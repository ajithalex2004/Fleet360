export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';
import { parseAlertConfigInput } from '@/lib/alerts/alert-config';
export async function GET(req: NextRequest) {

    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const configs = await tx.alertConfig.findMany({
                where: { tenantId, deletedAt: null },
                orderBy: { createdAt: 'desc' }
            });
            return NextResponse.json(JSON.parse(JSON.stringify(configs)));
        } catch (e) {
            console.error('Failed to fetch alert configs:', e);
            return NextResponse.json({ error: 'Failed to fetch alert configs', details: String(e) }, { status: 500 });
        }
  });
}


async function handlePOST(request: NextRequest) {

    const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const input = parseAlertConfigInput(stripTenantOwnershipFields(await request.json().catch(() => null)), false);
            if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 });
            const d = input.data;

            // Saved under the signed-in tenant. This used tenantId '' (a
            // leftover TODO), which row level security refuses, so no rule
            // could ever be created.
            const config = await tx.alertConfig.create({
                data: {
                    tenantId,
                    alertFor:            d.alertFor,
                    alertType:           d.alertType,
                    frequency:           d.frequency,
                    frequencyValue:      BigInt(d.frequencyValue!),
                    dueAlertThreshold:   d.dueAlertThreshold,
                    thresholdValue:      BigInt(d.thresholdValue!),
                    notificationEnabled: d.notificationEnabled,
                    whatsappEnabled:     d.whatsappEnabled,
                    assignedIds:         [],
                }
            });

            return NextResponse.json(JSON.parse(JSON.stringify(config)), { status: 201 });
            } catch (e) {
            console.error('Failed to create alert config:', e);
            return NextResponse.json({ error: 'Failed to create alert config', details: String(e) }, { status: 500 });
        }
  });
}


// Privileged writes are always audited (src/lib/audited-action.ts).
export const POST = withAuditedAction(handlePOST);
