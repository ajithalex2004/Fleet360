/**
 * School Bus Fee [id] API has moved to Finance Module.
 *
 * Use: /api/finance/invoices/[id]
 *
 * This handler permanently redirects to the Finance invoices endpoint.
 */
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.redirect(new URL(`/api/finance/invoices/${id}`, req.url), { status: 308 });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await req.json();
    const r = await fetch(new URL(`/api/finance/invoices/${id}`, req.url), {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    return NextResponse.json(await r.json(), { status: r.status });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.redirect(new URL(`/api/finance/invoices/${id}`, req.url), { status: 308 });
}
