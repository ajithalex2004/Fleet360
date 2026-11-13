export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { withSavepoint } from '@/lib/rental/locks';
import { requireAuthorizedTenant } from '@/lib/tenant-context';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const { searchParams } = new URL(req.url);
    const moduleFilter = (searchParams.get('module') || 'ALL').toUpperCase();
    const daysParam = searchParams.get('days') || 'ALL';
    const parsedDays = parseInt(daysParam, 10);
    const maxDays =
      daysParam === 'ALL' || Number.isNaN(parsedDays)
        ? 90
        : Math.min(Math.max(parsedDays, 0), 90);

    const allAlerts: Array<{
      id: string;
      type: string;
      name: string;
      document_type: string;
      expiry_date: unknown;
      days_remaining: number;
      module: string;
      action_url: string;
    }> = [];

    // ──────────────────────────────────────────────
    // 1. rental_documents — Emirates IDs, licenses, passports, visit visas
    // ──────────────────────────────────────────────
    if (moduleFilter === 'ALL' || moduleFilter === 'RENTAL') {
      const rows = await withSavepoint(
        tx,
        'expiry_rental_documents',
        () =>
          tx.$queryRawUnsafe<any[]>(
            `SELECT
               id::text,
               COALESCE(NULLIF(TRIM(customer_name), ''), customer_id::text, 'Unknown Customer') AS name,
               doc_type AS document_type,
               expiry_date,
               EXTRACT(EPOCH FROM (expiry_date::timestamptz - NOW())) / 86400 AS days_remaining,
               'RENTAL' AS module,
               id::text AS ref_id
             FROM rental_documents
             WHERE tenant_id = $1
               AND expiry_date IS NOT NULL
               AND deleted_at IS NULL
               AND EXTRACT(EPOCH FROM (expiry_date::timestamptz - NOW())) / 86400 <= $2
             ORDER BY days_remaining ASC`,
            tenantId,
            maxDays,
          ),
        [],
      );
      for (const r of rows) {
        allAlerts.push({
          id: r.id,
          type: mapDocType(r.document_type),
          name: r.name,
          document_type: r.document_type,
          expiry_date: r.expiry_date,
          days_remaining: parseFloat(r.days_remaining),
          module: 'RENTAL',
          action_url: `/rental/documents?id=${encodeURIComponent(String(r.id))}`,
        });
      }
    }

    // ──────────────────────────────────────────────
    // 2. rental_insurance_policies — RAC insurance expiry
    // ──────────────────────────────────────────────
    if (moduleFilter === 'ALL' || moduleFilter === 'RENTAL') {
      const rows = await withSavepoint(
        tx,
        'expiry_rental_insurance',
        () =>
          tx.$queryRawUnsafe<any[]>(
            `SELECT
               id::text,
               COALESCE(NULLIF(TRIM(insurer), ''), policy_no, 'Insurance Policy') AS name,
               'INSURANCE' AS document_type,
               end_date AS expiry_date,
               EXTRACT(EPOCH FROM (end_date::timestamptz - NOW())) / 86400 AS days_remaining,
               'RENTAL' AS module,
               id::text AS ref_id
             FROM rental_insurance_policies
             WHERE tenant_id = $1
               AND end_date IS NOT NULL
               AND deleted_at IS NULL
               AND EXTRACT(EPOCH FROM (end_date::timestamptz - NOW())) / 86400 <= $2
             ORDER BY days_remaining ASC`,
            tenantId,
            maxDays,
          ),
        [],
      );
      for (const r of rows) {
        allAlerts.push({
          id: `ins-${r.id}`,
          type: 'INSURANCE',
          name: r.name,
          document_type: 'Insurance Policy',
          expiry_date: r.expiry_date,
          days_remaining: parseFloat(r.days_remaining),
          module: 'RENTAL',
          action_url: `/rental/insurance?id=${encodeURIComponent(String(r.ref_id ?? r.id))}`,
        });
      }
    }

    // ──────────────────────────────────────────────
    // 3. lease_credit_assessments / leasing_credit_assessments
    // ──────────────────────────────────────────────
    if (moduleFilter === 'ALL' || moduleFilter === 'LEASING') {
      const v2Rows = await withSavepoint(
        tx,
        'expiry_lease_credit_v2',
        () =>
          tx.$queryRawUnsafe<any[]>(
            `SELECT
               lca.id::text AS id,
               COALESCE(NULLIF(TRIM(l.name), ''), lca.lessee_id::text, 'Lessee') AS name,
               lca.valid_until AS expiry_date,
               EXTRACT(EPOCH FROM (lca.valid_until::timestamptz - NOW())) / 86400 AS days_remaining,
               lca.id::text AS ref_id
             FROM lease_credit_assessments lca
             LEFT JOIN lessees l ON l.id = lca.lessee_id
             WHERE lca.tenant_id = $1
               AND lca.valid_until IS NOT NULL
               AND EXTRACT(EPOCH FROM (lca.valid_until::timestamptz - NOW())) / 86400 <= $2
             ORDER BY days_remaining ASC`,
            tenantId,
            maxDays,
          ),
        [],
      );
      for (const r of v2Rows) {
        allAlerts.push({
          id: `lca-${r.id}`,
          type: 'CREDIT_ASSESSMENT',
          name: r.name,
          document_type: 'Credit Assessment (Leasing)',
          expiry_date: r.expiry_date,
          days_remaining: parseFloat(r.days_remaining),
          module: 'LEASING',
          action_url: `/leasing/credit-assessments?id=${r.ref_id}`,
        });
      }

      const legacyRows = await withSavepoint(
        tx,
        'expiry_leasing_credit_legacy',
        () =>
          tx.$queryRawUnsafe<any[]>(
            `SELECT
               id::text,
               full_name AS name,
               license_expiry AS expiry_date,
               EXTRACT(EPOCH FROM (license_expiry::timestamptz - NOW())) / 86400 AS days_remaining,
               id::text AS ref_id
             FROM leasing_credit_assessments
             WHERE tenant_id = $1
               AND license_expiry IS NOT NULL
               AND EXTRACT(EPOCH FROM (license_expiry::timestamptz - NOW())) / 86400 <= $2
             ORDER BY days_remaining ASC`,
            tenantId,
            maxDays,
          ),
        [],
      );
      for (const r of legacyRows) {
        allAlerts.push({
          id: `lca-leg-${r.id}`,
          type: 'LEASING_LICENSE',
          name: r.name,
          document_type: 'Driving License (Leasing)',
          expiry_date: r.expiry_date,
          days_remaining: parseFloat(r.days_remaining),
          module: 'LEASING',
          action_url: `/leasing/credit-assessments?id=${r.ref_id}`,
        });
      }
    }

    // ──────────────────────────────────────────────
    // 4. lease_insurance_policies / leasing_insurance_policies
    // ──────────────────────────────────────────────
    if (moduleFilter === 'ALL' || moduleFilter === 'LEASING') {
      const rows = await withSavepoint(
        tx,
        'expiry_lease_insurance_v2',
        () =>
          tx.$queryRawUnsafe<any[]>(
            `SELECT
               id::text,
               COALESCE(NULLIF(TRIM(insurer), ''), policy_no, 'Leasing Insurance') AS name,
               expiry_date,
               EXTRACT(EPOCH FROM (expiry_date::timestamptz - NOW())) / 86400 AS days_remaining,
               id::text AS ref_id
             FROM lease_insurance_policies
             WHERE tenant_id = $1
               AND expiry_date IS NOT NULL
               AND deleted_at IS NULL
               AND EXTRACT(EPOCH FROM (expiry_date::timestamptz - NOW())) / 86400 <= $2
             ORDER BY days_remaining ASC`,
            tenantId,
            maxDays,
          ),
        [],
      );
      for (const r of rows) {
        allAlerts.push({
          id: `lins-${r.id}`,
          type: 'INSURANCE',
          name: r.name,
          document_type: 'Insurance Policy',
          expiry_date: r.expiry_date,
          days_remaining: parseFloat(r.days_remaining),
          module: 'LEASING',
          action_url: `/leasing/contracts?id=${r.ref_id}`,
        });
      }

      if (rows.length === 0) {
        const legacyRows = await withSavepoint(
          tx,
          'expiry_leasing_insurance_legacy',
          () =>
            tx.$queryRawUnsafe<any[]>(
              `SELECT
                 id::text,
                 COALESCE(insurer_name, policy_no, 'Leasing Insurance') AS name,
                 expiry_date,
                 EXTRACT(EPOCH FROM (expiry_date::timestamptz - NOW())) / 86400 AS days_remaining,
                 id::text AS ref_id
               FROM leasing_insurance_policies
               WHERE tenant_id = $1
                 AND expiry_date IS NOT NULL
                 AND deleted_at IS NULL
                 AND EXTRACT(EPOCH FROM (expiry_date::timestamptz - NOW())) / 86400 <= $2
               ORDER BY days_remaining ASC`,
              tenantId,
              maxDays,
            ),
          [],
        );
        for (const r of legacyRows) {
          allAlerts.push({
            id: `lins-leg-${r.id}`,
            type: 'INSURANCE',
            name: r.name,
            document_type: 'Insurance Policy',
            expiry_date: r.expiry_date,
            days_remaining: parseFloat(r.days_remaining),
            module: 'LEASING',
            action_url: `/leasing/contracts?id=${r.ref_id}`,
          });
        }
      }
    }

    // ──────────────────────────────────────────────
    // 5. vehicles — registration, insurance & Mulkiya expiry
    // ──────────────────────────────────────────────
    if (moduleFilter === 'ALL' || moduleFilter === 'FLEET' || moduleFilter === 'RENTAL') {
      const rentalOnlyClause =
        moduleFilter === 'RENTAL'
          ? "AND UPPER(COALESCE(vehicle_usage, '')) = 'RENTAL'"
          : '';
      const vehRows = await withSavepoint(
        tx,
        'expiry_vehicles',
        () =>
          tx.$queryRawUnsafe<any[]>(
            `SELECT
               id::text,
               COALESCE(
                 NULLIF(TRIM(license_plate), ''),
                 NULLIF(TRIM(plate_number), ''),
                 NULLIF(TRIM(registration_no), ''),
                 CONCAT_WS(' ', make, model),
                 id::text
               ) AS name,
               registration_expiry,
               insurance_expiry,
               mulkiya_expiry
             FROM vehicles
             WHERE tenant_id = $1
               AND deleted_at IS NULL
               ${rentalOnlyClause}
               AND (
                 (registration_expiry IS NOT NULL AND EXTRACT(EPOCH FROM (registration_expiry::timestamptz - NOW())) / 86400 <= $2)
                 OR (insurance_expiry IS NOT NULL AND EXTRACT(EPOCH FROM (insurance_expiry::timestamptz - NOW())) / 86400 <= $2)
                 OR (mulkiya_expiry IS NOT NULL AND EXTRACT(EPOCH FROM (mulkiya_expiry::timestamptz - NOW())) / 86400 <= $2)
               )`,
            tenantId,
            maxDays,
          ),
        [],
      );
      const nowMs = Date.now();
      for (const v of vehRows) {
        const checks: Array<{ key: string; col: unknown; label: string; type: string }> = [
          { key: 'reg', col: v.registration_expiry, label: 'Vehicle Registration', type: 'REGISTRATION' },
          { key: 'ins', col: v.insurance_expiry, label: 'Vehicle Insurance', type: 'INSURANCE' },
          { key: 'mul', col: v.mulkiya_expiry, label: 'Mulkiya', type: 'MULKIYA' },
        ];
        for (const c of checks) {
          if (!c.col) continue;
          const daysRem = (new Date(String(c.col)).getTime() - nowMs) / 86_400_000;
          if (daysRem <= maxDays) {
            allAlerts.push({
              id: `veh-${c.key}-${v.id}`,
              type: c.type,
              name: v.name,
              document_type: c.label,
              expiry_date: c.col,
              days_remaining: daysRem,
              module: 'FLEET',
              action_url: `/fleet/vehicles?id=${v.id}`,
            });
          }
        }
      }
    }

    // ──────────────────────────────────────────────
    // 6. drivers — license, Emirates ID, passport & visa expiry
    // ──────────────────────────────────────────────
    if (moduleFilter === 'ALL' || moduleFilter === 'DRIVERS') {
      const drvRows = await withSavepoint(
        tx,
        'expiry_drivers',
        () =>
          tx.$queryRawUnsafe<any[]>(
            `SELECT
               id::text,
               COALESCE(
                 NULLIF(TRIM(name), ''),
                 NULLIF(TRIM(CONCAT_WS(' ', first_name, last_name)), ''),
                 id::text
               ) AS name,
               license_expiry,
               emirates_id_expiry,
               passport_expiry,
               visa_expiry
             FROM drivers
             WHERE tenant_id = $1
               AND deleted_at IS NULL
               AND (
                 (license_expiry IS NOT NULL AND EXTRACT(EPOCH FROM (license_expiry::timestamptz - NOW())) / 86400 <= $2)
                 OR (emirates_id_expiry IS NOT NULL AND EXTRACT(EPOCH FROM (emirates_id_expiry::timestamptz - NOW())) / 86400 <= $2)
                 OR (passport_expiry IS NOT NULL AND EXTRACT(EPOCH FROM (passport_expiry::timestamptz - NOW())) / 86400 <= $2)
                 OR (visa_expiry IS NOT NULL AND EXTRACT(EPOCH FROM (visa_expiry::timestamptz - NOW())) / 86400 <= $2)
               )`,
            tenantId,
            maxDays,
          ),
        [],
      );
      const nowMs = Date.now();
      for (const d of drvRows) {
        const checks: Array<{ key: string; col: unknown; label: string; type: string }> = [
          { key: 'lic', col: d.license_expiry, label: 'Driving License', type: 'DRIVING_LICENSE' },
          { key: 'eid', col: d.emirates_id_expiry, label: 'Emirates ID', type: 'EMIRATES_ID' },
          { key: 'psp', col: d.passport_expiry, label: 'Passport', type: 'PASSPORT' },
          { key: 'vis', col: d.visa_expiry, label: 'Residence / Visit Visa', type: 'VISIT_VISA' },
        ];
        for (const c of checks) {
          if (!c.col) continue;
          const daysRem = (new Date(String(c.col)).getTime() - nowMs) / 86_400_000;
          if (daysRem <= maxDays) {
            allAlerts.push({
              id: `drv-${c.key}-${d.id}`,
              type: c.type,
              name: d.name,
              document_type: c.label,
              expiry_date: c.col,
              days_remaining: daysRem,
              module: 'DRIVERS',
              action_url: `/driver-mgmt/profiles?id=${d.id}`,
            });
          }
        }
      }
    }

    // ──────────────────────────────────────────────
    // Apply days filter & sort
    // ──────────────────────────────────────────────
    const filtered = allAlerts
      .filter((a) => Number.isFinite(a.days_remaining) && a.days_remaining <= maxDays)
      .sort((a, b) => a.days_remaining - b.days_remaining);

    // Compute summary
    const critical = filtered.filter((a) => a.days_remaining < 0).length;
    const warning = filtered.filter((a) => a.days_remaining >= 0 && a.days_remaining <= 30).length;
    const notice = filtered.filter((a) => a.days_remaining > 30 && a.days_remaining <= 90).length;

    return NextResponse.json({
      summary: { critical, warning, notice, total: filtered.length },
      alerts: filtered,
    });
  });
}

// ──────────────────────────────────────────────
// Helper: map raw document_type to alert type enum
// ──────────────────────────────────────────────
function mapDocType(raw: string | null): string {
  if (!raw) return 'OTHER';
  const t = raw.trim().toUpperCase();
  if (t === 'TRADE_LICENSE' || t.includes('TRADE')) return 'TRADE_LICENSE';
  if (t === 'MULKIYA' || t.includes('MULKIYA')) return 'MULKIYA';
  if (t === 'REGISTRATION' || t.includes('REGISTRATION')) return 'REGISTRATION';
  if (t === 'CONTRACT' || t.includes('CONTRACT')) return 'CONTRACT';
  if (t.includes('EMIRATES') || t.includes('EID')) return 'EMIRATES_ID';
  if (t.includes('DRIVING') || t.includes('LICENSE')) return 'DRIVING_LICENSE';
  if (t.includes('PASSPORT')) return 'PASSPORT';
  if (t.includes('INSURANCE')) return 'INSURANCE';
  if (t === 'VISIT_VISA' || t.includes('VISIT')) return 'VISIT_VISA';
  if (t === 'VISA' || t.includes('VISA')) return 'VISA';
  return 'OTHER';
}
