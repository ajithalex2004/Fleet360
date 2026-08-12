/**
 * lib/push/server.ts — VAPID setup + send helpers for the Staff Transport PWA.
 *
 * VAPID keys are read from the environment (`VAPID_PUBLIC_KEY` and
 * `VAPID_PRIVATE_KEY`). On first run the server will auto-generate a key
 * pair and print a one-liner to copy into .env. The keys live in the
 * repo's `.env` so they survive dev-server restarts; the public key is
 * safe to ship to clients.
 *
 * Push subscription rows live in `push_subscriptions` (see Prisma model).
 * Sending is fire-and-forget — the scheduler iterates the per-tenant
 * audience, and the receiver's service worker decides what to do with the
 * payload.
 */

import webpush from 'web-push';
import type { PushSubscription as WebPushSubscription } from 'web-push';

let vapidConfigured = false;

function loadVapidKeys(): { publicKey: string; privateKey: string; subject: string } {
  const publicKey  = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject    = process.env.VAPID_SUBJECT ?? 'mailto:admin@fleet360.com';
  if (!publicKey || !privateKey) {
    throw new Error(
      'VAPID keys are not configured. Add VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY to .env.\n' +
      'Generate a pair with: npx web-push generate-vapid-keys',
    );
  }
  return { publicKey, privateKey, subject };
}

/** Configure the global web-push SDK with the VAPID key pair. Idempotent. */
export function configureWebPush(): void {
  if (vapidConfigured) return;
  const { publicKey, privateKey, subject } = loadVapidKeys();
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
}

export interface PushPayload {
  /** Title shown in the OS notification. */
  title: string;
  /** Body text. */
  body: string;
  /** Deep-link target when the user taps the notification. */
  url?: string;
  /** Tag for collapsing repeat notifications. */
  tag?: string;
  /** Sound / channel: 'default' or 'silent'. */
  sound?: 'default' | 'silent';
  /** Arbitrary key/value data the SW can read from event.data.json(). */
  data?: Record<string, unknown>;
  /** Optional icon URL (defaults to /icon-192.png). */
  icon?: string;
  /** Optional badge URL (defaults to /icon-96.png). */
  badge?: string;
}

/** Outcome of one send. The caller (scheduler) writes back error metadata
 *  to the subscription row so we can prune dead endpoints. */
export type SendResult =
  | { ok: true; statusCode: number }
  | { ok: false; statusCode: number; reason: 'gone' | 'invalid' | 'transient' };

/** Send one push to one subscription. */
export async function sendPush(
  sub: { endpoint: string; p256dh: string; auth: string },
  payload: PushPayload,
  opts: { ttlSeconds?: number } = {},
): Promise<SendResult> {
  configureWebPush();
  const wpSub: WebPushSubscription = {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.p256dh, auth: sub.auth },
  };
  const json = JSON.stringify({
    title: payload.title,
    body:  payload.body,
    url:   payload.url,
    tag:   payload.tag,
    sound: payload.sound ?? 'default',
    icon:  payload.icon  ?? '/icon-192.png',
    badge: payload.badge ?? '/icon-192.png',
    data:  payload.data ?? {},
  });
  try {
    const res = await webpush.sendNotification(wpSub, json, {
      TTL: opts.ttlSeconds ?? 60 * 60, // 1h — push is best-effort, OS may dedupe
      urgency: 'normal',
    });
    return { ok: true, statusCode: res.statusCode };
  } catch (e: unknown) {
    const err = e as { statusCode?: number; body?: string; message?: string };
    const code = err.statusCode ?? 0;
    if (code === 404 || code === 410) return { ok: false, statusCode: code, reason: 'gone' };
    if (code === 400 || code === 403) return { ok: false, statusCode: code, reason: 'invalid' };
    return { ok: false, statusCode: code, reason: 'transient' };
  }
}

/** Public VAPID key — sent to the browser so it can subscribe. */
export function getPublicVapidKey(): string {
  return loadVapidKeys().publicKey;
}
