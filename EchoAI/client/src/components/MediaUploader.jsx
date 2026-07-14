import { useRef, useState } from "react";
import { api } from "../api.js";

// Upload a real photo or video from the owner's device and attach it to the
// post. Videos publish on Facebook only (platform API limitation), so the
// picker only accepts video files on Facebook cards.
export default function MediaUploader({ platform, uploadedMedia, onUploaded, onCleared }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const allowVideo = platform === "facebook";

  async function handleFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (file.type.startsWith("video/") && !allowVideo) {
      setError("Video posts are currently supported on Facebook only.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = await api.uploadSocialMedia(file);
      onUploaded?.(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 border-t border-gray-800 pt-3">
      {error && (
        <p className="mb-2 rounded-lg bg-red-500/10 px-2 py-1 text-xs text-red-300">
          {error}
        </p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={
          allowVideo
            ? "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm"
            : "image/jpeg,image/png,image/webp,image/gif"
        }
        className="hidden"
        onChange={handleFile}
      />
      {uploadedMedia ? (
        <div className="flex items-center gap-3">
          {uploadedMedia.mediaType === "video" ? (
            <video
              src={uploadedMedia.url}
              className="h-16 w-16 shrink-0 rounded-lg border border-gray-800 object-cover"
              muted
              playsInline
            />
          ) : (
            <img
              src={uploadedMedia.url}
              alt="Uploaded"
              className="h-16 w-16 shrink-0 rounded-lg border border-gray-800 object-cover"
            />
          )}
          <p className="flex-1 text-xs text-green-400">
            Your {uploadedMedia.mediaType === "video" ? "video" : "photo"} is
            attached — it will publish with this post.
          </p>
          <button
            type="button"
            onClick={() => onCleared?.()}
            className="rounded-lg border border-gray-800 px-2 py-1 text-xs font-medium text-gray-400 hover:bg-gray-800"
          >
            Remove
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="w-full rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-60"
        >
          {busy
            ? "Uploading…"
            : allowVideo
              ? "Upload Your Photo or Video"
              : "Upload Your Photo"}
        </button>
      )}
    </div>
  );
}
