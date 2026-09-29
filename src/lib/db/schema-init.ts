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
 *   - otherwise attempts the DDL (fresh local databases connected as the
 *     owner) and, when the role may not run it, logs what is missing
 *     instead of failing every request.
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

const _g = globalThis as { _schemaInit?: Map<string, Promise<void>> };

/**
 * Runs `ddl` at most once per process, and only where the tables or columns
 * in `spec` are missing. Concurrent callers share the same run; a failed run
 * is retried by the next caller.
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
    const missing = await missingObjects(spec);
    if (missing.length === 0) return;
    try {
      await ddl();
    } catch (e) {
      if (!isInsufficientPrivilege(e)) throw e;
      console.warn(
        `[schema:${name}] missing ${missing.join(', ')}; the runtime role may not create them. Apply the pending migrations.`,
      );
    }
  }).catch((e) => {
    runs.delete(name);
    throw e;
  });
  runs.set(name, run);
  return run;
}

async function missingObjects(spec: SchemaSpec): Promise<string[]> {
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
