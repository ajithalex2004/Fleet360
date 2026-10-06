export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Tenant attachments (Admin > Tenants > Manage > Attachments).
 *
 *   GET  /api/admin/tenants/[id]/attachments  the tenant's documents and the
 *        active attachment types (with which mandatory ones are missing)
 *   POST /api/admin/tenants/[id]/attachments  multipart/form-data, same fields
 *        as Create Tenant: file:<typeId>, documentNumber:<typeId>,
 *        expiryDate:<typeId>. Adds documents; platform admin.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, requireSuperAdminForTenant } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';
import type { StoredFile } from '@/lib/storage';
import {
  AttachmentsNotMigratedError, attachmentUploadProblem, insertTenantAttachments, listAttachmentTypes,
  listTenantAttachments, removeStoredFiles, storeAttachmentFiles, uploadsFromFormData,
} from '@/lib/tenant-attachments';

type Props = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, props: Props) {
  const { id } = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const guard = requireSuperAdminForTenant(authz, id);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  try {
    const [types, attachments] = await withTenantRls(prisma, id, async (tx) =>
      [await listAttachmentTypes(tx, { activeOnly: true }), await listTenantAttachments(tx, id)] as const);
    const have = new Set(attachments.map((a) => a.attachmentTypeId));
    const missingMandatory = types.filter((t) => t.isMandatory && !have.has(t.id)).map((t) => t.name);
    return NextResponse.json({ types, attachments, missingMandatory }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (e instanceof AttachmentsNotMigratedError) return NextResponse.json({ error: e.message }, { status: 503 });
    return NextResponse.json({ error: 'Failed to load attachments' }, { status: 500 });
  }
}

async function handlePOST(req: NextRequest, props: Props) {
  const { id } = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const guard = requireSuperAdminForTenant(authz, id);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let form: FormData;
  try { form = await req.formData(); }
  catch { return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 }); }
  const uploads = uploadsFromFormData(form);
  if (uploads.length === 0) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

  let stored: StoredFile[] = [];
  try {
    const exists = await withTenantRls(prisma, id, (tx) => tx.tenant.findUnique({ where: { id }, select: { id: true } }));
    if (!exists) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    const types = await withTenantRls(prisma, id, (tx) => listAttachmentTypes(tx, { activeOnly: true }));
    const problem = await attachmentUploadProblem(uploads, types, { requireMandatory: false });
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });

    stored = await storeAttachmentFiles(id, uploads);
    await withTenantRls(prisma, id, (tx) => insertTenantAttachments(tx, id, uploads, stored, authz.userId ?? null));
    return NextResponse.json({ ok: true, added: uploads.length }, { status: 201 });
  } catch (e) {
    await removeStoredFiles(stored);
    if (e instanceof AttachmentsNotMigratedError) return NextResponse.json({ error: e.message }, { status: 503 });
    console.error('[tenant attachments POST]', e);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const POST = withAuditedAction(handlePOST);
