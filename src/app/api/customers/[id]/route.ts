import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { customerBelongsToTenant } from '@/lib/corporate-customer-identity';

type Params = { params: Promise<{ id: string }> };
type CustomerDetailRow = Record<string, unknown> & {
  region_name?: string | null;
  dept_name?: string | null;
  unit_name?: string | null;
  region_id?: string | null;
  department_id?: string | null;
  unit_id?: string | null;
};

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

function requestContext(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id') ?? '';
  const userId = req.headers.get('x-user-id') ?? '';
  if (!tenantId || !userId) return null;
  return { tenantId, userId };
}

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const ctx = requestContext(req);
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    if (!(await customerBelongsToTenant(id, ctx.tenantId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const rows = await prisma.$queryRawUnsafe<CustomerDetailRow[]>(`
      SELECT c.*,
        r.name as region_name, d.name as dept_name, u.name as unit_name
      FROM customers c
      LEFT JOIN customer_hierarchy r ON c.region_id = r.id
      LEFT JOIN customer_hierarchy d ON c.department_id = d.id
      LEFT JOIN customer_hierarchy u ON c.unit_id = u.id
      WHERE c.id = '${id}' AND c.tenant_id::text = '${ctx.tenantId.replace(/'/g,"''")}'
    `);
    if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const c = rows[0];
    const docs = await prisma.$queryRawUnsafe(`SELECT * FROM customer_documents WHERE customer_id = '${id}' ORDER BY created_at DESC`);
    return NextResponse.json({
      ...c,
      region:     c.region_name ? { id: c.region_id,     name: c.region_name } : null,
      department: c.dept_name   ? { id: c.department_id, name: c.dept_name   } : null,
      unit:       c.unit_name   ? { id: c.unit_id,       name: c.unit_name   } : null,
      documents: docs,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: errorMessage(e, 'Failed') }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const ctx = requestContext(req);
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    if (!(await customerBelongsToTenant(id, ctx.tenantId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const body = await req.json();
    const data = { ...body };
    delete data.region;
    delete data.department;
    delete data.unit;
    delete data.documents;
    const now = new Date().toISOString();
    const sets: string[] = [`updated_at = '${now}'`];
    const allowed = ['customer_type','priority','account_code','trade_license','name_en','name_ar',
      'description_en','email','mobile_number','mobile_country_code','communication_language',
      'region_id','department_id','unit_id','contact_person','contact_person_phone','contact_person_email',
      'address_line1','address_line2','city','state','country','po_box',
      'tax_registration_number','tax_applicable','toll_exempt','credit_limit','credit_days',
      'allowed_payment_methods','default_payment_method','billing_cycle','invoice_frequency',
      'invoice_delivery_method','payment_reminder_days','late_fee_percentage','auto_invoice',
      'allowed_waiting_time_min','cancellation_allowed_min','allowed_booking_modifications',
      'skip_approval','preferred_channel','notification_email','notification_sms_code',
      'notification_sms','marketing_communications','booking_notifications','status'];
    const camelToSnake = (s: string) => s.replace(/[A-Z]/g,(c)=>`_${c.toLowerCase()}`);
    for (const [k,v] of Object.entries(data)) {
      const col = camelToSnake(k);
      if (!allowed.includes(col)) continue;
      if (v === null || v === undefined) sets.push(`${col} = NULL`);
      else if (typeof v === 'boolean') sets.push(`${col} = ${v}`);
      else if (typeof v === 'number') sets.push(`${col} = ${v}`);
      else sets.push(`${col} = '${String(v).replace(/'/g,"''")}'`);
    }
    await prisma.$executeRawUnsafe(`UPDATE customers SET ${sets.join(', ')} WHERE id = '${id}' AND tenant_id::text = '${ctx.tenantId.replace(/'/g,"''")}'`);
    const rows = await prisma.$queryRawUnsafe<CustomerDetailRow[]>(`SELECT * FROM customers WHERE id = '${id}' AND tenant_id::text = '${ctx.tenantId.replace(/'/g,"''")}'`);
    return NextResponse.json(rows[0]);
  } catch (e: unknown) {
    return NextResponse.json({ error: errorMessage(e, 'Failed') }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const ctx = requestContext(req);
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!(await customerBelongsToTenant(id, ctx.tenantId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  await prisma.$executeRawUnsafe(`UPDATE customers SET deleted_at = NOW(), status = 'INACTIVE' WHERE id = '${id}' AND tenant_id::text = '${ctx.tenantId.replace(/'/g,"''")}'`);
  return NextResponse.json({ success: true });
}
