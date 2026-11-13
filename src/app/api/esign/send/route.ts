export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { withTenantRls, type TxClient } from '@/lib/rls';
import { runOutsideRlsScope } from '@/lib/rls-scope';
import { prisma } from '@/lib/prisma';
import { withSavepoint } from '@/lib/rental/locks';
import { sendEmail } from '@/lib/email';
import { sendWhatsAppMessage } from '@/lib/whatsapp/twilio-client';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';

/**
 * E-Signing — Send / Request API
 *
 * POST /api/esign/send  — create a new signing request
 * GET  /api/esign/send?contractId=X&contractType=Y — list signing requests for a contract
 */

const VALID_CONTRACT_TYPES = [
  'LEASE_AGREEMENT',
  'RENTAL_AGREEMENT',
  'LEASE_QUOTATION',
  'RENTAL_QUOTATION',
] as const;

const VALID_CHANNELS = ['SMS', 'WHATSAPP', 'EMAIL'] as const;

function resolveAppOrigin(req: NextRequest): string {
  const configured = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '').trim();
  const base = configured || req.nextUrl.origin;
  return base.replace(/\/$/, '');
}

async function verifyTargetContractOwnership(
  tx: TxClient,
  tenantId: string,
  contractType: string,
  contractId: string,
): Promise<boolean> {
  const cid = String(contractId).trim();
  if (!cid) return false;

  switch (contractType) {
    case 'RENTAL_AGREEMENT': {
      const rows = await withSavepoint(
        tx,
        'esign_send_chk_rac_agr',
        () =>
          tx.$queryRawUnsafe<Array<{ id: string }>>(
            `SELECT id::text AS id
               FROM rental_agreements
              WHERE id::text = $1
                AND tenant_id::text = $2
                AND deleted_at IS NULL
              LIMIT 1`,
            cid,
            tenantId,
          ),
        [],
      );
      return rows.length > 0;
    }

    case 'LEASE_AGREEMENT': {
      const v2Rows = await withSavepoint(
        tx,
        'esign_send_chk_lease_v2',
        () =>
          tx.$queryRawUnsafe<Array<{ id: string }>>(
            `SELECT id::text AS id
               FROM lease_contracts_v2
              WHERE id::text = $1
                AND tenant_id::text = $2
                AND deleted_at IS NULL
              LIMIT 1`,
            cid,
            tenantId,
          ),
        [],
      );
      if (v2Rows.length > 0) return true;

      const v1Rows = await withSavepoint(
        tx,
        'esign_send_chk_lease_v1',
        () =>
          tx.$queryRawUnsafe<Array<{ id: string }>>(
            `SELECT id::text AS id
               FROM lease_contracts
              WHERE id::text = $1
                AND tenant_id::text = $2
              LIMIT 1`,
            cid,
            tenantId,
          ),
        [],
      );
      return v1Rows.length > 0;
    }

    case 'RENTAL_QUOTATION': {
      const quoteRows = await withSavepoint(
        tx,
        'esign_send_chk_rac_quote',
        () =>
          tx.$queryRawUnsafe<Array<{ id: string }>>(
            `SELECT id::text AS id
               FROM rental_quotations
              WHERE id::text = $1
                AND tenant_id::text = $2
                AND deleted_at IS NULL
              LIMIT 1`,
            cid,
            tenantId,
          ),
        [],
      );
      if (quoteRows.length > 0) return true;

      const rateQuoteRows = await withSavepoint(
        tx,
        'esign_send_chk_rac_rate_quote',
        () =>
          tx.$queryRawUnsafe<Array<{ id: string }>>(
            `SELECT id::text AS id
               FROM rental_rate_quotes
              WHERE id::text = $1
                AND tenant_id::text = $2
              LIMIT 1`,
            cid,
            tenantId,
          ),
        [],
      );
      return rateQuoteRows.length > 0;
    }

    case 'LEASE_QUOTATION': {
      const leaseQuoteRows = await withSavepoint(
        tx,
        'esign_send_chk_lease_quote',
        () =>
          tx.$queryRawUnsafe<Array<{ id: string }>>(
            `SELECT id::text AS id
               FROM lease_quotations
              WHERE id::text = $1
                AND tenant_id::text = $2
                AND deleted_at IS NULL
              LIMIT 1`,
            cid,
            tenantId,
          ),
        [],
      );
      return leaseQuoteRows.length > 0;
    }

    default:
      return false;
  }
}

