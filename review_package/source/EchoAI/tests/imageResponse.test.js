/**
 * Regression tests for the mid-2026 OpenAI image-API change: dall-e-3 was
 * retired and `response_format` removed, so images.generate responses may be
 * either a hosted temporary URL (older models) or inline b64_json bytes
 * (gpt-image models). imageUrlFromResponse must handle both, and persistImage
 * must pass through the already-persisted local paths the b64 branch creates
 * — but ONLY strict UUID-shaped /uploads/images paths (no generic local-path
 * bypass, since saveImage takes a client-supplied imageUrl).
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs/promises");
const path = require("path");

const {
  _imageUrlFromResponseForTests: imageUrlFromResponse,
  persistImage,
  UPLOADS_DIR,
} = require("../controllers/imageController");

// 1x1 transparent PNG.
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

test("hosted url response → returned as-is", async () => {
  const url = "https://oaidalleapiprodscus.blob.core.windows.net/x/y.png?sig=1";
  assert.equal(await imageUrlFromResponse({ data: [{ url }] }), url);
});

test("b64_json response → persisted to /uploads/images and passthrough works", async () => {
  const local = await imageUrlFromResponse({ data: [{ b64_json: PNG_B64 }] });
  try {
    assert.match(
      local,
      /^\/uploads\/images\/[0-9a-f-]{36}\.png$/i,
      "b64 responses must be persisted to a UUID-named uploads path"
    );
    // persistImage must treat the already-persisted path as final.
    assert.equal(await persistImage(local), local);
  } finally {
    await fs.rm(path.join(UPLOADS_DIR, path.basename(local)), { force: true });
  }
});

test("empty/malformed response → aiInvalid error (502 mapping)", async () => {
  for (const bad of [null, {}, { data: [] }, { data: [{}] }]) {
    await assert.rejects(
      () => imageUrlFromResponse(bad),
      (err) => err.aiInvalid === true
    );
  }
});

test("persistImage rejects non-UUID local paths and disallowed hosts", async () => {
  for (const bad of [
    "/uploads/images/../../etc/passwd",
    "/uploads/images/evil.png",
    "/uploads/media/abc.png",
    "http://evil.test/x.png",
    "https://evil.test/x.png",
  ]) {
    await assert.rejects(() => persistImage(bad), /not from an allowed host/);
  }
});
