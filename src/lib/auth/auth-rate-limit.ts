/**
 * Redis-backed authentication & password-reset abuse protection (M1-P1-2, M1-P1-5).
 *
 * Uses Upstash Redis counters (`INCR` + `EXPIRE` / `MGET` / `DEL`) when configured
 * so brute-force and credential-stuffing protections are enforced across all
 * application replicas. Falls back to a bounded in-process map (max 10,000 keys)
 * when Redis is unavailable or unconfigured in local/CI environments.
 *
 * All user/email identifiers are SHA-256 hashed before being used as Redis keys
 * so no PII appears in Redis keyspace telemetry.
 */

import crypto from 'crypto';
import { getRedis } from '@/lib/upstash';

export const AUTH_THROTTLE_WINDOW_SEC = 15 * 60; // 15 minutes
const AUTH_THROTTLE_WINDOW_MS = AUTH_THROTTLE_WINDOW_SEC * 1000;
const REDIS_TIMEOUT_MS = 1_500;
const MAX_FALLBACK_ENTRIES = 10_000;

export const LOGIN_IP_ACCOUNT_LIMIT = 5;
export const LOGIN_ACCOUNT_LIMIT = 10;
export const LOGIN_IP_LIMIT = 30;
export const MFA_USER_LIMIT = 5;
export const FORGOT_PASSWORD_IP_LIMIT = 10;
export const FORGOT_PASSWORD_EMAIL_LIMIT = 3;
export const RESET_PASSWORD_IP_LIMIT = 10;

export interface ThrottleDecision {
  allowed: boolean;
  retryAfterSec: number;
  reason?: string;
}

interface MemoryCounter {
  count: number;
  expiresAt: number;
}

const memoryStore = new Map<string, MemoryCounter>();

function pruneMemoryStore(now: number): void {
  if (memoryStore.size < MAX_FALLBACK_ENTRIES) return;
  for (const [k, entry] of memoryStore.entries()) {
    if (entry.expiresAt <= now) {
      memoryStore.delete(k);
    }
  }
  while (memoryStore.size >= MAX_FALLBACK_ENTRIES) {
    const oldestKey = memoryStore.keys().next().value;
    if (oldestKey === undefined) break;
    memoryStore.delete(oldestKey);
  }
}

function hashIdentifier(value: string): string {
  return crypto
    .createHash('sha256')
    .update(value.trim().toLowerCase())
    .digest('hex')
    .slice(0, 24);
}

function sanitizeIpSegment(ip: string): string {
  const clean = (ip || 'unknown').trim().toLowerCase().replace(/[^a-z0-9.:_-]/g, '_');
  return clean.slice(0, 64) || 'unknown';
}

function loginKeys(ip: string, normalizedIdent: string): {
  ipAccount: string;
  account: string;
  ipOnly: string;
} {
  const safeIp = sanitizeIpSegment(ip);
  const identHash = hashIdentifier(normalizedIdent);
  return {
    ipAccount: `auth:fail:ip_acct:${safeIp}:${identHash}`,
    account: `auth:fail:acct:${identHash}`,
    ipOnly: `auth:fail:ip:${safeIp}`,
  };
}

function mfaKey(userId: string): string {
  return `auth:fail:mfa:${hashIdentifier(userId)}`;
}

async function withRedisTimeout<T>(op: Promise<T>): Promise<T> {
  let timerId: ReturnType<typeof setTimeout> | undefined;
  op.catch(() => {});
  try {
    const timeout = new Promise<never>((_, reject) => {
      timerId = setTimeout(() => reject(new Error('Redis throttle operation timed out')), REDIS_TIMEOUT_MS);
    });
    return await Promise.race([op, timeout]);
  } finally {
    if (timerId !== undefined) clearTimeout(timerId);
  }
}

