import { NextRequest, NextResponse } from 'next/server';
import {
  CORPORATE_CLIENTS_REGISTRY,
  CorporateClientRecord,
} from '@/lib/corporate-clients-registry';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const domain = searchParams.get('domain');

    if (domain) {
      const match = CORPORATE_CLIENTS_REGISTRY.find(
        (c) => c.emailDomain.toLowerCase() === domain.toLowerCase().trim()
      );
      if (match) {
        return NextResponse.json({ client: match });
      }
      return NextResponse.json({ error: 'Domain not registered' }, { status: 404 });
    }

    return NextResponse.json({ clients: CORPORATE_CLIENTS_REGISTRY });
  } catch (err) {
    console.error('[api/admin/corporate-clients GET]', err);
    return NextResponse.json({ error: 'Failed to fetch corporate clients' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      clientName,
      emailDomain,
      tenantId = 'tnt-exl-solutions',
      tenantName = 'EXL Solutions',
      costCenterCode,
      discountPercent = 10,
      creditLimitAed = 50000,
    } = body;

    if (!clientName || !emailDomain || !costCenterCode) {
      return NextResponse.json({ error: 'Missing required client fields' }, { status: 400 });
    }

    const cleanDomain = emailDomain.replace('@', '').toLowerCase().trim();

    const existingIdx = CORPORATE_CLIENTS_REGISTRY.findIndex(
      (c) => c.emailDomain === cleanDomain
    );

    const newRecord: CorporateClientRecord = {
      id: `cli-${cleanDomain.replace(/[^a-z0-9]/g, '')}-${Date.now()}`,
      clientName,
      emailDomain: cleanDomain,
      tenantId,
      tenantName,
      costCenterCode,
      discountPercent: Number(discountPercent),
      billingMethod: 'CORPORATE_ACCOUNT',
      creditLimitAed: Number(creditLimitAed),
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
    };

    if (existingIdx >= 0) {
      CORPORATE_CLIENTS_REGISTRY[existingIdx] = newRecord;
    } else {
      CORPORATE_CLIENTS_REGISTRY.push(newRecord);
    }

    return NextResponse.json({ success: true, client: newRecord });
  } catch (err) {
    console.error('[api/admin/corporate-clients POST]', err);
    return NextResponse.json({ error: 'Failed to register corporate client' }, { status: 500 });
  }
}
