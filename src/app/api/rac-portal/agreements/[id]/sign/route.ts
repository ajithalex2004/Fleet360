export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { stripTenantOwnershipFields } from '@/lib/tenant-context';
import {
  FINANCE_SIGN_RAC_PORTAL_ROLES,
  requireRacPortalRole,
} from '../../../_helpers';

const ALLOWED_SIGNABLE_STATUSES = new Set(['DRAFT', 'ACTIVE', 'PENDING_SIGNATURE']);

const SignAgreementSchema = z.object({
  signerName: z.string().trim().min(2).max(120).optional(),
  signerTitle: z.string().trim().max(80).optional(),
  signatureDataUrl: z
    .string()
    .max(350_000)
    .refine(
      (val) => /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(val.trim()),
      'signatureDataUrl must be a base64 PNG, JPEG, or WebP data URI',
    )
    .optional(),
});

class SignConflictError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'SignConflictError';
    this.statusCode = statusCode;
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const ctx = await requireRacPortalRole(
    req,
    FINANCE_SIGN_RAC_PORTAL_ROLES,
    'Corporate Finance (RAC_B2B_FINANCE) or B2B Admin (RAC_B2B_ADMIN) role is required to digitally sign corporate rental agreements.',
  );
  if (ctx instanceof NextResponse) return ctx;

  try {
    const { id } = await context.params;
    const rawBody = await req.json().catch(() => null);
    const sanitizedBody =
      rawBody && typeof rawBody === 'object'
        ? stripTenantOwnershipFields(rawBody as Record<string, unknown>)
        : rawBody;
    const parsed = SignAgreementSchema.safeParse(sanitizedBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid digital signature payload' },
        { status: 400 },
      );
    }

    const { signerName, signerTitle, signatureDataUrl } = parsed.data;
    const effectiveSigner = signerName || ctx.user.fullName || ctx.user.email;
    if (!effectiveSigner && !signatureDataUrl) {
      return NextResponse.json(
        { error: 'Please provide your typed corporate signature or drawn signature' },
        { status: 400 },
      );
    }

    const sigDigest = crypto
      .createHash('sha256')
      .update(`${signatureDataUrl ?? effectiveSigner}:${ctx.user.email}:${id}`)
      .digest('hex')
      .slice(0, 16)
      .toUpperCase();

    const signedByLabel = signerTitle
      ? `${effectiveSigner} (${signerTitle} · ${ctx.user.email})`
      : `${effectiveSigner} (${ctx.user.email})`;

    const auditStamp = `[B2B Corporate E-Signed by ${signedByLabel} · Ref SIG-${sigDigest}]`;

    const updated = await withTenantRls(prisma, ctx.tenantId, async (tx) => {
      const existing = await tx.$queryRawUnsafe<
        Array<{
          id: string;
          agreement_no: string | null;
          status: string | null;
          signed_at: string | Date | null;
        }>
      >(
        `SELECT id, agreement_no, status, signed_at
           FROM rental_agreements
          WHERE id = $1
            AND tenant_id::text = $2
            AND customer_id = $3
            AND deleted_at IS NULL
          LIMIT 1
          FOR UPDATE`,
        id,
        ctx.tenantId,
        ctx.customerId,
      );
      const agr = existing[0];
      if (!agr) return null;

      if (agr.signed_at !== null) {
        throw new SignConflictError('Agreement has already been signed', 409);
      }

      const normStatus = String(agr.status ?? '').trim().toUpperCase();
      if (!ALLOWED_SIGNABLE_STATUSES.has(normStatus)) {
        throw new SignConflictError(
          `Cannot digitally sign an agreement in status ${agr.status ?? 'UNKNOWN'}`,
          409,
        );
      }

      const rows = await tx.$queryRawUnsafe<
        Array<{
          id: string;
          agreement_no: string | null;
          signed_at: string | Date;
          signed_by: string;
        }>
      >(
        `UPDATE rental_agreements
            SET signed_at = NOW(),
                signed_by = $1,
                remarks = CASE
                  WHEN remarks IS NULL OR remarks = '' THEN $2
                  ELSE remarks || E'\n' || $2
                END,
                updated_at = NOW()
          WHERE id = $3
            AND tenant_id::text = $4
            AND customer_id = $5
            AND signed_at IS NULL
          RETURNING id, agreement_no, signed_at, signed_by`,
        signedByLabel,
        auditStamp,
        id,
        ctx.tenantId,
        ctx.customerId,
      );
      if (!rows[0]) {
        throw new SignConflictError('Agreement has already been signed', 409);
      }
      return rows[0];
    });

    if (!updated) {
      return NextResponse.json({ error: 'Rental agreement not found' }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      agreement: {
        id: updated.id,
        agreementNo: updated.agreement_no,
        signedByCustomer: true,
        signedAt: new Date(updated.signed_at).toISOString(),
        signedBy: updated.signed_by,
        signatureRef: `SIG-${sigDigest}`,
      },
    });
  } catch (err) {
    if (err instanceof SignConflictError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    console.error('[rac-portal/agreements/[id]/sign] POST failed:', err);
    return NextResponse.json(
      { error: 'Failed to record digital signature' },
      { status: 500 },
    );
  }
}
