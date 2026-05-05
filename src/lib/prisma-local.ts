/**
 * Local PostgreSQL secondary Prisma client
 * Points to localhost:5433/tripxl
 * Used exclusively by the dual-write layer — never import this directly in API routes.
 */

import { PrismaClient } from '@prisma/client';

// Exported type so prisma.ts can reference it without circular-dep issues
export type LocalPrismaType = PrismaClient | null;

const localPrismaClientSingleton = (): LocalPrismaType => {
  const url = process.env.LOCAL_DATABASE_URL;
  if (!url) return null;

  return new PrismaClient({
    datasources: { db: { url } },
    log: [], // suppress logs for secondary DB
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
