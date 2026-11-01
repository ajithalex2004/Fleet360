export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import {
  ensureDrayageSchema,
  verifyDrayageCustomerTrackingToken,
  getPublicCustomerTrackingByToken,
  updateDrayageCustomerAlertPreferences,
  dispatchDrayageCustomerMilestoneAlert,
  consigneeConfirmEmptyReady,
} from '@/lib/logistics/drayage-domain';

let schemaReady = false;

export async function GET(req: NextRequest) {
  const rawToken = req.nextUrl.searchParams.get('token') || '';
  const verified = verifyDrayageCustomerTrackingToken(rawToken);

  if (!verified.valid || !verified.tenantId || !verified.jobCode) {
    return NextResponse.json(
      {
        error: 'Invalid or expired customer tracking token.',
        code: 'INVALID_TRACKING_TOKEN',
      },
      { status: 401 },
    );
  }

  if (!schemaReady) {
    await ensureDrayageSchema(prisma).catch(() => {});
    schemaReady = true;
  }

  try {
    const data = await withTenantRls(
      prisma,
      verified.tenantId,
      async (tx) => {
        return getPublicCustomerTrackingByToken(tx, {
          tenantId: verified.tenantId!,
          jobCode: verified.jobCode!,
          containerNumber: verified.containerNumber,
          rawToken,
        });
      },
      { timeoutMs: 25000 },
    );

    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Unable to load customer tracking portal',
      },
      { status: 404 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rawToken = String(body.token || '');
    const verified = verifyDrayageCustomerTrackingToken(rawToken);

    if (!verified.valid || !verified.tenantId || !verified.jobCode) {
      return NextResponse.json(
        { error: 'Invalid or expired customer tracking token.' },
        { status: 401 },
      );
    }

    if (!schemaReady) {
      await ensureDrayageSchema(prisma).catch(() => {});
      schemaReady = true;
    }

    const action = String(body.action || '');
    const tenantId = verified.tenantId;

    const result = await withTenantRls(
      prisma,
      tenantId,
      async (tx) => {
        const portalData = await getPublicCustomerTrackingByToken(tx, {
          tenantId,
          jobCode: verified.jobCode!,
          containerNumber: verified.containerNumber,
          rawToken,
        });
        const jobId = portalData.job.id;

        if (action === 'update_subscriptions') {
          const updated = await updateDrayageCustomerAlertPreferences(tx, {
            tenantId,
            jobId,
            customerWhatsApp: String(body.customerWhatsApp || '+971 50 482 9104'),
            customerEmail: String(body.customerEmail || 'logistics-ops@shipper.ae'),
            autoAlertsEnabled: Boolean(body.autoAlertsEnabled ?? true),
          });
          const alertSent = await dispatchDrayageCustomerMilestoneAlert(tx, {
            tenantId,
            jobId,
            customWhatsApp: updated.customerWhatsApp,
            customEmail: updated.customerEmail,
            triggerSource: 'CUSTOMER_PORTAL',
          });
          return { ok: true, updated, alertSent };
        }

        if (action === 'confirm_offloading_complete') {
          return consigneeConfirmEmptyReady(tx, {
            tenantId,
            jobId,
            receiverName: String(body.consigneeContact || `${portalData.job.customerName} (Customer Portal)`),
            bayNotes: 'Offloading completed & Empty Ready confirmed via Shareable Customer Portal',
          });
        }

        throw new Error(`Unsupported customer portal action: ${action}`);
      },
      { timeoutMs: 25000 },
    );

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Operation failed' },
      { status: 400 },
    );
  }
}
