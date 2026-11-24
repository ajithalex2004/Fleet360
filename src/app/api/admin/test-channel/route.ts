export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/test-channel
 * Sends a real test email or SMS using the settings provided in the request body.
 * Settings are passed directly from the UI (unsaved state is fine — this tests the live form values).
 *
 * Body: { channel: 'email' | 'sms', settings: Record<string, string>, toEmail?: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';
import { smtpTlsOptions } from '@/lib/smtp-tls';
import {
  canReuseStoredSmtpPassword,
  canReuseStoredSmsAuthToken,
  redactPlatformSettingSecrets,
} from '@/lib/platform-settings-secrets';

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

const STORED_CHANNEL_KEYS = [
  'smtp_host',
  'smtp_port',
  'smtp_username',
  'smtp_encryption',
  'smtp_password',
  'sms_account_sid',
  'sms_auth_token',
] as const;

async function loadStoredChannelSettings(): Promise<Record<string, string>> {
  try {
    const rows = await withPlatformAdmin(prisma, (tx) =>
      tx.$queryRawUnsafe<Array<{ key: string; value: string }>>(
        `SELECT key, value FROM platform_settings WHERE key = ANY($1::text[])`,
        [...STORED_CHANNEL_KEYS],
      ),
    );
    const out: Record<string, string> = {};
    for (const r of rows) {
      out[r.key] = r.value ?? '';
    }
    return out;
  } catch {
    return {};
  }
}

async function handlePOST(request: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status, headers: NO_STORE_HEADERS });
  }
  if (authz.role !== 'SUPER_ADMIN') {
    return NextResponse.json(
      { error: 'Only a platform admin can test notification channels.' },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  try {
    let parsed: unknown;
    try {
      parsed = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400, headers: NO_STORE_HEADERS });
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const body = parsed as Record<string, unknown>;
    const channel = typeof body.channel === 'string' ? body.channel : '';
    const toEmail = typeof body.toEmail === 'string' ? body.toEmail : undefined;
    const rawSettings = body.settings;
    if (
      rawSettings !== undefined &&
      (typeof rawSettings !== 'object' || rawSettings === null || Array.isArray(rawSettings))
    ) {
      return NextResponse.json({ error: 'Invalid settings object.' }, { status: 400, headers: NO_STORE_HEADERS });
    }
    const settings: Record<string, string> = {};
    if (rawSettings && typeof rawSettings === 'object') {
      for (const [k, v] of Object.entries(rawSettings as Record<string, unknown>)) {
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
          settings[k] = String(v);
        }
      }
    }

    if (channel === 'email') {
      return await testEmail(settings, toEmail);
    }

    if (channel === 'sms') {
      return await testSms(settings);
    }

    return NextResponse.json({ error: `Unknown channel: ${channel}` }, { status: 400, headers: NO_STORE_HEADERS });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[test-channel]', redactPlatformSettingSecrets(msg));
    return NextResponse.json({ error: 'Channel test failed.' }, { status: 500, headers: NO_STORE_HEADERS });
  }
}

// ── Email test ────────────────────────────────────────────────────────────────

