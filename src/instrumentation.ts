/**
 * Next.js Instrumentation hook (runs once on server startup).
 *
 * Routes Node-only setup into instrumentation-node.ts via a dynamic import
 * so the Edge runtime compile pass never inspects the Node APIs and doesn't
 * emit "A Node.js API is used in the Edge Runtime" warnings.
 *
 * Docs: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { registerNode } = await import('./instrumentation-node');
  await registerNode();
}
