export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { withPlatformAdmin, withTenantRls, type TxClient } from '@/lib/rls';
import { runOutsideRlsScope } from '@/lib/rls-scope';
import { prisma } from '@/lib/prisma';
import { withSavepoint } from '@/lib/rental/locks';
import { RateLimiter } from '@/lib/rate-limiter';
import { logAudit } from '@/lib/audit';
import { sendEmail } from '@/lib/email';
import { sendWhatsAppMessage } from '@/lib/whatsapp/twilio-client';
import { stripTenantOwnershipFields } from '@/lib/tenant-context';

function resolveAppOrigin(req: NextRequest): string {
  const configured = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '').trim();
  const base = configured || req.nextUrl.origin;
  return base.replace(/\/$/, '');
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
            `Your new 6-digit One-Time Password (OTP) to digitally sign "${args.documentTitle}" (Ref: ${args.contractRef}) is:`,
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
        `Smart Mobility E-Sign: Your new OTP for ${args.documentTitle} (${args.contractRef}) is ${args.otpCode}. Sign securely within 30 mins: ${fullSigningUrl}`,
      );
      return Boolean(waRes?.sid);
    }

    return false;
  } catch (err) {
    console.warn('[esign/verify] Outbound OTP resend dispatch failed:', err);
    return false;
  }
}

/**
 * E-Signing — Verify / OTP API (Public Capability-Token Flow)
 *
 * POST /api/esign/verify
 *   body: { signingToken, otpCode, signerIp?, signerUserAgent? }  — verify OTP and sign
 *   body: { signingToken, action: 'resend' }                       — resend / regenerate OTP
 *
 * GET  /api/esign/verify?signingToken=X — fetch signing request info (used by public /sign/[token] page)
 */

const MAX_FAILED_OTP_ATTEMPTS = 5;

const getIpLimiter = new RateLimiter({ windowMs: 15 * 60_000, maxRequests: 30 });
const getTokenLimiter = new RateLimiter({ windowMs: 15 * 60_000, maxRequests: 20 });
const postIpLimiter = new RateLimiter({ windowMs: 15 * 60_000, maxRequests: 15 });
const postTokenLimiter = new RateLimiter({ windowMs: 15 * 60_000, maxRequests: 10 });

// In-memory brute-force fallback in case failed_attempts DDL column is unavailable
const failedOtpFallbackMap = new Map<string, number>();
let failedAttemptsColumnEnsured = false;

interface EsignContractSummary {
  startDate: string;
  endDate: string;
  vehicleLabel: string;
  totalAmount: number;
  currency: string;
  securityDeposit: number | null;
}

type EsignRow = {
  id: string;
  tenant_id: string | null;
  signing_token: string;
  contract_id: string;
  contract_type: string;
  contract_ref: string;
  document_title: string;
  signer_name: string;
  signer_email: string | null;
  signer_phone: string;
  otp_code: string;
  otp_expires_at: string;
  status: string;
  signed_at: string | null;
  signer_ip: string | null;
  signer_user_agent: string | null;
  sent_via: string;
  resend_count: number;
  failed_attempts?: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

class EsignTargetNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EsignTargetNotFoundError';
  }
}

function extractClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}

function hashSigningToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 32);
}

async function enforceEsignRateLimit(
  req: NextRequest,
  method: 'GET' | 'POST',
  signingToken?: string,
): Promise<NextResponse | null> {
  const ip = extractClientIp(req);
  const ipRes =
    method === 'GET'
      ? await getIpLimiter.check(`esign:get:ip:${ip}`)
      : await postIpLimiter.check(`esign:post:ip:${ip}`);

  if (!ipRes.allowed) {
    const retryAfter = Math.max(1, Math.ceil((ipRes.resetMs - Date.now()) / 1000));
    return NextResponse.json(
      {
        error: 'Too many verification requests. Please wait before trying again.',
        code: 'RATE_LIMITED',
      },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    );
  }

  if (signingToken) {
    const tokenHash = hashSigningToken(signingToken);
    const tokRes =
      method === 'GET'
        ? await getTokenLimiter.check(`esign:get:tok:${tokenHash}`)
        : await postTokenLimiter.check(`esign:post:tok:${tokenHash}`);

    if (!tokRes.allowed) {
      const retryAfter = Math.max(1, Math.ceil((tokRes.resetMs - Date.now()) / 1000));
      return NextResponse.json(
        {
          error: 'Too many attempts for this signing link. Please wait before trying again.',
          code: 'RATE_LIMITED',
        },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } },
      );
    }
  }

  return null;
}