function readMemoryCounter(key: string, now: number): { count: number; retryAfterSec: number } {
  const entry = memoryStore.get(key);
  if (!entry || entry.expiresAt <= now) {
    if (entry) memoryStore.delete(key);
    return { count: 0, retryAfterSec: AUTH_THROTTLE_WINDOW_SEC };
  }
  return {
    count: entry.count,
    retryAfterSec: Math.max(1, Math.ceil((entry.expiresAt - now) / 1000)),
  };
}

function incrMemoryCounter(key: string, windowSec: number, now: number): { count: number; retryAfterSec: number } {
  const existing = memoryStore.get(key);
  if (!existing || existing.expiresAt <= now) {
    pruneMemoryStore(now);
    const expiresAt = now + windowSec * 1000;
    memoryStore.set(key, { count: 1, expiresAt });
    return { count: 1, retryAfterSec: windowSec };
  }
  existing.count += 1;
  return {
    count: existing.count,
    retryAfterSec: Math.max(1, Math.ceil((existing.expiresAt - now) / 1000)),
  };
}

function decrMemoryCounter(key: string, now: number): void {
  const entry = memoryStore.get(key);
  if (!entry || entry.expiresAt <= now) {
    if (entry) memoryStore.delete(key);
    return;
  }
  if (entry.count <= 1) {
    memoryStore.delete(key);
  } else {
    entry.count -= 1;
  }
}

async function readCounterBatch(keys: string[]): Promise<Array<{ count: number; retryAfterSec: number }>> {
  const now = Date.now();
  const redis = getRedis();
  if (redis && typeof redis.mget === 'function') {
    try {
      const vals = await withRedisTimeout(redis.mget<Array<string | number | null>>(...keys));
      if (Array.isArray(vals) && vals.length === keys.length) {
        return vals.map((v) => ({
          count: Math.max(0, Number(v) || 0),
          retryAfterSec: AUTH_THROTTLE_WINDOW_SEC,
        }));
      }
    } catch (err) {
      console.warn('[auth-rate-limit] Redis mget failed, falling back to memory:', err instanceof Error ? err.message : String(err));
    }
  }
  return keys.map((k) => readMemoryCounter(k, now));
}

async function incrementCounter(key: string, windowSec = AUTH_THROTTLE_WINDOW_SEC): Promise<{ count: number; retryAfterSec: number }> {
  const now = Date.now();
  const redis = getRedis();
  if (redis && typeof redis.incr === 'function') {
    try {
      const count = await withRedisTimeout(redis.incr(key));
      if (count === 1 && typeof redis.expire === 'function') {
        await withRedisTimeout(redis.expire(key, windowSec));
      }
      let retryAfterSec = windowSec;
      if (typeof redis.ttl === 'function') {
        const ttl = await withRedisTimeout(redis.ttl(key)).catch(() => null);
        if (typeof ttl === 'number' && ttl > 0) {
          retryAfterSec = ttl;
        } else if (ttl === -1 && typeof redis.expire === 'function') {
          // Repair only a genuine key missing a TTL (never on Redis timeout/error).
          await withRedisTimeout(redis.expire(key, windowSec)).catch(() => {});
        }
      }
      return { count, retryAfterSec };
    } catch (err) {
      console.warn('[auth-rate-limit] Redis incr failed, falling back to memory:', err instanceof Error ? err.message : String(err));
    }
  }
  return incrMemoryCounter(key, windowSec, now);
}

async function decrementCounter(key: string): Promise<void> {
  const now = Date.now();
  const redis = getRedis();
  if (redis && typeof redis.decr === 'function') {
    try {
      const next = await withRedisTimeout(redis.decr(key));
      // Only remove if key did not exist prior to decr (went negative with no TTL).
      // Leaving next === 0 preserves the existing TTL and avoids deleting a concurrent incr.
      if (typeof next === 'number' && next < 0 && typeof redis.del === 'function') {
        await withRedisTimeout(redis.del(key)).catch(() => {});
      }
      return;
    } catch (err) {
      console.warn('[auth-rate-limit] Redis decr failed, falling back to memory:', err instanceof Error ? err.message : String(err));
    }
  }
  decrMemoryCounter(key, now);
}

