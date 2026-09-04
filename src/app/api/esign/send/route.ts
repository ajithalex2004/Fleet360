export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import crypto from 'crypto';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
/**
 * E-Signing — Send / Request API
 *
 * POST /api/esign/send  — create a new signing request
 * GET  /api/esign/send?contractId=X&contractType=Y — list signing requests for a contract
 */

// ── POST — create signing request ────────────────────────────────────────────
export async function POST(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
        const {
          contractId,
          contractType,
          contractRef,
          documentTitle,
          signerName,
          signerEmail,
          signerPhone,
          sentVia = 'SMS',
          notes,
        } = body;

        // Validate required fields
        if (!contractId || !contractType || !contractRef || !documentTitle || !signerName || !signerPhone) {
          return NextResponse.json(
            { error: 'Missing required fields: contractId, contractType, contractRef, documentTitle, signerName, signerPhone' },
            { status: 400 }
          );
        }

        const validTypes = ['LEASE_AGREEMENT', 'RENTAL_AGREEMENT', 'LEASE_QUOTATION', 'RENTAL_QUOTATION'];
        if (!validTypes.includes(contractType)) {
          return NextResponse.json(
            { error: `Invalid contractType. Must be one of: ${validTypes.join(', ')}` },
            { status: 400 }
          );
        }

        // Generate signing token (32-char hex = 16 random bytes)
        const signingToken = crypto.randomBytes(16).toString('hex');

        // Generate 6-digit OTP
        const otpCode = String(Math.floor(100000 + Math.random() * 900000)).padStart(6, '0');

        type InsertRow = { id: string };
        const rows = await tx.$queryRawUnsafe<InsertRow[]>(`
          INSERT INTO esign_requests (
            tenant_id, signing_token, contract_id, contract_type, contract_ref,
            document_title, signer_name, signer_email, signer_phone,
            otp_code, otp_expires_at, status, sent_via, notes
          ) VALUES (
            $1, $2, $3, $4,
            $5, $6, $7, $8,
            $9, $10, NOW() + INTERVAL '30 minutes', 'PENDING', $11, $12
          )
          RETURNING id
        `,
          tenantId,
          signingToken,
          contractId,
          contractType,
          contractRef,
          documentTitle,
          signerName,
          signerEmail ?? null,
          signerPhone,
          otpCode,
          sentVia,
          notes ?? null,
        );

        const id = rows[0]?.id;
        const signingUrl = `/sign/${signingToken}`;

        return NextResponse.json({
          success: true,
          id,
          signingToken,
          signingUrl,
          otpCode,       // DEMO only — in production, deliver via SMS/WhatsApp
          expiresInMinutes: 30,
          message: `Signing request created. OTP sent via ${sentVia}.`,
        }, { status: 201 });
        } catch (err) {
        console.error('[esign/send POST]', err);
        return NextResponse.json({ error: 'Failed to create signing request' }, { status: 500 });
      }
  });
}


// ── GET — list signing requests for a contract ───────────────────────────────
export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const { searchParams } = new URL(req.url);
        const contractId   = searchParams.get('contractId')   ?? '';
        const contractType = searchParams.get('contractType') ?? '';

        const conds: string[] = [];
        const params: unknown[] = [];
        let pi = 1;

        if (contractId)   { conds.push(`contract_id = $${pi++}`);   params.push(contractId); }
        if (contractType) { conds.push(`contract_type = $${pi++}`); params.push(contractType); }

        const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

        type EsignRow = {
          id: string;
          signing_token: string;
          contract_id: string;
          contract_type: string;
          contract_ref: string;
          document_title: string;
          signer_name: string;
          signer_email: string | null;
          signer_phone: string;
          otp_expires_at: string;
          status: string;
          signed_at: string | null;
          sent_via: string;
          resend_count: number;
          notes: string | null;
          created_at: string;
        };

        const rows = await tx.$queryRawUnsafe<EsignRow[]>(`
          SELECT
            id, signing_token, contract_id, contract_type, contract_ref,
            document_title, signer_name, signer_email, signer_phone,
            otp_expires_at, status, signed_at, sent_via, resend_count,
            notes, created_at
          FROM esign_requests
          ${where}
          ORDER BY created_at DESC
          LIMIT 100
        `, ...params);

        return NextResponse.json({ data: rows, count: rows.length });
        } catch (err) {
        console.error('[esign/send GET]', err);
        return NextResponse.json({ error: 'Failed to fetch signing requests' }, { status: 500 });
      }
  });
}

