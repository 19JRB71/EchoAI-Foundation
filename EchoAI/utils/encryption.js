const crypto = require("crypto");

const ALGORITHM = "aes-256-gcm";

/**
 * Resolves the 32-byte encryption key from the ENCRYPTION_KEY env var.
 * Accepts either a 64-character hex string or a 32-character raw string.
 */
function getKey() {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error("ENCRYPTION_KEY is not set; cannot encrypt/decrypt credentials");
  }
  if (/^[0-9a-fA-F]{64}$/.test(key)) {
    return Buffer.from(key, "hex");
  }
  const buf = Buffer.from(key, "utf8");
  if (buf.length !== 32) {
    throw new Error("ENCRYPTION_KEY must be 32 bytes (or a 64-character hex string)");
  }
  return buf;
}

/**
 * Encrypts a plaintext string with AES-256-GCM.
 * Returns a colon-delimited "iv:authTag:ciphertext" string (all base64).
 */
function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), encrypted.toString("base64")].join(":");
}

/**
 * Decrypts a value produced by encrypt().
 */
function decrypt(payload) {
  const [ivB64, tagB64, dataB64] = String(payload).split(":");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Invalid encrypted payload format");
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

module.exports = { encrypt, decrypt };
