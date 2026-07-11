import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api.js";

// Show the contact-capture form once the prospect has had a couple of exchanges.
const CONTACT_AFTER_EXCHANGES = 2;

export default function VoiceLandingPage() {
  const { brandId } = useParams();

  const [brand, setBrand] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [leadId, setLeadId] = useState(null);

  const [messages, setMessages] = useState([]); // [{ role, content }]
  const [exchanges, setExchanges] = useState(0);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [micError, setMicError] = useState("");

  const [contactSaved, setContactSaved] = useState(false);
  const [closed, setClosed] = useState(false);

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const transcriptEndRef = useRef(null);

  // Load the brand profile and open the conversation as soon as the page mounts.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const profile = await api.getPublicBrand(brandId);
        if (!active) return;
        setBrand(profile);
      } catch (err) {
        if (active) setLoadError(err.message || "This page is unavailable.");
        return;
      }
      try {
        const { leadId: id, greeting } = await api.startVoiceLead(brandId);
        if (!active) return;
        setLeadId(id);
        if (greeting) {
          setMessages([{ role: "assistant", content: greeting }]);
        }
      } catch {
        // Brand loaded but the opening greeting failed — the prospect can still
        // tap the mic to begin once a lead is available.
      }
    })();
    return () => {
      active = false;
    };
  }, [brandId]);

  // Keep the latest transcript line in view.
  useEffect(() => {
    if (transcriptEndRef.current) {
      transcriptEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  async function toggleRecording() {
    if (busy || !leadId || closed) return;
    if (recording) {
      stopRecording();
      return;
    }
    await startRecording();
  }

  async function startRecording() {
    setMicError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
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
      setMicError("Please allow microphone access to start the conversation.");
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      setRecording(false);
    }
  }

  async function sendAudio(blob) {
    setBusy(true);
    setMicError("");
    try {
      const data = await api.voiceChat(leadId, blob);
      setMessages((prev) => [
        ...prev,
        { role: "user", content: data.transcript },
        { role: "assistant", content: data.reply },
      ]);
      setExchanges((n) => n + 1);
      playAudio(data.audio, data.audioFormat);
    } catch (err) {
      setMicError(err.message || "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function playAudio(base64, format) {
    if (!base64) return;
    const audio = new Audio(`data:${format || "audio/mpeg"};base64,${base64}`);
    audio.play().catch(() => {});
  }

  const showContact =
    !contactSaved && !closed && exchanges >= CONTACT_AFTER_EXCHANGES;

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black p-6 text-center">
        <p className="text-gray-400">{loadError}</p>
      </div>
    );
  }

  if (!brand) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-gray-800 border-t-amber-500" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-black text-gray-100">
      {/* Section 1: Business header (the customer's brand, no Zorecho branding) */}
      <header className="border-b border-gray-800 bg-gray-900 px-6 py-5 text-center">
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
          {brand.businessName}
        </h1>
        {brand.tagline && (
          <p className="mx-auto mt-1 max-w-xl text-sm text-gray-400 sm:text-base">
            {brand.tagline}
          </p>
        )}
      </header>

      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col px-5 py-8">
        {closed ? (
          /* Section 4: Closing confirmation */
          <Closing />
        ) : (
          <>
            {/* Section 2: Voice chatbot interface */}
            <div className="flex flex-col items-center">
              <button
                type="button"
                onClick={toggleRecording}
                disabled={busy || !leadId}
                aria-label={recording ? "Stop recording" : "Start speaking"}
                className={`relative flex h-32 w-32 items-center justify-center rounded-full text-white shadow-xl transition focus:outline-none focus:ring-4 focus:ring-amber-500/40 disabled:opacity-60 ${
                  recording
                    ? "bg-red-500"
                    : "bg-amber-500 hover:bg-amber-600"
                }`}
              >
                {!recording && !busy && (
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-40" />
                )}
                <MicIcon className="relative h-12 w-12" />
              </button>
              <p className="mt-5 h-5 text-sm font-medium text-gray-400">
                {busy
                  ? "Thinking…"
                  : recording
                  ? "Listening… tap to send"
                  : leadId
                  ? "Tap to speak"
                  : "Starting…"}
              </p>
              {micError && (
                <p className="mt-2 text-center text-sm text-red-600">{micError}</p>
              )}
            </div>

            {/* Live transcript */}
            <div className="mt-8 flex-1 space-y-3 overflow-y-auto">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`flex ${
                    m.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed ${
                      m.role === "user"
                        ? "bg-amber-500 text-gray-900"
                        : "bg-gray-900 text-gray-200 shadow-sm ring-1 ring-gray-700"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              <div ref={transcriptEndRef} />
            </div>

            {/* Section 3: Contact capture */}
            {showContact && (
              <ContactForm
                leadId={leadId}
                onSaved={() => setContactSaved(true)}
              />
            )}

            {(contactSaved || exchanges >= CONTACT_AFTER_EXCHANGES) && (
              <button
                type="button"
                onClick={() => {
                  stopRecording();
                  setClosed(true);
                }}
                className="mt-6 w-full rounded-xl border border-gray-700 bg-gray-900 py-3 font-semibold text-gray-300 transition hover:bg-gray-800"
              >
                Finish conversation
              </button>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function ContactForm({ leadId, onSaved }) {
  const [form, setForm] = useState({ name: "", phone: "", email: "" });
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setStatus("saving");
    try {
      await api.saveLeadContact(leadId, form);
      setStatus("idle");
      onSaved();
    } catch (err) {
      setError(err.message || "Could not save your details. Please try again.");
      setStatus("idle");
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-8 rounded-2xl border border-gray-800 bg-gray-900 p-5 shadow-sm"
    >
      <h2 className="text-lg font-bold text-gray-100">
        Where can we reach you?
      </h2>
      <p className="mt-1 text-sm text-gray-400">
        Leave your details and we'll follow up shortly.
      </p>
      <div className="mt-4 space-y-3">
        <input
          type="text"
          required
          placeholder="Your name"
          autoComplete="name"
          value={form.name}
          onChange={(e) => update("name", e.target.value)}
          className="w-full rounded-xl border border-gray-700 px-4 py-3 text-base outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/40"
        />
        <input
          type="tel"
          required
          placeholder="Phone number"
          autoComplete="tel"
          value={form.phone}
          onChange={(e) => update("phone", e.target.value)}
          className="w-full rounded-xl border border-gray-700 px-4 py-3 text-base outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/40"
        />
        <input
          type="email"
          required
          placeholder="Email address"
          autoComplete="email"
          value={form.email}
          onChange={(e) => update("email", e.target.value)}
          className="w-full rounded-xl border border-gray-700 px-4 py-3 text-base outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/40"
        />
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={status === "saving"}
        className="mt-4 w-full rounded-xl bg-amber-500 py-3 text-base font-semibold text-gray-900 transition hover:bg-amber-600 disabled:opacity-60"
      >
        {status === "saving" ? "Saving…" : "Send my details"}
      </button>
    </form>
  );
}

function Closing() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-amber-500/15 text-4xl text-amber-300">
        ✓
      </div>
      <h2 className="mt-6 text-2xl font-bold text-gray-100">Thank you!</h2>
      <p className="mt-3 max-w-sm text-gray-400">
        Thanks for chatting with us. Someone from our team will be in touch
        shortly.
      </p>
    </div>
  );
}

function MicIcon({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}
