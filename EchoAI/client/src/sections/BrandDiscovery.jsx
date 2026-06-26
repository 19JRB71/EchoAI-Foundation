import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import Spinner from "../components/Spinner.jsx";
import ErrorBanner from "../components/ErrorBanner.jsx";

export default function BrandDiscovery({ brandId, onClose, onComplete }) {
  const [sessionId, setSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [completed, setCompleted] = useState(false);
  const scrollRef = useRef(null);

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
        if (data.reply)
          setMessages([{ role: "assistant", content: data.reply }]);
      } catch (err) {
        if (active) setError(err.message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [brandId]);

  useEffect(() => {
    if (scrollRef.current)
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  async function send(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text || !sessionId) return;
    setMessages((m) => [...m, { role: "user", content: text }]);
    setInput("");
    setSending(true);
    setError("");
    try {
      const data = await api.discovery({ sessionId, message: text, brandId });
      if (data.reply)
        setMessages((m) => [...m, { role: "assistant", content: data.reply }]);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  async function confirm() {
    if (!sessionId) return;
    setSending(true);
    setError("");
    try {
      const data = await api.discovery({ sessionId, confirm: true, brandId });
      if (data.status === "completed") {
        setCompleted(true);
        if (onComplete) onComplete();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

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
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-400"
          >
            ✕
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
          {loading ? (
            <Spinner label="Starting conversation…" />
          ) : (
            messages.map((m, i) => (
              <div
                key={i}
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                  m.role === "user"
                    ? "ml-auto bg-amber-500 text-gray-900"
                    : "bg-gray-800 text-gray-200"
                }`}
              >
                {m.content}
              </div>
            ))
          )}
          {completed && (
            <p className="text-center text-sm font-medium text-green-600">
              Brand profile saved!
            </p>
          )}
        </div>

        <div className="border-t border-gray-800 p-4">
          <ErrorBanner message={error} />
          {!completed && (
            <>
              <form onSubmit={send} className="mt-2 flex gap-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Type your answer…"
                  disabled={loading || sending}
                  className="flex-1 rounded-lg border border-gray-700 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
                <button
                  type="submit"
                  disabled={loading || sending || !input.trim()}
                  className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-60"
                >
                  Send
                </button>
              </form>
              <button
                onClick={confirm}
                disabled={loading || sending || messages.length === 0}
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
}
