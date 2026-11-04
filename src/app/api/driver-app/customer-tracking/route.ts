export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import {
  ensureDrayageSchema,
  verifyDrayageCustomerTrackingToken,
  resolveDrayageCustomerTrackingToken,
  getPublicCustomerTrackingByToken,
  updateDrayageCustomerAlertPreferences,
  dispatchDrayageCustomerMilestoneAlert,
  consigneeConfirmEmptyReady,
  extendDrayageJobEtcTime,
} from '@/lib/logistics/drayage-domain';
import {
  emitDrayageEvent,
  resetEtcAutoActivationThrottle,
} from '@/lib/logistics/drayage-events';
import {
  recordDrayageApiMetric,
  buildServerTimingHeader,
} from '@/lib/logistics/drayage-observability';

let schemaReady = false;

export async function GET(req: NextRequest) {
  const t0 = performance.now();
  const rawToken = req.nextUrl.searchParams.get('token') || '';
  let verified = verifyDrayageCustomerTrackingToken(rawToken);
  if (!verified.valid) {
    verified = await resolveDrayageCustomerTrackingToken(prisma, rawToken);
  }

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
    const dbStart = performance.now();
    const data = await withTenantRls(
      prisma,
      verified.tenantId,
      async (tx) => {
        return getPublicCustomerTrackingByToken(tx, {
          tenantId: verified.tenantId!,
          jobCode: verified.jobCode!,
          containerNumber: verified.containerNumber,
          rawToken,
          role: verified.role,
        });
      },
      { timeoutMs: 25000 },
    );
    const dbMs = performance.now() - dbStart;
    const totalMs = performance.now() - t0;

    recordDrayageApiMetric({
      tenantId: verified.tenantId,
      route: '/api/driver-app/customer-tracking',
      method: 'GET',
      actionOrScope: `portal:${verified.role || 'CUSTOMER'}`,
      durationMs: totalMs,
      dbMs,
      status: 200,
      cacheStatus: 'BYPASS',
    });

    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        'Server-Timing': buildServerTimingHeader({
          totalMs,
          dbMs,
          cacheStatus: 'BYPASS',
          scope: verified.role || 'CUSTOMER',
        }),
      },
    });
  } catch (err) {
    const totalMs = performance.now() - t0;
    recordDrayageApiMetric({
      tenantId: verified.tenantId,
      route: '/api/driver-app/customer-tracking',
      method: 'GET',
      actionOrScope: `portal:${verified.role || 'CUSTOMER'}`,
      durationMs: totalMs,
      status: 404,
      cacheStatus: 'BYPASS',
      errorMessage: err instanceof Error ? err.message : 'Portal GET failed',
    });
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Unable to load customer tracking portal',
      },
      { status: 404 },
    );
  }
}

