export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import {
  createDigitalEBOL,
  DigitalEBOLRecord,
} from '@/lib/digital-ebol-engine';

const EBOL_STORE_BY_TENANT = new Map<string, Record<string, DigitalEBOLRecord>>();

function getTenantEbolStore(tenantId: string): Record<string, DigitalEBOLRecord> {
  let store = EBOL_STORE_BY_TENANT.get(tenantId);
  if (!store) {
    store = {};
    EBOL_STORE_BY_TENANT.set(tenantId, store);
  }
  return store;
}

export async function GET(req: NextRequest) {
  const auth = requireAuthorizedTenant(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const tenantStore = getTenantEbolStore(auth.tenantId);
  const ebolNumber = req.nextUrl.searchParams.get('ebolNumber');
  if (ebolNumber && tenantStore[ebolNumber]) {
    return NextResponse.json({ success: true, ebol: tenantStore[ebolNumber] });
  }

  return NextResponse.json({
    success: true,
    records: Object.values(tenantStore),
  });
}

export async function POST(req: NextRequest) {
  const auth = requireAuthorizedTenant(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const rawBody = await req.json();
    // Body is user-supplied and untyped; this cast matches the function's
    // actual (unchanged) runtime behavior — it does not itself validate
    // missing required fields, same as before.
    const body = stripTenantOwnershipFields(rawBody) as Parameters<typeof createDigitalEBOL>[0];
    const ebol = createDigitalEBOL({ ...body, tenantId: auth.tenantId });
    const tenantStore = getTenantEbolStore(auth.tenantId);
    tenantStore[ebol.ebolNumber] = ebol;

    return NextResponse.json({
      success: true,
      ebol,
      message: `Digital Bill of Lading ${ebol.ebolNumber} generated and cryptographically sealed with SHA-256`,
    });
  } catch (err) {
    console.error('[api/logistics/ebol POST]', err);
    return NextResponse.json({ error: 'Failed to generate e-BOL' }, { status: 500 });
  }
}
