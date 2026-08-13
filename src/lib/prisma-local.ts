/**
 * Local PostgreSQL secondary Prisma client — the dual-write mirror.
 *
 * ── Design intent ────────────────────────────────────────────────────────
 * This client points at LOCAL_DATABASE_URL (typically a localhost Postgres
 * running on port 5433 in dev) and is consumed ONLY by the dual-write
 * middleware in src/lib/prisma.ts. It exists to give the driver mobile app
 * and counter PWA a durable write buffer when connectivity to the primary
 * (Neon) database is patchy:
 *
 *   1. Primary write to Neon succeeds → local mirror fires in the background.
 *   2. Primary write succeeds but mirror times out / fails → circuit
 *      breaker opens, retries pause, eventually flushes when reachable.
 *   3. Primary write fails → throw to caller. The mirror is NEVER the
 *      source of truth.
 *
 * It is NOT a read replica. Do not import this directly from API routes;
 * read traffic should hit the primary or a proper read replica.
 *
 * ── Why the dual-write layer exists ──────────────────────────────────────
 * The driver app submits shift events, fuel logs, damage photos, and
 * boarding events from areas with intermittent coverage. Without a
 * durable buffer, those writes either fail visibly (bad UX — driver sees
 * "save failed" then re-enters and double-counts) or succeed silently to
 * the remote DB after a long wait (worse — driver thinks it's saved, then
 * it isn't, and we lose the data). The local mirror gives us a "saved
 * locally, will sync" guarantee without requiring a full sync engine.
 *
 * ── Failure semantics ───────────────────────────────────────────────────
 * - Conflicts: last-write-wins. If two devices edit the same row offline,
 *   whichever syncs last wins. This is acceptable for shift events and
 *   fuel logs (operational, not financial) and matches the mobile app's
 *   optimistic UI.
 * - The mirror NEVER blocks the primary. Errors are logged, the circuit
 *   breaker absorbs bursts.
 * - A reconciliation job (separate; not in this file) compares row counts
 *   nightly and surfaces drift.
 *
 * ── When LOCAL_DATABASE_URL is unset ────────────────────────────────────
 * The singleton returns `null`. The middleware short-circuits and never
 * attempts the mirror write. This is the production cloud posture — the
 * driver app's offline queue is the durable buffer there, not a local
 * Postgres on a phone. Production here = Neon primary only.
 *
 * ── Adding a model to the mirror? ───────────────────────────────────────
 * You usually don't need to. The dual-write middleware routes ALL ORM
 * writes through the mirror automatically via `params.model` /
 * `params.action`. New models get mirrored for free as long as they
 * exist in BOTH schemas (the primary Prisma schema and the local DB's
 * schema). The local DB needs migrations applied separately — see
 * scripts/mirror-migrate.sh.
 */

import { PrismaClient } from '@prisma/client';

// Exported type so prisma.ts can reference it without circular-dep issues
export type LocalPrismaType = PrismaClient | null;

const localPrismaClientSingleton = (): LocalPrismaType => {
  const url = process.env.LOCAL_DATABASE_URL;
  if (!url) return null;

  return new PrismaClient({
    datasources: { db: { url } },
    log: [], // suppress logs for secondary DB — see ARCHITECTURE.md §5
  });
};

const globalForLocalPrisma = globalThis as unknown as {
  localPrisma: LocalPrismaType | undefined;
};

export const localPrisma: LocalPrismaType =
  globalForLocalPrisma.localPrisma ?? localPrismaClientSingleton();

if (process.env.NODE_ENV !== 'production') {
  globalForLocalPrisma.localPrisma = localPrisma;
}
