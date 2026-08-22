/**
 * Realtime hub — local fan-out + optional Redis pub/sub for multi-instance.
 *
 * Env (any of):
 *   UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN  → publish via @upstash/redis
 *   REALTIME_REDIS_URL or REDIS_URL                    → publish + subscribe via ioredis
 *   REALTIME_REDIS=0                                   → force in-memory only
 *
 * Subscribe requires a long-lived Redis protocol connection (ioredis).
 * Pure serverless without a sticky process should rely on polling fallback.
 */

export type RealtimeMessage = {
  channel: string;
  type: string;
  tenantId: string;
  at: string;
  payload?: Record<string, unknown>;
};

type Listener = (msg: RealtimeMessage) => void;

declare global {
  // eslint-disable-next-line no-var
  var __fleet360RealtimeHub: Map<string, Set<Listener>> | undefined;
  // eslint-disable-next-line no-var
  var __fleet360RealtimeRedisSubStarted: boolean | undefined;
}

function store(): Map<string, Set<Listener>> {
  if (!globalThis.__fleet360RealtimeHub) {
    globalThis.__fleet360RealtimeHub = new Map();
  }
  return globalThis.__fleet360RealtimeHub;
}

function key(tenantId: string, channel: string) {
  return `${tenantId}::${channel}`;
}

export const RT_CHANNELS = {
  schedules: 'bus-ops:schedules',
  incidents: 'bus-ops:incidents',
  scheduleTemplates: 'bus-ops:schedule-templates',
  drivers: 'bus-ops:drivers',
  maintenance: 'maintenance:requests',
  maintenanceActionCentre: 'maintenance:action-centre',
} as const;

export function redisChannelName(tenantId: string, channel: string) {
  return `rt:${tenantId}:${channel}`;
}

/** Local-only deliver (same Node process). */
export function publishRealtimeLocal(msg: RealtimeMessage) {
  const set = store().get(key(msg.tenantId, msg.channel));
  if (!set || set.size === 0) return;
  for (const listener of set) {
    try {
      listener(msg);
    } catch {
      /* isolate */
    }
  }
}

export function subscribeRealtime(
  tenantId: string,
  channel: string,
  listener: Listener,
): () => void {
  void ensureRedisSubscriber();
  const k = key(tenantId, channel);
  const map = store();
  let set = map.get(k);
  if (!set) {
    set = new Set();
    map.set(k, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) map.delete(k);
  };
}

/**
 * Publish to local listeners + Redis (when configured).
 * Safe to call from API routes after mutations.
 */
export function publishRealtime(msg: Omit<RealtimeMessage, 'at'> & { at?: string }) {
  const full: RealtimeMessage = {
    ...msg,
    at: msg.at ?? new Date().toISOString(),
  };
  publishRealtimeLocal(full);
  void publishRealtimeRedis(full);
}

function redisDisabled() {
  return process.env.REALTIME_REDIS === '0' || process.env.REALTIME_REDIS === 'false';
}

async function publishRealtimeRedis(msg: RealtimeMessage) {
  if (redisDisabled()) return;
  const body = JSON.stringify(msg);
  const ch = redisChannelName(msg.tenantId, msg.channel);

  try {
    const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
    const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (upstashUrl && upstashToken) {
      const { Redis } = await import('@upstash/redis');
      const redis = new Redis({ url: upstashUrl, token: upstashToken });
      await redis.publish(ch, body);
      return;
    }
  } catch (e) {
    console.warn('[realtime] Upstash publish failed', e);
  }

  try {
    const url = process.env.REALTIME_REDIS_URL || process.env.REDIS_URL;
    if (!url) return;
    const Redis = (await import('ioredis')).default;
    const pub = new Redis(url, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
      lazyConnect: true,
    });
    await pub.connect();
    await pub.publish(ch, body);
    await pub.quit();
  } catch (e) {
    console.warn('[realtime] Redis publish failed', e);
  }
}

/**
 * One pattern-subscribe per process. Forwards Redis messages into local hub.
 * No-op when Redis URL missing or REALTIME_REDIS=0.
 */
export async function ensureRedisSubscriber(): Promise<void> {
  if (redisDisabled()) return;
  if (globalThis.__fleet360RealtimeRedisSubStarted) return;
  const url = process.env.REALTIME_REDIS_URL || process.env.REDIS_URL;
  if (!url) return;

  globalThis.__fleet360RealtimeRedisSubStarted = true;

  try {
    const Redis = (await import('ioredis')).default;
    const sub = new Redis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });

    sub.on('error', (err: any) => {
      console.warn('[realtime] Redis subscriber error', err?.message ?? err);
    });

    // rt:{tenantId}:{channel}
    await sub.psubscribe('rt:*');

    sub.on('pmessage', (_pattern: any, _redisChannel: any, raw: any) => {
      try {
        const msg = JSON.parse(String(raw)) as RealtimeMessage;
        if (!msg?.tenantId || !msg?.channel || !msg?.type) return;
        publishRealtimeLocal(msg);
      } catch {
        /* ignore bad payloads */
      }
    });

    console.info('[realtime] Redis psubscribe rt:* active');
  } catch (e) {
    globalThis.__fleet360RealtimeRedisSubStarted = false;
    console.warn('[realtime] Redis subscriber not started (is ioredis installed?)', e);
  }
}
