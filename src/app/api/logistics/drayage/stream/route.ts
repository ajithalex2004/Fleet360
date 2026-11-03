export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { subscribeDrayageEvents } from '@/lib/logistics/drayage-events';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const encoder = new TextEncoder();
  let cleanupFn: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const sendChunk = (payload: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          closed = true;
        }
      };

      // Send initial connection confirmation
      sendChunk(
        `event: connected\ndata: ${JSON.stringify({
          status: 'connected',
          tenantId,
          timestamp: new Date().toISOString(),
        })}\n\n`,
      );

      // Subscribe to tenant-scoped real-time drayage & telematics events
      const unsubscribe = subscribeDrayageEvents(tenantId, (evt) => {
        sendChunk(`event: drayage_update\ndata: ${JSON.stringify(evt)}\n\n`);
      });

      // Keepalive heartbeat every 20s to prevent reverse-proxy idle timeout
      const heartbeatTimer = setInterval(() => {
        sendChunk(`: heartbeat ${Date.now()}\n\n`);
      }, 20_000);

      cleanupFn = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeatTimer);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Stream already closed
        }
      };

      req.signal.addEventListener('abort', () => {
        cleanupFn?.();
      });
    },
    cancel() {
      cleanupFn?.();
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