async function dispatchEsignOtp(args: {
  req: NextRequest;
  sentVia: string;
  signerName: string;
  signerEmail: string | null;
  signerPhone: string;
  documentTitle: string;
  contractRef: string;
  otpCode: string;
  signingToken: string;
}): Promise<boolean> {
  const fullSigningUrl = `${resolveAppOrigin(args.req)}/sign/${args.signingToken}`;
  const channel = String(args.sentVia || 'SMS').trim().toUpperCase();

  try {
    if (channel === 'EMAIL' && args.signerEmail) {
      const emailRes = await runOutsideRlsScope(() =>
        sendEmail({
          to: args.signerEmail!.trim(),
          subject: `Digital E-Signature OTP (${args.contractRef}) — ${args.documentTitle}`,
          text: [
            `Hello ${args.signerName},`,
            '',
            `Your 6-digit One-Time Password (OTP) to digitally sign "${args.documentTitle}" (Ref: ${args.contractRef}) is:`,
            '',
            `  ${args.otpCode}`,
            '',
            'Open your secure signing link (valid for 30 minutes):',
            fullSigningUrl,
            '',
            'Do not share this OTP with anyone.',
          ].join('\n'),
          html: `<div style="font-family:Arial,sans-serif;max-width:560px;line-height:1.5;color:#0f172a">
            <h2 style="margin:0 0 12px">Digital E-Signature Verification</h2>
            <p>Hello <strong>${args.signerName.replace(/[<>&"]/g, '')}</strong>,</p>
            <p>Use the 6-digit One-Time Password below to sign <strong>${args.documentTitle.replace(/[<>&"]/g, '')}</strong> (Ref: <code>${args.contractRef.replace(/[<>&"]/g, '')}</code>):</p>
            <div style="margin:20px 0;padding:16px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;text-align:center;font-size:28px;font-weight:bold;letter-spacing:6px;color:#1d4ed8">
              ${args.otpCode}
            </div>
            <p style="margin:20px 0">
              <a href="${fullSigningUrl}" style="display:inline-block;padding:12px 20px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:bold">
                Review &amp; Sign Document
              </a>
            </p>
            <p style="font-size:12px;color:#64748b">This OTP expires in 30 minutes.</p>
          </div>`,
        }),
      );
      return Boolean(emailRes.sent);
    }

    if (channel === 'WHATSAPP' && args.signerPhone) {
      const waRes = await sendWhatsAppMessage(
        args.signerPhone.trim(),
        `Smart Mobility E-Sign: Your OTP for ${args.documentTitle} (${args.contractRef}) is ${args.otpCode}. Sign securely within 30 mins: ${fullSigningUrl}`,
      );
      return Boolean(waRes?.sid);
    }

    return false;
  } catch (err) {
    console.warn('[esign/send] Outbound OTP dispatch failed:', err);
    return false;
  }
}

