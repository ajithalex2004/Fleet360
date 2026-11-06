export const dynamic = 'force-dynamic';

/**
 * Domain Verification — PRE-REGISTRATION (Email OTP & AI Document Autofill)
 *
 * POST /api/tenants/pre-verify-domain
 *   Body: { domain: string }
 *   → Generates a verification token, stores a temporary record,
 *     returns { id, domain }
 *
 * POST /api/tenants/pre-verify-domain?action=send-otp
 *   Body: { id: string, email: string }
 *   → Generates a 6-digit OTP, stores it, emails it (template
 *     account.domain_verification_code, platform email sender).
 *
 * POST /api/tenants/pre-verify-domain?action=verify-otp
 *   Body: { id: string, otp: string }
 *   → Checks OTP, marks verified.
 *
 * POST /api/tenants/pre-verify-domain?action=autofill-document
 *   Body: { base64: string, mimeType?: string, fileName?: string, docType?: 'TRADE_LICENSE' | 'VAT_CERTIFICATE' | 'CORPORATE_TAX_CERTIFICATE' | 'AUTO' }
 *   → Extracts UAE Company Trade License & FTA VAT Certificate fields via PDF text + AI Vision during company registration.
 *
 * Public endpoint — no auth required (pre-registration).
 *
 * Records stored in domain_pre_verifications table (auto-created if missing).
 * IDs are always generated in JavaScript — no dependency on DB extensions.
 * Records expire after 24 hours and are never linked to a real tenant.
 * When provisioning a tenant, pass preVerificationId to skip post-registration email.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import crypto from 'crypto';
import { NO_TENANT, sendTemplatedEmail } from '@/lib/email-templates';
import { autofillCompanyDocument } from '@/lib/tenant-attachments-autofill';

// ── Helpers ───────────────────────────────────────────────────────────────────

function genId(): string    { return crypto.randomUUID(); }
function genToken(): string { return crypto.randomBytes(20).toString('hex'); }
function genOtp(): string   { return String(crypto.randomInt(100000, 1000000)); }

// ── POST — all actions ────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const url    = request.nextUrl;
  const action = url.searchParams.get('action');

  // ── autofill-document (Company Registration AI Extraction) ──────────────────
  if (action === 'autofill-document') {
    try {
      const body = await request.json() as {
        base64?: string;
        mimeType?: string;
        fileName?: string;
        docType?: 'TRADE_LICENSE' | 'VAT_CERTIFICATE' | 'CORPORATE_TAX_CERTIFICATE' | 'AUTO';
      };

      const rawBase64 = typeof body.base64 === 'string' ? body.base64.trim() : '';
      const base64 = rawBase64.includes(',') ? rawBase64.split(',')[1] : rawBase64;
      if (!base64) {
        return NextResponse.json({ error: 'base64 document content is required' }, { status: 400 });
      }

      const buf = Buffer.from(base64, 'base64');
      if (buf.byteLength === 0 || buf.byteLength > 10 * 1024 * 1024) {
        return NextResponse.json({ error: 'Document must be between 1 byte and 10 MB' }, { status: 400 });
      }

      const mimeType = body.mimeType || (body.fileName?.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');
      const fileName = body.fileName || 'company-document.pdf';
      const docType =
        body.docType === 'TRADE_LICENSE' ||
        body.docType === 'VAT_CERTIFICATE' ||
        body.docType === 'CORPORATE_TAX_CERTIFICATE'
          ? body.docType
          : 'AUTO';

      const result = await autofillCompanyDocument({ base64, mimeType, fileName }, docType);
      return NextResponse.json(result);
    } catch (err) {
      console.error('[pre-verify-domain] autofill-document error:', err);
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  // ── send-otp ────────────────────────────────────────────────────────────────
  if (action === 'send-otp') {
    try {
      const { id, email } = await request.json() as { id?: string; email?: string };

      if (!id || !email) {
        return NextResponse.json({ error: 'id and email are required' }, { status: 400 });
      }

      type Row = { id: string; domain: string; verified: boolean; expires_at: string };
      const rows = await prisma.$queryRawUnsafe<Row[]>(
        `SELECT id, domain, verified, expires_at FROM domain_pre_verifications WHERE id = $1`, id,
      );

      if (!rows.length) {
        return NextResponse.json({ error: 'Verification session not found. Please refresh and try again.' }, { status: 404 });
      }

      const rec = rows[0];

      if (rec.verified) {
        return NextResponse.json({ ok: true, alreadyVerified: true });
      }

      if (new Date(rec.expires_at) < new Date()) {
        return NextResponse.json({ error: 'Verification session expired. Please start again.' }, { status: 410 });
      }

      // Email domain must match the registered domain
      const emailDomain = email.split('@')[1]?.toLowerCase() ?? '';
      const domainClean = rec.domain.replace(/^www\./, '').toLowerCase();
      if (emailDomain !== domainClean) {
        return NextResponse.json(
          { error: `Email must be at your company domain (@${domainClean})` },
          { status: 400 },
        );
      }

      const otp      = genOtp();
      const otpExpiry = new Date(Date.now() + 15 * 60 * 1000); // 15 min

      await prisma.$executeRawUnsafe(
        `UPDATE domain_pre_verifications SET otp = $1, otp_email = $2, otp_expires_at = $3::timestamptz WHERE id = $4`,
        otp, email, otpExpiry.toISOString(), id,
      );

      // The platform's wording (Admin > Email templates > Account), sent
      // through the platform email sender. The code is never logged.
      const sent = await sendTemplatedEmail({
        tenantId: NO_TENANT,
        key: 'account.domain_verification_code',
        to: email,
        values: { code: otp, domain: rec.domain, validMinutes: '15' },
      });
      if (!sent.sent) {
        return NextResponse.json(
          { error: 'We could not send the verification email. Please try again later or contact support.' },
          { status: 503 },
        );
      }

      return NextResponse.json({ ok: true, sentTo: email });
    } catch (err) {
      console.error('[pre-verify-domain] send-otp error:', err);
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  // ── verify-otp ──────────────────────────────────────────────────────────────
  if (action === 'verify-otp') {
    try {
      const { id, otp } = await request.json() as { id?: string; otp?: string };

      if (!id || !otp) {
        return NextResponse.json({ error: 'id and otp are required' }, { status: 400 });
      }

      type OtpRow = { id: string; otp: string | null; otp_expires_at: string | null; verified: boolean };
      const rows = await prisma.$queryRawUnsafe<OtpRow[]>(
        `SELECT id, otp, otp_expires_at, verified FROM domain_pre_verifications WHERE id = $1`, id,
      );

      if (!rows.length) {
        return NextResponse.json({ error: 'Verification session not found.' }, { status: 404 });
      }

      const rec = rows[0];

      if (rec.verified) {
        return NextResponse.json({ ok: true, verified: true });
      }

      if (!rec.otp) {
        return NextResponse.json({ error: 'No code has been sent yet. Request a code first.' }, { status: 400 });
      }

      if (rec.otp_expires_at && new Date(rec.otp_expires_at) < new Date()) {
        return NextResponse.json({ error: 'Code has expired. Request a new one.' }, { status: 410 });
      }

      if (rec.otp !== otp.trim()) {
        return NextResponse.json({ error: 'Incorrect code. Please try again.' }, { status: 401 });
      }

      await prisma.$executeRawUnsafe(
        `UPDATE domain_pre_verifications SET verified = true, verified_method = 'EMAIL_OTP' WHERE id = $1`, id,
      );

      return NextResponse.json({ ok: true, verified: true });
    } catch (err) {
      console.error('[pre-verify-domain] verify-otp error:', err);
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  // ── default POST — initiate domain session ───────────────────────────────────
  try {
    const body = await request.json() as { domain?: string };
    const { domain } = body;

    if (!domain) {
      return NextResponse.json({ error: 'domain is required' }, { status: 400 });
    }

    const domainClean  = domain.replace(/^www\./, '').toLowerCase().trim();
    const domainPattern = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]?\.[a-zA-Z]{2,}$/;
    if (!domainPattern.test(domainClean)) {
      return NextResponse.json({ error: 'Invalid domain format (e.g. acmetransport.com)' }, { status: 400 });
    }

    // Clean up expired records for this domain
    await prisma.$executeRawUnsafe(
      `DELETE FROM domain_pre_verifications WHERE domain = $1 AND expires_at < NOW()`,
      domainClean,
    ).catch(() => {}); // ignore if table empty / doesn't exist yet

    // Reuse an existing unexpired & already-verified session
    type ExistingRow = { id: string; verified: boolean };
    const existing = await prisma.$queryRawUnsafe<ExistingRow[]>(
      `SELECT id, verified FROM domain_pre_verifications
       WHERE domain = $1 AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      domainClean,
    ).catch(() => [] as ExistingRow[]);

    if (existing.length && existing[0].verified) {
      return NextResponse.json({ id: existing[0].id, domain: domainClean, verified: true });
    }

    // Create a new session — generate id and token in JavaScript
    const id    = genId();
    const token = genToken();

    await prisma.$executeRawUnsafe(
      `INSERT INTO domain_pre_verifications (id, domain, token) VALUES ($1, $2, $3)`,
      id, domainClean, token,
    );

    return NextResponse.json({ id, domain: domainClean, verified: false });
  } catch (err) {
    console.error('[pre-verify-domain] initiate error:', err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