function validateRowTenantId(tenantId: string | null | undefined): string | null {
  const trimmed = tenantId?.trim();
  if (!trimmed || /[^a-zA-Z0-9_-]/.test(trimmed)) return null;
  return trimmed;
}

function maskEmailAddress(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim();
  const atIdx = trimmed.indexOf('@');
  if (atIdx <= 0 || atIdx === trimmed.length - 1) return null;
  const local = trimmed.slice(0, atIdx);
  const domain = trimmed.slice(atIdx + 1);
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visible}***@${domain}`;
}

async function ensureFailedAttemptsColumn(): Promise<void> {
  if (failedAttemptsColumnEnsured) return;
  try {
    await runOutsideRlsScope(() =>
      withPlatformAdmin(prisma, (tx) =>
        withSavepoint(
          tx,
          'esign_ensure_failed_attempts_col',
          () =>
            tx.$executeRawUnsafe(
              `ALTER TABLE esign_requests ADD COLUMN IF NOT EXISTS failed_attempts INT NOT NULL DEFAULT 0`,
            ),
          0,
        ),
      ),
    );
    failedAttemptsColumnEnsured = true;
  } catch {
    // Non-fatal: in-memory fallback map still protects against brute force
  }
}

async function lookupEsignByToken(signingToken: string): Promise<EsignRow | null> {
  await ensureFailedAttemptsColumn();
  const rows = await runOutsideRlsScope(() =>
    withPlatformAdmin(prisma, async (tx) => {
      const withAttempts = await withSavepoint<EsignRow[] | null>(
        tx,
        'esign_lookup_with_attempts',
        () =>
          tx.$queryRawUnsafe<EsignRow[]>(
            `SELECT
               id::text AS id,
               tenant_id,
               signing_token,
               contract_id,
               contract_type,
               contract_ref,
               document_title,
               signer_name,
               signer_email,
               signer_phone,
               otp_code,
               otp_expires_at,
               status,
               signed_at,
               signer_ip,
               signer_user_agent,
               sent_via,
               resend_count,
               failed_attempts,
               notes,
               created_at,
               updated_at
             FROM esign_requests
             WHERE signing_token = $1
             LIMIT 1`,
            signingToken,
          ),
        null,
      );
      if (withAttempts !== null) return withAttempts;

      return tx.$queryRawUnsafe<EsignRow[]>(
        `SELECT
           id::text AS id,
           tenant_id,
           signing_token,
           contract_id,
           contract_type,
           contract_ref,
           document_title,
           signer_name,
           signer_email,
           signer_phone,
           otp_code,
           otp_expires_at,
           status,
           signed_at,
           signer_ip,
           signer_user_agent,
           sent_via,
           resend_count,
           notes,
           created_at,
           updated_at
         FROM esign_requests
         WHERE signing_token = $1
         LIMIT 1`,
        signingToken,
      );
    }),
  );
  return rows[0] ?? null;
}

function rejectOperatorTenantMismatch(
  req: NextRequest,
  expectedTenantId: string,
): NextResponse | null {
  const callerTenant = req.headers.get('x-tenant-id')?.trim();
  const callerRole = req.headers.get('x-user-role')?.trim()?.toUpperCase();
  if (callerTenant && callerRole !== 'SUPER_ADMIN' && callerTenant !== expectedTenantId) {
    return NextResponse.json({ error: 'Forbidden: tenant mismatch' }, { status: 403 });
  }
  return null;
}

async function runInVerifiedTenantScope<T>(
  validTenantId: string,
  fn: (tx: TxClient) => Promise<T>,
): Promise<T> {
  return runOutsideRlsScope(() => withTenantRls(prisma, validTenantId, fn));
}

function verifyOtpConstantTime(expectedOtp: string, providedOtp: string): boolean {
  const a = Buffer.from(String(expectedOtp).trim(), 'utf8');
  const b = Buffer.from(String(providedOtp).trim(), 'utf8');
  if (a.length === 0 || a.length !== b.length) {
    const ha = crypto.createHash('sha256').update(a).digest();
    const hb = crypto.createHash('sha256').update(b).digest();
    crypto.timingSafeEqual(ha, hb);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

async function fetchRentalContractSummary(
  validTenantId: string,
  contractId: string,
): Promise<EsignContractSummary | null> {
  if (!contractId) return null;
  return runInVerifiedTenantScope(validTenantId, async (tx) => {
    const softDeleteRows = await withSavepoint<Array<{ deleted_at: unknown }> | null>(
      tx,
      'esign_fetch_rac_soft_del',
      () =>
        tx.$queryRawUnsafe<Array<{ deleted_at: unknown }>>(
          `SELECT deleted_at
             FROM rental_agreements
            WHERE id::text = $1
              AND tenant_id::text = $2
            LIMIT 1`,
          contractId,
          validTenantId,
        ),
      null,
    );
    if (softDeleteRows && (!softDeleteRows[0] || softDeleteRows[0].deleted_at != null)) {
      return null;
    }

    const agreement = await withSavepoint(
      tx,
      'esign_fetch_rac_summary',
      () =>
        tx.rentalAgreement.findFirst({
          where: {
            id: contractId,
            tenantId: validTenantId,
          },
        }),
      null,
    );
    if (!agreement) return null;

    const vehicle = agreement.vehicleId
      ? await withSavepoint(
          tx,
          'esign_fetch_rac_vehicle',
          () =>
            tx.vehicle.findFirst({
              where: { id: agreement.vehicleId!, tenantId: validTenantId },
            }),
          null,
        )
      : null;

    const vehicleLabel = vehicle
      ? [
          vehicle.year ? String(vehicle.year) : '',
          vehicle.make,
          vehicle.model,
          vehicle.licensePlate ? `(${vehicle.licensePlate})` : '',
        ]
          .filter(Boolean)
          .join(' ')
      : 'Corporate Rental Vehicle';

    return {
      startDate: new Date(agreement.startDate).toISOString(),
      endDate: new Date(agreement.endDate).toISOString(),
      vehicleLabel,
      totalAmount: Number(agreement.totalAmount ?? 0),
      currency: agreement.currency || 'AED',
      securityDeposit:
        agreement.securityDeposit != null ? Number(agreement.securityDeposit) : null,
    };
  });
}

async function syncSignedTargetContract(args: {
  tx: TxClient;
  validTenantId: string;
  contractType: string;
  contractId: string;
  signerLabel: string;
  auditNote: string;
}): Promise<number> {
  const { tx, validTenantId, contractId, signerLabel, auditNote } = args;
  const contractTypeUpper = String(args.contractType ?? '').trim().toUpperCase();
  const cid = String(contractId ?? '').trim();
  if (!cid) return 0;

  if (['RENTAL_AGREEMENT', 'RENTAL', 'RAC'].includes(contractTypeUpper)) {
    const updatedWithRemarks = await withSavepoint<number | null>(
      tx,
      'esign_sync_rac_agreement_remarks',
      () =>
        tx.$executeRawUnsafe(
          `UPDATE rental_agreements
              SET signed_at = NOW(),
                  signed_by = $1,
                  remarks = CASE
                    WHEN remarks IS NULL OR remarks = '' THEN $2
                    ELSE remarks || E'\n' || $2
                  END,
                  updated_at = NOW()
            WHERE id::text = $3
              AND tenant_id::text = $4
              AND deleted_at IS NULL`,
          signerLabel,
          auditNote,
          cid,
          validTenantId,
        ),
      null,
    );
    if (updatedWithRemarks !== null) return updatedWithRemarks;

    return withSavepoint(
      tx,
      'esign_sync_rac_agreement_basic',
      () =>
        tx.$executeRawUnsafe(
          `UPDATE rental_agreements
              SET signed_at = NOW(),
                  signed_by = $1,
                  updated_at = NOW()
            WHERE id::text = $2
              AND tenant_id::text = $3
              AND deleted_at IS NULL`,
          signerLabel,
          cid,
          validTenantId,
        ),
      0,
    );
  }

  if (
    ['LEASE_AGREEMENT', 'LEASE_CONTRACT', 'LEASING', 'LEASE'].includes(contractTypeUpper)
  ) {
    const v2Updated = await withSavepoint(
      tx,
      'esign_sync_lease_v2',
      () =>
        tx.$executeRawUnsafe(
          `UPDATE lease_contracts_v2
              SET updated_at = NOW(),
                  notes = CASE
                    WHEN COALESCE(notes, '') LIKE '%[OTP E-SIGN%' THEN notes
                    ELSE CONCAT_WS(E'\n', NULLIF(notes, ''), $1)
                  END
            WHERE id::text = $2
              AND tenant_id::text = $3
              AND deleted_at IS NULL`,
          auditNote,
          cid,
          validTenantId,
        ),
      0,
    );
    if (v2Updated > 0) return v2Updated;

    return withSavepoint(
      tx,
      'esign_sync_lease_v1',
      () =>
        tx.$executeRawUnsafe(
          `UPDATE lease_contracts
              SET signed_at = NOW(),
                  updated_at = NOW()
            WHERE id::text = $1
              AND tenant_id::text = $2`,
          cid,
          validTenantId,
        ),
      0,
    );
  }

  if (contractTypeUpper === 'RENTAL_QUOTATION') {
    const quoteUpdated = await withSavepoint(
      tx,
      'esign_sync_rac_quotation',
      () =>
        tx.$executeRawUnsafe(
          `UPDATE rental_quotations
              SET status = CASE
                    WHEN UPPER(COALESCE(status, 'DRAFT')) IN ('DRAFT', 'SENT', 'PENDING') THEN 'ACCEPTED'
                    ELSE status
                  END,
                  accepted_at = COALESCE(accepted_at, NOW()),
                  notes = CONCAT_WS(E'\n', NULLIF(notes, ''), $1),
                  updated_at = NOW()
            WHERE id::text = $2
              AND tenant_id::text = $3
              AND deleted_at IS NULL`,
          auditNote,
          cid,
          validTenantId,
        ),
      0,
    );
    if (quoteUpdated > 0) return quoteUpdated;

    return withSavepoint(
      tx,
      'esign_sync_rac_rate_quote',
      () =>
        tx.$executeRawUnsafe(
          `UPDATE rental_rate_quotes
              SET breakdown = breakdown
            WHERE id::text = $1
              AND tenant_id::text = $2`,
          cid,
          validTenantId,
        ),
      0,
    );
  }

  if (contractTypeUpper === 'LEASE_QUOTATION') {
    return withSavepoint(
      tx,
      'esign_sync_lease_quotation',
      () =>
        tx.$executeRawUnsafe(
          `UPDATE lease_quotations
              SET customer_approved_at = COALESCE(customer_approved_at, NOW()),
                  status = CASE
                    WHEN UPPER(COALESCE(status, 'NEW')) IN ('NEW', 'SENT_TO_CUSTOMER', 'DRAFT') THEN 'CUSTOMER_APPROVED'
                    ELSE status
                  END,
                  notes = CONCAT_WS(E'\n', NULLIF(notes, ''), $1),
                  updated_at = NOW()
            WHERE id::text = $2
              AND tenant_id::text = $3
              AND deleted_at IS NULL`,
          auditNote,
          cid,
          validTenantId,
        ),
      0,
    );
  }

  return 0;
}

// ── GET — fetch signing request info ────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const signingToken = (searchParams.get('signingToken') ?? '').trim();

    const rl = await enforceEsignRateLimit(req, 'GET', signingToken || undefined);
    if (rl) return rl;

    if (!signingToken) {
      return NextResponse.json({ error: 'signingToken is required' }, { status: 400 });
    }

    const row = await lookupEsignByToken(signingToken);
    if (!row) {
      return NextResponse.json(
        { error: 'Signing request not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    const validTenantId = validateRowTenantId(row.tenant_id);
    if (!validTenantId) {
      return NextResponse.json(
        { error: 'Signing request is missing a valid tenant scope', code: 'INVALID_TENANT' },
        { status: 403 },
      );
    }

    const mismatch = rejectOperatorTenantMismatch(req, validTenantId);
    if (mismatch) return mismatch;

    // Check expiry for PENDING requests
    if (row.status === 'PENDING' && new Date(row.otp_expires_at) < new Date()) {
      await runInVerifiedTenantScope(validTenantId, (tx) =>
        tx.$executeRawUnsafe(
          `UPDATE esign_requests
              SET status = 'EXPIRED', updated_at = NOW()
            WHERE signing_token = $1
              AND tenant_id = $2
              AND status = 'PENDING'`,
          signingToken,
          validTenantId,
        ),
      );
      row.status = 'EXPIRED';
    }

    const contractSummary =
      String(row.contract_type ?? '').trim().toUpperCase() === 'RENTAL_AGREEMENT'
        ? await fetchRentalContractSummary(validTenantId, row.contract_id)
        : null;

    // Return info (never expose otp_code)
    return NextResponse.json({
      id: row.id,
      signingToken: row.signing_token,
      contractId: row.contract_id,
      contractType: row.contract_type,
      contractRef: row.contract_ref,
      documentTitle: row.document_title,
      signerName: row.signer_name,
      signerEmail: row.signer_email,
      signerEmailMasked: maskEmailAddress(row.signer_email),
      signerPhone: row.signer_phone,
      otpExpiresAt: row.otp_expires_at,
      status: row.status,
      signedAt: row.signed_at,
      sentVia: row.sent_via,
      resendCount: row.resend_count,
      createdAt: row.created_at,
      contractSummary,
    });
  } catch (err) {
    console.error('[esign/verify GET]', err);
    return NextResponse.json({ error: 'Failed to fetch signing request' }, { status: 500 });
  }
}

// ── POST — verify OTP or resend ──────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const bodyRaw = await req.json();
    const body = stripTenantOwnershipFields(bodyRaw);
    const { action, otpCode, signerIp, signerUserAgent } = body;
    const signingToken = String(body.signingToken ?? '').trim();

    const rl = await enforceEsignRateLimit(req, 'POST', signingToken || undefined);
    if (rl) return rl;

    if (!signingToken) {
      return NextResponse.json({ error: 'signingToken is required' }, { status: 400 });
    }

    const row = await lookupEsignByToken(signingToken);
    if (!row) {
      return NextResponse.json(
        { error: 'Signing request not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    const validTenantId = validateRowTenantId(row.tenant_id);
    if (!validTenantId) {
      return NextResponse.json(
        { error: 'Signing request is missing a valid tenant scope', code: 'INVALID_TENANT' },
        { status: 403 },
      );
    }

    const mismatch = rejectOperatorTenantMismatch(req, validTenantId);
    if (mismatch) return mismatch;

    // ── RESEND action ─────────────────────────────────────────────────────────
    if (action === 'resend') {
      if (row.status !== 'PENDING' && row.status !== 'EXPIRED') {
        return NextResponse.json(
          { error: `Cannot resend OTP for a ${row.status} request`, code: 'INVALID_STATUS' },
          { status: 400 },
        );
      }

      if (Number(row.resend_count ?? 0) >= 5) {
        return NextResponse.json(
          { error: 'Maximum resend attempts reached', code: 'MAX_RESEND' },
          { status: 429 },
        );
      }

      const newOtp = String(crypto.randomInt(100000, 1000000)).padStart(6, '0');
      const tokenHash = hashSigningToken(signingToken);

      await runInVerifiedTenantScope(validTenantId, async (tx) => {
        const updatedWithReset = await withSavepoint<number | null>(
          tx,
          'esign_resend_with_failed_reset',
          () =>
            tx.$executeRawUnsafe(
              `UPDATE esign_requests
                  SET status = 'PENDING',
                      otp_code = $1,
                      otp_expires_at = NOW() + INTERVAL '30 minutes',
                      resend_count = resend_count + 1,
                      failed_attempts = 0,
                      updated_at = NOW()
                WHERE signing_token = $2
                  AND tenant_id = $3
                  AND status IN ('PENDING', 'EXPIRED')`,
              newOtp,
              signingToken,
              validTenantId,
            ),
          null,
        );
        if (updatedWithReset === null) {
          await tx.$executeRawUnsafe(
            `UPDATE esign_requests
                SET status = 'PENDING',
                    otp_code = $1,
                    otp_expires_at = NOW() + INTERVAL '30 minutes',
                    resend_count = resend_count + 1,
                    updated_at = NOW()
              WHERE signing_token = $2
                AND tenant_id = $3
                AND status IN ('PENDING', 'EXPIRED')`,
            newOtp,
            signingToken,
            validTenantId,
          );
        }
      });

      failedOtpFallbackMap.delete(tokenHash);

      const dispatched = await dispatchEsignOtp({
        req,
        sentVia: row.sent_via,
        signerName: row.signer_name,
        signerEmail: row.signer_email,
        signerPhone: row.signer_phone,
        documentTitle: row.document_title,
        contractRef: row.contract_ref,
        otpCode: newOtp,
        signingToken,
      });

      return NextResponse.json({
        success: true,
        dispatched,
        ...(process.env.NODE_ENV !== 'production' ? { otpCode: newOtp } : {}),
        expiresInMinutes: 30,
        message: dispatched
          ? `New OTP dispatched via ${row.sent_via}.`
          : 'New OTP generated successfully.',
      });
    }

    // ── VERIFY OTP action ─────────────────────────────────────────────────────
    if (!otpCode) {
      return NextResponse.json({ error: 'otpCode is required' }, { status: 400 });
    }

    if (row.status === 'SIGNED') {
      return NextResponse.json(
        { error: 'Document already signed', code: 'ALREADY_SIGNED' },
        { status: 409 },
      );
    }
    if (row.status === 'CANCELLED') {
      return NextResponse.json(
        { error: 'Signing request cancelled', code: 'CANCELLED' },
        { status: 410 },
      );
    }
    if (row.status !== 'PENDING') {
      if (row.status === 'EXPIRED') {
        return NextResponse.json(
          { error: 'OTP has expired. Please request a new OTP.', code: 'EXPIRED' },
          { status: 410 },
        );
      }
      return NextResponse.json(
        { error: 'Signing request not found or already processed', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    // Check OTP expiry
    const now = new Date();
    const expiresAt = new Date(row.otp_expires_at);
    if (expiresAt < now) {
      await runInVerifiedTenantScope(validTenantId, (tx) =>
        tx.$executeRawUnsafe(
          `UPDATE esign_requests
              SET status = 'EXPIRED', updated_at = NOW()
            WHERE signing_token = $1
              AND tenant_id = $2
              AND status = 'PENDING'`,
          signingToken,
          validTenantId,
        ),
      );
      return NextResponse.json(
        { error: 'OTP has expired. Please request a new OTP.', code: 'EXPIRED' },
        { status: 410 },
      );
    }

    // Constant-time OTP verification + brute-force lockout after 5 wrong guesses
    const tokenHash = hashSigningToken(signingToken);
    if (!verifyOtpConstantTime(row.otp_code, String(otpCode))) {
      const priorDbAttempts = Number(row.failed_attempts ?? 0);
      const priorMemAttempts = failedOtpFallbackMap.get(tokenHash) ?? 0;
      const nextAttempts = Math.max(priorDbAttempts, priorMemAttempts) + 1;
      failedOtpFallbackMap.set(tokenHash, nextAttempts);

      const lockedOut = nextAttempts >= MAX_FAILED_OTP_ATTEMPTS;

      await runInVerifiedTenantScope(validTenantId, async (tx) => {
        const updatedCol = await withSavepoint<number | null>(
          tx,
          'esign_inc_failed_attempts',
          () =>
            tx.$executeRawUnsafe(
              `UPDATE esign_requests
                  SET failed_attempts = COALESCE(failed_attempts, 0) + 1,
                      status = CASE
                        WHEN COALESCE(failed_attempts, 0) + 1 >= $1 THEN 'EXPIRED'
                        ELSE status
                      END,
                      updated_at = NOW()
                WHERE signing_token = $2
                  AND tenant_id = $3
                  AND status = 'PENDING'`,
              MAX_FAILED_OTP_ATTEMPTS,
              signingToken,
              validTenantId,
            ),
          null,
        );

        if (updatedCol === null && lockedOut) {
          await tx.$executeRawUnsafe(
            `UPDATE esign_requests
                SET status = 'EXPIRED', updated_at = NOW()
              WHERE signing_token = $1
                AND tenant_id = $2
                AND status = 'PENDING'`,
            signingToken,
            validTenantId,
          );
        }
      });

      if (lockedOut) {
        return NextResponse.json(
          {
            error:
              'Too many incorrect OTP attempts. This OTP has been invalidated; please request a new OTP.',
            code: 'EXPIRED',
            attemptsRemaining: 0,
          },
          { status: 410 },
        );
      }

      return NextResponse.json(
        {
          error: 'Invalid OTP. Please try again.',
          code: 'INVALID',
          attemptsRemaining: Math.max(0, MAX_FAILED_OTP_ATTEMPTS - nextAttempts),
        },
        { status: 422 },
      );
    }

    const resolvedIp =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      (signerIp ? String(signerIp) : null);
    const resolvedUa =
      (signerUserAgent ? String(signerUserAgent) : null) ||
      req.headers.get('user-agent') ||
      null;
    const signedAt = new Date().toISOString();
    const signerLabel = row.signer_name || row.signer_email || 'Customer';
    const auditNote = `[OTP E-SIGN ${signedAt}] Signed by ${signerLabel} (${
      row.signer_phone || row.signer_email || 'verified'
    }) IP=${resolvedIp ?? 'unknown'} Ref=${row.id}`;

    const claimed = await runInVerifiedTenantScope(validTenantId, async (tx) => {
      const updatedRows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `UPDATE esign_requests
            SET status = 'SIGNED',
                signed_at = NOW(),
                signer_ip = $1,
                signer_user_agent = $2,
                updated_at = NOW()
          WHERE signing_token = $3
            AND tenant_id = $4
            AND status = 'PENDING'
          RETURNING id::text AS id`,
        resolvedIp,
        resolvedUa,
        signingToken,
        validTenantId,
      );
      if (!updatedRows.length) {
        return false;
      }

      const targetUpdated = await syncSignedTargetContract({
        tx,
        validTenantId,
        contractType: row.contract_type,
        contractId: row.contract_id,
        signerLabel,
        auditNote,
      });

      if (targetUpdated === 0) {
        // Roll back the entire transaction so esign_requests is NOT marked SIGNED
        // when the underlying contract/quotation does not exist or belongs to another tenant.
        throw new EsignTargetNotFoundError(
          `Underlying ${row.contract_type} (${row.contract_id}) not found for tenant`,
        );
      }

      return true;
    });

    if (!claimed) {
      return NextResponse.json(
        { error: 'Document already signed', code: 'ALREADY_SIGNED' },
        { status: 409 },
      );
    }

    failedOtpFallbackMap.delete(tokenHash);

    void logAudit({
      tenantId: validTenantId,
      entityType: row.contract_type || 'EsignRequest',
      entityId: row.contract_id,
      entityName: row.contract_ref,
      userName: row.signer_name,
      userEmail: row.signer_email ?? undefined,
      action: 'UPDATE',
      ipAddress: resolvedIp ?? undefined,
      userAgent: resolvedUa ?? undefined,
      details: auditNote,
    });

    return NextResponse.json({
      success: true,
      contractRef: row.contract_ref,
      contractType: row.contract_type,
      documentTitle: row.document_title,
      signerName: row.signer_name,
      signedAt,
    });
  } catch (err) {
    if (err instanceof EsignTargetNotFoundError) {
      return NextResponse.json(
        {
          error:
            'The underlying contract or quotation could not be found or is no longer eligible for signing.',
          code: 'CONTRACT_NOT_FOUND',
        },
        { status: 404 },
      );
    }
    console.error('[esign/verify POST]', err);
    return NextResponse.json({ error: 'Failed to process OTP verification' }, { status: 500 });
  }
}
