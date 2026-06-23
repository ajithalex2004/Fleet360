import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const module = (searchParams.get('module') || 'ALL').toUpperCase();
  const daysParam = searchParams.get('days') || 'ALL';
  const maxDays = daysParam === 'ALL' ? 90 : Math.min(parseInt(daysParam) || 90, 90);

  const allAlerts: any[] = [];

  // ──────────────────────────────────────────────
  // 1. rental_documents — Emirates IDs, licenses, passports, visit visas
  // ──────────────────────────────────────────────
  if (module === 'ALL' || module === 'RENTAL') {
    try {
      const rows = await prisma.$queryRawUnsafe<any[]>(`
        SELECT
          id::text,
          COALESCE(customer_name, customer_id::text, 'Unknown Customer') AS name,
          document_type,
          expiry_date,
          EXTRACT(EPOCH FROM (expiry_date::timestamptz - NOW())) / 86400 AS days_remaining,
          'RENTAL'  AS module,
          customer_id::text AS ref_id
        FROM rental_documents
        WHERE expiry_date IS NOT NULL
          AND deleted_at IS NULL
          AND EXTRACT(EPOCH FROM (expiry_date::timestamptz - NOW())) / 86400 <= 90
        ORDER BY days_remaining ASC
      `);
      for (const r of rows) {
        allAlerts.push({
          id: r.id,
          type: mapDocType(r.document_type),
          name: r.name,
          document_type: r.document_type,
          expiry_date: r.expiry_date,
          days_remaining: parseFloat(r.days_remaining),
          module: 'RENTAL',
          action_url: `/rental/documents?id=${r.ref_id}`,
        });
      }
    } catch (_) {
      // table may not exist
    }
  }

  // ──────────────────────────────────────────────
  // 2. rental_insurance_policies — RAC insurance expiry
  // ──────────────────────────────────────────────
  if (module === 'ALL' || module === 'RENTAL') {
    try {
      const rows = await prisma.$queryRawUnsafe<any[]>(`
        SELECT
          id::text,
          COALESCE(insurer_name, policy_no, 'Insurance Policy') AS name,
          'INSURANCE' AS document_type,
          end_date AS expiry_date,
          EXTRACT(EPOCH FROM (end_date::timestamptz - NOW())) / 86400 AS days_remaining,
          'RENTAL' AS module,
          id::text AS ref_id
        FROM rental_insurance_policies
        WHERE end_date IS NOT NULL
          AND deleted_at IS NULL
          AND EXTRACT(EPOCH FROM (end_date::timestamptz - NOW())) / 86400 <= 90
        ORDER BY days_remaining ASC
      `);
      for (const r of rows) {
        allAlerts.push({
          id: `ins-${r.id}`,
          type: 'INSURANCE',
          name: r.name,
          document_type: 'Insurance Policy',
          expiry_date: r.expiry_date,
          days_remaining: parseFloat(r.days_remaining),
          module: 'RENTAL',
          action_url: `/rental/insurance?id=${r.ref_id}`,
        });
      }
    } catch (_) {
      // table may not exist
    }
  }

  // ──────────────────────────────────────────────
  // 3. leasing_credit_assessments — lessee license expiry
  // ──────────────────────────────────────────────
  if (module === 'ALL' || module === 'LEASING') {
    try {
      const rows = await prisma.$queryRawUnsafe<any[]>(`
        SELECT
          id::text,
          full_name AS name,
          'DRIVING_LICENSE' AS document_type,
          license_expiry AS expiry_date,
          EXTRACT(EPOCH FROM (license_expiry::timestamptz - NOW())) / 86400 AS days_remaining,
          'LEASING' AS module,
          id::text AS ref_id
        FROM leasing_credit_assessments
        WHERE license_expiry IS NOT NULL
          AND EXTRACT(EPOCH FROM (license_expiry::timestamptz - NOW())) / 86400 <= 90
        ORDER BY days_remaining ASC
      `);
      for (const r of rows) {
        allAlerts.push({
          id: `lca-${r.id}`,
          type: 'LEASING_LICENSE',
          name: r.name,
          document_type: 'Driving License (Leasing)',
          expiry_date: r.expiry_date,
          days_remaining: parseFloat(r.days_remaining),
          module: 'LEASING',
          action_url: `/leasing/credit-assessments?id=${r.ref_id}`,
        });
      }
    } catch (_) {
      // table may not exist
    }
  }

  // ──────────────────────────────────────────────
  // 4. leasing_insurance_policies — leasing insurance
  // ──────────────────────────────────────────────
  if (module === 'ALL' || module === 'LEASING') {
    try {
      const rows = await prisma.$queryRawUnsafe<any[]>(`
        SELECT
          id::text,
          COALESCE(insurer_name, policy_no, 'Leasing Insurance') AS name,
          'INSURANCE' AS document_type,
          expiry_date,
          EXTRACT(EPOCH FROM (expiry_date::timestamptz - NOW())) / 86400 AS days_remaining,
          'LEASING' AS module,
          id::text AS ref_id
        FROM leasing_insurance_policies
        WHERE expiry_date IS NOT NULL
          AND deleted_at IS NULL
          AND EXTRACT(EPOCH FROM (expiry_date::timestamptz - NOW())) / 86400 <= 90
        ORDER BY days_remaining ASC
      `);
      for (const r of rows) {
        allAlerts.push({
          id: `lins-${r.id}`,
          type: 'INSURANCE',
          name: r.name,
          document_type: 'Insurance Policy',
          expiry_date: r.expiry_date,
          days_remaining: parseFloat(r.days_remaining),
          module: 'LEASING',
          action_url: `/leasing/insurance?id=${r.ref_id}`,
        });
      }
    } catch (_) {
      // table may not exist
    }
  }

  // ──────────────────────────────────────────────
  // Apply days filter & sort
  // ──────────────────────────────────────────────
  if (module === 'ALL' || module === 'LEASING') {
    try {
      const rows = await prisma.$queryRawUnsafe<any[]>(`
        SELECT
          c.id::text,
          COALESCE(c.contract_number, c.id::text) AS contract_number,
          COALESCE(l.name, 'Unknown Lessee') AS lessee_name,
          c.end_date AS expiry_date,
          EXTRACT(EPOCH FROM (c.end_date::timestamptz - NOW())) / 86400 AS days_remaining
        FROM lease_contracts_v2 c
        LEFT JOIN lessees l ON l.id = c.lessee_id
        WHERE c.end_date IS NOT NULL
          AND c.deleted_at IS NULL
          AND COALESCE(c.status, 'ACTIVE') IN ('ACTIVE', 'EXTENDED', 'APPROVED')
          AND EXTRACT(EPOCH FROM (c.end_date::timestamptz - NOW())) / 86400 <= 90
          AND NOT EXISTS (
            SELECT 1
            FROM lease_renewals r
            WHERE r.original_contract_id = c.id
              AND COALESCE(r.status, 'PROPOSED') IN ('PROPOSED', 'SENT_TO_CUSTOMER', 'ACCEPTED')
          )
        ORDER BY days_remaining ASC
      `);
      for (const r of rows) {
        allAlerts.push({
          id: `lctr-${r.id}`,
          type: 'CONTRACT_RENEWAL',
          name: `${r.contract_number} · ${r.lessee_name}`,
          document_type: 'Lease Contract Renewal',
          expiry_date: r.expiry_date,
          days_remaining: parseFloat(r.days_remaining),
          module: 'LEASING',
          action_url: `/leasing/renewals?contractId=${r.id}`,
        });
      }
    } catch (_) {
      // table may not exist
    }
  }

  const filtered = allAlerts
    .filter((a) => a.days_remaining <= maxDays)
    .sort((a, b) => a.days_remaining - b.days_remaining);

  // Compute summary
  const critical = filtered.filter((a) => a.days_remaining < 0).length;
  const warning  = filtered.filter((a) => a.days_remaining >= 0 && a.days_remaining < 30).length;
  const notice   = filtered.filter((a) => a.days_remaining >= 30 && a.days_remaining <= 90).length;

  return NextResponse.json({
    summary: { critical, warning, notice, total: filtered.length },
    alerts: filtered,
  });
}

// ──────────────────────────────────────────────
// Helper: map raw document_type to alert type enum
// ──────────────────────────────────────────────
function mapDocType(raw: string | null): string {
  if (!raw) return 'DOCUMENT';
  const t = raw.toUpperCase();
  if (t.includes('EMIRATES') || t.includes('EID'))        return 'EMIRATES_ID';
  if (t.includes('DRIVING') || t.includes('LICENSE'))     return 'DRIVING_LICENSE';
  if (t.includes('PASSPORT'))                             return 'PASSPORT';
  if (t.includes('INSURANCE'))                            return 'INSURANCE';
  if (t.includes('VISIT') || t.includes('VISA'))          return 'VISIT_VISA';
  return 'DOCUMENT';
}
