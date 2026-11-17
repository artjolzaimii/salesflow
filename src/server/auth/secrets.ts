import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes } from "node:crypto";

/**
 * Server-side secret handling for account security (Phase 6B).
 *
 * - MFA secrets are encrypted at rest with AES-256-GCM. The key comes from
 *   MFA_ENCRYPTION_KEY (32 bytes, base64). Outside production, a key derived
 *   from AUTH_SECRET with HKDF is used when that variable is missing, so local
 *   development works; production refuses to enable MFA without the dedicated key.
 * - Recovery codes are stored as HMAC-SHA-256 (keyed with the same key material),
 *   so a database dump alone can't be used to test candidate codes.
 * - Setup and reset links are 256-bit random tokens, stored as SHA-256.
 * Ciphertext format: "v1:" + base64(iv | tag | ciphertext).
 */

export class SecretsNotConfigured extends Error {}

function key(): Buffer {
  const raw = process.env.MFA_ENCRYPTION_KEY;
  if (raw) {
    const k = Buffer.from(raw, "base64");
    if (k.length !== 32) throw new SecretsNotConfigured("MFA_ENCRYPTION_KEY must be 32 bytes, base64-encoded.");
    return k;
  }
  if (process.env.NODE_ENV === "production" && process.env.MFA_ALLOW_DERIVED_KEY !== "true") {
    throw new SecretsNotConfigured("MFA_ENCRYPTION_KEY is not set.");
  }
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new SecretsNotConfigured("AUTH_SECRET is not set.");
  return Buffer.from(hkdfSync("sha256", secret, "salesflow", "salesflow-mfa-v1", 32));
}

export function mfaKeyAvailable(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return "v1:" + Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}

export function decryptSecret(stored: string): string {
  if (!stored.startsWith("v1:")) throw new Error("Unknown secret format.");
  const buf = Buffer.from(stored.slice(3), "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}

/** Keyed hash for recovery codes (normalized: no dashes or spaces, lower case). */
export function hashRecoveryCode(code: string): string {
  return createHmac("sha256", key()).update("recovery:" + normalizeRecoveryCode(code)).digest("hex");
}

export const normalizeRecoveryCode = (code: string) => code.replace(/[\s-]/g, "").toLowerCase();

/** New random token (base64url, 256 bits) and its SHA-256 for storage. */
export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
