/**
 * storedFiles — durable copies of served upload files (/uploads/images,
 * /uploads/media). Production disk is wiped on every deploy; the stored_files
 * table is the source of truth and the disk is a self-restoring cache.
 * Covers: disk hit (no DB), disk miss → DB restore + recache, unmanaged dir
 * rejected, traversal reduced to basename, save upserts, honest null.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

require("./dbGuard");
const db = require("../config/db");
const storedFiles = require("../utils/storedFiles");

const IMAGES_DIR = path.join(__dirname, "..", "uploads", "images");

const originalQuery = db.query;
function stubDb(impl) {
  db.query = async (...args) => impl(...args);
}
function restoreDb() {
  db.query = originalQuery;
}

test("disk hit serves the cached file without touching the DB", async () => {
  const name = `test-sf-diskhit-${Date.now()}.png`;
  await fs.promises.mkdir(IMAGES_DIR, { recursive: true });
  const abs = path.join(IMAGES_DIR, name);
  await fs.promises.writeFile(abs, Buffer.from("disk-bytes"));
  let dbCalls = 0;
  stubDb(() => {
    dbCalls += 1;
    return { rows: [] };
  });
  try {
    const file = await storedFiles.readStoredFile("images", name);
    assert.ok(file);
    assert.strictEqual(file.buffer.toString(), "disk-bytes");
    assert.strictEqual(file.mime, "image/png");
    assert.strictEqual(dbCalls, 0);
  } finally {
    restoreDb();
    await fs.promises.unlink(abs).catch(() => {});
  }
});

test("disk miss restores from the DB copy and re-caches the file", async () => {
  const name = `test-sf-restore-${Date.now()}.png`;
  const abs = path.join(IMAGES_DIR, name);
  stubDb((sql, params) => {
    assert.match(sql, /FROM stored_files/);
    assert.deepStrictEqual(params, [`/uploads/images/${name}`]);
    return { rows: [{ data: Buffer.from("db-bytes"), mime_type: "image/png" }] };
  });
  try {
    const file = await storedFiles.readStoredFile("images", name);
    assert.ok(file);
    assert.strictEqual(file.buffer.toString(), "db-bytes");
    const cached = await fs.promises.readFile(abs);
    assert.strictEqual(cached.toString(), "db-bytes");
  } finally {
    restoreDb();
    await fs.promises.unlink(abs).catch(() => {});
  }
});

test("unmanaged directory is rejected (null) without a DB query", async () => {
  let dbCalls = 0;
  stubDb(() => {
    dbCalls += 1;
    return { rows: [] };
  });
  try {
    assert.strictEqual(await storedFiles.readStoredFile("vision", "x.png"), null);
    assert.strictEqual(await storedFiles.readStoredFile("..", "x.png"), null);
    assert.strictEqual(dbCalls, 0);
  } finally {
    restoreDb();
  }
});

test("path traversal in the name is reduced to its basename", async () => {
  let queriedPath = null;
  stubDb((sql, params) => {
    queriedPath = params[0];
    return { rows: [] };
  });
  try {
    const file = await storedFiles.readStoredFile("images", "../../etc/passwd");
    assert.strictEqual(file, null);
    assert.strictEqual(queriedPath, "/uploads/images/passwd");
  } finally {
    restoreDb();
  }
});

test("disk miss with no DB row returns null (honest failure)", async () => {
  stubDb(() => ({ rows: [] }));
  try {
    assert.strictEqual(await storedFiles.readStoredFile("images", "gone.png"), null);
  } finally {
    restoreDb();
  }
});

test("saveStoredFile upserts by file_path", async () => {
  const calls = [];
  stubDb((sql, params) => {
    calls.push({ sql, params });
    return { rows: [] };
  });
  try {
    await storedFiles.saveStoredFile("/uploads/images/a.png", "image/png", Buffer.from("x"));
    assert.strictEqual(calls.length, 1);
    assert.match(calls[0].sql, /ON CONFLICT \(file_path\) DO UPDATE/);
    assert.deepStrictEqual(calls[0].params[0], "/uploads/images/a.png");
  } finally {
    restoreDb();
  }
});

test("mimeForFilename maps known extensions and defaults safely", () => {
  assert.strictEqual(storedFiles.mimeForFilename("a.jpg"), "image/jpeg");
  assert.strictEqual(storedFiles.mimeForFilename("b.MP4".toLowerCase()), "video/mp4");
  assert.strictEqual(storedFiles.mimeForFilename("c.unknown"), "application/octet-stream");
});
