/**
 * GET /api/realtime/stream?channels=bus-ops:schedules,bus-ops:incidents
 */

import { NextRequest } from 'next/server';
import {
  ensureRedisSubscriber,
  subscribeRealtime,
  type RealtimeMessage,
} from '@/lib/realtime/hub';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const channelsParam = req.nextUrl.searchParams.get('channels') ?? '';
  const channels = channelsParam
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);

  if (!channels.length) {
    return new Response(JSON.stringify({ error: 'channels query required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Start cross-instance subscriber once (no-op without REDIS_URL)
  await ensureRedisSubscriber();

  const encoder = new TextEncoder();
  let closed = false;
  const unsubs: Array<() => void> = [];

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          closed = true;
        }
      };

      send('ready', {
        tenantId,
        channels,
        transport: 'sse',
        redis: Boolean(process.env.REALTIME_REDIS_URL || process.env.REDIS_URL || process.env.UPSTASH_REDIS_REST_URL),
      });

      const heartbeat = setInterval(() => {
        send('ping', { t: Date.now() });
      }, 25_000);

      for (const channel of channels) {
        unsubs.push(
          subscribeRealtime(tenantId, channel, (msg: RealtimeMessage) => {
            send('message', msg);
          }),
        );
      }

      const abort = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        for (const u of unsubs) u();
        try {
          controller.close();
        } catch {
          /* */
        }
      };

      req.signal.addEventListener('abort', abort);
    },
    cancel() {
      closed = true;
      for (const u of unsubs) u();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
