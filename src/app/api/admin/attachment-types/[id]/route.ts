export const dynamic = 'force-dynamic';

/**
 * PATCH /api/admin/attachment-types/[id] — update an attachment type
 * (name, mandatory, requires expiry, active, sort order). Platform admin.
 * The code is fixed once created; types are deactivated, not deleted.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';
import { AttachmentsNotMigratedError, listAttachmentTypes } from '@/lib/tenant-attachments';
import { attachmentTypeInput } from '@/lib/attachment-type-input';

const COLUMNS: Record<string, string> = {
  name: 'name', description: 'description', isMandatory: 'is_mandatory',
  requiresExpiry: 'requires_expiry', isActive: 'is_active', sortOrder: 'sort_order',
};

async function handlePATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });

  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === 'object' ? stripTenantOwnershipFields(raw) : raw;
  if (body && typeof body === 'object' && 'code' in body) {
    return NextResponse.json({ error: 'The code of an attachment type cannot be changed' }, { status: 400 });
  }
  const input = attachmentTypeInput(body, { partial: true });
  if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 });

  const entries = Object.entries(input.value).filter(([k]) => k in COLUMNS);
  const sets = entries.map(([k], i) => `${COLUMNS[k]} = $${i + 2}`).join(', ');
  try {
    const n = await withPlatformAdmin(prisma, async (tx) => {
      await listAttachmentTypes(tx); // surfaces a missing migration as 503
      return tx.$executeRawUnsafe(
        `UPDATE tenant_attachment_types SET ${sets}, updated_at = now() WHERE id = $1::uuid`,
        id, ...entries.map(([, v]) => v),
      );
    });
    if (!n) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AttachmentsNotMigratedError) return NextResponse.json({ error: e.message }, { status: 503 });
    console.error('[attachment-types PATCH]', e);
    return NextResponse.json({ error: 'Failed to update attachment type' }, { status: 500 });
  }
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const PATCH = withAuditedAction(handlePATCH);
