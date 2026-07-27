/**
 * visionFiles.readReferencePhoto — durable Vision photo access.
 *
 * Production runs on an ephemeral filesystem (every deploy wipes
 * uploads/vision/), so photo bytes live in vision_reference_images.image_data
 * and the disk is only a cache. These tests cover:
 * - disk hit → served from disk, no DB query
 * - disk miss → restored from the DB copy (and re-cached to disk)
 * - disk miss + no stored bytes → null (honest failure, pre-migration rows)
 * - path traversal input is reduced to its basename
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

require("./dbGuard");
const db = require("../config/db");
const visionFiles = require("../utils/visionFiles");

const originalQuery = db.query;
function stubDb(impl) {
  db.query = async (...args) => impl(...args);
}
function restoreDb() {
  db.query = originalQuery;
}

test("disk hit serves the cached file without touching the DB", async () => {
  const name = `test-diskhit-${Date.now()}.png`;
  await fs.promises.mkdir(visionFiles.REFERENCE_DIR, { recursive: true });
  const abs = path.join(visionFiles.REFERENCE_DIR, name);
  await fs.promises.writeFile(abs, Buffer.from("disk-bytes"));
  let dbCalls = 0;
  stubDb(() => {
    dbCalls += 1;
    return { rows: [] };
  });
  try {
    const photo = await visionFiles.readReferencePhoto(`/uploads/vision/${name}`, "image/png");
    assert.ok(photo);
    assert.strictEqual(photo.buffer.toString(), "disk-bytes");
    assert.strictEqual(photo.mime, "image/png");
    assert.strictEqual(dbCalls, 0);
  } finally {
    restoreDb();
    await fs.promises.unlink(abs).catch(() => {});
  }
});

test("disk miss restores from the DB copy and re-caches the file", async () => {
  const name = `test-restore-${Date.now()}.jpg`;
  const abs = path.join(visionFiles.REFERENCE_DIR, name);
  stubDb((sql, params) => {
    assert.match(sql, /image_data IS NOT NULL/);
    assert.deepStrictEqual(params, [`/uploads/vision/${name}`]);
    return { rows: [{ image_data: Buffer.from("db-bytes"), mime_type: "image/jpeg" }] };
  });
  try {
    const photo = await visionFiles.readReferencePhoto(`/uploads/vision/${name}`, null);
    assert.ok(photo);
    assert.strictEqual(photo.buffer.toString(), "db-bytes");
    assert.strictEqual(photo.mime, "image/jpeg");
    // disk cache restored
    const cached = await fs.promises.readFile(abs);
    assert.strictEqual(cached.toString(), "db-bytes");
  } finally {
    restoreDb();
    await fs.promises.unlink(abs).catch(() => {});
  }
});

test("disk miss with no stored bytes returns null (honest failure)", async () => {
  stubDb(() => ({ rows: [] }));
  try {
    const photo = await visionFiles.readReferencePhoto("/uploads/vision/gone-forever.png", "image/png");
    assert.strictEqual(photo, null);
  } finally {
    restoreDb();
  }
});

test("path traversal input is reduced to its basename", async () => {
  let queriedPath = null;
  stubDb((sql, params) => {
    queriedPath = params[0];
    return { rows: [] };
  });
  try {
    const photo = await visionFiles.readReferencePhoto("../../etc/passwd", null);
    assert.strictEqual(photo, null);
    assert.strictEqual(queriedPath, "/uploads/vision/passwd");
  } finally {
    restoreDb();
  }
});

test("empty input returns null", async () => {
  const photo = await visionFiles.readReferencePhoto("", null);
  assert.strictEqual(photo, null);
});
