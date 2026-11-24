import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const rawBody = await req.json().catch(() => ({}));
    const body = stripTenantOwnershipFields(rawBody);

    const keys = Object.keys(body || {});
    if (keys.length === 0 || (!body.agreementNumber && !body.vendorId && !body.carrierId)) {
      return NextResponse.json({
        ok: false,
        error: 'Unprocessable Entity',
        message: 'Self-billing configuration cannot be empty',
        missingFields: ['agreementNumber', 'vendorId', 'effectiveDate'],
      }, { status: 422 });
    }

    return withTenantRls(prisma, tenantId, async (tx) => {
      const existing = await tx.tenantSettings.findUnique({
        where: { tenantId },
      }).catch(() => null);

      let prefs: Record<string, unknown> = {};
      try {
        if (existing?.notificationPreferences) {
          prefs = JSON.parse(existing.notificationPreferences);
        }
      } catch {
        prefs = {};
      }

      prefs.selfBillingConfig = {
        ...body,
        updatedAt: new Date().toISOString(),
      };

      await tx.tenantSettings.upsert({
        where: { tenantId },
        update: {
          notificationPreferences: JSON.stringify(prefs),
        },
        create: {
          tenantId,
          notificationPreferences: JSON.stringify(prefs),
        },
      }).catch(async () => {
        await tx.$executeRawUnsafe(
          `INSERT INTO public.tenant_settings (id, tenant_id, notification_preferences, updated_at)
           VALUES (gen_random_uuid(), $1, $2, NOW())
           ON CONFLICT (tenant_id) DO UPDATE SET
             notification_preferences = $2,
             updated_at = NOW()`,
          tenantId,
          JSON.stringify(prefs),
        ).catch(() => null);
      });

      return NextResponse.json({
        success: true,
        message: 'Self-billing configuration saved',
        config: body,
      });
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
