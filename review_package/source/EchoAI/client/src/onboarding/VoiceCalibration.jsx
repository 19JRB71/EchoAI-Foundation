/**
 * Voice Calibration — a short, friendly conversation (3–4 minutes) that
 * learns the user's natural speech rhythm BEFORE business setup.
 *
 * Echo asks a mix of easy questions (people answer instantly) and
 * think-first questions (pause… talk… pause), silently measuring pause
 * lengths, speaking pace, and continuation habits ("and… but… so…"), then
 * runs a live stop-command test. The result is a per-user voice profile
 * (Fast / Balanced / Patient Listener + tuned end-of-turn timings) the
 * conversation engine applies from then on.
 *
 * Privacy: transcripts are analyzed in the browser for timing only — what
 * is SAID is never stored. Only numeric rhythm stats persist in the profile.
 *
 * Mic coordination: broadcasts `echoai:calibration-state` {active} so the
 * always-on engine releases the mic while this screen runs its own
 * recognizer, and resumes afterward.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { recordVoiceEvent } from "../voice/flightRecorder.js";
import {
  CALIBRATION_QUESTIONS,
  isUserStopCommand,
  STYLE_LABELS,
  PROFILE_PRESETS,
  analyzeAnswer,
  summarizeAnswers,
  recommendProfile,
  profileForStyle,
  describeProfile,
} from "../voice/calibration.js";

function getSpeechRecognition() {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

// How long a silence ends an answer. Deliberately GENEROUS (much longer than
// any live-conversation wait) — cutting someone off during the tool that's
// supposed to learn their pauses would be self-defeating.
const ANSWER_SILENCE_MS = 3500;
// Don't end an answer before the user has said at least a few words.
const MIN_ANSWER_WORDS = 3;
// Hard cap per answer so a wedged recognizer can never hang the flow.
const ANSWER_CAP_MS = 90000;

// IMPORTANT: this spoken script must NEVER contain the interrupt words
// themselves ("stop", "wait", "hold on") — the microphone hears Echo's own
// voice, and a self-spoken trigger word ends the test with the user silent
// (observed in CEO testing July 2026). The trigger words are shown on screen
// instead; Echo only points at them.
const STOP_TEST_TEXT =
  "Now let's test interruptions. I'm going to keep talking for a little while, " +
  "and whenever you feel like it, just cut me off using one of the words on your " +
  "screen. I'll keep going until you do. Businesses that respond to new leads " +
  "within five minutes are far more likely to win the customer, which is why " +
  "speed matters so much, and why having an assistant that listens properly " +
  "makes all the...";


export default function VoiceCalibration({ onComplete, onSkip }) {
  const supported = Boolean(getSpeechRecognition());
  // step: intro | question | stopTest | summary | saving | error
  const [step, setStep] = useState("intro");
  const [qIndex, setQIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [liveText, setLiveText] = useState("");
  const [error, setError] = useState("");
  const [stopResult, setStopResult] = useState("skipped"); // passed|failed|skipped
  const [recommended, setRecommended] = useState(null);
  const [chosenStyle, setChosenStyle] = useState(null);
  const [summaryLines, setSummaryLines] = useState([]);

  const answerStatsRef = useRef([]);
  const eventsRef = useRef([]);
  const recRef = useRef(null);
  const audioRef = useRef(null);
  const doneRef = useRef(false);
  const answerTimerRef = useRef(null);
  const answerResolveRef = useRef(null);
  const stopHeardRef = useRef(false);

  // Tell the always-on engine to release the mic while we're here.
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("echoai:calibration-state", { detail: { active: true } }),
    );
    recordVoiceEvent("calibration-started", { supported });
    return () => {
      doneRef.current = true;
      stopRecognizer();
      stopAudio();
      window.dispatchEvent(
        new CustomEvent("echoai:calibration-state", { detail: { active: false } }),
      );
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopAudio() {
    const el = audioRef.current;
    if (el) {
      try {
        el.pause();
        el.src = "";
      } catch {
        /* already stopped */
      }
      audioRef.current = null;
    }
  }

  function stopRecognizer() {
    const rec = recRef.current;
    recRef.current = null;
    if (rec) {
      rec.onresult = null;
      rec.onend = null;
      rec.onerror = null;
      try {
        rec.abort();
      } catch {
        /* already dead */
      }
    }
    if (answerTimerRef.current) {
      clearInterval(answerTimerRef.current);
      answerTimerRef.current = null;
    }
  }

  // Speak `text` in Echo's voice; resolves when playback ends (or fails —
  // calibration must keep moving even if TTS is down; the on-screen text
  // always shows the question).
  const speak = useCallback(async (text) => {
    setSpeaking(true);
    try {
      const blob = await api.echoVoiceSpeak(text);
      await new Promise((resolve) => {
        const el = new Audio(URL.createObjectURL(blob));
        audioRef.current = el;
        el.onended = resolve;
        el.onerror = resolve;
        el.onpause = resolve; // stop-test barge-in pauses playback
        el.play().catch(resolve);
      });
    } catch {
      /* TTS unavailable — text on screen carries the step */
    } finally {
      setSpeaking(false);
    }
  }, []);

  // Listen for one answer; resolves with the raw timing events.
  const listenForAnswer = useCallback(() => {
    return new Promise((resolve) => {
      const SR = getSpeechRecognition();
      if (!SR) {
        resolve([]);
        return;
      }
      eventsRef.current = [];
      let finals = "";
      let lastEventAt = 0;
      const startedAt = Date.now();
      answerResolveRef.current = resolve;

      const finish = () => {
        if (answerResolveRef.current !== resolve) return;
        answerResolveRef.current = null;
        stopRecognizer();
        setListening(false);
        resolve(eventsRef.current);
      };

      const rec = new SR();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = (typeof navigator !== "undefined" && navigator.language) || "en-US";
      rec.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i += 1) {
          const chunk = e.results[i][0].transcript;
          if (e.results[i].isFinal) finals = `${finals} ${chunk}`.trim();
          else interim += chunk;
        }
        const text = `${finals} ${interim}`.trim();
        if (!text) return;
        lastEventAt = Date.now();
        eventsRef.current.push({ at: lastEventAt, text });
        setLiveText(text);
      };
      rec.onerror = (e) => {
        const code = e && e.error;
        if (code === "not-allowed" || code === "service-not-allowed" || code === "audio-capture") {
          recordVoiceEvent("calibration-mic-error", { code });
          finish();
        }
      };
      rec.onend = () => {
        // Browser sessions self-terminate; restart until the answer is done.
        if (doneRef.current || answerResolveRef.current !== resolve) return;
        try {
          rec.start();
        } catch {
          finish();
        }
      };
      recRef.current = rec;
      try {
        rec.start();
        setListening(true);
        setLiveText("");
      } catch {
        finish();
        return;
      }

      answerTimerRef.current = setInterval(() => {
        const now = Date.now();
        const words = finals ? finals.split(/\s+/).length : 0;
        if (
          lastEventAt &&
          words >= MIN_ANSWER_WORDS &&
          now - lastEventAt >= ANSWER_SILENCE_MS
        ) {
          finish();
        } else if (now - startedAt >= ANSWER_CAP_MS) {
          finish();
        }
      }, 400);
    });
  }, []);

  // "I'm done answering" button — resolves the pending answer immediately.
  const finishAnswerNow = useCallback(() => {
    const resolve = answerResolveRef.current;
    if (resolve) {
      answerResolveRef.current = null;
      stopRecognizer();
      setListening(false);
      resolve(eventsRef.current);
    }
  }, []);

  const runQuestion = useCallback(
    async (index) => {
      const q = CALIBRATION_QUESTIONS[index];
      setQIndex(index);
      setStep("question");
      setLiveText("");
      recordVoiceEvent("calibration-question", { id: q.id, kind: q.kind });
      await speak(q.text);
      if (doneRef.current) return;
      const events = await listenForAnswer();
      if (doneRef.current) return;
      const stats = analyzeAnswer(events);
      answerStatsRef.current.push(stats);
      recordVoiceEvent("calibration-answer", {
        id: q.id,
        pauseCount: stats.pauseCount,
        maxPauseMs: stats.maxPauseMs,
        continuationResumes: stats.continuationResumes,
        wordCount: stats.wordCount,
      });
      if (index + 1 < CALIBRATION_QUESTIONS.length) {
        await runQuestion(index + 1);
      } else {
        await runStopTest();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [speak, listenForAnswer],
  );

  const runStopTest = useCallback(async () => {
    setStep("stopTest");
    setLiveText("");
    stopHeardRef.current = false;
    recordVoiceEvent("calibration-stop-test-started", {});

    // Listen WHILE Echo talks — the whole point is barge-in.
    const SR = getSpeechRecognition();
    let rec = null;
    if (SR) {
      rec = new SR();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = (typeof navigator !== "undefined" && navigator.language) || "en-US";
      rec.onresult = (e) => {
        // Evaluate each recognizer segment on its own: the mic often hears
        // Echo's OWN stop-test speech (which literally says "say Stop, or
        // Wait, or Hold on"), so a naive keyword match on the concatenated
        // transcript self-triggers with the user silent. isUserStopCommand
        // filters out segments that are fragments of the spoken script.
        for (let i = e.resultIndex; i < e.results.length; i += 1) {
          const segment = e.results[i][0].transcript;
          if (!stopHeardRef.current && isUserStopCommand(segment, STOP_TEST_TEXT)) {
            stopHeardRef.current = true;
            stopAudio(); // halt Echo mid-sentence, exactly like real barge-in
          }
        }
      };
      rec.onend = () => {
        if (!doneRef.current && recRef.current === rec && !stopHeardRef.current) {
          try {
            rec.start();
          } catch {
            /* stop test continues without mic */
          }
        }
      };
      recRef.current = rec;
      try {
        rec.start();
      } catch {
        rec = null;
      }
    }

    await speak(STOP_TEST_TEXT);
    stopRecognizer();
    const result = stopHeardRef.current ? "passed" : rec ? "failed" : "skipped";
    setStopResult(result);
    recordVoiceEvent("calibration-stop-test", { result });

    const summary = summarizeAnswers(answerStatsRef.current);
    const rec2 = recommendProfile(summary, { stopTest: result });
    setRecommended(rec2);
    setChosenStyle(rec2.style);
    setSummaryLines(describeProfile(rec2));
    if (stopHeardRef.current) {
      await speak("Got it — I stopped the moment you cut in. That's exactly how it'll work.");
    }
    await speak(
      "That's everything I need. Take a look at what I learned about how you talk — you can pick how patient you want me to be.",
    );
    setStep("summary");
  }, [speak]);

  const begin = useCallback(async () => {
    setBusy(true);
    await speak(
      "Before we set up your business, let's talk for a few minutes so I can learn how you communicate. This helps me avoid interrupting you and respond more naturally. There are no wrong answers — just talk the way you normally do, and take all the time you need.",
    );
    setBusy(false);
    if (!doneRef.current) await runQuestion(0);
  }, [speak, runQuestion]);

  const save = useCallback(async () => {
    if (!recommended) return;
    const profile = chosenStyle === recommended.style ? recommended : profileForStyle(chosenStyle, recommended);
    setStep("saving");
    setError("");
    try {
      const data = await api.echoVoiceGetSettings();
      const settings = { ...(data && data.settings), voiceProfile: profile };
      await api.echoVoiceSaveSettings({ settings });
      recordVoiceEvent("calibration-saved", {
        style: profile.style,
        activePauseMs: profile.activePauseMs,
      });
      if (onComplete) onComplete(profile);
    } catch (e) {
      setError(e.message || "Couldn't save your voice profile.");
      setStep("summary");
    }
  }, [recommended, chosenStyle, onComplete]);

  const skip = useCallback(() => {
    recordVoiceEvent("calibration-skipped", { atStep: step });
    if (onSkip) onSkip();
  }, [step, onSkip]);

  const q = CALIBRATION_QUESTIONS[qIndex];

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 rounded-2xl border border-white/10 bg-white/5 p-6 text-white">
      <div className="flex items-center gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-400 to-emerald-600 text-lg font-black text-black">
          E
        </div>
        <div>
          <h2 className="text-lg font-bold">Voice calibration</h2>
          <p className="text-sm text-white/60">
            A few minutes of conversation so Echo learns your rhythm — and never talks over you.
          </p>
        </div>
      </div>

      {!supported ? (
        <div className="flex flex-col gap-4">
          <p className="text-white/80">
            This browser can't do live speech recognition, so Echo can't run the calibration
            conversation here. You can still pick a listener style in Voice Settings — and
            calibrate any time from a browser like Chrome, Edge, or Safari.
          </p>
          <button
            type="button"
            onClick={skip}
            className="self-start rounded-xl bg-teal-500 px-5 py-2.5 font-semibold text-black hover:bg-teal-400"
          >
            Continue without calibrating
          </button>
        </div>
      ) : step === "intro" ? (
        <div className="flex flex-col gap-4">
          <p className="text-white/80">
            Echo will ask you a few easy questions and a couple that make you think. While you
            talk, it quietly measures your natural pauses, your pace, and how you trail off
            mid-thought — then builds a listening profile just for you. It also runs a quick
            &ldquo;say Stop to cut me off&rdquo; test.
          </p>
          <p className="text-sm text-white/50">
            Privacy: what you say is analyzed on this device for timing only. Echo keeps the
            rhythm numbers — never a recording or transcript of your answers.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={begin}
              disabled={busy}
              className="rounded-xl bg-teal-500 px-5 py-2.5 font-semibold text-black hover:bg-teal-400 disabled:opacity-50"
            >
              {busy ? "Starting…" : "Start the conversation"}
            </button>
            <button
              type="button"
              onClick={skip}
              className="rounded-xl border border-white/15 px-5 py-2.5 font-semibold text-white/70 hover:text-white"
            >
              Skip for now
            </button>
          </div>
        </div>
      ) : step === "question" ? (
        <div className="flex flex-col gap-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-teal-300">
            Question {qIndex + 1} of {CALIBRATION_QUESTIONS.length}
            {q.kind === "thinking" ? " — take your time on this one" : ""}
          </p>
          <p className="text-lg font-medium text-white/90">{q.text}</p>
          {speaking ? (
            <p className="text-sm text-white/50">Echo is asking…</p>
          ) : listening ? (
            <div className="flex flex-col gap-2">
              <p className="flex items-center gap-2 text-sm text-emerald-300">
                <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-400" />
                Listening — pause as long as you like, Echo won't jump in.
              </p>
              {liveText ? (
                <p className="rounded-xl bg-black/30 p-3 text-sm text-white/70">{liveText}</p>
              ) : null}
              <button
                type="button"
                onClick={finishAnswerNow}
                className="self-start rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-white/70 hover:text-white"
              >
                I'm done answering
              </button>
            </div>
          ) : (
            <p className="text-sm text-white/50">One moment…</p>
          )}
          <button
            type="button"
            onClick={skip}
            className="self-start text-sm text-white/40 underline hover:text-white/70"
          >
            Skip calibration
          </button>
        </div>
      ) : step === "stopTest" ? (
        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-teal-300">
            Interruption test
          </p>
          <p className="text-lg font-medium text-white/90">
            Echo is going to keep talking — cut it off whenever you like. Say{" "}
            <span className="font-bold text-white">&ldquo;Stop&rdquo;</span>,{" "}
            <span className="font-bold text-white">&ldquo;Wait&rdquo;</span> or{" "}
            <span className="font-bold text-white">&ldquo;Hold on&rdquo;</span>.
          </p>
          <p className="text-sm text-white/50">
            {speaking ? "Echo is talking — interrupt it!" : "Wrapping up…"}
          </p>
        </div>
      ) : step === "summary" || step === "saving" ? (
        <div className="flex flex-col gap-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-teal-300">
            What Echo learned
          </p>
          <ul className="flex flex-col gap-2">
            {summaryLines.map((line) => (
              <li key={line} className="rounded-xl bg-black/30 p-3 text-sm text-white/80">
                {line}
              </li>
            ))}
          </ul>
          <p className="text-sm text-white/60">
            Pick how patient Echo should be. The recommended style is highlighted — you can
            change it any time in Voice Settings.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {Object.keys(PROFILE_PRESETS).map((style) => (
              <button
                key={style}
                type="button"
                onClick={() => setChosenStyle(style)}
                aria-pressed={chosenStyle === style}
                className={`rounded-xl border p-3 text-left ${
                  chosenStyle === style
                    ? "border-teal-400 bg-teal-500/15"
                    : "border-white/10 bg-white/5 hover:border-white/25"
                }`}
              >
                <span className="block font-semibold">
                  {STYLE_LABELS[style]}
                  {recommended && recommended.style === style ? (
                    <span className="ml-2 rounded-full bg-teal-500/20 px-2 py-0.5 text-xs text-teal-300">
                      Recommended
                    </span>
                  ) : null}
                </span>
                <span className="mt-1 block text-xs text-white/50">
                  Waits {(PROFILE_PRESETS[style].activePauseMs / 1000).toFixed(1)}s before
                  answering
                </span>
              </button>
            ))}
          </div>
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={save}
              disabled={step === "saving"}
              className="rounded-xl bg-teal-500 px-5 py-2.5 font-semibold text-black hover:bg-teal-400 disabled:opacity-50"
            >
              {step === "saving" ? "Saving…" : "Save my voice profile"}
            </button>
            <button
              type="button"
              onClick={skip}
              className="rounded-xl border border-white/15 px-5 py-2.5 font-semibold text-white/70 hover:text-white"
            >
              Don't save
            </button>
          </div>
        </div>
      ) : null}

      <p className="text-xs text-white/40">
        Stop-test result so far: {stopResult === "passed" ? "Echo stops when you cut in ✓" : stopResult === "failed" ? "not registered yet" : "not run yet"}
      </p>
    </div>
  );
}
