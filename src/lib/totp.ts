/**
 * RFC 6238 TOTP — pure Node crypto, no external deps.
 *
 * Compatible with Google Authenticator, Microsoft Authenticator,
 * Authy, 1Password, Bitwarden, and any other RFC-compliant authenticator.
 *
 * Default parameters:
 *   - HMAC-SHA1 (universal authenticator support)
 *   - 30-second time-step
 *   - 6-digit code
 *   - ±1 time-step window on verify (handles clock drift)
 */

import crypto from 'crypto';

const STEP_SECONDS = 30;
const DIGITS = 6;
const ALGO = 'sha1';

/* ── Base32 (RFC 4648) ─────────────────────────────────────────────────── */

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += B32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

export function base32Decode(s: string): Buffer {
  const cleaned = s.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of cleaned) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error(`Invalid base32 character: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/* ── HOTP (RFC 4226) — TOTP is HOTP with counter = T/X ─────────────────── */

function hotp(secret: Buffer, counter: number, digits = DIGITS): string {
  const buf = Buffer.alloc(8);
  // Counter is 64-bit big-endian; JS numbers safe to ~2^53 — fine for any
  // realistic Unix timestamp / 30s = ~7e16 vs 2^53 = ~9e15. Use BigInt math.
  const hi = Math.floor(counter / 0x100000000);
  const lo = counter % 0x100000000;
  buf.writeUInt32BE(hi, 0);
  buf.writeUInt32BE(lo, 4);
  const hmac = crypto.createHmac(ALGO, secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac[offset] & 0x7f) << 24) |
               ((hmac[offset + 1] & 0xff) << 16) |
               ((hmac[offset + 2] & 0xff) << 8) |
               (hmac[offset + 3] & 0xff);
  return String(code % 10 ** digits).padStart(digits, '0');
}

/* ── TOTP (RFC 6238) ───────────────────────────────────────────────────── */

export function generateTotpSecret(byteLength = 20): { base32: string; raw: Buffer } {
  const raw = crypto.randomBytes(byteLength); // 160 bits matches RFC 6238 baseline
  return { raw, base32: base32Encode(raw) };
}

export function totpNow(secretBase32: string, atMs: number = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / STEP_SECONDS);
  return hotp(base32Decode(secretBase32), counter);
}

export interface VerifyOptions {
  windowSteps?: number; // ±N time-steps tolerance. Default 1 (= ±30s).
}

export function verifyTotp(secretBase32: string, code: string, opts: VerifyOptions = {}): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const window = opts.windowSteps ?? 1;
  const secret = base32Decode(secretBase32);
  const now = Math.floor(Date.now() / 1000 / STEP_SECONDS);
  for (let i = -window; i <= window; i++) {
    if (hotp(secret, now + i) === code) return true;
  }
  return false;
}

/* ── Provisioning URI (otpauth://) for QR codes ────────────────────────── */

export function provisioningUri(opts: {
  accountName: string;
  issuer: string;
  secretBase32: string;
}): string {
  const label = encodeURIComponent(`${opts.issuer}:${opts.accountName}`);
  const params = new URLSearchParams({
    secret: opts.secretBase32,
    issuer: opts.issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/* ── Recovery codes ────────────────────────────────────────────────────── */

export function generateRecoveryCodes(count = 10): { codes: string[]; hashes: string[] } {
  const codes: string[] = [];
  const hashes: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(5).toString('hex'); // 10 hex chars
    const formatted = raw.slice(0, 5) + '-' + raw.slice(5, 10);
    codes.push(formatted);
    hashes.push(crypto.createHash('sha256').update(formatted).digest('hex'));
  }
  return { codes, hashes };
}

export function verifyRecoveryCode(plaintext: string, hashes: string[]): { ok: boolean; remaining: string[] } {
  const normalised = plaintext.toLowerCase().replace(/\s+/g, '').replace(/-/g, '');
  if (!/^[a-f0-9]{10}$/.test(normalised)) return { ok: false, remaining: hashes };
  const formatted = normalised.slice(0, 5) + '-' + normalised.slice(5, 10);
  const candidate = crypto.createHash('sha256').update(formatted).digest('hex');
  const idx = hashes.indexOf(candidate);
  if (idx < 0) return { ok: false, remaining: hashes };
  // Remove on use — single-use.
  return { ok: true, remaining: hashes.filter((_, i) => i !== idx) };
}
