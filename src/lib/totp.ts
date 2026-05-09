/**
 * RFC 6238 TOTP + RFC 4226 HOTP implementation.
 * No external deps — pure Node crypto.
 *
 * Defaults: SHA-1, 30s step, 6 digits (compatible with Google
 * Authenticator, 1Password, Authy, Microsoft Authenticator).
 */

import crypto from 'crypto';

const STEP_SECONDS = 30;
const DIGITS = 6;
const ALGO = 'sha1';

// ── Base32 (RFC 4648) ────────────────────────────────────────────────────────
const B32_ALPH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPH[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPH[(value << (5 - bits)) & 0x1f];
  return out;
}

export function base32Decode(str: string): Buffer {
  const clean = str.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32_ALPH.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// ── HOTP / TOTP core ─────────────────────────────────────────────────────────

function hotp(secret: Buffer, counter: number): string {
  // 8-byte big-endian counter
  const buf = Buffer.alloc(8);
  // JS bitwise ops are 32-bit — split high/low halves manually.
  const high = Math.floor(counter / 0x1_0000_0000);
  const low  = counter >>> 0;
  buf.writeUInt32BE(high, 0);
  buf.writeUInt32BE(low,  4);

  const hmac = crypto.createHmac(ALGO, secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset]     & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) <<  8) |
    ( hmac[offset + 3] & 0xff);
  return (code % 10 ** DIGITS).toString().padStart(DIGITS, '0');
}

export function totpNow(secretBase32: string, atSeconds = Math.floor(Date.now() / 1000)): string {
  return hotp(base32Decode(secretBase32), Math.floor(atSeconds / STEP_SECONDS));
}

export interface VerifyOptions {
  /** ± steps to tolerate clock drift (default 1 = ±30s). */
  windowSteps?: number;
  /** Override "now" in seconds — useful for tests. */
  atSeconds?: number;
}

export function verifyTotp(
  secretBase32: string,
  code: string,
  opts: VerifyOptions = {},
): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const window = opts.windowSteps ?? 1;
  const secret = base32Decode(secretBase32);
  const at = opts.atSeconds ?? Math.floor(Date.now() / 1000);
  const counter = Math.floor(at / STEP_SECONDS);
  for (let i = -window; i <= window; i++) {
    if (timingSafeEq(hotp(secret, counter + i), code)) return true;
  }
  return false;
}

function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// ── Secret + provisioning ────────────────────────────────────────────────────

/** Returns a 20-byte (160-bit) base32 secret — RFC 4226 SHOULD value. */
export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

/**
 * Builds an otpauth:// URI for QR code rendering.
 * issuer / account become the visible label in authenticator apps.
 */
export function provisioningUri(opts: {
  issuer: string;
  account: string;
  secretBase32: string;
}): string {
  const issuer  = encodeURIComponent(opts.issuer);
  const account = encodeURIComponent(opts.account);
  const params  = new URLSearchParams({
    secret: opts.secretBase32,
    issuer: opts.issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${issuer}:${account}?${params.toString()}`;
}

// ── Recovery codes ───────────────────────────────────────────────────────────

/** Returns 10 recovery codes (plaintext) and their sha256 hashes. */
export function generateRecoveryCodes(count = 10): { plaintext: string[]; hashed: string[] } {
  const plaintext: string[] = [];
  const hashed:    string[] = [];
  for (let i = 0; i < count; i++) {
    // 10 chars: 5 hex + dash + 5 hex (e.g. "a3f9c-7e1b8")
    const raw = crypto.randomBytes(5).toString('hex') + '-' + crypto.randomBytes(5).toString('hex').slice(0, 5);
    plaintext.push(raw);
    hashed.push(crypto.createHash('sha256').update(raw).digest('hex'));
  }
  return { plaintext, hashed };
}

/**
 * Verify a recovery code against an array of stored sha256 hashes.
 * Returns the matched hash so the caller can remove it (single-use).
 */
export function verifyRecoveryCode(code: string, storedHashes: string[]): string | null {
  const norm = code.trim().toLowerCase();
  if (!/^[a-f0-9]{5}-[a-f0-9]{5}$/.test(norm)) return null;
  const hash = crypto.createHash('sha256').update(norm).digest('hex');
  return storedHashes.includes(hash) ? hash : null;
}
