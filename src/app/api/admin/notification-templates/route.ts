export const dynamic = 'force-dynamic';


import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';
export async function GET(req: NextRequest) {
    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }

    try {
        const templates = await withPlatformAdmin(prisma, (tx) =>
            tx.notificationTemplate.findMany()
        );
        return NextResponse.json(templates);
    } catch {
        return NextResponse.json({ error: 'Failed to fetch templates' }, { status: 500 });
    }
}

async function handlePOST(request: NextRequest) {
    const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }

    try {
        const body = await request.json();
        const template = await withPlatformAdmin(prisma, (tx) =>
            tx.notificationTemplate.create({
                data: {
                    name: body.name,
                    event: body.event,
                    channel: body.channel,
                    subject: body.subject,
                    body: body.body,
                    isActive: body.isActive,
                },
            })
        );
        return NextResponse.json(template);
    } catch {
        return NextResponse.json({ error: 'Failed to create template' }, { status: 500 });
    }
}

async function handlePUT(request: NextRequest) {
    const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }

    try {
        const body = await request.json();
        const template = await withPlatformAdmin(prisma, (tx) =>
            tx.notificationTemplate.update({
                where: { id: body.id },
                data: {
                    name: body.name,
                    event: body.event,
                    channel: body.channel,
                    subject: body.subject,
                    body: body.body,
                    isActive: body.isActive,
                },
            })
        );
        return NextResponse.json(template);
    } catch {
        return NextResponse.json({ error: 'Failed to update template' }, { status: 500 });
    }
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const POST = withAuditedAction(handlePOST);
export const PUT = withAuditedAction(handlePUT);
