/**
 * Boarding check-in / check-out helpers for the staff bus platform.
 *
 * Central concept: every boarding event is a tuple of
 *   (scheduleId, passenger or staff identity, method, direction, identifier).
 *
 * Each method has a different "identifier" semantic:
 *   - QR    → a server-issued, HMAC-signed token bound to a scheduleId
 *             (short-lived; produced by /api/bus-ops/schedules/[id]/qr-token).
 *   - NFC   → the StaffRfidTag.tagUid registered to the staff member.
 *   - BLE   → the VehicleBeacon.bleUuid registered to the trip's vehicle.
 *   - MANUAL→ no identifier (driver tapped the row, or staff self-tapped).
 *
 * Pure functions only — DB access lives in the route handler.
 */

import { createHmac, timingSafeEqual } from 'crypto';

export type CheckinMethod = 'QR' | 'NFC' | 'BLE' | 'MANUAL';
export type CheckinDirection = 'BOARD' | 'ALIGHT';

const QR_SECRET_ENV = 'BUS_QR_SIGNING_SECRET';
const QR_DEFAULT_TTL_SECONDS = 15 * 60; // 15 minutes — covers a reasonable boarding window

/* ── QR token ─────────────────────────────────────────────────────────── */

export interface QrTokenPayload {
  scheduleId: string;
  expiresAt: number; // epoch ms
}

function getQrSecret(): string {
  const s = process.env[QR_SECRET_ENV] ?? process.env.SESSION_SECRET;
  if (!s) throw new Error(`${QR_SECRET_ENV} (or SESSION_SECRET) must be set to issue / verify QR tokens.`);
  return s;
}

/** Issues a signed token that can be embedded in a QR shown by the driver
 *  or printed/displayed inside the bus. Format: <scheduleId>.<expiresAt>.<sig>
 */
export function issueQrToken(scheduleId: string, ttlSeconds: number = QR_DEFAULT_TTL_SECONDS): string {
  const secret = getQrSecret();
  const expiresAt = Date.now() + ttlSeconds * 1000;
  const payload = `${scheduleId}.${expiresAt}`;
  const sig = createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

export interface QrVerifyResult {
  ok: boolean;
  reason?: 'malformed' | 'invalid_signature' | 'expired';
  scheduleId?: string;
  expiresAt?: number;
}

/** Constant-time verification of a QR token. */
export function verifyQrToken(token: string, now: number = Date.now()): QrVerifyResult {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [scheduleId, expiresAtStr, sig] = parts;
  const expiresAt = parseInt(expiresAtStr, 10);
  if (!scheduleId || !Number.isFinite(expiresAt)) return { ok: false, reason: 'malformed' };

  const secret = getQrSecret();
  const expected = createHmac('sha256', secret).update(`${scheduleId}.${expiresAt}`).digest('hex');
  if (expected.length !== sig.length) return { ok: false, reason: 'invalid_signature' };
  let valid = false;
  try { valid = timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sig, 'hex')); } catch { /* fall-through */ }
  if (!valid) return { ok: false, reason: 'invalid_signature' };
  if (now > expiresAt) return { ok: false, reason: 'expired', scheduleId, expiresAt };

  return { ok: true, scheduleId, expiresAt };
}

/* ── BLE / NFC identifier validation helpers ──────────────────────────── */

/** Normalise a BLE UUID (hex with dashes, lowercase). */
export function normaliseBleUuid(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-f0-9-]/g, '');
}

/** Normalise an NFC tag UID (hex, uppercase, no separators). */
export function normaliseNfcUid(s: string): string {
  return s.trim().toUpperCase().replace(/[^A-F0-9]/g, '');
}

/* ── Boarding-event guard rails ───────────────────────────────────────── */

export interface CheckinRequest {
  scheduleId: string;
  method: CheckinMethod;
  direction: CheckinDirection;
  /** Identifier semantic depends on method. */
  identifier?: string | null;
  /** Optional — narrows passenger lookup. */
  staffMemberId?: string | null;
  /** Optional — RFID/NFC path uses tag UID. */
  tagUid?: string | null;
}
