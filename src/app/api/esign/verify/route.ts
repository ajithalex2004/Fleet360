import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import crypto from 'crypto';

/**
 * E-Signing — Verify / OTP API
 *
 * POST /api/esign/verify
 *   body: { signingToken, otpCode, signerIp?, signerUserAgent? }  — verify OTP and sign
 *   body: { signingToken, action: 'resend' }                       — resend / regenerate OTP
 *
 * GET  /api/esign/verify?signingToken=X — fetch signing request info (used by signing page)
 */

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
  otp_code: string;
  otp_expires_at: string;
  status: string;
  signed_at: string | null;
  signer_ip: string | null;
  signer_user_agent: string | null;
  sent_via: string;
  resend_count: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

// ── GET — fetch signing request info ────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const signingToken = searchParams.get('signingToken') ?? '';

    if (!signingToken) {
      return NextResponse.json({ error: 'signingToken is required' }, { status: 400 });
    }

    const rows = await prisma.$queryRawUnsafe<EsignRow[]>(`
      SELECT
        id, signing_token, contract_id, contract_type, contract_ref,
        document_title, signer_name, signer_email, signer_phone,
        otp_expires_at, status, signed_at, sent_via, resend_count,
        notes, created_at, updated_at
      FROM esign_requests
      WHERE signing_token = $1
      LIMIT 1
    `, signingToken);

    if (!rows.length) {
      return NextResponse.json({ error: 'Signing request not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    const row = rows[0];

    // Check expiry for PENDING requests
    if (row.status === 'PENDING') {
      const expired = new Date(row.otp_expires_at) < new Date();
      if (expired) {
        // Mark as EXPIRED in DB
        await prisma.$executeRawUnsafe(`
          UPDATE esign_requests SET status = 'EXPIRED', updated_at = NOW()
          WHERE signing_token = $1 AND status = 'PENDING'
        `, signingToken);
        row.status = 'EXPIRED';
      }
    }

    // Return info (without OTP code for security)
    return NextResponse.json({
      id: row.id,
      signingToken: row.signing_token,
      contractId: row.contract_id,
      contractType: row.contract_type,
      contractRef: row.contract_ref,
      documentTitle: row.document_title,
      signerName: row.signer_name,
      signerEmail: row.signer_email,
      signerPhone: row.signer_phone,
      otpExpiresAt: row.otp_expires_at,
      status: row.status,
      signedAt: row.signed_at,
      sentVia: row.sent_via,
      resendCount: row.resend_count,
      createdAt: row.created_at,
    });

  } catch (err: unknown) {
    console.error('[esign/verify GET]', err);
    return NextResponse.json({ error: 'Failed to fetch signing request' }, { status: 500 });
  }
}

// ── POST — verify OTP or resend ──────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { signingToken, action, otpCode, signerIp, signerUserAgent } = body;

    if (!signingToken) {
      return NextResponse.json({ error: 'signingToken is required' }, { status: 400 });
    }

    // ── RESEND action ─────────────────────────────────────────────────────────
    if (action === 'resend') {
      const rows = await prisma.$queryRawUnsafe<EsignRow[]>(`
        SELECT id, status, resend_count FROM esign_requests
        WHERE signing_token = $1
        LIMIT 1
      `, signingToken);

      if (!rows.length) {
        return NextResponse.json({ error: 'Signing request not found', code: 'NOT_FOUND' }, { status: 404 });
      }

      const row = rows[0];

      if (row.status !== 'PENDING') {
        return NextResponse.json(
          { error: `Cannot resend OTP for a ${row.status} request`, code: 'INVALID_STATUS' },
          { status: 400 }
        );
      }

      if (row.resend_count >= 5) {
        return NextResponse.json(
          { error: 'Maximum resend attempts reached', code: 'MAX_RESEND' },
          { status: 429 }
        );
      }

      // Generate new OTP
      const newOtp = String(Math.floor(100000 + Math.random() * 900000)).padStart(6, '0');

      await prisma.$executeRawUnsafe(`
        UPDATE esign_requests
        SET otp_code = $1,
            otp_expires_at = NOW() + INTERVAL '30 minutes',
            resend_count = resend_count + 1,
            updated_at = NOW()
        WHERE signing_token = $2
      `, newOtp, signingToken);

      return NextResponse.json({
        success: true,
        otpCode: newOtp,    // DEMO only — in production deliver via SMS/WhatsApp
        expiresInMinutes: 30,
        message: 'New OTP generated successfully.',
      });
    }

    // ── VERIFY OTP action ─────────────────────────────────────────────────────
    if (!otpCode) {
      return NextResponse.json({ error: 'otpCode is required' }, { status: 400 });
    }

    const rows = await prisma.$queryRawUnsafe<EsignRow[]>(`
      SELECT
        id, signing_token, contract_id, contract_type, contract_ref,
        document_title, signer_name, signer_email, signer_phone,
        otp_code, otp_expires_at, status, resend_count
      FROM esign_requests
      WHERE signing_token = $1 AND status = 'PENDING'
      LIMIT 1
    `, signingToken);

    if (!rows.length) {
      // Check if it already exists but in non-PENDING state
      const anyRows = await prisma.$queryRawUnsafe<{ status: string; signed_at: string | null }[]>(`
        SELECT status, signed_at FROM esign_requests WHERE signing_token = $1 LIMIT 1
      `, signingToken);

      if (anyRows.length && anyRows[0].status === 'SIGNED') {
        return NextResponse.json({ error: 'Document already signed', code: 'ALREADY_SIGNED' }, { status: 409 });
      }
      if (anyRows.length && anyRows[0].status === 'CANCELLED') {
        return NextResponse.json({ error: 'Signing request cancelled', code: 'CANCELLED' }, { status: 410 });
      }
      return NextResponse.json({ error: 'Signing request not found or already processed', code: 'NOT_FOUND' }, { status: 404 });
    }

    const row = rows[0];

    // Check OTP expiry
    const now = new Date();
    const expiresAt = new Date(row.otp_expires_at);
    if (expiresAt < now) {
      await prisma.$executeRawUnsafe(`
        UPDATE esign_requests SET status = 'EXPIRED', updated_at = NOW()
        WHERE signing_token = $1 AND status = 'PENDING'
      `, signingToken);
      return NextResponse.json({ error: 'OTP has expired. Please request a new OTP.', code: 'EXPIRED' }, { status: 410 });
    }

    // Compare OTP (plain-text demo — use bcrypt in production)
    if (row.otp_code !== String(otpCode).trim()) {
      return NextResponse.json({ error: 'Invalid OTP. Please try again.', code: 'INVALID' }, { status: 422 });
    }

    // OTP is valid — mark as SIGNED
    const signedAt = new Date().toISOString();
    await prisma.$executeRawUnsafe(`
      UPDATE esign_requests
      SET status = 'SIGNED',
          signed_at = NOW(),
          signer_ip = $1,
          signer_user_agent = $2,
          updated_at = NOW()
      WHERE signing_token = $3
    `,
      signerIp ?? null,
      signerUserAgent ?? null,
      signingToken,
    );

    return NextResponse.json({
      success: true,
      contractRef: row.contract_ref,
      contractType: row.contract_type,
      documentTitle: row.document_title,
      signerName: row.signer_name,
      signedAt,
    });

  } catch (err: unknown) {
    console.error('[esign/verify POST]', err);
    return NextResponse.json({ error: 'Failed to process OTP verification' }, { status: 500 });
  }
}
