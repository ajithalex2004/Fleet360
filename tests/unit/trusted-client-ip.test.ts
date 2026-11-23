/**
 * Unit & integration tests for Railway-aware trustedClientIp() (PR #261).
 *
 * Verifies:
 *  - Railway runtime (non-spoofable RAILWAY_* server env) prefers Railway-
 *    overwritten X-Real-IP over X-Forwarded-For's rotating CDN77 edge proxy hop,
 *    with right-anchored penultimate valid XFF fallback when X-Real-IP is missing/malformed.
 *  - Non-Railway runtime retains rightmost valid X-Forwarded-For precedence so
 *    spoofed leftmost XFF, X-Real-IP, CF-Connecting-IP, or forged X-Railway-Edge
 *    headers cannot bypass rate limits.
 *  - Strict IPv4/IPv6 validation, port stripping, IPv4-mapped IPv6 normalization,
 *    and malformed/injection input rejection.
 *  - Rate-limit isolation across distinct client IPs sharing the same Railway
 *    CDN77 edge POP IP, and consistent single-bucket enforcement + 10x concurrent
 *    burst capping when one client hits multiple rotating Railway edge POP IPs.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { mockRedis, redisKv } = vi.hoisted(() => {
  const kv = new Map<string, number>();
  return {
    redisKv: kv,
    mockRedis: {
      incr: vi.fn(async (key: string) => {
        const next = (kv.get(key) ?? 0) + 1;
        kv.set(key, next);
        return next;
      }),
      expire: vi.fn(async () => 1),
      ttl: vi.fn(async () => 600),
      del: vi.fn(async (...keys: string[]) => {
        let deleted = 0;
        for (const k of keys) {
          if (kv.delete(k)) deleted += 1;
        }
        return deleted;
      }),
    },
  };
});

vi.mock('@/lib/upstash', () => ({
  getRedis: () => mockRedis,
}));

let trustedClientIp: typeof import('@/lib/auth/setup-bootstrap').trustedClientIp;
let parseIpCandidate: typeof import('@/lib/auth/setup-bootstrap').parseIpCandidate;
let isRailwayRuntime: typeof import('@/lib/auth/setup-bootstrap').isRailwayRuntime;
let consumeLoginAttempt: typeof import('@/lib/auth/auth-rate-limit').consumeLoginAttempt;
let checkResetPasswordRateLimit: typeof import('@/lib/auth/auth-rate-limit').checkResetPasswordRateLimit;
let resetAuthRateLimitsForTests: typeof import('@/lib/auth/auth-rate-limit').resetAuthRateLimitsForTests;

beforeAll(async () => {
  vi.resetModules();
  ({ trustedClientIp, parseIpCandidate, isRailwayRuntime } = await import('@/lib/auth/setup-bootstrap'));
  ({ consumeLoginAttempt, checkResetPasswordRateLimit, resetAuthRateLimitsForTests } = await import(
    '@/lib/auth/auth-rate-limit'
  ));
});

function makeReq(headers: Record<string, string>): NextRequest {
  return new NextRequest('https://fleet360.example.com/api/auth/login', {
    method: 'POST',
    headers,
  });
}

describe('trustedClientIp() — Railway vs non-Railway proxy semantics & IP validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisKv.clear();
    vi.unstubAllEnvs();
    vi.stubEnv('RAILWAY_ENVIRONMENT', '');
    vi.stubEnv('RAILWAY_PROJECT_ID', '');
    vi.stubEnv('RAILWAY_SERVICE_ID', '');
    resetAuthRateLimitsForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    redisKv.clear();
    resetAuthRateLimitsForTests();
  });

  describe('Railway runtime behavior', () => {
    it('prefers Railway-overwritten X-Real-IP over rightmost CDN77 edge IP in X-Forwarded-For', () => {
      vi.stubEnv('RAILWAY_ENVIRONMENT', 'production');
      expect(isRailwayRuntime()).toBe(true);

      const req = makeReq({
        'x-real-ip': '92.96.121.163',
        'x-forwarded-for': '92.96.121.163, 152.233.12.241',
        'x-railway-edge': 'railway/asia-southeast1',
      });
      expect(trustedClientIp(req)).toBe('92.96.121.163');
    });

    it('detects Railway runtime via RAILWAY_PROJECT_ID or RAILWAY_SERVICE_ID as well', () => {
      vi.stubEnv('RAILWAY_PROJECT_ID', 'ac5b8297-816b-44d3-bb61-41f079e92faa');
      expect(isRailwayRuntime()).toBe(true);

      const req = makeReq({
        'x-real-ip': '203.0.113.10',
        'x-forwarded-for': '203.0.113.10, 152.233.13.164',
      });
      expect(trustedClientIp(req)).toBe('203.0.113.10');

      vi.stubEnv('RAILWAY_PROJECT_ID', '');
      vi.stubEnv('RAILWAY_SERVICE_ID', 'svc-123');
      expect(isRailwayRuntime()).toBe(true);
      expect(trustedClientIp(req)).toBe('203.0.113.10');
    });

    it('falls back to right-anchored penultimate XFF on Railway when X-Real-IP is missing/malformed (defeating spoofed leftmost & >4KB padding)', () => {
      vi.stubEnv('RAILWAY_ENVIRONMENT', 'staging');

      const missingReal = makeReq({
        'x-forwarded-for': '92.96.121.163, 152.233.12.242',
      });
      expect(trustedClientIp(missingReal)).toBe('92.96.121.163');

      const malformedReal = makeReq({
        'x-real-ip': 'not-an-ip;drop',
        'x-forwarded-for': 'garbage, 92.96.121.163, 152.233.12.245',
      });
      expect(trustedClientIp(malformedReal)).toBe('92.96.121.163');

      // Attacker prepends spoofed leftmost IP in XFF when X-Real-IP is absent -> penultimate skips spoof & CDN77 hop
      const spoofedLeft = makeReq({
        'x-forwarded-for': '198.51.100.77, 92.96.121.163, 152.233.12.241',
      });
      expect(trustedClientIp(spoofedLeft)).toBe('92.96.121.163');

      // Attacker pads >4KB of spoofed leftmost XFF entries -> trailing slice preserves real client IP
      const paddedSpoof = makeReq({
        'x-forwarded-for': `${'198.51.100.1, '.repeat(400)}92.96.121.163, 152.233.12.241`,
      });
      expect(trustedClientIp(paddedSpoof)).toBe('92.96.121.163');

      // Single-hop Railway XFF without CDN77 hop still resolves to sole valid IP
      const singleHop = makeReq({
        'x-forwarded-for': '92.96.121.163',
      });
      expect(trustedClientIp(singleHop)).toBe('92.96.121.163');
    });

    it('falls back to CF-Connecting-IP and then unknown on Railway when X-Real-IP and XFF are absent/invalid', () => {
      vi.stubEnv('RAILWAY_ENVIRONMENT', 'production');

      expect(
        trustedClientIp(
          makeReq({
            'x-real-ip': '999.999.999.999',
            'x-forwarded-for': 'invalid, also-invalid',
            'cf-connecting-ip': '198.51.100.7',
          }),
        ),
      ).toBe('198.51.100.7');

      expect(trustedClientIp(makeReq({}))).toBe('unknown');
    });
  });

  describe('Non-Railway runtime behavior (standard reverse-proxy fallback)', () => {
    it('retains rightmost valid X-Forwarded-For precedence and defeats leftmost XFF & X-Real-IP spoofing', () => {
      expect(isRailwayRuntime()).toBe(false);

      const req = makeReq({
        // Attacker injects forged X-Railway-Edge, X-Real-IP, CF-Connecting-IP, and leftmost XFF
        'x-railway-edge': 'railway/spoofed',
        'x-real-ip': '198.51.100.99',
        'cf-connecting-ip': '198.51.100.88',
        'x-forwarded-for': '198.51.100.1, 203.0.113.50',
      });
      expect(trustedClientIp(req)).toBe('203.0.113.50');
    });

    it('skips trailing malformed tokens in X-Forwarded-For outside Railway', () => {
      const req = makeReq({
        'x-forwarded-for': '198.51.100.1, 203.0.113.50, malformed-garbage',
      });
      expect(trustedClientIp(req)).toBe('203.0.113.50');
    });

    it('falls back to X-Real-IP, then CF-Connecting-IP, then unknown outside Railway', () => {
      expect(trustedClientIp(makeReq({ 'x-real-ip': '203.0.113.11' }))).toBe('203.0.113.11');
      expect(trustedClientIp(makeReq({ 'cf-connecting-ip': '203.0.113.12' }))).toBe('203.0.113.12');
      expect(trustedClientIp(makeReq({}))).toBe('unknown');
    });
  });

  describe('parseIpCandidate() strict normalization & malformed input rejection', () => {
    it('canonicalizes all RFC 5952 IPv6 and dotted/hex/expanded IPv4-mapped IPv6 forms to one identical key', () => {
      expect(parseIpCandidate('92.96.121.163')).toBe('92.96.121.163');
      expect(parseIpCandidate('  "92.96.121.163"  ')).toBe('92.96.121.163');
      expect(parseIpCandidate('92.96.121.163:54321')).toBe('92.96.121.163');

      // All IPv4-mapped IPv6 encodings (dotted, uppercase, expanded, hex) collapse to canonical IPv4
      expect(parseIpCandidate('::ffff:92.96.121.163')).toBe('92.96.121.163');
      expect(parseIpCandidate('::FFFF:92.96.121.163')).toBe('92.96.121.163');
      expect(parseIpCandidate('0:0:0:0:0:ffff:92.96.121.163')).toBe('92.96.121.163');
      expect(parseIpCandidate('::ffff:5c60:79a3')).toBe('92.96.121.163');
      expect(parseIpCandidate('0000:0000:0000:0000:0000:ffff:5c60:79a3')).toBe('92.96.121.163');

      // All IPv6 expanded/compressed/mixed-case forms collapse to one RFC 5952 key
      expect(parseIpCandidate('2001:DB8::1')).toBe('2001:db8::1');
      expect(parseIpCandidate('2001:0db8::1')).toBe('2001:db8::1');
      expect(parseIpCandidate('2001:db8:0::1')).toBe('2001:db8::1');
      expect(parseIpCandidate('2001:0db8:0000:0000:0000:0000:0000:0001')).toBe('2001:db8::1');
      expect(parseIpCandidate('[2001:0DB8::1]:443')).toBe('2001:db8::1');
      expect(parseIpCandidate('[2001:db8::1]')).toBe('2001:db8::1');
    });

    it('rejects malformed, leading-zero IPv4, bracketed IPv4, out-of-range, multi-value, zone-qualified, and injection payloads', () => {
      expect(parseIpCandidate('')).toBeNull();
      expect(parseIpCandidate('   ')).toBeNull();
      expect(parseIpCandidate('999.999.999.999')).toBeNull();
      expect(parseIpCandidate('010.0.0.1')).toBeNull();
      expect(parseIpCandidate('[92.96.121.163]:443')).toBeNull();
      expect(parseIpCandidate('92.96.121.163:0')).toBeNull();
      expect(parseIpCandidate('92.96.121.163:70000')).toBeNull();
      expect(parseIpCandidate('[2001:db8::1]:99999')).toBeNull();
      expect(parseIpCandidate('[2001:db8::1')).toBeNull();
      expect(parseIpCandidate('fe80::1%eth0')).toBeNull();
      expect(parseIpCandidate('92.96.121.163, 152.233.12.241')).toBeNull();
      expect(parseIpCandidate('92.96.121.163; DROP TABLE audit_logs')).toBeNull();
      expect(parseIpCandidate('a'.repeat(100))).toBeNull();
      expect(parseIpCandidate(`${' '.repeat(140)}92.96.121.163`)).toBeNull();
    });
  });

  describe('Rate-limit bucketing & cross-customer isolation on Railway Metal Edge', () => {
    it('enforces exact single-client limits across rotating CDN77 POP IPs and isolates unrelated clients sharing the same POP', async () => {
      vi.stubEnv('RAILWAY_ENVIRONMENT', 'production');
      const cdn77Pops = [
        '152.233.12.241',
        '152.233.12.242',
        '152.233.12.245',
        '152.233.13.164',
        '152.233.13.165',
      ];

      // 1. Concurrent 10x burst from one client split across 5 rotating Railway CDN77 POPs:
      //    exactly 5 allowed, 5 rejected (no split across edge IPs).
      const burstDecisions = await Promise.all(
        Array.from({ length: 10 }, (_, idx) => {
          const pop = cdn77Pops[idx % cdn77Pops.length];
          const ip = trustedClientIp(
            makeReq({
              'x-real-ip': '92.96.121.163',
              'x-forwarded-for': `92.96.121.163, ${pop}`,
            }),
          );
          expect(ip).toBe('92.96.121.163');
          return consumeLoginAttempt(ip, 'victim@fleet360.example.com');
        }),
      );
      expect(burstDecisions.filter((d) => d.allowed).length).toBe(5);
      expect(burstDecisions.filter((d) => !d.allowed).length).toBe(5);

      // 2. Exhaust reset-password limit (10) from client A across rotating POPs -> 11th blocked
      for (let i = 0; i < 10; i++) {
        const ipA = trustedClientIp(
          makeReq({
            'x-real-ip': '92.96.121.163',
            'x-forwarded-for': `92.96.121.163, ${cdn77Pops[i % cdn77Pops.length]}`,
          }),
        );
        expect((await checkResetPasswordRateLimit(ipA)).allowed).toBe(true);
      }
      const blockedA = await checkResetPasswordRateLimit(
        trustedClientIp(
          makeReq({
            'x-real-ip': '92.96.121.163',
            'x-forwarded-for': '92.96.121.163, 152.233.12.241',
          }),
        ),
      );
      expect(blockedA.allowed).toBe(false);

      // 3. Unrelated customer B hitting the EXACT SAME Railway CDN77 edge POP (152.233.12.241)
      //    must NOT share client A's locked bucket.
      const ipB = trustedClientIp(
        makeReq({
          'x-real-ip': '198.51.100.42',
          'x-forwarded-for': '198.51.100.42, 152.233.12.241',
        }),
      );
      expect(ipB).toBe('198.51.100.42');
      expect((await checkResetPasswordRateLimit(ipB)).allowed).toBe(true);
      expect((await consumeLoginAttempt(ipB, 'other-tenant@fleet360.example.com')).allowed).toBe(true);
    });
  });
});
