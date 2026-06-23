import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';
import { requireAdminPermission, requireDangerApproval } from '@/lib/admin-policy';
import { recordAdminChange } from '@/lib/admin-change-history';

const SECRET_FIELDS = new Set(['password', 'apiKey', 'apiSecret', 'authToken']);
const MASKED_SECRET = '********';

function maskConfig<T extends Record<string, unknown>>(config: T): T {
  const masked: Record<string, unknown> = { ...config };
  for (const key of SECRET_FIELDS) {
    if (masked[key]) masked[key] = MASKED_SECRET;
  }
  return masked as T;
}

function isMaskedSecret(key: string, value: unknown) {
  return SECRET_FIELDS.has(key) && String(value) === MASKED_SECRET;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdminPermission(req, 'view', 'integrations');
    if (auth instanceof NextResponse) return auth;
    const configs = await prisma.integrationConfig.findMany();
    return NextResponse.json(configs.map(c => maskConfig(c)));
  } catch (e) {
    console.error('GET integration-configs error:', e);
    return NextResponse.json({ error: 'Failed to fetch configurations' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdminPermission(req, 'edit', 'integrations');
    if (auth instanceof NextResponse) return auth;
    const body = await req.json();
    const { type, ...data } = body;

    if (!type) {
      return NextResponse.json({ error: 'type is required' }, { status: 400 });
    }

    // provider is required  default to type name if missing
    const provider = data.provider?.trim() || type;
    const before = await prisma.integrationConfig.findUnique({ where: { type } });
    const approval = await requireDangerApproval(req, auth.ctx, 'integration-config.update', {
      targetType: 'IntegrationConfig',
      targetId: type,
      summary: `Update ${type} integration configuration.`,
      payload: { before: before ? maskConfig(before) : null, after: maskConfig({ type, ...data }) },
      requiredApprovals: 2,
    });
    if (approval) return approval;

    // Strip unknown/undefined fields and build clean update payload
    const allowed = [
      'provider','host','port','username','password','apiKey','apiSecret',
      'senderId','senderEmail','fromName','encryption','accountSid',
      'authToken','fromNumber','isEnabled',
    ];
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    for (const key of allowed) {
      if (isMaskedSecret(key, data[key])) continue;
      if (data[key] !== undefined) updateData[key] = data[key] ?? null;
    }
    updateData.provider = provider;

    const config = await prisma.integrationConfig.upsert({
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

    await recordAdminChange({
      req,
      ctx: auth.ctx,
      tenantId: auth.ctx.tenantId ?? null,
      entityType: 'IntegrationConfig',
      entityId: config.id,
      entityName: type,
      action: before ? 'UPDATE' : 'CREATE',
      before: before ? maskConfig(before) : null,
      after: maskConfig(config),
      summary: `Updated ${type} integration configuration.`,
    });

    return NextResponse.json(maskConfig(config));
  } catch (e) {
    console.error('POST integration-configs error:', e);
    return NextResponse.json(
      { error: getErrorMessage(e, 'Failed to save configuration') },
      { status: 500 }
    );
  }
}
