export const dynamic = 'force-dynamic';

/**
 * DELETE /api/admin/tenants/[id]/attachments/[attachmentId] — remove a
 * tenant document (soft delete; the file stays in storage for the audit
 * trail). Refused when it is the tenant's only document of a mandatory
 * type: upload the replacement first. Platform admin.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, requireSuperAdminForTenant } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';
import { AttachmentsNotMigratedError, listAttachmentTypes, listTenantAttachments } from '@/lib/tenant-attachments';

async function handleDELETE(req: NextRequest, props: { params: Promise<{ id: string; attachmentId: string }> }) {
  const { id, attachmentId } = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const guard = requireSuperAdminForTenant(authz, id);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  try {
    return await withTenantRls(prisma, id, async (tx) => {
      const attachments = await listTenantAttachments(tx, id);
      const target = attachments.find((a) => a.id === attachmentId);
      if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });

      const type = (await listAttachmentTypes(tx, { activeOnly: true })).find((t) => t.id === target.attachmentTypeId);
      const sameType = attachments.filter((a) => a.attachmentTypeId === target.attachmentTypeId).length;
      if (type?.isMandatory && sameType <= 1) {
        return NextResponse.json(
          { error: `${type.name} is mandatory: upload the replacement before removing this one` },
          { status: 409 },
        );
      }
      await tx.$executeRawUnsafe(
        `UPDATE tenant_attachments SET deleted_at = now() WHERE id = $1::uuid AND tenant_id = $2`,
        attachmentId, id,
      );
      return NextResponse.json({ ok: true });
    });
  } catch (e) {
    if (e instanceof AttachmentsNotMigratedError) return NextResponse.json({ error: e.message }, { status: 503 });
    return NextResponse.json({ error: 'Failed to remove attachment' }, { status: 500 });
  }
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const DELETE = withAuditedAction(handleDELETE);
