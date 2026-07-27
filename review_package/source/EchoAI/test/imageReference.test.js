// Reference-photo upload + validation for the Image Studio.
//
// Covers:
// - uploadReferenceImage: accepts a PNG data URL, rejects non-image payloads
//   and oversized images.
// - loadReferenceImage: strict ref-<uuid> path shape only (no traversal, no
//   arbitrary uploads paths), missing file -> client-facing 400 error.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs/promises");
const path = require("path");

const {
  UPLOADS_DIR,
  uploadReferenceImage,
  _loadReferenceImageForTests: loadReferenceImage,
} = require("../controllers/imageController");

// 1x1 transparent PNG.
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

const createdFiles = [];
test.after(async () => {
  for (const file of createdFiles) {
    await fs.unlink(path.join(UPLOADS_DIR, file)).catch(() => {});
  }
});

test("uploadReferenceImage stores a PNG and returns a strict ref path", async () => {
  const res = mockRes();
  await uploadReferenceImage(
    { body: { imageData: `data:image/png;base64,${PNG_B64}` } },
    res
  );
  assert.strictEqual(res.statusCode, 201);
  const refPath = res.body.referencePath;
  assert.match(
    refPath,
    /^\/uploads\/images\/ref-[0-9a-f-]{36}\.png$/i,
    "returns a ref-<uuid>.png uploads path"
  );
  createdFiles.push(path.basename(refPath));

  // Round-trip: loadReferenceImage accepts the path it just produced.
  const loaded = await loadReferenceImage(refPath);
  assert.ok(loaded.buffer.length > 0);
  assert.strictEqual(loaded.mime, "image/png");
});

test("uploadReferenceImage rejects non-image and malformed payloads", async () => {
  for (const bad of [
    undefined,
    12345,
    "not a data url",
    `data:text/html;base64,${PNG_B64}`,
    "data:image/png;base64,", // empty payload
  ]) {
    const res = mockRes();
    await uploadReferenceImage({ body: { imageData: bad } }, res);
    assert.strictEqual(res.statusCode, 400, `rejects ${String(bad).slice(0, 30)}`);
  }
});

test("uploadReferenceImage rejects images over the size cap", async () => {
  // > 8 MB decoded (base64 inflates by 4/3, so 9 MB of raw bytes).
  const big = Buffer.alloc(9 * 1024 * 1024).toString("base64");
  const res = mockRes();
  await uploadReferenceImage(
    { body: { imageData: `data:image/png;base64,${big}` } },
    res
  );
  assert.strictEqual(res.statusCode, 400);
  assert.match(res.body.error, /8 MB/);
});

test("loadReferenceImage returns null when no reference supplied", async () => {
  assert.strictEqual(await loadReferenceImage(undefined), null);
  assert.strictEqual(await loadReferenceImage(null), null);
  assert.strictEqual(await loadReferenceImage(""), null);
});

test("loadReferenceImage rejects traversal and non-ref paths", async () => {
  const bad = [
    "/uploads/images/../../etc/passwd",
    "/uploads/images/ref-../../x.png",
    "/etc/passwd",
    // A regular generated-image path (not a reference) must not be readable
    // through the reference loader.
    "/uploads/images/123e4567-e89b-12d3-a456-426614174000.png",
    "uploads/images/ref-123e4567-e89b-12d3-a456-426614174000.png", // no leading slash
    "/uploads/images/ref-123e4567-e89b-12d3-a456-426614174000.svg", // bad ext
  ];
  for (const p of bad) {
    await assert.rejects(
      loadReferenceImage(p),
      (err) => err.httpStatus === 400,
      `rejects ${p}`
    );
  }
});

test("loadReferenceImage 400s on a well-formed but missing file", async () => {
  await assert.rejects(
    loadReferenceImage(
      "/uploads/images/ref-123e4567-e89b-12d3-a456-426614174000.png"
    ),
    (err) => err.httpStatus === 400 && /upload it again/i.test(err.clientMessage)
  );
});
