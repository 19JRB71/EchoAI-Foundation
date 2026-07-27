import { useState } from "react";
import { api } from "../api.js";
import VoiceChat from "../components/VoiceChat.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";

function defaultMode() {
  if (typeof window === "undefined" || !window.matchMedia) return "text";
  // Default to voice on mobile devices, text on desktop.
  return window.matchMedia("(max-width: 767px)").matches ? "voice" : "text";
}

/**
 * The lead qualification chatbot for prospects. Works in either text mode or
 * voice mode, with a toggle to switch between them. The conversation history is
 * shared across both modes.
 *
 * Props:
 *  - leadId: the prospect/lead this conversation belongs to
 */
export default function LeadQualificationChat({ leadId }) {
  const [mode, setMode] = useState(defaultMode);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  function append(role, content) {
    setMessages((prev) => [...prev, { role, content }]);
  }

  async function sendText(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    setInput("");
    setError("");
    append("user", text);
    setSending(true);
    try {
      const data = await api.leadChat(leadId, text);
      append("assistant", data.reply);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  function handleVoiceExchange({ transcript, reply }) {
    append("user", transcript);
    append("assistant", reply);
  }

  return (
    <div className="mx-auto flex max-w-md flex-col rounded-2xl bg-gray-900 p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-100">Let's chat</h2>
        <div className="flex rounded-lg bg-gray-800 p-1 text-sm font-medium">
          <button
            onClick={() => setMode("text")}
            className={`rounded-md px-3 py-1 transition ${
              mode === "text"
                ? "bg-gray-900 text-amber-300 shadow-sm"
                : "text-gray-400"
            }`}
          >
            Text
          </button>
          <button
            onClick={() => setMode("voice")}
            className={`rounded-md px-3 py-1 transition ${
              mode === "voice"
                ? "bg-gray-900 text-amber-300 shadow-sm"
                : "text-gray-400"
            }`}
          >
            Voice
          </button>
        </div>
      </div>

      {mode === "voice" ? (
        <VoiceChat
          leadId={leadId}
          messages={messages}
          onExchange={handleVoiceExchange}
        />
      ) : (
        <div className="flex flex-col">
          <div className="mb-3 max-h-80 space-y-2 overflow-y-auto">
            {messages.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-400">
                Send a message to start the conversation.
              </p>
            ) : (
              messages.map((m, i) => (
                <div
                  key={i}
                  className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${
                    m.role === "assistant"
                      ? "bg-gray-800 text-gray-200"
                      : "ml-auto bg-amber-500 text-gray-900"
                  }`}
                >
                  {m.content}
                </div>
              ))
            )}
          </div>

          <ErrorBanner message={error} />

          <form onSubmit={sendText} className="mt-2 flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type your message…"
              className="flex-1 rounded-lg border border-gray-700 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
            <button
              type="submit"
              disabled={sending}
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 transition hover:bg-amber-600 disabled:opacity-60"
            >
              {sending ? "…" : "Send"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
