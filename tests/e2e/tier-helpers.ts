/**
 * Tier-Based E2E Test Suite Helpers for Fleet360 Platform.
 *
 * Provides:
 *  - isServerAvailable(): Probes localhost:3000 before running tests.
 *  - skipIfOffline(serverUp, testInfo): Gracefully skips test when dev server is offline.
 *  - e2eFetch(path, options): Opaque-box HTTP client against the Next.js API server.
 *  - createWebhookHmac(secret, payload): Computes valid HMAC-SHA256 signature for webhooks.
 *  - createMockSessionCookie(payload): Generates a well-formed session cookie for authenticated requests.
 *  - Standard UAE test fixtures (TRN, License Plates, Emirates, etc.).
 */

import { type TestInfo } from '@playwright/test';
import * as crypto from 'crypto';

export const BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';

let cachedServerStatus: boolean | null = null;

/**
 * Probes the local dev server to check availability.
 */
export async function isServerAvailable(timeoutMs = 20000): Promise<boolean> {
  if (cachedServerStatus !== null) {
    return cachedServerStatus;
  }

  const urls = [BASE_URL, 'http://localhost:3000'];
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const url of urls) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch(`${url}/api/health`, { signal: controller.signal }).catch(async () => {
          return await fetch(url, { signal: controller.signal });
        });
        clearTimeout(timer);
        if (res && res.status < 500) {
          cachedServerStatus = true;
          return true;
        }
      } catch {
        // ignore and try next
      }
    }
    if (attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  cachedServerStatus = false;
  return false;
}

/**
 * Skip the test if server is not reachable.
 */
export function skipIfOffline(serverUp: boolean, testInfo: TestInfo): void {
  if (!serverUp) {
    testInfo.skip(true, 'Dev server (localhost:3000) is offline. Start server with `npm run dev` to execute live HTTP verification.');
  }
}

export interface E2ERequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  cookies?: Record<string, string>;
  timeoutMs?: number;
}

export interface E2EResponse {
  status: number;
  statusText: string;
  headers: Headers;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: () => Promise<any>;
  text: () => Promise<string>;
  ok: boolean;
}

/**
 * Opaque-box HTTP request helper.
 */
export async function e2eFetch(
  endpoint: string,
  options: E2ERequestOptions = {},
): Promise<E2EResponse> {
  const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`;
  const method = options.method || 'GET';
  const headers = new Headers(options.headers || {});

  if (options.body && typeof options.body === 'object' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (options.cookies) {
    const cookieHeader = Object.entries(options.cookies)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('; ');
    headers.set('Cookie', cookieHeader);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 15000);

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: options.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timer);

    return {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
      ok: res.ok,
      json: () => res.json(),
      text: () => res.text(),
    };
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * Generate HMAC-SHA256 signature for webhooks.
 */
export function createWebhookHmac(secret: string, payload: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Generate Twilio signature (HMAC-SHA1 of URL + sorted params).
 */
export function createTwilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + params[key];
  }
  return crypto.createHmac('sha1', authToken).update(data, 'utf-8').digest('base64');
}

/**
 * Standard test fixtures and generators for opaque-box tests.
 */
export const FIXTURES = {
  uaeTrn: '100234567800003', // Valid 15-digit UAE TRN
  emirates: ['Abu Dhabi', 'Dubai', 'Sharjah', 'Ajman', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah'] as const,
  vatRateStandard: 0.05,
  vatRateStatutoryFine: 0.00,
  randomUUID: () => crypto.randomUUID(),
  randomPlate: () => `DXB-${Math.floor(1000 + Math.random() * 9000)}`,
  randomPhone: () => `+97150${Math.floor(1000000 + Math.random() * 9000000)}`,
};
