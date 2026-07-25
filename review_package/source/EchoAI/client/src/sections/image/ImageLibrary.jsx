import { useState, useEffect, useCallback } from "react";
import { api } from "../../api.js";
import ErrorBanner from "../../components/ErrorBanner.jsx";
import Spinner from "../../components/Spinner.jsx";

export default function ImageLibrary({ brandId, refreshKey }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [groups, setGroups] = useState([]);
  const [filter, setFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.getImages(brandId);
      setGroups(data.groups || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function handleDelete(imageId) {
    try {
      await api.deleteImage(imageId);
      setGroups((prev) =>
        prev
          .map((g) => ({
            ...g,
            images: g.images.filter((img) => img.image_id !== imageId),
          }))
          .filter((g) => g.images.length > 0)
      );
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading) return <Spinner label="Loading images…" />;

  const visibleGroups =
    filter === "all" ? groups : groups.filter((g) => g.purpose === filter);
  const totalImages = groups.reduce((n, g) => n + g.images.length, 0);

  return (
    <div className="space-y-6">
      <ErrorBanner message={error} />

      {totalImages === 0 ? (
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-8 text-center text-sm text-gray-400">
          No saved images yet. Generate and save images to build your library.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <FilterChip
              label="All"
              active={filter === "all"}
              onClick={() => setFilter("all")}
            />
            {groups.map((g) => (
              <FilterChip
                key={g.purpose}
                label={`${g.label} (${g.images.length})`}
                active={filter === g.purpose}
                onClick={() => setFilter(g.purpose)}
              />
            ))}
          </div>

          {visibleGroups.map((g) => (
            <div key={g.purpose} className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-100">{g.label}</h3>
              <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
                {g.images.map((img) => (
                  <LibraryCard
                    key={img.image_id}
                    image={img}
                    onDelete={() => handleDelete(img.image_id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function FilterChip({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
        active
          ? "border-amber-500 bg-amber-500/10 text-amber-300"
          : "border-gray-800 text-gray-400 hover:bg-gray-800"
      }`}
    >
      {label}
    </button>
  );
}

function LibraryCard({ image, onDelete }) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="flex flex-col rounded-xl border border-gray-800 bg-gray-900 p-3 shadow-sm">
      <div className="overflow-hidden rounded-lg border border-gray-800 bg-black">
        <img
          src={image.image_url}
          alt={image.purpose}
          className="h-auto w-full"
        />
      </div>
      <p className="mt-2 line-clamp-2 text-xs text-gray-500" title={image.prompt_used}>
        {image.prompt_used}
      </p>
      <div className="mt-3 flex gap-2">
        <a
          href={image.image_url}
          download
          className="flex-1 rounded-lg border border-gray-700 px-2 py-1.5 text-center text-xs font-medium text-gray-300 hover:bg-gray-800"
        >
          Download
        </a>
        {confirming ? (
          <>
            <button
              onClick={onDelete}
              className="rounded-lg bg-red-600 px-2 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
            >
              Confirm
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="rounded-lg border border-gray-700 px-2 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-800"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="rounded-lg border border-gray-700 px-2 py-1.5 text-xs font-medium text-gray-400 hover:bg-gray-800"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
