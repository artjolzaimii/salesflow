import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { Secret, TOTP } from "otpauth";
import { renderSVG } from "uqr";
import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/server/db";
import { decryptSecret, encryptSecret, hashRecoveryCode, normalizeRecoveryCode } from "./secrets";
import { clearThrottle, isThrottled, recordThrottleFailure } from "./throttle";

/**
 * TOTP (RFC 6238: SHA-1, 6 digits, 30 s, ±1 step) via the maintained `otpauth`
 * library, plus single-use recovery codes.
 * - Secrets: 160 random bits, AES-256-GCM encrypted at rest (secrets.ts), shown
 *   to the user only during setup and never returned once MFA is enabled.
 * - Replay: the last accepted time step is stored; a code for that step or an
 *   earlier one is refused, even inside the validity window.
 * - Attempts: 5 wrong codes per user in 15 minutes lock MFA checks for 15 minutes.
 * - Recovery codes: 10 per enrollment, 50 random bits each, stored as keyed
 *   hashes and consumed atomically (a code works once).
 */

export const ISSUER = "SalesFlow";
const PERIOD = 30;
const RECOVERY_CODES = 10;
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/o, 1/l/i

type Tx = Prisma.TransactionClient;

const totpFor = (secretBase32: string, label: string) =>
  new TOTP({ issuer: ISSUER, label, algorithm: "SHA1", digits: 6, period: PERIOD, secret: Secret.fromBase32(secretBase32) });

export function newMfaSecret(label: string) {
  const secret = new Secret({ size: 20 });
  const uri = totpFor(secret.base32, label).toString();
  const svg = renderSVG(uri, { border: 2, whiteColor: "#ffffff", blackColor: "#000000" });
  return { base32: secret.base32, uri, qrDataUrl: "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64"), encrypted: encryptSecret(secret.base32) };
}

/** Time step of a valid code for this secret, or null. `afterCounter` refuses replays. */
export function matchTotp(encrypted: string, code: string, afterCounter: bigint | null, now = Date.now()): number | null {
  const token = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(token)) return null;
  const totp = totpFor(decryptSecret(encrypted), "x");
  const counter = Math.floor(now / 1000 / PERIOD);
  const delta = totp.validate({ token, timestamp: now, window: 1, afterCounter: afterCounter === null ? undefined : Number(afterCounter) });
  return delta === null ? null : counter + delta;
}

export const isRecoveryCodeShape = (code: string) => /^[a-z2-9]{10}$/.test(normalizeRecoveryCode(code));

export function newRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODES }, () => {
    const bytes = randomBytes(10);
    const s = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
}

/** Replaces the user's recovery codes; returns the plain codes (shown once). */
export async function replaceRecoveryCodes(tx: Tx, userId: string): Promise<string[]> {
  const codes = newRecoveryCodes();
  await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
  await tx.mfaRecoveryCode.createMany({ data: codes.map((c) => ({ id: randomUUID(), userId, codeHash: hashRecoveryCode(c) })) });
  return codes;
}

export type MfaCheck = { ok: true; method: "totp" | "recovery" } | { ok: false; reason: "invalid" | "locked" };

/**
 * Checks an MFA code (TOTP or recovery code) for a user with MFA enabled and
 * consumes it: the TOTP step is recorded, a recovery code is marked used. Both
 * updates are conditional, so two requests can't use the same code.
 */
export async function verifyMfa(userId: string, code: string): Promise<MfaCheck> {
  if (await isThrottled("mfa", userId)) return { ok: false, reason: "locked" };
  const db = getDb();
  const user = await db.user.findUnique({ where: { id: userId }, select: { mfaEnabled: true, mfaSecret: true, mfaLastCounter: true } });
  if (!user?.mfaEnabled || !user.mfaSecret) return { ok: false, reason: "invalid" };

  let method: "totp" | "recovery" | null = null;
  const step = matchTotp(user.mfaSecret, code, user.mfaLastCounter);
  if (step !== null) {
    const claimed = await db.user.updateMany({
      where: { id: userId, OR: [{ mfaLastCounter: null }, { mfaLastCounter: { lt: step } }] },
      data: { mfaLastCounter: step },
    });
    if (claimed.count === 1) method = "totp";
  } else if (isRecoveryCodeShape(code)) {
    const used = await db.mfaRecoveryCode.updateMany({ where: { userId, codeHash: hashRecoveryCode(code), usedAt: null }, data: { usedAt: new Date() } });
    if (used.count === 1) method = "recovery";
  }
  if (!method) {
    await recordThrottleFailure("mfa", userId);
    return { ok: false, reason: "invalid" };
  }
  await clearThrottle("mfa", userId);
  return { ok: true, method };
}
