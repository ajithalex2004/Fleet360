import { NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { PrismaClient } from '@prisma/client';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
const prisma = new PrismaClient();

export async function GET() {

    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const logs = await tx.notificationLog.findMany({
                orderBy: {
                    sentAt: 'desc',
                },
            });
            return NextResponse.json(logs);
        } catch (e) {
            console.error('Failed to fetch notification logs:', e);
            return NextResponse.json({ error: 'Failed to fetch notification logs' }, { status: 500 });
        }
  });
}


export async function POST(request: Request) {

    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const body = await request.json();
            const {
                recipient,
                type,
                subject,
                body: messageBody,
                status,
                triggerReason,
            } = body;

            const newLog = await tx.notificationLog.create({
                data: {
                    id: crypto.randomUUID(),
                    recipient,
                    type,
                    subject,
                    body: messageBody,
                    status: status || 'Pending',
                    triggerReason,
                    sentAt: new Date(),
                }
            });
            return NextResponse.json(newLog);
        } catch (e) {
            console.error('Failed to create notification log:', e);
            return NextResponse.json({ error: 'Failed to create notification log' }, { status: 500 });
        }
  });
}