async function deleteKeys(keys: string[]): Promise<void> {
  for (const k of keys) {
    memoryStore.delete(k);
  }
  const redis = getRedis();
  if (redis && typeof redis.del === 'function' && keys.length > 0) {
    try {
      await withRedisTimeout(redis.del(...keys));
    } catch (err) {
      console.warn('[auth-rate-limit] Redis del failed:', err instanceof Error ? err.message : String(err));
    }
  }
}

async function getRedisTtlOrDefault(key: string, fallbackSec: number): Promise<number> {
  const redis = getRedis();
  if (redis && typeof redis.ttl === 'function') {
    try {
      const ttl = await withRedisTimeout(redis.ttl(key));
      if (typeof ttl === 'number' && ttl > 0) return ttl;
    } catch {
      // Fall back to default window
    }
  }
  return fallbackSec;
}

/**
 * Atomically consumes a login attempt slot across (ip + account), (account-only
 * across all IPs), and (ip-only across all accounts) BEFORE DB lookup / PBKDF2.
 * Increment-before-verify defeats concurrent burst (TOCTOU) attacks.
 */
export async function consumeLoginAttempt(ip: string, normalizedIdent: string): Promise<ThrottleDecision> {
  const keys = loginKeys(ip, normalizedIdent);
  const [ipAcct, acct, ipOnly] = await Promise.all([
    incrementCounter(keys.ipAccount, AUTH_THROTTLE_WINDOW_SEC),
    incrementCounter(keys.account, AUTH_THROTTLE_WINDOW_SEC),
    incrementCounter(keys.ipOnly, AUTH_THROTTLE_WINDOW_SEC),
  ]);

  if (ipAcct.count > LOGIN_IP_ACCOUNT_LIMIT) {
    return { allowed: false, retryAfterSec: ipAcct.retryAfterSec, reason: 'ip_account_limit' };
  }
  if (acct.count > LOGIN_ACCOUNT_LIMIT) {
    return { allowed: false, retryAfterSec: acct.retryAfterSec, reason: 'account_limit' };
  }
  if (ipOnly.count > LOGIN_IP_LIMIT) {
    return { allowed: false, retryAfterSec: ipOnly.retryAfterSec, reason: 'ip_limit' };
  }
  return { allowed: true, retryAfterSec: 0 };
}

/**
 * Atomically consumes canonical-email account buckets when the caller logged in
 * via an alias (username / employeeId / prefix) that differs from `user.email`.
 * Deliberately does NOT increment `ipOnly` a second time for the same request.
 */
export async function consumeAliasAccountAttempt(ip: string, canonicalIdent: string): Promise<ThrottleDecision> {
  const keys = loginKeys(ip, canonicalIdent);
  const [ipAcct, acct] = await Promise.all([
    incrementCounter(keys.ipAccount, AUTH_THROTTLE_WINDOW_SEC),
    incrementCounter(keys.account, AUTH_THROTTLE_WINDOW_SEC),
  ]);

  if (ipAcct.count > LOGIN_IP_ACCOUNT_LIMIT) {
    return { allowed: false, retryAfterSec: ipAcct.retryAfterSec, reason: 'ip_account_limit' };
  }
  if (acct.count > LOGIN_ACCOUNT_LIMIT) {
    return { allowed: false, retryAfterSec: acct.retryAfterSec, reason: 'account_limit' };
  }
  return { allowed: true, retryAfterSec: 0 };
}

/**
 * Atomically consumes an MFA verification attempt for `userId` across all IPs
 * BEFORE evaluating TOTP or recovery codes (defeats concurrent burst races).
 */
export async function consumeMfaAttempt(userId: string): Promise<ThrottleDecision> {
  const key = mfaKey(userId);
  const res = await incrementCounter(key, AUTH_THROTTLE_WINDOW_SEC);
  if (res.count > MFA_USER_LIMIT) {
    return { allowed: false, retryAfterSec: res.retryAfterSec, reason: 'mfa_limit' };
  }
  return { allowed: true, retryAfterSec: 0 };
}

