import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import Spinner from "../components/Spinner.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";

// A warm, natural OpenAI TTS voice for reading questions aloud.
const TTS_VOICE = "nova";

export default function BrandDiscovery({ brandId, onClose, onComplete }) {
  const [sessionId, setSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [completed, setCompleted] = useState(false);

  // Voice state.
  const [voiceOn, setVoiceOn] = useState(true);
  const [voiceGated, setVoiceGated] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  const scrollRef = useRef(null);
  const audioRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const activeRef = useRef(true);
  const voiceOnRef = useRef(voiceOn);
  voiceOnRef.current = voiceOn;

  function stopSpeaking() {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      if (audio._url) URL.revokeObjectURL(audio._url);
      audioRef.current = null;
    }
    setSpeaking(false);
  }

  // Voice endpoints are Pro-gated. When one returns 403, disable voice for the
  // rest of the session and keep the typed flow as the primary path.
  function disableVoiceGated() {
    setVoiceGated(true);
    setVoiceOn(false);
    voiceOnRef.current = false;
    stopSpeaking();
    setError("Voice requires the Professional plan — you can still type your answers.");
  }

  // Read a question aloud. Best-effort: autoplay may be blocked (offer replay),
  // and a 403 means voice isn't available on this plan (fall back to typing).
  async function speak(text) {
    if (!voiceOnRef.current || !text) return;
    let url;
    try {
      stopSpeaking();
      const blob = await api.textToSpeech(text, TTS_VOICE);
      if (!activeRef.current) return;
      url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio._url = url;
      audioRef.current = audio;
      audio.onended = () => {
        setSpeaking(false);
        URL.revokeObjectURL(url);
        if (audioRef.current === audio) audioRef.current = null;
      };
      setSpeaking(true);
      await audio.play();
    } catch (err) {
      setSpeaking(false);
      if (url) URL.revokeObjectURL(url);
      if (audioRef.current && audioRef.current._url === url) audioRef.current = null;
      if (err && err.status === 403) disableVoiceGated();
    }
  }

  // Start a fresh discovery session when the modal opens.
  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const data = await api.discovery({ brandId });
        if (!active) return;
        setSessionId(data.sessionId);
        if (data.reply) {
          setMessages([{ role: "assistant", content: data.reply }]);
          speak(data.reply);
        }
      } catch (err) {
        if (active) setError(err.message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId]);

  // Tear down audio + any in-flight recording when the modal unmounts so async
  // handlers can't fire (or advance discovery) after we're gone.
  useEffect(() => {
    return () => {
      activeRef.current = false;
      stopSpeaking();
      const mr = mediaRecorderRef.current;
      if (mr) {
        mr.ondataavailable = null;
        mr.onstop = null;
        try {
          if (mr.stream) mr.stream.getTracks().forEach((t) => t.stop());
          if (mr.state !== "inactive") mr.stop();
        } catch {
          /* recorder already torn down */
        }
      }
    };
  }, []);

  useEffect(() => {
    if (scrollRef.current)
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  async function sendText(text) {
    const trimmed = (text || "").trim();
    if (!trimmed || !sessionId) return;
    setMessages((m) => [...m, { role: "user", content: trimmed }]);
    setInput("");
    setSending(true);
    setError("");
    try {
      const data = await api.discovery({ sessionId, message: trimmed, brandId });
      if (!activeRef.current) return;
      if (data.reply) {
        setMessages((m) => [...m, { role: "assistant", content: data.reply }]);
        speak(data.reply);
      }
    } catch (err) {
      if (activeRef.current) setError(err.message);
    } finally {
      if (activeRef.current) setSending(false);
    }
  }

  function send(e) {
    e.preventDefault();
    sendText(input);
  }

  async function startRecording() {
    setError("");
    stopSpeaking();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size) chunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (!activeRef.current) return; // modal closed mid-recording
        setRecording(false);
        const blob = new Blob(chunksRef.current, {
          type: mr.mimeType || "audio/webm",
        });
        if (!blob.size) return;
        setTranscribing(true);
        try {
          const { text } = await api.speechToText(blob);
          if (!activeRef.current) return;
          if (text && text.trim()) await sendText(text.trim());
          else
            setError("I didn't catch that — please try again or type your answer.");
        } catch (err) {
          if (!activeRef.current) return;
          if (err && err.status === 403) disableVoiceGated();
          else
            setError(
              err.message ||
                "Couldn't understand the audio — try again or type your answer."
            );
        } finally {
          if (activeRef.current) setTranscribing(false);
        }
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setRecording(true);
    } catch {
      setError(
        "Microphone access was blocked. If you're viewing this inside the embedded preview, open the app in its own browser tab to use voice — or just type your answer below."
      );
    }
  }

  function stopRecording() {
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== "inactive") mr.stop();
  }

  function toggleRecording() {
    if (recording) stopRecording();
    else startRecording();
  }

  function toggleVoice() {
    if (voiceGated) return;
    setVoiceOn((on) => {
      if (on) stopSpeaking();
      return !on;
    });
  }

  const busy = loading || sending || transcribing;
  let status = "";
  if (recording) status = "Listening… tap the mic when you're done";
  else if (transcribing) status = "Transcribing your answer…";
  else if (speaking) status = "Speaking…";

  const showReplay = voiceOn && !voiceGated;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl bg-gray-900 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-800 p-4">
          <h3 className="text-lg font-bold text-gray-100">Brand discovery</h3>
          <div className="flex items-center gap-3">
            <button
              onClick={toggleVoice}
              disabled={voiceGated}
              title={
                voiceGated
                  ? "Voice requires the Professional plan"
                  : voiceOn
                    ? "Mute questions"
                    : "Read questions aloud"
              }
              className="text-gray-400 hover:text-gray-200 disabled:opacity-50"
            >
              {voiceOn && !voiceGated ? "🔊" : "🔇"}
            </button>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-200"
            >
              ✕
            </button>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
          {loading ? (
            <Spinner label="Starting conversation…" />
          ) : (
            messages.map((m, i) => (
              <div
                key={i}
                className={`flex items-end gap-2 ${
                  m.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    m.role === "user"
                      ? "bg-amber-500 text-gray-900"
                      : "bg-gray-800 text-gray-200"
                  }`}
                >
                  {m.content}
                </div>
                {m.role === "assistant" && showReplay && (
                  <button
                    onClick={() => speak(m.content)}
                    title="Replay"
                    className="shrink-0 text-gray-500 hover:text-gray-300"
                  >
                    🔊
                  </button>
                )}
              </div>
            ))
          )}
          {completed && (
            <p className="text-center text-sm font-medium text-green-500">
              Brand profile saved!
            </p>
          )}
        </div>

        <div className="border-t border-gray-800 p-4">
          <ErrorBanner message={error} />
          {status && (
            <p className="mb-2 text-center text-xs font-medium text-amber-400">
              {status}
            </p>
          )}
          {!completed && (
            <>
              <div className="mt-2 flex items-center gap-2">
                {!voiceGated && (
                  <button
                    type="button"
                    onClick={toggleRecording}
                    disabled={busy && !recording}
                    title={recording ? "Stop and send" : "Speak your answer"}
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg font-semibold transition disabled:opacity-60 ${
                      recording
                        ? "animate-pulse bg-red-500 text-white"
                        : "bg-amber-500 text-gray-900 hover:bg-amber-600"
                    }`}
                  >
                    {recording ? "■" : "🎤"}
                  </button>
                )}
                <form onSubmit={send} className="flex flex-1 gap-2">
                  <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={
                      recording ? "Listening…" : "Speak, or type your answer…"
                    }
                    disabled={busy || recording}
                    className="flex-1 rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                  <button
                    type="submit"
                    disabled={busy || recording || !input.trim()}
                    className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-60"
                  >
                    Send
                  </button>
                </form>
              </div>
              <button
                onClick={confirm}
                disabled={busy || recording || messages.length === 0}
                className="mt-2 w-full rounded-lg border border-amber-500 px-4 py-2 text-sm font-semibold text-amber-300 hover:bg-amber-500/10 disabled:opacity-60"
              >
                Finish &amp; save brand profile
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );

  async function confirm() {
    if (!sessionId) return;
    stopSpeaking();
    setSending(true);
    setError("");
    try {
      const data = await api.discovery({ sessionId, confirm: true, brandId });
      if (!activeRef.current) return;
      if (data.status === "completed") {
        setCompleted(true);
        if (onComplete) onComplete();
      }
    } catch (err) {
      if (activeRef.current) setError(err.message);
    } finally {
      if (activeRef.current) setSending(false);
    }
  }
}
