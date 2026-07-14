// Echo's voice for the Guided Setup wizard.
//
// Voice is an ENHANCEMENT, never a requirement: every line Echo speaks is also
// shown as text, and any failure (TTS not configured, autoplay blocked because
// there was no user gesture, network error) degrades silently to text-only.
// Speak calls are made from user-gesture handlers wherever possible so browser
// autoplay policies allow playback.

import { useCallback, useEffect, useRef } from "react";
import { api } from "../../api.js";

export function useEchoSpeak() {
  const audioRef = useRef(null);
  const urlRef = useRef(null);

  const cleanup = useCallback(() => {
    if (audioRef.current) {
      try {
        audioRef.current.pause();
      } catch {
        /* ignore */
      }
      audioRef.current = null;
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const speak = useCallback(
    async (text) => {
      if (!text || typeof text !== "string") return;
      try {
        const blob = await api.echoVoiceSpeak(text);
        if (!blob) return;
        cleanup();
        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = cleanup;
        audio.onerror = cleanup;
        await audio.play();
      } catch {
        /* voice unavailable or autoplay blocked — the text is on screen */
      }
    },
    [cleanup],
  );

  return { speak, stop: cleanup };
}
