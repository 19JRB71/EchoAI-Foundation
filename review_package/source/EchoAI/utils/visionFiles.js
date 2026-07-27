// Durable access to Vision reference photos.
//
// The database column vision_reference_images.image_data is the source of
// truth for the photo bytes (it survives redeploys); the file under
// uploads/vision/ is only a cache. Production runs on an ephemeral
// filesystem, so every reader must go through readReferencePhoto(), which
// restores the disk cache from the DB when the file has vanished.

const fs = require("fs");
const path = require("path");
const db = require("../config/db");

const REFERENCE_DIR = path.join(__dirname, "..", "uploads", "vision");

// Best-effort disk cache write; failures never break the read path.
async function cacheToDisk(filename, buffer) {
  try {
    await fs.promises.mkdir(REFERENCE_DIR, { recursive: true });
    await fs.promises.writeFile(path.join(REFERENCE_DIR, filename), buffer);
  } catch (e) {
    console.error(`Vision cache write failed for ${filename}:`, e.message);
  }
}

/**
 * Reads one reference photo's bytes by its stored file_path (a relative URL
 * like /uploads/vision/<name>). Disk first, then the DB copy (restoring the
 * disk cache). Returns { buffer, mime, filename } or null when the photo is
 * genuinely unrecoverable (no file AND no stored bytes — pre-migration
 * uploads lost to a redeploy).
 */
async function readReferencePhoto(filePath, mimeType) {
  const filename = path.basename(String(filePath || ""));
  if (!filename) return null;
  try {
    const buffer = await fs.promises.readFile(path.join(REFERENCE_DIR, filename));
    return { buffer, mime: mimeType || "image/jpeg", filename };
  } catch {
    // Disk miss → restore from the database copy.
  }
  const r = await db.query(
    `SELECT image_data, mime_type FROM vision_reference_images
     WHERE file_path = $1 AND image_data IS NOT NULL`,
    [`/uploads/vision/${filename}`]
  );
  if (!r.rows.length || !r.rows[0].image_data) return null;
  const buffer = r.rows[0].image_data;
  await cacheToDisk(filename, buffer);
  return { buffer, mime: r.rows[0].mime_type || mimeType || "image/jpeg", filename };
}

/**
 * One-time repair for legacy rows uploaded before image_data existed: where
 * the disk file still survives, copy its bytes into the DB. Rows whose files
 * were already wiped by a redeploy are unrecoverable (owner must re-upload).
 * Safe to run on every boot — it only touches rows with NULL image_data.
 */
async function backfillFromDisk() {
  try {
    const r = await db.query(
      `SELECT image_id, file_path FROM vision_reference_images WHERE image_data IS NULL`
    );
    let repaired = 0;
    for (const row of r.rows) {
      try {
        const buffer = await fs.promises.readFile(
          path.join(REFERENCE_DIR, path.basename(row.file_path))
        );
        await db.query(
          `UPDATE vision_reference_images SET image_data = $1
           WHERE image_id = $2 AND image_data IS NULL`,
          [buffer, row.image_id]
        );
        repaired += 1;
      } catch {
        // File already lost to a redeploy — nothing to repair.
      }
    }
    if (r.rows.length) {
      console.log(
        `Vision photo backfill: ${repaired}/${r.rows.length} legacy photo(s) copied into the database.`
      );
    }
  } catch (e) {
    console.error("Vision photo backfill failed:", e.message);
  }
}

module.exports = { REFERENCE_DIR, readReferencePhoto, backfillFromDisk };