export async function POST(req: NextRequest) {
  const t0 = performance.now();
  try {
    const body = await req.json();
    const rawToken = String(body.token || '');
    let verified = verifyDrayageCustomerTrackingToken(rawToken);
    if (!verified.valid) {
      verified = await resolveDrayageCustomerTrackingToken(prisma, rawToken);
    }

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
    const tokenRole = verified.role || 'CUSTOMER';

    const dbStart = performance.now();
    const result = await withTenantRls(
      prisma,
      tenantId,
      async (tx) => {
        const portalData = await getPublicCustomerTrackingByToken(tx, {
          tenantId,
          jobCode: verified.jobCode!,
          containerNumber: verified.containerNumber,
          rawToken,
          role: tokenRole,
        });

        if (!portalData.linkActive) {
          throw new Error(
            portalData.activationRequirement ||
              'This tracking link is not yet active for the current job stage.',
          );
        }

        const jobId = portalData.job.id;

        if (action === 'update_subscriptions') {
          const customerWhatsApp = String(body.customerWhatsApp ?? '').trim();
          const customerEmail = String(body.customerEmail ?? '').trim();
          if (!customerWhatsApp && !customerEmail) {
            throw new Error('Give a WhatsApp number or an email address for alerts.');
          }
          if (customerWhatsApp && !/^\+?[0-9 ()-]{7,20}$/.test(customerWhatsApp)) {
            throw new Error('WhatsApp number is not valid.');
          }
          if (customerEmail && !/^[^\s@[\]]+@[^\s@[\]]+\.[^\s@[\]]+$/.test(customerEmail)) {
            throw new Error('Email address is not valid.');
          }
          const updated = await updateDrayageCustomerAlertPreferences(tx, {
            tenantId,
            jobId,
            customerWhatsApp:
              tokenRole === 'CUSTOMER'
                ? customerWhatsApp
                : portalData.job.customerPortal?.customerWhatsApp || customerWhatsApp,
            customerEmail:
              tokenRole === 'CUSTOMER'
                ? customerEmail
                : portalData.job.customerPortal?.customerEmail || customerEmail,
            clientWhatsApp: tokenRole === 'CLIENT' ? customerWhatsApp : undefined,
            clientEmail: tokenRole === 'CLIENT' ? customerEmail : undefined,
            rampWhatsApp: tokenRole === 'RAMP' ? customerWhatsApp : undefined,
            autoAlertsEnabled: Boolean(body.autoAlertsEnabled ?? true),
          });
          const alertSent = await dispatchDrayageCustomerMilestoneAlert(tx, {
            tenantId,
            jobId,
            customWhatsApp: customerWhatsApp,
            customEmail: customerEmail,
            targetRole: tokenRole,
            triggerSource: 'CUSTOMER_PORTAL',
          });
          return { ok: true, updated, alertSent };
        }

        if (action === 'confirm_offloading_complete' || action === 'confirm_stuffing_complete') {
          if (tokenRole === 'CUSTOMER') {
            throw new Error(
              'Customer link is read-only. Please use the Ramp Link (active upon PLACED_AT_RAMP) to update Stuffing/Destuffing completion.',
            );
          }
          return consigneeConfirmEmptyReady(tx, {
            tenantId,
            jobId,
            receiverName: String(
              body.consigneeContact ||
                body.receiverName ||
                `${portalData.job.warehouseName} (Ramp Supervisor)`,
            ),
            bayNotes: body.bayNotes
              ? String(body.bayNotes)
              : 'Stuffing/Destuffing completed & confirmed via Role-Scoped Ramp Link',
            operationType:
              action === 'confirm_stuffing_complete' || body.operationType === 'STUFFING'
                ? 'STUFFING'
                : 'DESTUFFING',
            newSealNumber: body.newSealNumber ? String(body.newSealNumber) : null,
            grossWeightKg: body.grossWeightKg != null ? Number(body.grossWeightKg) : null,
          });
        }

        if (action === 'extend_ramp_etc') {
          if (tokenRole === 'CUSTOMER') {
            throw new Error('Customer link is read-only. Only Ramp or Client links can adjust Ramp ETC.');
          }
          const mins = Math.min(240, Math.max(15, Number(body.minutesToAdd || 30)));
          return extendDrayageJobEtcTime(tx, {
            tenantId,
            jobId,
            minutesToAdd: mins,
            reason: body.reason ? String(body.reason) : `Extended via ${tokenRole} Link`,
            actor: `${portalData.job.warehouseName} (${tokenRole} Portal)`,
          });
        }

        throw new Error(`Unsupported portal action: ${action}`);
      },
      { timeoutMs: 25000 },
    );
    const dbMs = performance.now() - dbStart;
    const totalMs = performance.now() - t0;

    resetEtcAutoActivationThrottle(tenantId);
    emitDrayageEvent(tenantId, {
      type: 'customer_portal_mutation',
      action,
      jobCode: verified.jobCode,
      containerNumber: verified.containerNumber ?? null,
    });
    recordDrayageApiMetric({
      tenantId,
      route: '/api/driver-app/customer-tracking',
      method: 'POST',
      actionOrScope: `${tokenRole}:${action}`,
      durationMs: totalMs,
      dbMs,
      status: 200,
      cacheStatus: 'MUTATION',
    });

    return NextResponse.json(result, {
      headers: {
        'Server-Timing': buildServerTimingHeader({
          totalMs,
          dbMs,
          cacheStatus: 'MUTATION',
          scope: action,
        }),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Operation failed' },
      { status: 400 },
    );
  }
}
