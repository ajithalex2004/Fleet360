/**
 * /api/admin/tenants/[id]/branding
 *
 * GET — current branding fields for the tenant (auth required).
 * PUT — upsert branding fields. Body keys: productName, tagline, logoUrl,
 *       faviconUrl, primaryColor, accentColor. All optional. Empty string
 *       or null clears the field.
 *
 * Authorization: SUPER_ADMIN, or that tenant's TENANT_ADMIN.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  ensureBrandingColumns, getBranding, normalizeHexColor, normalizeUrl,
} from '@/lib/branding';
import { requirePlan } from '@/lib/plan-limits';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

interface RouteParams { params: Promise<{ id: string }>; }

function authorize(req: NextRequest, tenantId: string): { ok: true; userId: string } | { ok: false; res: NextResponse } {
  const role     = req.headers.get('x-user-role')   ?? '';
  const userId   = req.headers.get('x-user-id')     ?? '';
  const ctxTenant = req.headers.get('x-tenant-id')  ?? '';
  if (!userId) return { ok: false, res: NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 }) };
  if (role !== 'SUPER_ADMIN' && ctxTenant !== tenantId) {
    return { ok: false, res: NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 }) };
  }
  return { ok: true, userId };
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  const { id: tenantId } = await params;
  const auth = authorize(req, tenantId);
  if (!auth.ok) return auth.res;
  const branding = await getBranding(tenantId);
  return NextResponse.json({ ok: true, branding });
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  const { id: tenantId } = await params;
  const auth = authorize(req, tenantId);
  if (!auth.ok) return auth.res;
  // White-label is a Professional-tier feature.
  const gate = requirePlan(req, 'PROFESSIONAL');
  if (gate) return gate;

  let body: {
    productName?: string | null; tagline?: string | null;
    logoUrl?: string | null; faviconUrl?: string | null;
    primaryColor?: string | null; accentColor?: string | null;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

  // Trim strings, treat empty as clear-the-field.
  const trim = (v: string | null | undefined): string | null =>
    typeof v === 'string' && v.trim().length > 0 ? v.trim().slice(0, 240) : null;

  const productName = trim(body.productName);
  const tagline     = trim(body.tagline);

  // Validate URLs and colors strictly.
  const logoUrl    = body.logoUrl    !== undefined ? normalizeUrl(body.logoUrl)         : undefined;
  const faviconUrl = body.faviconUrl !== undefined ? normalizeUrl(body.faviconUrl)      : undefined;
  if (body.logoUrl    && body.logoUrl.trim()    && logoUrl    === null) return NextResponse.json({ ok: false, error: 'logoUrl must be a valid http(s) URL.' }, { status: 400 });
  if (body.faviconUrl && body.faviconUrl.trim() && faviconUrl === null) return NextResponse.json({ ok: false, error: 'faviconUrl must be a valid http(s) URL.' }, { status: 400 });

  const primaryColor = body.primaryColor !== undefined ? normalizeHexColor(body.primaryColor) : undefined;
  const accentColor  = body.accentColor  !== undefined ? normalizeHexColor(body.accentColor)  : undefined;
  if (body.primaryColor && body.primaryColor.trim() && primaryColor === null) return NextResponse.json({ ok: false, error: 'primaryColor must be #rgb or #rrggbb.' }, { status: 400 });
  if (body.accentColor  && body.accentColor.trim()  && accentColor  === null) return NextResponse.json({ ok: false, error: 'accentColor must be #rgb or #rrggbb.' }, { status: 400 });

  try {
    await ensureBrandingColumns();
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true },
    });
    if (!tenant) return NextResponse.json({ ok: false, error: 'Tenant not found' }, { status: 404 });

    await prisma.$executeRawUnsafe(
      `UPDATE tenants
         SET brand_product_name   = $1,
             brand_tagline        = $2,
             brand_logo_url       = $3,
             brand_favicon_url    = $4,
             brand_primary_color  = $5,
             brand_accent_color   = $6,
             updated_at           = NOW()
       WHERE id = $7`,
      productName, tagline,
      logoUrl ?? null, faviconUrl ?? null,
      primaryColor ?? null, accentColor ?? null,
      tenantId,
    );

    void logAudit({
      tenantId, tenantName: tenant.name,
      userId: auth.userId, userRole: 'TENANT_ADMIN',
      entityType: 'Branding',
      action: 'UPDATE',
      details: `Branding updated: ${[
        productName ? `productName=${productName}` : null,
        primaryColor ? `primary=${primaryColor}` : null,
        accentColor  ? `accent=${accentColor}`   : null,
        logoUrl ? 'logoUrl set' : null,
      ].filter(Boolean).join('; ') || 'cleared'}.`,
    });

    const fresh = await getBranding(tenantId);
    return NextResponse.json({ ok: true, branding: fresh });
  } catch (err) {
    captureException(err, { context: 'admin.branding.put' });
    return NextResponse.json({ ok: false, error: 'Failed to save branding' }, { status: 500 });
  }
}
