/**
 * Next.js Instrumentation hook (runs once on server startup).
 *
 * Body lives in instrumentation-node.ts and is dynamically imported only
 * when NEXT_RUNTIME === 'nodejs'. This keeps `process.on(...)` out of the
 * Edge Runtime build so Turbopack doesn't warn.
 *
 * Docs: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  await import('./instrumentation-node');
}
