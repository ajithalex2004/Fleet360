/**
 * POST /api/admin/test-channel
 * Sends a real test email or SMS using the settings provided in the request body.
 * Settings are passed directly from the UI (unsaved state is fine — this tests the live form values).
 *
 * Body: { channel: 'email' | 'sms', settings: Record<string, string>, toEmail?: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminPermission } from '@/lib/admin-policy';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdminPermission(request, 'edit', 'platform');
    if (auth instanceof NextResponse) return auth;
    const body = await request.json() as {
      channel: 'email' | 'sms';
      settings: Record<string, string>;
      toEmail?: string;
    };

    const { channel, settings, toEmail } = body;

    if (channel === 'email') {
      return await testEmail(settings, toEmail);
    }

    if (channel === 'sms') {
      return await testSms(settings);
    }

    return NextResponse.json({ error: `Unknown channel: ${channel}` }, { status: 400 });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[test-channel]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
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
      { status: 400 },
    );
  }

  if (provider === 'none') {
    return NextResponse.json(
      { error: 'Email provider is set to "none". Select SMTP or another provider first.' },
      { status: 400 },
    );
  }

  if (provider === 'smtp') {
    return await testSmtp(settings, fromName, fromAddr, recipient);
  }

  // For API-based providers (SendGrid, Mailgun, etc.) we can't test without
  // their SDK — return a helpful message.
  return NextResponse.json(
    { error: `Live testing for "${provider}" is not yet implemented. Use SMTP to verify connectivity.` },
    { status: 400 },
  );
}

async function testSmtp(
  settings: Record<string, string>,
  fromName: string,
  fromAddr: string,
  recipient: string,
): Promise<NextResponse> {
  const host       = settings['smtp_host'];
  const port       = parseInt(settings['smtp_port'] || '587', 10);
  const username   = settings['smtp_username'];
  const password   = settings['smtp_password'];
  const encryption = settings['smtp_encryption'] || 'tls'; // tls | ssl | none

  if (!host || !username || !password) {
    return NextResponse.json(
      { error: 'SMTP Host, Username, and Password are all required.' },
      { status: 400 },
    );
  }

  try {
    const nodemailer = await import('nodemailer');

    const secure = encryption === 'ssl'; // true only for implicit SSL (port 465)
    const transportOptions: Record<string, unknown> = {
      host,
      port,
      secure,
      auth: { user: username, pass: password },
      connectionTimeout: 10_000,
      socketTimeout:     10_000,
    };

    // Office 365 / Exchange requires explicit TLS options
    if (host.includes('office365') || host.includes('outlook.com') || host.includes('exchange')) {
      transportOptions.requireTLS = true;
      transportOptions.tls = { ciphers: 'SSLv3', rejectUnauthorized: false };
    } else if (encryption === 'tls') {
      // Standard STARTTLS
      transportOptions.tls = { rejectUnauthorized: false };
    }

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

    return NextResponse.json({
      ok: true,
      message: `Test email delivered to ${recipient}`,
      messageId: info.messageId,
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[test-channel/smtp]', msg);

    // Give actionable error messages for common failures
    let friendly = msg;
    if (msg.includes('ECONNREFUSED'))  friendly = `Connection refused on ${host}:${port}. Check the host and port.`;
    else if (msg.includes('ETIMEDOUT')) friendly = `Connection timed out to ${host}:${port}. Check the host or firewall.`;
    else if (msg.includes('535') || msg.includes('Authentication')) friendly = `Authentication failed. Check your username and password.`;
    else if (msg.includes('STARTTLS'))  friendly = `The server requires STARTTLS. Set Encryption to "TLS".`;
    else if (msg.includes('certificate')) friendly = `SSL certificate error: ${msg}`;

    return NextResponse.json({ error: friendly }, { status: 502 });
  }
}

// ── SMS test ──────────────────────────────────────────────────────────────────

async function testSms(settings: Record<string, string>): Promise<NextResponse> {
  const provider = settings['sms_provider'] ?? 'none';

  if (provider === 'none') {
    return NextResponse.json(
      { error: 'SMS provider is set to "none". Select a provider first.' },
      { status: 400 },
    );
  }

  if (provider === 'twilio') {
    const sid   = settings['sms_account_sid'];
    const token = settings['sms_auth_token'];
    const from  = settings['sms_from_number'];

    if (!sid || !token || !from) {
      return NextResponse.json(
        { error: 'Twilio Account SID, Auth Token, and Sender Number are required.' },
        { status: 400 },
      );
    }

    // Just verify credentials by fetching account info
    try {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}.json`;
      const res = await fetch(url, {
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
        },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { message?: string }).message ?? `HTTP ${res.status}`);
      }
      return NextResponse.json({ ok: true, message: 'Twilio credentials verified successfully.' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: `Twilio verification failed: ${msg}` }, { status: 502 });
    }
  }

  return NextResponse.json(
    { error: `Live testing for "${provider}" SMS is not yet implemented.` },
    { status: 400 },
  );
}
