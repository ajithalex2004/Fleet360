'use client';

import { useEffect, useRef } from 'react';

export type RealtimeMessage = {
  channel: string;
  type: string;
  tenantId: string;
  at: string;
  payload?: Record<string, unknown>;
};

export type RealtimeHandler = (msg: RealtimeMessage) => void;

/**
 * Subscribe to realtime push channels.
 *
 * Transport priority:
 * 1. WebSocket when NEXT_PUBLIC_REALTIME_WS_URL is set
 * 2. SSE  /api/realtime/stream  (default — works with Next.js)
 */
export function useRealtimeChannel(
  channels: string[],
  onMessage: RealtimeHandler,
  opts?: { enabled?: boolean },
) {
  const enabled = opts?.enabled ?? true;
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;
  const channelsKey = channels.join(',');

  useEffect(() => {
    if (!enabled || !channels.length) return;
    if (typeof window === 'undefined') return;

    let closed = false;
    let retryMs = 2_000;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let dispose: (() => void) | null = null;

    const handlePayload = (raw: unknown) => {
      if (!raw || typeof raw !== 'object') return;
      const msg = raw as RealtimeMessage;
      if (!msg.channel || !msg.type) return;
      handlerRef.current(msg);
    };

    const scheduleReconnect = (connect: () => () => void) => {
      if (closed) return;
      retryTimer = setTimeout(() => {
        retryMs = Math.min(retryMs * 1.5, 30_000);
        dispose = connect();
      }, retryMs);
    };

    const connectSse = () => {
      const qs = encodeURIComponent(channelsKey);
      const es = new EventSource(`/api/realtime/stream?channels=${qs}`);

      const onMsg = (ev: MessageEvent) => {
        try {
          handlePayload(JSON.parse(ev.data));
        } catch {
          /* ignore */
        }
      };

      es.addEventListener('message', onMsg as EventListener);
      es.addEventListener('ready', () => {
        retryMs = 2_000;
      });
      es.onerror = () => {
        es.close();
        scheduleReconnect(connectSse);
      };

      return () => {
        es.removeEventListener('message', onMsg as EventListener);
        es.close();
      };
    };

    const connectWs = (url: string) => {
      const ws = new WebSocket(
        `${url.replace(/\/$/, '')}?channels=${encodeURIComponent(channelsKey)}`,
      );
      ws.onopen = () => {
        retryMs = 2_000;
        ws.send(JSON.stringify({ type: 'subscribe', channels: channelsKey.split(',') }));
      };
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(String(ev.data));
          if (data?.payload) handlePayload(data.payload);
          else handlePayload(data);
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => scheduleReconnect(() => connectWs(url));
      return () => {
        try {
          ws.close();
        } catch {
          /* */
        }
      };
    };

    const wsUrl = process.env.NEXT_PUBLIC_REALTIME_WS_URL;
    dispose = wsUrl ? connectWs(wsUrl) : connectSse();

    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      dispose?.();
    };
  }, [channelsKey, enabled]);
}
