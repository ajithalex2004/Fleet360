/**
 * POST /api/admin/tenants/[id]/branding/logo
 * multipart/form-data with `file` field — uploads a tenant logo and
 * persists the resulting URL on the tenants row.
 *
 * Accepts PNG / JPEG / SVG / WebP. Max 1 MB.
 *
 * Auth: SUPER_ADMIN or that tenant's TENANT_ADMIN. White-label requires
 * Professional plan.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureBrandingColumns, getBranding } from '@/lib/branding';
import { getStorage } from '@/lib/storage';
import { requirePlan } from '@/lib/plan-limits';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

interface RouteParams { params: Promise<{ id: string }>; }

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp']);
const MAX_BYTES    = 1_000_000; // 1 MB

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

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id: tenantId } = await params;
  const auth = authorize(req, tenantId);
  if (!auth.ok) return auth.res;
  const gate = requirePlan(req, 'PROFESSIONAL');
  if (gate) return gate;

  let formData: FormData;
  try { formData = await req.formData(); }
  catch { return NextResponse.json({ ok: false, error: 'Expected multipart/form-data with a file field.' }, { status: 400 }); }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: 'No file uploaded.' }, { status: 400 });
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json({ ok: false, error: `Unsupported type ${file.type}. Use PNG, JPEG, SVG, or WebP.` }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: `Max file size is ${(MAX_BYTES / 1_000_000).toFixed(1)} MB.` }, { status: 400 });
  }

  try {
    await ensureBrandingColumns();

    const buffer = Buffer.from(await file.arrayBuffer());
    const stored = await getStorage().upload({
      buffer,
      originalName: file.name,
      mimeType: file.type,
      prefix: `branding/${tenantId}`,
    });

    await prisma.$executeRawUnsafe(
      `UPDATE tenants SET brand_logo_url = $1, updated_at = NOW() WHERE id = $2`,
      stored.url, tenantId,
    );

    void logAudit({
      tenantId,
      userId: auth.userId, userRole: 'TENANT_ADMIN',
      entityType: 'Branding', entityName: file.name,
      action: 'UPDATE',
      details: `Logo uploaded (${file.type}, ${file.size}B) → ${stored.url}`,
    });

    const fresh = await getBranding(tenantId);
    return NextResponse.json({ ok: true, branding: fresh, logoUrl: stored.url });
  } catch (err) {
    captureException(err, { context: 'admin.branding.logo' });
    return NextResponse.json({ ok: false, error: 'Upload failed.' }, { status: 500 });
  }
}
