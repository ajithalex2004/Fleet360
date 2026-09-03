export const dynamic = 'force-dynamic';

/**
 * TEMPORARY — one-shot apply for
 * prisma/migrations/20260910000011_leasing_tenant_scoped_serial_uniques.
 *
 * This repo's normal `prisma migrate deploy` path is not reliably wired
 * into the Railway build (see scripts/apply-pending-migrations.cjs's own
 * docstring about a pre-existing broken migration blocking it), and local
 * dev can't reach the Neon DB directly right now to run a one-off script
 * against it. Every statement in the migration is idempotent
 * (DROP INDEX IF EXISTS / CREATE UNIQUE INDEX IF NOT EXISTS) so running it
 * more than once, or running it here instead of via `prisma migrate
 * deploy`, is safe either way.
 *
 * DELETE THIS FILE once the migration has been applied and verified.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import fs from 'node:fs';
import path from 'node:path';

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  try {
    const sqlPath = path.join(
      process.cwd(),
      'prisma',
      'migrations',
      '20260910000011_leasing_tenant_scoped_serial_uniques',
      'migration.sql',
    );
    const sql = fs.readFileSync(sqlPath, 'utf8');
    // Strip comments and split on statement-terminating semicolons — every
    // statement in this file is a standalone ALTER/DROP/CREATE, no
    // dollar-quoted bodies, so a naive split is safe here.
    const statements = sql
      .split('\n')
      .filter(line => !line.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .map(s => s.trim())
      .filter(Boolean);

    const results: Array<{ statement: string; ok: boolean; error?: string }> = [];
    for (const stmt of statements) {
      try {
        await prisma.$executeRawUnsafe(stmt);
        results.push({ statement: stmt.slice(0, 100), ok: true });
      } catch (e) {
        results.push({ statement: stmt.slice(0, 100), ok: false, error: String(e) });
      }
    }

    return NextResponse.json({ applied: results.length, results });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
