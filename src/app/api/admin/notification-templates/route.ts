
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export async function GET() {
    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

    try {
        const templates = await withPlatformAdmin(prisma, (tx) =>
            tx.notificationTemplate.findMany()
        );
        return NextResponse.json(templates);
    } catch (error) {
        return NextResponse.json({ error: 'Failed to fetch templates' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

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
    } catch (error) {
        return NextResponse.json({ error: 'Failed to create template' }, { status: 500 });
    }
}

export async function PUT(request: Request) {
    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

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
    } catch (error) {
        return NextResponse.json({ error: 'Failed to update template' }, { status: 500 });
    }
}
