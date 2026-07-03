import { useState, useRef, useEffect, useCallback } from "react";
import { api } from "../api.js";

// Voice-input engine for the Setup Agent.
//
// Two transcription methods with automatic fallback, chosen once on load:
//   - "webspeech": the browser's native Web Speech API (Chrome/Edge/Safari).
//     Real-time, no backend call — the fastest option.
//   - "whisper": records with MediaRecorder and posts the audio blob to
//     /api/setup-agent/transcribe (OpenAI Whisper) when Web Speech is absent.
//
// Mobile vs desktop behavior:
//   - Mobile: a natural 2s pause auto-stops recording and auto-submits, so the
//     user never has to tap twice.
//   - Desktop: the user explicitly clicks the mic again to stop, leaving time to
//     think; the transcript is populated for review before they click Next.

const AUTO_SUBMIT_PAUSE_MS = 2000;
// Silence detection threshold for the Whisper (MediaRecorder) path. Normalized
// RMS below this counts as "quiet".
const SILENCE_RMS = 0.015;

export function detectIsMobile() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const coarse =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  return /Mobi|Android|iPhone|iPad|iPod/i.test(ua) || (navigator.maxTouchPoints || 0) > 0 || coarse;
}

function getSpeechRecognition() {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export function detectVoiceMethod() {
  if (getSpeechRecognition()) return "webspeech";
  const hasRecorder =
    typeof window !== "undefined" &&
    typeof window.MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function";
  return hasRecorder ? "whisper" : null;
}

function friendlyMicError(code) {
  if (code === "not-allowed" || code === "service-not-allowed" || code === "NotAllowedError") {
    return "Microphone access was blocked. Allow it in your browser, or type your answer instead.";
  }
  if (code === "no-speech") {
    return "I didn't catch that — try speaking again, or type your answer.";
  }
  if (code === "audio-capture" || code === "NotFoundError") {
    return "No microphone was found. Type your answer instead.";
  }
  return "Voice input isn't working right now — you can type your answer instead.";
}

export function useVoiceInput({ onTranscript, onAutoSubmit, isMobile }) {
  const [method] = useState(detectVoiceMethod);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState("");

  // Web Speech
  const recognitionRef = useRef(null);
  const finalRef = useRef("");
  // MediaRecorder / Whisper
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const rafRef = useRef(null);
  // Shared
  const pauseTimerRef = useRef(null);
  const isMobileRef = useRef(isMobile);
  isMobileRef.current = isMobile;
  const cbRef = useRef({ onTranscript, onAutoSubmit });
  cbRef.current = { onTranscript, onAutoSubmit };

  const clearError = useCallback(() => setError(""), []);

  const clearPauseTimer = useCallback(() => {
    if (pauseTimerRef.current) {
      clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = null;
    }
  }, []);

  // Fully tear down any in-flight capture. Safe to call repeatedly.
  const teardown = useCallback(() => {
    clearPauseTimer();
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const rec = recognitionRef.current;
    if (rec) {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
      recognitionRef.current = null;
    }
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== "inactive") {
      try {
        mr.stop();
      } catch {
        /* already stopped */
      }
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      try {
        audioCtxRef.current.close();
      } catch {
        /* ignore */
      }
      audioCtxRef.current = null;
      analyserRef.current = null;
    }
  }, [clearPauseTimer]);

  // Clean up on unmount.
  useEffect(() => teardown, [teardown]);

  // ---- Web Speech ----------------------------------------------------------

  const stopWebSpeech = useCallback(() => {
    clearPauseTimer();
    const rec = recognitionRef.current;
    if (rec) {
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    }
  }, [clearPauseTimer]);

  const startWebSpeech = useCallback(() => {
    const SR = getSpeechRecognition();
    if (!SR) {
      setError(friendlyMicError());
      return;
    }
    finalRef.current = "";
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = (typeof navigator !== "undefined" && navigator.language) || "en-US";

    rec.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const chunk = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalRef.current = `${finalRef.current} ${chunk}`.trim();
        } else {
          interim += chunk;
        }
      }
      const text = `${finalRef.current} ${interim}`.trim();
      cbRef.current.onTranscript(text);

      // On mobile, a 2s pause auto-stops + auto-submits so users don't tap twice.
      if (isMobileRef.current) {
        clearPauseTimer();
        pauseTimerRef.current = setTimeout(() => {
          stopWebSpeech();
          const finalText = finalRef.current.trim();
          if (finalText) cbRef.current.onAutoSubmit(finalText);
        }, AUTO_SUBMIT_PAUSE_MS);
      }
    };
    rec.onerror = (event) => {
      setError(friendlyMicError(event && event.error));
      setRecording(false);
      clearPauseTimer();
    };
    rec.onend = () => {
      setRecording(false);
      clearPauseTimer();
      recognitionRef.current = null;
    };

    recognitionRef.current = rec;
    try {
      rec.start();
      setError("");
      setRecording(true);
    } catch {
      setError(friendlyMicError());
      setRecording(false);
    }
  }, [clearPauseTimer, stopWebSpeech]);

  // ---- Whisper (MediaRecorder) --------------------------------------------

  const stopWhisper = useCallback(() => {
    clearPauseTimer();
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== "inactive") {
      try {
        mr.stop();
      } catch {
        /* ignore */
      }
    }
  }, [clearPauseTimer]);

  const startWhisper = useCallback(async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError(friendlyMicError());
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      setError(friendlyMicError(err && err.name));
      return;
    }
    streamRef.current = stream;
    chunksRef.current = [];

    // Release the just-acquired mic if anything below fails, so a failed start
    // never leaves the stream (and its "recording" indicator) live.
    const releaseStream = () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };

    let mr;
    try {
      mr = new MediaRecorder(stream);
    } catch {
      releaseStream();
      setError(friendlyMicError());
      setRecording(false);
      return;
    }
    mediaRecorderRef.current = mr;
    mr.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    mr.onstop = async () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (audioCtxRef.current) {
        try {
          audioCtxRef.current.close();
        } catch {
          /* ignore */
        }
        audioCtxRef.current = null;
        analyserRef.current = null;
      }
      setRecording(false);
      const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
      chunksRef.current = [];
      if (!blob.size) return;
      setTranscribing(true);
      try {
        const { text } = await api.transcribeSetupVoice(blob);
        const clean = (text || "").trim();
        if (clean) {
          cbRef.current.onTranscript(clean);
          if (isMobileRef.current) cbRef.current.onAutoSubmit(clean);
        } else {
          setError("I didn't catch that — try speaking again, or type your answer.");
        }
      } catch (err) {
        setError(err.message || "Could not transcribe your voice. Type your answer instead.");
      } finally {
        setTranscribing(false);
      }
    };

    try {
      mr.start();
      setError("");
      setRecording(true);
    } catch {
      releaseStream();
      mediaRecorderRef.current = null;
      setError(friendlyMicError());
      setRecording(false);
      return;
    }

    // Mobile: watch the mic level and auto-stop after a 2s natural pause.
    if (isMobileRef.current) {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        const ctx = new AudioCtx();
        audioCtxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);
        analyserRef.current = analyser;
        const data = new Uint8Array(analyser.fftSize);
        let spokeAtLeastOnce = false;

        const tick = () => {
          if (!analyserRef.current) return;
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i += 1) {
            const v = (data[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / data.length);
          if (rms > SILENCE_RMS) {
            spokeAtLeastOnce = true;
            clearPauseTimer();
            pauseTimerRef.current = null;
          } else if (spokeAtLeastOnce && !pauseTimerRef.current) {
            pauseTimerRef.current = setTimeout(() => stopWhisper(), AUTO_SUBMIT_PAUSE_MS);
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch {
        /* silence detection is best-effort; explicit stop still works */
      }
    }
  }, [clearPauseTimer, stopWhisper]);

  // ---- Public API ----------------------------------------------------------

  const start = useCallback(() => {
    if (recording || transcribing) return;
    setError("");
    if (method === "webspeech") startWebSpeech();
    else if (method === "whisper") startWhisper();
    else setError(friendlyMicError());
  }, [method, recording, transcribing, startWebSpeech, startWhisper]);

  const stop = useCallback(() => {
    if (method === "webspeech") stopWebSpeech();
    else if (method === "whisper") stopWhisper();
  }, [method, stopWebSpeech, stopWhisper]);

  const toggle = useCallback(() => {
    if (recording) stop();
    else start();
  }, [recording, start, stop]);

  return {
    supported: method !== null,
    method,
    recording,
    transcribing,
    error,
    clearError,
    start,
    stop,
    toggle,
  };
}
