/**
 * School Bus Fees API has moved to Finance Module.
 *
 * All invoice operations for school bus transport are now handled via:
 *   GET  /api/finance/invoices?module=SCHOOL_BUS
 *   POST /api/finance/invoices  (body: { module: 'SCHOOL_BUS', vatRate: 0, ... })
 *
 * This handler issues a permanent redirect so any existing API integrations
 * are automatically forwarded.
 *
 * Migration endpoint: POST /api/school-bus/fees/migrate
 */
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const params = new URLSearchParams({ module: 'SCHOOL_BUS' });
  if (sp.get('tenantId')) params.set('tenantId', sp.get('tenantId')!);
  if (sp.get('status'))   params.set('status',   sp.get('status')!);
  if (sp.get('search'))   params.set('q',         sp.get('search')!);
  return NextResponse.redirect(
    new URL(`/api/finance/invoices?${params}`, req.url),
    { status: 308 }, // 308 Permanent Redirect — preserves method
  );
}

export async function POST(req: NextRequest) {
  // Forward body to Finance invoices endpoint with module=SCHOOL_BUS injected
  try {
    const body = await req.json();
    const enriched = {
      ...body,
      module:      'SCHOOL_BUS',
      serviceType: body.serviceType ?? 'TRANSPORT_EDU',
      vatRate:     body.vatRate     ?? 0, // EDU Zero Rate
      clientName:  body.clientName  ?? body.studentName,
      clientEmail: body.clientEmail ?? body.parentEmail,
      clientPhone: body.clientPhone ?? body.parentPhone,
      referenceType: 'SCHOOL_BUS_ALLOCATION',
    };
    const r = await fetch(new URL('/api/finance/invoices', req.url), {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(enriched),
    });
    const data = await r.json();
    return NextResponse.json(data, { status: r.status });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
