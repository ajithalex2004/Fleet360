import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const configs = await tx.integrationConfig.findMany();
        return NextResponse.json(configs);
      } catch (e: any) {
        console.error('GET integration-configs error:', e);
        return NextResponse.json({ error: 'Failed to fetch configurations' }, { status: 500 });
      }
  });
}


export async function POST(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
        const { type, ...data } = body;

        if (!type) {
          return NextResponse.json({ error: 'type is required' }, { status: 400 });
        }

        // provider is required  default to type name if missing
        const provider = data.provider?.trim() || type;

        // Strip unknown/undefined fields and build clean update payload
        const allowed = [
          'provider','host','port','username','password','apiKey','apiSecret',
          'senderId','senderEmail','fromName','encryption','accountSid',
          'authToken','fromNumber','isEnabled',
        ];
        const updateData: Record<string, unknown> = { updatedAt: new Date() };
        for (const key of allowed) {
          if (data[key] !== undefined) updateData[key] = data[key] ?? null;
        }
        updateData.provider = provider;

        const config = await tx.integrationConfig.upsert({
          where:  { type },
          update: updateData,
          create: {
            id:        randomUUID(),
            type,
            provider,
            updatedAt: new Date(),
            ...updateData,
          },
        });

        return NextResponse.json(config);
      } catch (e: any) {
        console.error('POST integration-configs error:', e);
        return NextResponse.json(
          { error: e?.message ?? 'Failed to save configuration' },
          { status: 500 }
        );
      }
  });
}

