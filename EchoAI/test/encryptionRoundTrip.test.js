// REPLIT_PROMPT_001 — token-at-rest encryption evidence.
// Proves the AES-256-GCM utility round-trips, produces ciphertext that never
// contains the plaintext, and fails loudly (never silently) on tampering or a
// wrong key — the properties the api_integrations / google_integrations token
// columns depend on.

const { test } = require("node:test");
const assert = require("node:assert");

// Ensure a valid 32-byte key exists for this process (mirrors production
// where config/env.js makes ENCRYPTION_KEY boot-critical).
if (!process.env.ENCRYPTION_KEY) {
  process.env.ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
}

const { encrypt, decrypt } = require("../utils/encryption");

test("encrypt/decrypt round-trips a Facebook-style token", () => {
  const token = "EAABsbCS1234FakeFacebookToken567890";
  const stored = encrypt(token);
  assert.strictEqual(decrypt(stored), token);
});

test("ciphertext is iv:tag:data format and never contains the plaintext", () => {
  const token = "ya29.a0FakeGoogleAccessToken-abc123";
  const stored = encrypt(token);
  assert.strictEqual(stored.split(":").length, 3, "expected iv:authTag:ciphertext");
  assert.ok(!stored.includes(token), "ciphertext must not contain the plaintext");
  assert.ok(!stored.startsWith("ya29"), "stored value must not look like a raw Google token");
  // Each part must be valid base64.
  for (const part of stored.split(":")) {
    assert.doesNotThrow(() => Buffer.from(part, "base64"));
  }
});

test("two encryptions of the same value differ (random IV) but both decrypt", () => {
  const token = "same-secret-value";
  const a = encrypt(token);
  const b = encrypt(token);
  assert.notStrictEqual(a, b, "random IV must make ciphertexts differ");
  assert.strictEqual(decrypt(a), token);
  assert.strictEqual(decrypt(b), token);
});

test("tampered ciphertext throws (GCM auth) — never returns garbage silently", () => {
  const stored = encrypt("secret");
  const [iv, tag, data] = stored.split(":");
  const flipped = Buffer.from(data, "base64");
  flipped[0] = flipped[0] ^ 0xff;
  const tampered = [iv, tag, flipped.toString("base64")].join(":");
  assert.throws(() => decrypt(tampered));
});

test("a plaintext (legacy-style) value is rejected by decrypt, not passed through", () => {
  // Guarantees no silent plaintext fallback exists in the utility itself.
  assert.throws(() => decrypt("EAABsbPlaintextTokenNeverStored"));
});

test("decrypting with a different key throws", () => {
  const stored = encrypt("secret");
  const prev = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = "ffffffffffffffffffffffffffffffff";
  try {
    assert.throws(() => decrypt(stored));
  } finally {
    process.env.ENCRYPTION_KEY = prev;
  }
});
