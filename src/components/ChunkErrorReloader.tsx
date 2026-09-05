'use client';
/**
 * ChunkErrorReloader — recovers from stale-deployment ChunkLoadErrors.
 *
 * Next.js splits each route into its own JS chunk, named by a build-time
 * content hash (e.g. page-10f375c61e774da1.js). When a new build deploys,
 * old chunks are deleted from the server. A browser tab that's been open
 * since before the deploy still holds the *old* chunk map in memory — if
 * the user then does a client-side navigation (e.g. clicking a sidebar
 * link) to a route it hasn't loaded yet, Next.js requests the old,
 * now-404ing filename and throws ChunkLoadError, which without a handler
 * bubbles up as a generic "Application error" crash screen.
 *
 * The fix isn't in the crashing route's code — any route can hit this on
 * any deploy. Recovering means reloading the document fresh so the
 * browser picks up the current build's HTML, chunk map, and CSS.
 *
 * sessionStorage guards against a reload loop: if the deployment itself
 * is broken (not just stale), we still only reload once per 10s window
 * instead of hammering the server / flashing the page forever.
 */
import { useEffect } from 'react';

const GUARD_KEY = 'fleet360-chunk-reload-at';
const GUARD_WINDOW_MS = 10_000;

function looksLikeChunkError(value: unknown): boolean {
  if (!value) return false;
  const text = typeof value === 'string' ? value : String((value as { message?: string; name?: string })?.message ?? (value as { name?: string })?.name ?? value);
  return /ChunkLoadError|Loading chunk [\d]+ failed|failed to fetch dynamically imported module/i.test(text);
}

export default function ChunkErrorReloader() {
  useEffect(() => {
    const reloadOnce = () => {
      let last = 0;
      try { last = Number(sessionStorage.getItem(GUARD_KEY) || 0); } catch { /* ignore */ }
      const now = Date.now();
      if (now - last < GUARD_WINDOW_MS) return;
      try { sessionStorage.setItem(GUARD_KEY, String(now)); } catch { /* ignore */ }
      window.location.reload();
    };

    const onError = (event: ErrorEvent) => {
      if (looksLikeChunkError(event.message) || looksLikeChunkError(event.error)) reloadOnce();
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      if (looksLikeChunkError(event.reason)) reloadOnce();
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return null;
}
