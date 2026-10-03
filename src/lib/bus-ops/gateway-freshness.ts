/** Signed body timestamps provide freshness without trusting unsigned request headers. */
export function freshGatewayBatch(payload: { events?: Array<{ occurredAt: string }>; scanWindow?: { startedAt: string; endedAt: string } }, now = Date.now()): boolean {
  if (payload.events !== undefined && !Array.isArray(payload.events)) return false;
  const times = payload.events?.length ? payload.events.map(e=>e && typeof e.occurredAt === 'string' ? Date.parse(e.occurredAt) : NaN)
    : payload.scanWindow ? [Date.parse(payload.scanWindow.startedAt),Date.parse(payload.scanWindow.endedAt)] : [];
  return times.length <= 500 && times.every(time=>Number.isFinite(time) && Math.abs(now-time)<=5*60_000)
    && (!payload.scanWindow || Date.parse(payload.scanWindow.startedAt)<=Date.parse(payload.scanWindow.endedAt));
}
