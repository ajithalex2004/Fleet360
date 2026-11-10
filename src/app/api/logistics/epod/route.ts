export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import {
  createDigitalEPOD,
  DigitalEPODRecord,
} from '@/lib/digital-epod-engine';

const EPOD_STORE_BY_TENANT = new Map<string, Record<string, DigitalEPODRecord>>();

function getTenantEpodStore(tenantId: string): Record<string, DigitalEPODRecord> {
  let store = EPOD_STORE_BY_TENANT.get(tenantId);
  if (!store) {
    store = {};
    EPOD_STORE_BY_TENANT.set(tenantId, store);
  }
  return store;
}

export async function GET(req: NextRequest) {
  const auth = requireAuthorizedTenant(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const tenantStore = getTenantEpodStore(auth.tenantId);
  const epodNumber = req.nextUrl.searchParams.get('epodNumber');
  if (epodNumber && tenantStore[epodNumber]) {
    return NextResponse.json({ success: true, epod: tenantStore[epodNumber] });
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
    // actual (unchanged) runtime behavior.
    const body = stripTenantOwnershipFields(rawBody) as Parameters<typeof createDigitalEPOD>[0];
    const epod = createDigitalEPOD({ ...body, tenantId: auth.tenantId });
    const tenantStore = getTenantEpodStore(auth.tenantId);
    tenantStore[epod.epodNumber] = epod;

    return NextResponse.json({
      success: true,
      epod,
      message: `Electronic Proof of Delivery (e-POD) ${epod.epodNumber} confirmed and sealed. Final VAT Invoice released.`,
    });
  } catch (err) {
    console.error('[api/logistics/epod POST]', err);
    return NextResponse.json({ error: 'Failed to generate e-POD' }, { status: 500 });
  }
}
