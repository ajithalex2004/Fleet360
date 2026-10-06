export const dynamic = 'force-dynamic';

/**
 * Attachment Type master (Admin > Attachment Types).
 *
 *   GET  /api/admin/attachment-types[?active=true]  list (any admin; the
 *        Create Tenant modal reads the active types)
 *   POST /api/admin/attachment-types                create (platform admin)
 *
 * Types are never deleted (tenant documents reference them); deactivate
 * one with PATCH /api/admin/attachment-types/[id] instead.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';
import { AttachmentsNotMigratedError, listAttachmentTypes } from '@/lib/tenant-attachments';
import { attachmentTypeInput } from '@/lib/attachment-type-input';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  try {
    const activeOnly = req.nextUrl.searchParams.get('active') === 'true';
    const types = await withPlatformAdmin(prisma, (tx) => listAttachmentTypes(tx, { activeOnly }));
    return NextResponse.json(types, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (e instanceof AttachmentsNotMigratedError) return NextResponse.json({ error: e.message }, { status: 503 });
    return NextResponse.json({ error: 'Failed to load attachment types' }, { status: 500 });
  }
}

async function handlePOST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });

  const body = await req.json().catch(() => null);
  const input = attachmentTypeInput(body && typeof body === 'object' ? stripTenantOwnershipFields(body) : body, { partial: false });
  if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 });
  const v = input.value;

  try {
    const rows = await withPlatformAdmin(prisma, async (tx) => {
      await listAttachmentTypes(tx); // surfaces a missing migration as 503
      return tx.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO attachment_types (code, name, description, is_mandatory, requires_expiry, is_active, sort_order, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id::text`,
        v.code, v.name, v.description ?? null, v.isMandatory ?? false, v.requiresExpiry ?? false,
        v.isActive ?? true, v.sortOrder ?? 100, authz.userId,
      );
    });
    return NextResponse.json({ id: rows[0]?.id }, { status: 201 });
  } catch (e) {
    if (e instanceof AttachmentsNotMigratedError) return NextResponse.json({ error: e.message }, { status: 503 });
    if (String(e).includes('attachment_types_code_key')) {
      return NextResponse.json({ error: `An attachment type with code ${v.code} already exists` }, { status: 409 });
    }
    console.error('[attachment-types POST]', e);
    return NextResponse.json({ error: 'Failed to create attachment type' }, { status: 500 });
  }
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const POST = withAuditedAction(handlePOST);