async function testEmail(
  settings: Record<string, string>,
  toEmail?: string,
): Promise<NextResponse> {
  const provider  = settings['email_provider'] ?? 'none';
  const fromName  = settings['email_from_name']    || 'Fleet360';
  // For SMTP, the authenticated sender MUST be the SMTP username (Exchange/O365 enforces this).
  // Fall back to email_from_address only for non-SMTP providers.
  const smtpUser  = settings['smtp_username'] || '';
  const fromAddr  = provider === 'smtp'
    ? (smtpUser || settings['email_from_address'] || '')
    : (settings['email_from_address'] || smtpUser || '');
  const recipient = toEmail || fromAddr;

  if (!recipient) {
    return NextResponse.json(
      { error: 'No recipient address. Fill in the "From Email" field or provide a toEmail.' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  if (provider === 'none') {
    return NextResponse.json(
      { error: 'Email provider is set to "none". Select SMTP or another provider first.' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  if (provider === 'smtp') {
    return await testSmtp(settings, fromName, fromAddr, recipient);
  }

  // For API-based providers (SendGrid, Mailgun, etc.) we can't test without
  // their SDK — return a helpful message.
  return NextResponse.json(
    { error: `Live testing for "${provider}" is not yet implemented. Use SMTP to verify connectivity.` },
    { status: 400, headers: NO_STORE_HEADERS },
  );
}

async function testSmtp(
  settings: Record<string, string>,
  fromName: string,
  fromAddr: string,
  recipient: string,
): Promise<NextResponse> {
  const host       = (settings['smtp_host'] ?? '').trim();
  const portRaw    = (settings['smtp_port'] ?? '587').trim() || '587';
  const port       = parseInt(portRaw, 10);
  const username   = (settings['smtp_username'] ?? '').trim();
  const encryption = (settings['smtp_encryption'] || 'tls').trim(); // tls | ssl | none
  const suppliedPassword = (settings['smtp_password'] ?? '').trim();

  if (!host || !username || !Number.isInteger(port) || port < 1 || port > 65535) {
    return NextResponse.json(
      { error: 'SMTP Host, valid Port, Username, and Password are all required.' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  let password = suppliedPassword;
  if (!password) {
    const stored = await loadStoredChannelSettings();
    const reuse = canReuseStoredSmtpPassword(stored, { host, port, username, encryption });
    if (!reuse.ok) {
      return NextResponse.json({ error: reuse.error }, { status: 400, headers: NO_STORE_HEADERS });
    }
    password = reuse.password;
  }

  try {
    const nodemailer = await import('nodemailer');

    const secure = encryption.toUpperCase() === 'SSL' || port === 465; // true only for implicit SSL (port 465)
    const transportOptions: Record<string, unknown> = {
      host,
      port,
      secure,
      auth: { user: username, pass: password },
      connectionTimeout: 10_000,
      socketTimeout:     10_000,
    };

    // Same TLS options as real sends (certificate verified).
    Object.assign(transportOptions, smtpTlsOptions(host, encryption));

    const transporter = nodemailer.default.createTransport(transportOptions as Parameters<typeof nodemailer.default.createTransport>[0]);

    // Verify connection before sending
    await transporter.verify();

    // Send the actual test email
    const info = await transporter.sendMail({
      from:    `"${fromName}" <${fromAddr}>`,
      to:      recipient,
      subject: '✅ Fleet360 — SMTP Test Successful',
      html: `
        <!DOCTYPE html>
        <html>
        <body style="font-family:Arial,sans-serif;background:#0f172a;color:#e2e8f0;padding:40px;margin:0;">
          <div style="max-width:480px;margin:0 auto;background:#1e293b;border-radius:12px;padding:32px;border:1px solid rgba(255,255,255,0.1);">
            <h2 style="color:#22c55e;margin-top:0;font-size:20px;">✅ SMTP Connection Verified</h2>
            <p style="color:#94a3b8;">Your email configuration is working correctly.</p>
            <table style="width:100%;border-collapse:collapse;margin:20px 0;">
              <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                <td style="padding:8px 4px;color:#64748b;font-size:12px;width:120px;">SMTP Host</td>
                <td style="padding:8px 4px;color:#e2e8f0;font-size:12px;font-family:monospace;">${host}:${port}</td>
              </tr>
              <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                <td style="padding:8px 4px;color:#64748b;font-size:12px;">Username</td>
                <td style="padding:8px 4px;color:#e2e8f0;font-size:12px;font-family:monospace;">${username}</td>
              </tr>
              <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                <td style="padding:8px 4px;color:#64748b;font-size:12px;">Encryption</td>
                <td style="padding:8px 4px;color:#e2e8f0;font-size:12px;">${encryption.toUpperCase()}</td>
              </tr>
              <tr>
                <td style="padding:8px 4px;color:#64748b;font-size:12px;">Sent to</td>
                <td style="padding:8px 4px;color:#e2e8f0;font-size:12px;">${recipient}</td>
              </tr>
            </table>
            <hr style="border-color:rgba(255,255,255,0.1);margin:24px 0;"/>
            <p style="color:#475569;font-size:11px;margin:0;">
              Fleet360 Platform — Notification Settings Test<br/>
              Sent at ${new Date().toUTCString()}
            </p>
          </div>
        </body>
        </html>
      `,
    });

    return NextResponse.json(
      {
        ok: true,
        message: `Test email delivered to ${recipient}`,
        messageId: info.messageId,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    const msg = redactPlatformSettingSecrets(rawMsg, [
      password,
      `${username}:${password}`,
      `\0${username}\0${password}`,
    ]);
    console.error('[test-channel/smtp]', msg);

    // Give actionable error messages for common failures
    let friendly = msg;
    if (msg.includes('ECONNREFUSED'))  friendly = `Connection refused on ${host}:${port}. Check the host and port.`;
    else if (msg.includes('ETIMEDOUT')) friendly = `Connection timed out to ${host}:${port}. Check the host or firewall.`;
    else if (msg.includes('535') || msg.includes('Authentication')) friendly = `Authentication failed. Check your username and password.`;
    else if (msg.includes('STARTTLS'))  friendly = `The server requires STARTTLS. Set Encryption to "TLS".`;
    else if (msg.includes('certificate')) friendly = `SSL certificate error: ${msg}`;

    return NextResponse.json({ error: friendly }, { status: 502, headers: NO_STORE_HEADERS });
  }
}

// ── SMS test ──────────────────────────────────────────────────────────────────

async function testSms(settings: Record<string, string>): Promise<NextResponse> {
  const provider = settings['sms_provider'] ?? 'none';

  if (provider === 'none') {
    return NextResponse.json(
      { error: 'SMS provider is set to "none". Select a provider first.' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  if (provider === 'twilio') {
    const sid   = (settings['sms_account_sid'] ?? '').trim();
    const suppliedToken = (settings['sms_auth_token'] ?? '').trim();
    const from  = (settings['sms_from_number'] ?? '').trim();

    if (!sid || !from) {
      return NextResponse.json(
        { error: 'Twilio Account SID, Auth Token, and Sender Number are required.' },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    let token = suppliedToken;
    if (!token) {
      const stored = await loadStoredChannelSettings();
      const reuse = canReuseStoredSmsAuthToken(stored, sid);
      if (!reuse.ok) {
        return NextResponse.json({ error: reuse.error }, { status: 400, headers: NO_STORE_HEADERS });
      }
      token = reuse.token;
    }

    // Just verify credentials by fetching account info
    try {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}.json`;
      const res = await fetch(url, {
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
        },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { message?: string }).message ?? `HTTP ${res.status}`);
      }
      return NextResponse.json(
        { ok: true, message: 'Twilio credentials verified successfully.' },
        { headers: NO_STORE_HEADERS },
      );
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      const safeMsg = redactPlatformSettingSecrets(rawMsg, [token, `${sid}:${token}`]);
      return NextResponse.json({ error: `Twilio verification failed: ${safeMsg}` }, { status: 502, headers: NO_STORE_HEADERS });
    }
  }

  return NextResponse.json(
    { error: `Live testing for "${provider}" SMS is not yet implemented.` },
    { status: 400, headers: NO_STORE_HEADERS },
  );
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const POST = withAuditedAction(handlePOST);
