export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: _req.headers, nextUrl: _req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const rows = await tx.$queryRawUnsafe(`
          SELECT c.*,
            r.name as region_name, d.name as dept_name, u.name as unit_name
          FROM customers c
          LEFT JOIN customer_hierarchy r ON c.region_id = r.id
          LEFT JOIN customer_hierarchy d ON c.department_id = d.id
          LEFT JOIN customer_hierarchy u ON c.unit_id = u.id
          WHERE c.id = '${params.id}'
        `);
        if (!(rows as any[]).length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        const c = (rows as any[])[0];
        const docs = await tx.$queryRawUnsafe(`SELECT * FROM customer_documents WHERE customer_id = '${params.id}' ORDER BY created_at DESC`);
        return NextResponse.json({
          ...c,
          region:     c.region_name ? { id: c.region_id,     name: c.region_name } : null,
          department: c.dept_name   ? { id: c.department_id, name: c.dept_name   } : null,
          unit:       c.unit_name   ? { id: c.unit_id,       name: c.unit_name   } : null,
          documents: docs,
        });
        } catch (e) {
        return NextResponse.json({ error: errorMessage(e, 'Failed') }, { status: 500 });
      }
  });
}


export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
      const { region, department, unit, documents, ...data } = body;
      const now = new Date().toISOString();
      const sets: string[] = [`updated_at = '${now}'`];

      const allowed = [
        'customer_code', 'customer_type', 'priority', 'account_code', 'trade_license',
        'name_en', 'name_ar', 'description_en', 'description_ar',
        'email', 'mobile_number', 'mobile_country_code', 'communication_language',
        'region_id', 'department_id', 'unit_id',
        'contact_person', 'contact_person_phone', 'contact_person_email',
        'address_line1', 'address_line2', 'city', 'state', 'country', 'po_box',
        'tax_registration_number', 'tax_applicable', 'toll_exempt',
        'credit_limit', 'credit_days', 'allowed_payment_methods', 'default_payment_method',
        'billing_cycle', 'invoice_frequency', 'invoice_delivery_method',
        'payment_reminder_days', 'late_fee_percentage', 'auto_invoice',
        'allowed_waiting_time_min', 'cancellation_allowed_min', 'allowed_booking_modifications',
        'skip_approval', 'preferred_channel', 'notification_email', 'notification_sms_code',
        'notification_sms', 'marketing_communications', 'booking_notifications', 'status',
      ];

      const numericCols = new Set([
        'credit_limit', 'credit_days', 'payment_reminder_days', 'late_fee_percentage',
        'allowed_waiting_time_min', 'cancellation_allowed_min', 'allowed_booking_modifications',
      ]);
      const booleanCols = new Set([
        'tax_applicable', 'toll_exempt', 'auto_invoice', 'skip_approval',
        'marketing_communications', 'booking_notifications',
      ]);
      const hierarchyFkCols = new Set(['region_id', 'department_id', 'unit_id']);
      const requiredStringCols = new Set(['name_en', 'customer_type']);

      // Validate any non-empty hierarchy FK IDs against customer_hierarchy so 23503 FK errors cannot occur
      const validHierarchyIds = new Set<string>();
      const candidateFkIds = ['regionId', 'departmentId', 'unitId', 'region_id', 'department_id', 'unit_id']
        .map((k) => (typeof data[k] === 'string' ? data[k].trim() : ''))
        .filter(Boolean);
      if (candidateFkIds.length > 0) {
        const existingH = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM customer_hierarchy WHERE id = ANY($1::text[])`,
          candidateFkIds,
        ).catch(() => []);
        for (const r of existingH) validHierarchyIds.add(r.id);
      }

      const camelToSnake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
      for (const [k, v] of Object.entries(data)) {
        const col = camelToSnake(k);
        if (!allowed.includes(col)) continue;

        if (v === null || v === undefined) {
          if (!requiredStringCols.has(col)) sets.push(`${col} = NULL`);
          continue;
        }

        if (booleanCols.has(col) || typeof v === 'boolean') {
          sets.push(`${col} = ${Boolean(v)}`);
          continue;
        }

        if (numericCols.has(col) || typeof v === 'number') {
          if (typeof v === 'string' && v.trim() === '') {
            sets.push(`${col} = NULL`);
          } else {
            const num = Number(v);
            sets.push(Number.isFinite(num) ? `${col} = ${num}` : `${col} = NULL`);
          }
          continue;
        }

        const strVal = String(v).trim();
        if (strVal === '') {
          if (!requiredStringCols.has(col)) {
            sets.push(`${col} = NULL`);
          }
          continue;
        }

        if (hierarchyFkCols.has(col) && !validHierarchyIds.has(strVal)) {
          sets.push(`${col} = NULL`);
          continue;
        }

        sets.push(`${col} = '${strVal.replace(/'/g, "''")}'`);
      }

      await tx.$executeRawUnsafe(`UPDATE customers SET ${sets.join(', ')} WHERE id = '${params.id}'`);

      const rows = await tx.$queryRawUnsafe(`SELECT * FROM customers WHERE id = '${params.id}'`);
      return NextResponse.json((rows as any[])[0]);
    } catch (e) {
      return NextResponse.json({ error: errorMessage(e, 'Failed') }, { status: 500 });
    }
  });
}


export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: _req.headers, nextUrl: _req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    await tx.$executeRawUnsafe(`UPDATE customers SET deleted_at = NOW(), status = 'INACTIVE' WHERE id = '${params.id}'`);
      return NextResponse.json({ success: true });
  });
}

