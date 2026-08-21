/**
 * Optional dedicated WebSocket gateway (long-running Node process).
 *
 *   node src/lib/realtime/ws-gateway.mjs
 *   NEXT_PUBLIC_REALTIME_WS_URL=ws://localhost:3081
 *
 * For production multi-instance, replace the in-memory fanout with Redis.
 * Default Fleet360 path uses SSE (/api/realtime/stream) and does not need this.
 */
import http from 'node:http';
import { WebSocketServer } from 'ws';

const port = Number(process.env.REALTIME_WS_PORT || 3081);
const server = http.createServer((_req, res) => {
  res.writeHead(200);
  res.end('Fleet360 realtime WS gateway');
});
const wss = new WebSocketServer({ server });

/** @type {Map<string, Set<import('ws').WebSocket>>} */
const rooms = new Map();

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const channels = (url.searchParams.get('channels') || '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);

  for (const ch of channels) {
    if (!rooms.has(ch)) rooms.set(ch, new Set());
    rooms.get(ch).add(ws);
  }

  ws.on('message', (buf) => {
    try {
      const msg = JSON.parse(String(buf));
      // Broadcast helper for local testing: { type:'broadcast', channel, payload }
      if (msg?.type === 'broadcast' && msg.channel) {
        const set = rooms.get(msg.channel);
        if (!set) return;
        const data = JSON.stringify(msg.payload ?? msg);
        for (const client of set) {
          if (client.readyState === 1) client.send(data);
        }
      }
    } catch {
      /* ignore */
    }
  });

  ws.on('close', () => {
    for (const ch of channels) {
      rooms.get(ch)?.delete(ws);
    }
  });
});

server.listen(port, () => {
  console.log(`[realtime-ws] listening on :${port}`);
});