// ── POST — create signing request ────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

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

    const normalizedSentVia = String(sentVia || 'SMS').trim().toUpperCase();
    if (!(VALID_CHANNELS as readonly string[]).includes(normalizedSentVia)) {
      return NextResponse.json(
        { error: `Invalid sentVia channel. Must be one of: ${VALID_CHANNELS.join(', ')}` },
        { status: 400 },
      );
    }

    if (!contractId || !contractType || !contractRef || !documentTitle || !signerName) {
      return NextResponse.json(
        {
          error:
            'Missing required fields: contractId, contractType, contractRef, documentTitle, signerName',
        },
        { status: 400 },
      );
    }

    if (normalizedSentVia === 'EMAIL' && !String(signerEmail ?? '').trim()) {
      return NextResponse.json(
        { error: 'signerEmail is required when sentVia is EMAIL' },
        { status: 400 },
      );
    }

    if (normalizedSentVia !== 'EMAIL' && !String(signerPhone ?? '').trim()) {
      return NextResponse.json(
        { error: 'Missing required fields: signerPhone' },
        { status: 400 },
      );
    }

    if (!(VALID_CONTRACT_TYPES as readonly string[]).includes(contractType)) {
      return NextResponse.json(
        { error: `Invalid contractType. Must be one of: ${VALID_CONTRACT_TYPES.join(', ')}` },
        { status: 400 },
      );
    }

    // Generate signing token (32-char hex = 16 random bytes)
    const signingToken = crypto.randomBytes(16).toString('hex');

    // Generate cryptographically secure 6-digit OTP
    const otpCode = String(crypto.randomInt(100000, 1000000)).padStart(6, '0');

    const txResult = await withTenantRls(prisma, tenantId, async (tx) => {
      const targetExists = await verifyTargetContractOwnership(
        tx,
        tenantId,
        contractType,
        String(contractId),
      );
      if (!targetExists) {
        return { kind: 'not_found' as const };
      }

      type InsertRow = { id: string };
      const rows = await tx.$queryRawUnsafe<InsertRow[]>(
        `INSERT INTO esign_requests (
           tenant_id, signing_token, contract_id, contract_type, contract_ref,
           document_title, signer_name, signer_email, signer_phone,
           otp_code, otp_expires_at, status, sent_via, notes
         ) VALUES (
           $1, $2, $3, $4,
           $5, $6, $7, $8,
           $9, $10, NOW() + INTERVAL '30 minutes', 'PENDING', $11, $12
         )
         RETURNING id`,
        tenantId,
        signingToken,
        String(contractId),
        contractType,
        String(contractRef),
        String(documentTitle),
        String(signerName),
        signerEmail ? String(signerEmail).trim() : null,
        String(signerPhone ?? '').trim(),
        otpCode,
        normalizedSentVia,
        notes ?? null,
      );

      return { kind: 'created' as const, id: rows[0]?.id };
    });

    if (txResult.kind === 'not_found') {
      return NextResponse.json(
        { error: 'Target contract or quotation not found for this tenant' },
        { status: 404 },
      );
    }

    // Dispatch OTP outside the RLS transaction so SMTP/HTTP calls never hold a DB connection
    const dispatched = await dispatchEsignOtp({
      req,
      sentVia: normalizedSentVia,
      signerName: String(signerName),
      signerEmail: signerEmail ? String(signerEmail).trim() : null,
      signerPhone: String(signerPhone ?? '').trim(),
      documentTitle: String(documentTitle),
      contractRef: String(contractRef),
      otpCode,
      signingToken,
    });

    const signingUrl = `/sign/${signingToken}`;

    return NextResponse.json(
      {
        success: true,
        id: txResult.id,
        signingToken,
        signingUrl,
        dispatched,
        ...(process.env.NODE_ENV !== 'production' ? { otpCode } : {}),
        expiresInMinutes: 30,
        message: dispatched
          ? `Signing request created. OTP dispatched via ${normalizedSentVia}.`
          : `Signing request created (${normalizedSentVia} transport not configured — share signing link directly).`,
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('[esign/send POST]', err);
    return NextResponse.json({ error: 'Failed to create signing request' }, { status: 500 });
  }
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
      const contractId = searchParams.get('contractId') ?? '';
      const contractType = searchParams.get('contractType') ?? '';

      const conds: string[] = ['tenant_id = $1'];
      const params: unknown[] = [tenantId];
      let pi = 2;

      if (contractId) {
        conds.push(`contract_id = $${pi++}`);
        params.push(contractId);
      }
      if (contractType) {
        conds.push(`contract_type = $${pi++}`);
        params.push(contractType);
      }

      const where = `WHERE ${conds.join(' AND ')}`;

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

      const rows = await tx.$queryRawUnsafe<EsignRow[]>(
        `SELECT
           id, signing_token, contract_id, contract_type, contract_ref,
           document_title, signer_name, signer_email, signer_phone,
           otp_expires_at, status, signed_at, sent_via, resend_count,
           notes, created_at
         FROM esign_requests
         ${where}
         ORDER BY created_at DESC
         LIMIT 100`,
        ...params,
      );

      return NextResponse.json({ data: rows, count: rows.length });
    } catch (err) {
      console.error('[esign/send GET]', err);
      return NextResponse.json({ error: 'Failed to fetch signing requests' }, { status: 500 });
    }
  });
}