/**
 * Read-only MFA lockout check used solely on the Step-1 login challenge prompt
 * (valid password, no MFA code submitted yet) so already-locked accounts get 429
 * without consuming an extra MFA guess.
 */
export async function checkMfaThrottle(userId: string): Promise<ThrottleDecision> {
  const key = mfaKey(userId);
  const [mfa] = await readCounterBatch([key]);
  if (mfa.count >= MFA_USER_LIMIT) {
    const retryAfterSec = await getRedisTtlOrDefault(key, mfa.retryAfterSec);
    return { allowed: false, retryAfterSec, reason: 'mfa_limit' };
  }
  return { allowed: true, retryAfterSec: 0 };
}

/**
 * Releases 1 slot from the per-IP counter upon successful authentication (or
 * valid-password Step-1 MFA challenge) so legitimate users behind a shared NAT
 * do not accumulate toward LOGIN_IP_LIMIT while prior spray failures stay intact.
 */
export async function releaseLoginIpSlotOnSuccess(ip: string): Promise<void> {
  const { ipOnly } = loginKeys(ip, '');
  await decrementCounter(ipOnly);
}

/** Clears account-scoped login and MFA failure counters after full authentication success. */
export async function clearLoginFailures(ip: string, normalizedIdent: string, userId?: string): Promise<void> {
  const keys = loginKeys(ip, normalizedIdent);
  const toClear = [keys.ipAccount, keys.account];
  if (userId) toClear.push(mfaKey(userId));
  await deleteKeys(toClear);
}

/** Clears only the MFA failure counter (e.g. after successful MFA verification on enroll/disable). */
export async function clearMfaFailures(userId: string): Promise<void> {
  await deleteKeys([mfaKey(userId)]);
}

/**
 * Enforces Redis-backed per-IP and per-email rate limits on POST /api/auth/forgot-password.
 * Must be called BEFORE looking up whether the email exists to avoid account enumeration.
 */
export async function checkForgotPasswordRateLimit(ip: string, normalizedEmail: string): Promise<ThrottleDecision> {
  const ipKey = `auth:forgot:ip:${sanitizeIpSegment(ip)}`;
  const emailKey = `auth:forgot:email:${hashIdentifier(normalizedEmail)}`;

  const [ipRes, emailRes] = await Promise.all([
    incrementCounter(ipKey, AUTH_THROTTLE_WINDOW_SEC),
    incrementCounter(emailKey, AUTH_THROTTLE_WINDOW_SEC),
  ]);

  if (ipRes.count > FORGOT_PASSWORD_IP_LIMIT) {
    return { allowed: false, retryAfterSec: ipRes.retryAfterSec, reason: 'forgot_ip_limit' };
  }
  if (emailRes.count > FORGOT_PASSWORD_EMAIL_LIMIT) {
    return { allowed: false, retryAfterSec: emailRes.retryAfterSec, reason: 'forgot_email_limit' };
  }
  return { allowed: true, retryAfterSec: 0 };
}

/**
 * Enforces Redis-backed per-IP rate limiting on POST /api/auth/reset-password.
 */
export async function checkResetPasswordRateLimit(ip: string): Promise<ThrottleDecision> {
  const ipKey = `auth:reset:ip:${sanitizeIpSegment(ip)}`;
  const res = await incrementCounter(ipKey, AUTH_THROTTLE_WINDOW_SEC);
  if (res.count > RESET_PASSWORD_IP_LIMIT) {
    return { allowed: false, retryAfterSec: res.retryAfterSec, reason: 'reset_ip_limit' };
  }
  return { allowed: true, retryAfterSec: 0 };
}

/** Tests only: clear in-memory fallback throttle counters between cases. */
export function resetAuthRateLimitsForTests(): void {
  memoryStore.clear();
}

export { AUTH_THROTTLE_WINDOW_MS };
