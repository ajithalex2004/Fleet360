export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/admin/attachment-types/[id]/autofill
 * multipart/form-data: file, and tenantId when the tenant already exists.
 *
 * Reads the Document Number and Expiry Date from a document of this
 * attachment type and returns them as suggestions (src/lib/tenant-
 * attachments-autofill.ts). Stores nothing: the file is uploaded with the
 * tenant (Create Tenant) or with "Upload" (Manage) as before.
 *
 * Returns { status: 'skipped' } when the platform setting
 * ff_attachment_autofill is off, or the tenant's data must stay in a region
 * (the document would be sent to the AI provider). Platform admin.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';
import { AttachmentsNotMigratedError, attachmentFileProblem, listAttachmentTypes } from '@/lib/tenant-attachments';
import { autofillAttachment } from '@/lib/tenant-attachments-autofill';

const noStore = { 'Cache-Control': 'no-store' };

async function autofillEnabled(): Promise<boolean> {
  try {
    const rows = await withPlatformAdmin(prisma, (tx) => tx.$queryRawUnsafe<{ value: string }[]>(
      `SELECT value FROM platform_settings WHERE key = 'ff_attachment_autofill'`,
    ));
    return rows[0]?.value !== 'false';
  } catch {
    return true; // no settings row/table yet: the default is on
  }
}

async function handlePOST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });

  let form: FormData;
  try { form = await req.formData(); }
  catch { return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 }); }
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
  const tenantId = typeof form.get('tenantId') === 'string' ? (form.get('tenantId') as string) : '';

  try {
    if (!(await autofillEnabled())) {
      return NextResponse.json({ status: 'skipped', reason: 'Document reading is switched off in Platform Settings.' }, { headers: noStore });
    }

    const type = (await withPlatformAdmin(prisma, (tx) => listAttachmentTypes(tx, { activeOnly: true })))
      .find((t) => t.id === id);
    if (!type) return NextResponse.json({ error: 'Unknown or inactive attachment type' }, { status: 404 });

    const problem = await attachmentFileProblem(file);
    if (problem) return NextResponse.json({ error: `${type.name}: ${problem}` }, { status: 400 });

    if (tenantId) {
      const tenant = await withPlatformAdmin(prisma, (tx) =>
        tx.tenant.findUnique({ where: { id: tenantId }, select: { dataResidency: true } }));
      if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
      if ((tenant.dataResidency ?? 'GLOBAL') !== 'GLOBAL') {
        return NextResponse.json(
          { status: 'skipped', reason: `Not read automatically: this tenant's data must stay in ${tenant.dataResidency}.` },
          { headers: noStore },
        );
      }
    }

    const result = await autofillAttachment(
      { base64: Buffer.from(await file.arrayBuffer()).toString('base64'), mimeType: file.type || 'application/pdf', fileName: file.name },
      type,
    );
    return NextResponse.json(result, { headers: noStore });
  } catch (e) {
    if (e instanceof AttachmentsNotMigratedError) return NextResponse.json({ error: e.message }, { status: 503 });
    console.error('[attachment autofill]', e);
    return NextResponse.json({ status: 'unavailable', reason: 'The document could not be read right now.' }, { headers: noStore });
  }
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const POST = withAuditedAction(handlePOST);
