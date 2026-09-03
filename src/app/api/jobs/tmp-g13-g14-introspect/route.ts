export const dynamic = 'force-dynamic';

/**
 * TEMPORARY — one-shot introspection for the G13/G14 leasing-gap migration
 * work in .audit-reports/LEASING-FUNCTIONALITY-GAP-DOCUMENT.md. Local dev
 * network can't reach the Neon DB directly right now, so this answers two
 * questions that determine whether a schema migration is safe to write:
 *   1. What do the current unique index/constraint definitions on the
 *      leasing serial-number columns actually look like (confirm real
 *      column names before writing DDL against them)?
 *   2. Are there any orphaned LeaseContract2.lesseeId / opening_branch_id /
 *      closing_branch_id rows that would make a real FK constraint fail?
 *
 * DELETE THIS FILE once that work is done — it is not meant to stay.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  try {
    const indexes = await prisma.$queryRawUnsafe<Array<{ tablename: string; indexname: string; indexdef: string }>>(`
      SELECT tablename, indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename IN (
          'lease_inquiries','lease_quotations','lease_insurance_policies',
          'lease_insurance_claims','lease_traffic_fines','lease_early_terminations',
          'lease_renewals','lease_pre_billing_statements','lease_direct_debits',
          'lease_invoices','lease_contracts_v2'
        )
        AND indexdef ILIKE '%UNIQUE%'
      ORDER BY tablename, indexname
    `);

    const constraints = await prisma.$queryRawUnsafe<Array<{ table_name: string; constraint_name: string; constraint_type: string }>>(`
      SELECT tc.table_name, tc.constraint_name, tc.constraint_type
      FROM information_schema.table_constraints tc
      WHERE tc.table_schema = 'public'
        AND tc.table_name IN (
          'lease_inquiries','lease_quotations','lease_insurance_policies',
          'lease_insurance_claims','lease_traffic_fines','lease_early_terminations',
          'lease_renewals','lease_pre_billing_statements','lease_direct_debits',
          'lease_invoices','lease_contracts_v2'
        )
        AND tc.constraint_type IN ('UNIQUE','FOREIGN KEY')
      ORDER BY tc.table_name, tc.constraint_name
    `);

    const columns = await prisma.$queryRawUnsafe<Array<{ table_name: string; column_name: string }>>(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('lease_invoices','lease_quotations','lease_contracts_v2')
        AND (column_name ILIKE '%no%' OR column_name ILIKE '%number%')
      ORDER BY table_name, column_name
    `).catch(() => []);

    const [badLessee] = await prisma.$queryRawUnsafe<Array<{ n: number }>>(`
      SELECT count(*)::int AS n FROM lease_contracts_v2 c
      LEFT JOIN lessees l ON l.id = c.lessee_id
      WHERE l.id IS NULL
    `);
    const [badOpeningBranch] = await prisma.$queryRawUnsafe<Array<{ n: number }>>(`
      SELECT count(*)::int AS n FROM lease_contracts_v2 c
      LEFT JOIN lease_branches b ON b.id = c.opening_branch_id
      WHERE c.opening_branch_id IS NOT NULL AND b.id IS NULL
    `);
    const [badClosingBranch] = await prisma.$queryRawUnsafe<Array<{ n: number }>>(`
      SELECT count(*)::int AS n FROM lease_contracts_v2 c
      LEFT JOIN lease_branches b ON b.id = c.closing_branch_id
      WHERE c.closing_branch_id IS NOT NULL AND b.id IS NULL
    `);
    const [totalContracts] = await prisma.$queryRawUnsafe<Array<{ n: number }>>(`
      SELECT count(*)::int AS n FROM lease_contracts_v2
    `);
    const [tenantCount] = await prisma.$queryRawUnsafe<Array<{ n: number }>>(`
      SELECT count(*)::int AS n FROM tenants
    `);

    return NextResponse.json({
      indexes,
      constraints,
      numberColumns: columns,
      orphans: {
        totalContracts: totalContracts.n,
        tenantCount: tenantCount.n,
        badLessee: badLessee.n,
        badOpeningBranch: badOpeningBranch.n,
        badClosingBranch: badClosingBranch.n,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
