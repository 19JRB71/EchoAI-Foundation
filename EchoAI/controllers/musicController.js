// Music search backing Echo's in-dashboard YouTube player.
//
// Playback itself runs entirely client-side via the YouTube IFrame API using
// video IDs, so no API key is needed just to play a known track. SEARCH (turning
// "play some lofi" into a video ID) requires the YouTube Data API v3, which needs
// YOUTUBE_API_KEY. Following EchoAI's feature-var convention, search degrades to
// 503 "not configured" when the key is unset — it never mocks results.

const SEARCH_ENDPOINT = "https://www.googleapis.com/youtube/v3/search";

function isConfigured() {
  return Boolean(process.env.YOUTUBE_API_KEY);
}

/** GET /api/music/status — lets the client show/hide search UI. */
async function status(_req, res) {
  return res.json({ configured: isConfigured() });
}

/**
 * GET /api/music/search?q=...&limit=...
 * Returns [{ videoId, title, channel, thumbnail }]. 503 when unconfigured,
 * 400 on a missing query, 502 when YouTube errors.
 */
async function search(req, res) {
  if (!isConfigured()) {
    return res
      .status(503)
      .json({ error: "Music search is not configured on the server." });
  }

  const q = String(req.query.q || "").trim();
  if (!q) {
    return res.status(400).json({ error: "A search query is required." });
  }

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 8, 1), 15);
  const params = new URLSearchParams({
    key: process.env.YOUTUBE_API_KEY,
    part: "snippet",
    type: "video",
    videoEmbeddable: "true",
    videoCategoryId: "10", // Music
    maxResults: String(limit),
    q,
  });

  let data;
  try {
    const resp = await fetch(`${SEARCH_ENDPOINT}?${params.toString()}`);
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.error("YouTube search failed:", resp.status, body.slice(0, 300));
      return res.status(502).json({ error: "Music search is unavailable right now." });
    }
    data = await resp.json();
  } catch (err) {
    console.error("YouTube search error:", err.message);
    return res.status(502).json({ error: "Music search is unavailable right now." });
  }

  const items = Array.isArray(data.items) ? data.items : [];
  const results = items
    .map((it) => {
      const videoId = it.id && it.id.videoId;
      const sn = it.snippet || {};
      if (!videoId || !sn.title) return null;
      const thumb =
        (sn.thumbnails &&
          (sn.thumbnails.medium || sn.thumbnails.default) &&
          (sn.thumbnails.medium || sn.thumbnails.default).url) ||
        "";
      return {
        videoId,
        title: decodeEntities(sn.title),
        channel: decodeEntities(sn.channelTitle || ""),
        thumbnail: thumb,
      };
    })
    .filter(Boolean);

  return res.json({ results });
}

// YouTube titles arrive HTML-entity-encoded (&amp; &#39; &quot;). Decode the
// common ones so titles render cleanly in the player widget.
function decodeEntities(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

module.exports = { status, search };
