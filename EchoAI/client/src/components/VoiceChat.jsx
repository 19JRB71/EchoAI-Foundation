import { useRef, useState } from "react";
import { api } from "../api.js";
import ErrorBanner from "./ErrorBanner.jsx";

/**
 * A simple, conversational voice interface: hold the microphone button to speak,
 * release to send. The recorded audio runs through the full voice loop and the
 * AI's spoken reply plays back automatically. A transcript is shown below.
 *
 * Props:
 *  - leadId: the prospect/lead this conversation belongs to
 *  - messages: the shared conversation history ([{ role, content }])
 *  - onExchange: called with { transcript, reply } after each completed turn
 *  - voice: optional TTS voice style
 */
export default function VoiceChat({ leadId, messages = [], onExchange, voice }) {
  const [recording, setRecording] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  async function startRecording() {
    if (loading || recording) return;
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        await sendAudio(blob);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setError("Microphone access is required for voice chat.");
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      setRecording(false);
    }
  }

  async function sendAudio(blob) {
    setLoading(true);
    setError("");
    try {
      const data = await api.voiceChat(leadId, blob, voice);
      if (onExchange) {
        onExchange({ transcript: data.transcript, reply: data.reply });
      }
      playAudio(data.audio, data.audioFormat);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function playAudio(base64, format) {
    if (!base64) return;
    const audio = new Audio(`data:${format || "audio/mpeg"};base64,${base64}`);
    audio.play().catch(() => {});
  }

  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        onPointerDown={startRecording}
        onPointerUp={stopRecording}
        onPointerLeave={stopRecording}
        disabled={loading}
        className={`flex h-24 w-24 items-center justify-center rounded-full text-white shadow-lg transition focus:outline-none focus:ring-4 focus:ring-indigo-300 disabled:opacity-60 ${
          recording
            ? "scale-110 animate-pulse bg-red-500"
            : "bg-indigo-600 hover:bg-indigo-700"
        }`}
        aria-label={recording ? "Release to send" : "Hold to speak"}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="h-10 w-10"
        >
          <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Z" />
          <path d="M19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V20H8a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2h-3v-2.08A7 7 0 0 0 19 11Z" />
        </svg>
      </button>

      <p className="mt-3 h-5 text-sm text-gray-500">
        {loading
          ? "Thinking…"
          : recording
            ? "Listening… release to send"
            : "Hold to speak"}
      </p>

      {loading && (
        <div className="mt-1 flex gap-1" aria-hidden="true">
          <span className="h-2 w-2 animate-bounce rounded-full bg-indigo-400 [animation-delay:-0.3s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-indigo-400 [animation-delay:-0.15s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-indigo-400" />
        </div>
      )}

      <div className="mt-4 w-full max-w-md">
        <ErrorBanner message={error} />
      </div>

      {messages.length > 0 && (
        <div className="mt-4 w-full max-w-md space-y-2">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`rounded-2xl px-4 py-2 text-sm ${
                m.role === "assistant"
                  ? "bg-gray-100 text-gray-800"
                  : "ml-auto bg-indigo-600 text-white"
              } max-w-[85%] ${m.role === "assistant" ? "" : "text-right"}`}
            >
              {m.content}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
