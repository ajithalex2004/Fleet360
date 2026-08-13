/**
 * lib/driver-session-client.ts
 *
 * Client-side helper to fetch the current shift + driver context.
 * Used by UI pages that need to know the driverId / tenantId /
 * shiftId without the middleware-injected headers (which are
 * server-side only).
 *
 * Reads the active shift from the same endpoint the API uses. The
 * result is cached for 5 s to avoid hammering the server on every
 * page render.
 */

interface CurrentShiftContext {
  shiftId: string | null;
  driverId: string;
  tenantId: string;
}

let cached: { at: number; ctx: CurrentShiftContext | null } | null = null;
const CACHE_MS = 5_000;

export async function getCurrentShift(): Promise<CurrentShiftContext | null> {
  if (typeof window === 'undefined') return null;
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.ctx;

  try {
    // Fetch from /api/auth/me to get the driver + tenant.
    const meRes = await fetch('/api/auth/me', { credentials: 'include' });
    if (!meRes.ok) {
      cached = { at: Date.now(), ctx: null };
      return null;
    }
    const me = await meRes.json();
    if (!me?.user?.id || !me?.tenant?.id) {
      cached = { at: Date.now(), ctx: null };
      return null;
    }

    // Then fetch the active shift (if any).
    const shiftRes = await fetch('/api/driver-app/shift/current', { credentials: 'include' });
    const shiftData = shiftRes.ok ? await shiftRes.json() : { shift: null };

    const ctx: CurrentShiftContext = {
      shiftId: shiftData.shift?.id ?? null,
      driverId: me.user.id,
      tenantId: me.tenant.id,
    };
    cached = { at: Date.now(), ctx };
    return ctx;
  } catch {
    cached = { at: Date.now(), ctx: null };
    return null;
  }
}
