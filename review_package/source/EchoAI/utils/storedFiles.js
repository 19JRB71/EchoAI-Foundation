// Durable access to served upload files (/uploads/images and /uploads/media).
//
// The stored_files table is the source of truth for the bytes (it survives
// redeploys — production disk is ephemeral and wiped on every deploy); the
// file on disk is only a cache. Writers persist to BOTH; readers go disk-first
// and restore the cache from the DB on a miss.

const fs = require("fs");
const path = require("path");
const db = require("../config/db");

const UPLOADS_ROOT = path.join(__dirname, "..", "uploads");
// Only these subdirectories are managed here (vision has its own table).
const MANAGED_DIRS = new Set(["images", "media"]);

const EXT_MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
};

function mimeForFilename(filename) {
  return EXT_MIME[path.extname(String(filename)).toLowerCase()] || "application/octet-stream";
}

/** Normalizes (dir, name) to a safe relative URL, or null if not managed. */
function relPathFor(dir, name) {
  const cleanDir = String(dir || "");
  const cleanName = path.basename(String(name || ""));
  if (!MANAGED_DIRS.has(cleanDir) || !cleanName) return null;
  return `/uploads/${cleanDir}/${cleanName}`;
}

/**
 * Persists the durable DB copy for a file that was just written to disk.
 * Throws on failure — the DB copy is the source of truth, so a save that
 * only reached the ephemeral disk must not report success.
 */
async function saveStoredFile(relPath, mimeType, buffer) {
  await db.query(
    `INSERT INTO stored_files (file_path, mime_type, data)
     VALUES ($1, $2, $3)
     ON CONFLICT (file_path) DO UPDATE SET mime_type = EXCLUDED.mime_type, data = EXCLUDED.data`,
    [relPath, mimeType || mimeForFilename(relPath), buffer]
  );
}

/**
 * Reads a managed upload file: disk first, then the DB copy (restoring the
 * disk cache best-effort). Returns { buffer, mime } or null when the file is
 * genuinely unrecoverable (pre-migration file lost to a redeploy).
 */
async function readStoredFile(dir, name) {
  const relPath = relPathFor(dir, name);
  if (!relPath) return null;
  const filename = path.basename(relPath);
  const absolute = path.join(UPLOADS_ROOT, dir, filename);
  try {
    const buffer = await fs.promises.readFile(absolute);
    return { buffer, mime: mimeForFilename(filename) };
  } catch {
    // Disk miss → restore from the database copy.
  }
  const r = await db.query(
    `SELECT data, mime_type FROM stored_files WHERE file_path = $1`,
    [relPath]
  );
  if (!r.rows.length || !r.rows[0].data) return null;
  const buffer = r.rows[0].data;
  try {
    await fs.promises.mkdir(path.join(UPLOADS_ROOT, dir), { recursive: true });
    await fs.promises.writeFile(absolute, buffer);
  } catch (e) {
    console.error(`Stored file cache write failed for ${relPath}:`, e.message);
  }
  return { buffer, mime: r.rows[0].mime_type || mimeForFilename(filename) };
}

/**
 * One-time repair for legacy files that exist on disk but have no DB copy
 * yet (uploaded before stored_files existed). Files already wiped by a
 * redeploy are unrecoverable. Safe to run on every boot.
 */
async function backfillFromDisk() {
  let scanned = 0;
  let copied = 0;
  for (const dir of MANAGED_DIRS) {
    let names;
    try {
      names = await fs.promises.readdir(path.join(UPLOADS_ROOT, dir));
    } catch {
      continue; // Directory doesn't exist — nothing to repair.
    }
    for (const name of names) {
      const relPath = relPathFor(dir, name);
      if (!relPath) continue;
      scanned += 1;
      try {
        const existing = await db.query(
          `SELECT 1 FROM stored_files WHERE file_path = $1`,
          [relPath]
        );
        if (existing.rows.length) continue;
        const buffer = await fs.promises.readFile(path.join(UPLOADS_ROOT, dir, name));
        await saveStoredFile(relPath, mimeForFilename(name), buffer);
        copied += 1;
      } catch (e) {
        console.error(`Stored file backfill failed for ${relPath}:`, e.message);
      }
    }
  }
  if (copied) {
    console.log(`Stored file backfill: ${copied}/${scanned} legacy file(s) copied into the database.`);
  }
}

module.exports = { saveStoredFile, readStoredFile, backfillFromDisk, mimeForFilename };
