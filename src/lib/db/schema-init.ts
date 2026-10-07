/**
 * Request-time schema setup, made safe for the runtime database role.
 *
 * Several modules create their tables and add columns from code the first
 * time a request needs them (ensureDispatchSchema, ensureSpmSchema, ...).
 * The runtime role (fleet360_app) may not create or alter tables: that DDL
 * fails with 42501 even when every table already exists, because
 * CREATE TABLE IF NOT EXISTS and ADD COLUMN IF NOT EXISTS still check the
 * privilege first. Worse, the first call in a process usually came from
 * inside a tenant transaction, where the failed statement aborted the
 * request's transaction and the request failed with it.
 *
 * provisionSchemaOnce() therefore:
 *   - runs outside the caller's tenant transaction, on its own connection,
 *     so nothing it does can abort the caller's work;
 *   - first checks, with a read any role may make, whether the tables (and
 *     columns) exist, and runs no DDL at all when they do: the normal case,
 *     since migrations create them;
 *   - otherwise, outside production, attempts the DDL (fresh local databases
 *     connected as the owner). Production never runs it: migrations own the
 *     schema there (ALLOW_RUNTIME_DDL=true overrides, for a one-off repair);
 *   - when objects are still missing, throws MissingSchemaError naming them
 *     and the fix, instead of letting the request fail later with "relation
 *     does not exist". That result is cached for a short while only, so the
 *     app recovers by itself once the migrations are applied.
 *
 * Every module's SchemaSpec is listed in src/lib/db/schema-registry.ts; the
 * readiness and health checks report anything missing (architecture audit A9).
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { runOutsideRlsScope } from '@/lib/rls-scope';

export function isInsufficientPrivilege(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    return (e.meta as { code?: string } | undefined)?.code === '42501';
  }
  return (e as { code?: string } | null)?.code === '42501';
}

export interface SchemaSpec {
  /** Tables the setup creates, schema-qualified where not in public. */
  tables: string[];
  /** Columns it adds to tables created elsewhere, as [table, column]. */
  columns?: Array<[string, string]>;
}

/** A module's tables or columns are missing from the database. */
export class MissingSchemaError extends Error {
  readonly code = 'MISSING_SCHEMA';
  constructor(readonly module: string, readonly missing: string[]) {
    super(
      `Database schema for "${module}" is incomplete: missing ${missing.join(', ')}. ` +
      `Apply the pending migrations (prisma migrate deploy).`,
    );
    this.name = 'MissingSchemaError';
  }
}

/** Runtime DDL is for fresh local databases; production schema comes from migrations. */
export function runtimeDdlAllowed(): boolean {
  if (process.env.ALLOW_RUNTIME_DDL === 'true') return true;
  return process.env.NODE_ENV !== 'production';
}

/** How long a "schema incomplete" result is reused before checking again. */
const MISSING_RECHECK_MS = 30_000;

const _g = globalThis as { _schemaInit?: Map<string, Promise<void>> };

/**
 * Ensures the tables and columns in `spec` exist: once per process when they
 * do (the normal case: no DDL). Where they are missing, runs `ddl` outside
 * production, and throws MissingSchemaError if anything is still missing.
 * Concurrent callers share the same run; a failure is retried by later
 * callers (after MISSING_RECHECK_MS for a missing schema).
 */
export function provisionSchemaOnce(
  name: string,
  spec: SchemaSpec,
  ddl: () => Promise<unknown>,
): Promise<void> {
  const runs = (_g._schemaInit ??= new Map());
  const existing = runs.get(name);
  if (existing) return existing;

  const run = runOutsideRlsScope(async () => {
    const missing = await findMissingObjects(spec);
    if (missing.length === 0) return;
    if (runtimeDdlAllowed()) {
      try {
        await ddl();
      } catch (e) {
        if (!isInsufficientPrivilege(e)) throw e;
      }
      const still = await findMissingObjects(spec);
      if (still.length === 0) return;
      throw new MissingSchemaError(name, still);
    }
    throw new MissingSchemaError(name, missing);
  }).catch((e) => {
    if (e instanceof MissingSchemaError) {
      console.error(`[schema:${name}] ${e.message}`);
      // Keep answering from this result briefly, then check again.
      setTimeout(() => { if (runs.get(name) === run) runs.delete(name); }, MISSING_RECHECK_MS).unref?.();
    } else {
      runs.delete(name);
    }
    throw e;
  });
  runs.set(name, run);
  return run;
}

/** The tables, and table.column pairs, in `spec` that do not exist. A read any role may make. */
export async function findMissingObjects(spec: SchemaSpec): Promise<string[]> {
  const tables = spec.tables;
  const colTables = (spec.columns ?? []).map(([t]) => t);
  const colNames = (spec.columns ?? []).map(([, c]) => c);
  const [row] = await prisma.$queryRawUnsafe<Array<{ missing: string[] | null }>>(
    `SELECT ARRAY(
       SELECT t FROM unnest($1::text[]) t WHERE to_regclass(t) IS NULL
       UNION ALL
       SELECT c.t || '.' || c.col
         FROM unnest($2::text[], $3::text[]) AS c(t, col)
        WHERE to_regclass(c.t) IS NULL
           OR NOT EXISTS (SELECT 1 FROM pg_attribute a
                           WHERE a.attrelid = to_regclass(c.t) AND a.attname = c.col
                             AND a.attnum > 0 AND NOT a.attisdropped)
     ) AS missing`,
    tables,
    colTables,
    colNames,
  );
  return row?.missing ?? [];
}
