/**
 * Add columns a runtime code path needs, only when they are missing.
 *
 * `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` still requires owning the table:
 * Postgres checks the privilege before the IF NOT EXISTS. The application
 * connects as a runtime role that owns no tables, so every such statement
 * failed with 42501 "must be owner of table ..." even when the column was
 * already there: log noise on every process start, and inside a transaction
 * an aborted transaction (see src/app/api/tenants/provision/route.ts).
 *
 * This reads pg_attribute first (no privilege needed) and runs ALTER TABLE
 * only for the columns that are actually missing. Where the schema is up to
 * date, it issues no DDL at all. A missing column still needs the table
 * owner: that ALTER can fail, and the caller decides how to handle it.
 */
import { prisma } from '@/lib/prisma';

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function qualified(table: string, schema: string): string {
  if (!IDENT.test(table) || !IDENT.test(schema)) {
    throw new Error(`ensure-columns: invalid identifier ${schema}.${table}`);
  }
  return `"${schema}"."${table}"`;
}

/** The names in `columns` that `schema.table` does not have. */
export async function missingColumns(
  table: string,
  columns: string[],
  schema = 'public',
): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ attname: string }>>(
    `SELECT a.attname
       FROM pg_attribute a
      WHERE a.attrelid = to_regclass($1)
        AND a.attname = ANY($2::text[])
        AND NOT a.attisdropped`,
    qualified(table, schema),
    columns,
  );
  const present = new Set(rows.map((r) => r.attname));
  return columns.filter((c) => !present.has(c));
}

/**
 * Add each column in `definitions` (name → SQL type and default) that
 * `schema.table` lacks. Returns the columns it added.
 */
export async function addMissingColumns(
  table: string,
  definitions: Record<string, string>,
  schema = 'public',
): Promise<string[]> {
  const missing = await missingColumns(table, Object.keys(definitions), schema);
  const target = qualified(table, schema);
  for (const column of missing) {
    if (!IDENT.test(column)) throw new Error(`ensure-columns: invalid column ${column}`);
    await prisma.$executeRawUnsafe(
      `ALTER TABLE ${target} ADD COLUMN IF NOT EXISTS "${column}" ${definitions[column]}`,
    );
  }
  return missing;
}

/** Whether an index (or any relation) of this name exists in `schema`. */
export async function relationExists(name: string, schema = 'public'): Promise<boolean> {
  const [row] = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
    `SELECT to_regclass($1) IS NOT NULL AS exists`,
    qualified(name, schema),
  );
  return Boolean(row?.exists);
}
