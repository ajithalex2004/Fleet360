/**
 * Domain Verification — PRE-REGISTRATION (Email OTP only)
 *
 * POST /api/tenants/pre-verify-domain
 *   Body: { domain: string }
 *   → Generates a verification token, stores a temporary record,
 *     returns { id, domain }
 *
 * POST /api/tenants/pre-verify-domain?action=send-otp
 *   Body: { id: string, email: string }
 *   → Generates a 6-digit OTP, stores it, sends via platform SMTP settings.
 *
 * POST /api/tenants/pre-verify-domain?action=verify-otp
 *   Body: { id: string, otp: string }
 *   → Checks OTP, marks verified.
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function genId(): string    { return crypto.randomUUID(); }
function genToken(): string { return crypto.randomBytes(20).toString('hex'); }
function genOtp(): string   { return String(Math.floor(100000 + Math.random() * 900000)); }

/**
 * Ensure the temp table exists.
 * All columns that would need DB extensions use explicit defaults from JS instead.
 * The CREATE TABLE uses no gen_random_uuid() — id is always passed explicitly.
 */
async function ensureTable(): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS domain_pre_verifications (
        id              TEXT PRIMARY KEY,
        domain          TEXT NOT NULL,
        token           TEXT NOT NULL,
        otp             TEXT,
        otp_email       TEXT,
        otp_expires_at  TIMESTAMPTZ,
        verified        BOOLEAN NOT NULL DEFAULT false,
        verified_method TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
      )
    `);
  } catch (e) {
    // Log but do not throw — the table may already exist or CREATE TABLE
    // may fail due to permissions. Subsequent DML will surface the real error.
    console.warn('[pre-verify-domain] ensureTable warning:', e);
  }
}

// ── POST — all actions ────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  await ensureTable();

  const url    = request.nextUrl;
  const action = url.searchParams.get('action');

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

      // Send OTP via platform SMTP (fire and forget on error — code is stored in DB)
      await sendOtpEmail(email, otp, rec.domain).catch(err => {
        console.error('[pre-verify-domain] sendOtpEmail failed:', err);
      });

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

// ── OTP email sender ──────────────────────────────────────────────────────────

async function sendOtpEmail(toEmail: string, otp: string, domain: string): Promise<void> {
  // Load platform SMTP settings from DB
  type SettingRow = { key: string; value: string };
  let rows: SettingRow[] = [];
  try {
    rows = await prisma.$queryRawUnsafe<SettingRow[]>(
      `SELECT key, value FROM platform_settings WHERE key LIKE 'smtp_%' OR key LIKE 'email_%'`,
    );
  } catch {
    // platform_settings may not exist yet
  }

  const s: Record<string, string> = {};
  for (const r of rows) s[r.key] = r.value;

  const host       = s['smtp_host'];
  const port       = parseInt(s['smtp_port'] || '587', 10);
  const username   = s['smtp_username'];
  const password   = s['smtp_password'];
  const encryption = s['smtp_encryption'] || 'tls';
  const fromName   = s['email_from_name'] || 'XL AI Smart Mobility';
  const fromAddr   = username || s['email_from_address'] || '';

  if (!host || !username || !password) {
    // SMTP not configured — OTP is stored in DB; log for operator reference
    console.warn('[pre-verify-domain] SMTP not configured. OTP for', toEmail, '→', otp);
    return;
  }

  const nodemailer = await import('nodemailer');
  const secure     = encryption === 'ssl';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const transportOptions: Record<string, any> = {
    host, port, secure,
    auth: { user: username, pass: password },
    connectionTimeout: 10_000,
    socketTimeout:     10_000,
  };

  if (host.includes('office365') || host.includes('outlook.com') || host.includes('exchange')) {
    transportOptions.requireTLS = true;
    transportOptions.tls        = { ciphers: 'SSLv3', rejectUnauthorized: false };
  } else if (encryption === 'tls') {
    transportOptions.tls = { rejectUnauthorized: false };
  }

  const transporter = nodemailer.default.createTransport(transportOptions);

  await transporter.sendMail({
    from:    `"${fromName}" <${fromAddr}>`,
    to:      toEmail,
    subject: `${otp} — Your domain verification code`,
    html: `
      <!DOCTYPE html>
      <html>
      <body style="font-family:Arial,sans-serif;background:#0f172a;color:#e2e8f0;padding:40px;margin:0;">
        <div style="max-width:460px;margin:0 auto;background:#1e293b;border-radius:12px;padding:32px;border:1px solid rgba(255,255,255,0.1);">
          <h2 style="color:#60a5fa;margin-top:0;font-size:20px;">Domain Verification</h2>
          <p style="color:#94a3b8;margin-bottom:8px;">
            You're registering <strong style="color:#e2e8f0;">${domain}</strong> on the XL AI Smart Mobility platform.
          </p>
          <p style="color:#94a3b8;">Enter this code to verify you own the domain:</p>
          <div style="background:#0f172a;border-radius:8px;padding:24px;text-align:center;margin:24px 0;border:1px solid rgba(96,165,250,0.3);">
            <span style="font-size:36px;font-weight:700;letter-spacing:8px;color:#60a5fa;font-family:monospace;">${otp}</span>
          </div>
          <p style="color:#64748b;font-size:12px;margin:0;">
            This code expires in 15 minutes. If you didn't request this, you can safely ignore it.
          </p>
        </div>
      </body>
      </html>
    `,
  });
}
