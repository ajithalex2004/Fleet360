/**
 * Email sender — platform SMTP via nodemailer, with SendGrid fallback.
 *
 * Transport selection (first match wins):
 *   1. If `SENDGRID_API_KEY` env var is set, use SendGrid v3 REST API.
 *   2. Otherwise, use the platform's SMTP config stored in `platform_settings`
 *      (the same one the admin UI manages at /admin/platform-settings).
 *      This is what the pre-verify-domain route has been using successfully.
 *   3. If neither is configured, return `not_configured` so the caller can
 *      decide what to do (most just log + continue — by design).
 *
 * SMTP settings are cached in-memory for 60 s to avoid hitting the DB on
 * every email. The cache is invalidated by `invalidateSmtpCache()`.
 *
 * Pairs with: `prisma/migrations/20260803000000_rls_tenant_isolation_all_tables/`
 * and `/admin/platform-settings` (which writes the settings).
 *
 * The old SendGrid-only behaviour was a silent-failure trap: every
 * caller did `if (!result.sent) { ... quietly ignore ... }` and
 * users only noticed when an email they expected never arrived.
 * Reading from `platform_settings` means the admin's SMTP config is
 * the single source of truth for email delivery.
 */

import { prisma } from './prisma';
import { captureException } from './sentry';

export interface EmailSendResult {
  sent: boolean;
  reason?: 'not_configured' | 'no_recipient' | 'smtp_not_configured' | 'sendgrid_error' | 'smtp_error' | 'network_error';
  status?: number;
  error?: string;
  transport?: 'sendgrid' | 'smtp';
}

export interface EmailMessage {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string;          // override default
  replyTo?: string;
}

interface SmtpConfig {
  host:       string;
  port:       number;
  username:   string;
  password:   string;
  encryption: string;     // 'ssl' | 'tls' | 'none'
  fromName:   string;
  fromAddr:   string;
}

// ── SMTP settings cache ─────────────────────────────────────────────────────

const TTL_MS = 60_000;

let _smtpCache: SmtpConfig | null = null;
let _smtpCacheAt = 0;
let _smtpLoading: Promise<SmtpConfig | null> | null = null;

async function loadSmtpFromDb(): Promise<SmtpConfig | null> {
  const rows = await prisma.$queryRawUnsafe<Array<{ key: string; value: string }>>(
    `SELECT key, value FROM platform_settings
     WHERE key IN ('smtp_host', 'smtp_port', 'smtp_username', 'smtp_password', 'smtp_encryption',
                    'email_from_name', 'email_from_address')`,
  );
  const s: Record<string, string> = {};
  for (const r of rows) s[r.key] = r.value;

  const host     = s['smtp_host'];
  const username = s['smtp_username'];
  const password = s['smtp_password'];
  if (!host || !username || !password) return null;

  return {
    host,
    port:       parseInt(s['smtp_port'] || '587', 10),
    username,
    password,
    encryption: s['smtp_encryption'] || 'tls',
    fromName:   s['email_from_name'] || 'Fleet360',
    fromAddr:   s['email_from_address'] || username,
  };
}

async function getSmtpConfig(): Promise<SmtpConfig | null> {
  const now = Date.now();
  if (_smtpCache && now - _smtpCacheAt < TTL_MS) return _smtpCache;
  if (_smtpLoading) { await _smtpLoading; return _smtpCache; }
  const loadPromise = (async () => {
    try {
      _smtpCache = await loadSmtpFromDb();
      _smtpCacheAt = Date.now();
    } catch (e) {
      console.error('[email] failed to load SMTP config:', e);
      _smtpCache = _smtpCache;  // keep stale
    }
  })() as unknown as Promise<SmtpConfig | null>;
  _smtpLoading = loadPromise;
  try { await loadPromise; } finally { _smtpLoading = null; }
  return _smtpCache;
}

/** Drop the SMTP cache. Call after /admin/platform-settings writes. */
export function invalidateSmtpCache(): void {
  _smtpCache = null;
  _smtpCacheAt = 0;
}

// ── Main entry point ─────────────────────────────────────────────────────────

export async function sendEmail(msg: EmailMessage): Promise<EmailSendResult> {
  const recipients = Array.isArray(msg.to) ? msg.to.filter(Boolean) : [msg.to].filter(Boolean);
  if (recipients.length === 0) return { sent: false, reason: 'no_recipient' };

  // 1. SendGrid takes priority if explicitly configured
  if (process.env.SENDGRID_API_KEY) {
    return sendViaSendGrid(msg, recipients);
  }

  // 2. Otherwise use platform SMTP from platform_settings
  return sendViaSmtp(msg, recipients);
}

// ── SendGrid path (legacy; kept for backward compat) ────────────────────────

async function sendViaSendGrid(msg: EmailMessage, recipients: string[]): Promise<EmailSendResult> {
  const apiKey = process.env.SENDGRID_API_KEY;
  const defaultFrom = process.env.EMAIL_FROM ?? process.env.SMTP_FROM;
  if (!apiKey || !defaultFrom) {
    return { sent: false, reason: 'not_configured', transport: 'sendgrid' };
  }

  const fromAddr = msg.from ?? defaultFrom;
  const fromMatch = /<([^>]+)>/.exec(fromAddr);
  const fromEmail = fromMatch ? fromMatch[1] : fromAddr;
  const fromName = fromMatch ? fromAddr.replace(fromMatch[0], '').trim().replace(/^"|"$/g, '') : undefined;

  const body = {
    personalizations: [{ to: recipients.map(email => ({ email })) }],
    from: fromName ? { email: fromEmail, name: fromName } : { email: fromEmail },
    ...(msg.replyTo ? { reply_to: { email: msg.replyTo } } : {}),
    subject: msg.subject,
    content: [
      msg.text ? { type: 'text/plain', value: msg.text } : null,
      msg.html ? { type: 'text/html', value: msg.html } : null,
    ].filter(Boolean) as { type: string; value: string }[],
  };
  if (body.content.length === 0) {
    body.content.push({ type: 'text/plain', value: msg.subject });
  }

  try {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status >= 200 && res.status < 300) {
      return { sent: true, status: res.status, transport: 'sendgrid' };
    }
    const text = await res.text();
    const err = new Error(`SendGrid ${res.status}: ${text.slice(0, 300)}`);
    captureException(err, { context: 'email.send.sendgrid', tags: { status: String(res.status) } });
    return { sent: false, reason: 'sendgrid_error', status: res.status, error: err.message, transport: 'sendgrid' };
  } catch (err) {
    captureException(err, { context: 'email.send.sendgrid' });
    return { sent: false, reason: 'network_error', error: err instanceof Error ? err.message : String(err), transport: 'sendgrid' };
  }
}

// ── SMTP path (the default; reads from platform_settings) ───────────────────

async function sendViaSmtp(msg: EmailMessage, recipients: string[]): Promise<EmailSendResult> {
  const cfg = await getSmtpConfig();
  if (!cfg) {
    return { sent: false, reason: 'smtp_not_configured', transport: 'smtp' };
  }

  const fromAddr = msg.from ?? (cfg.fromName ? `"${cfg.fromName}" <${cfg.fromAddr}>` : cfg.fromAddr);

  const secure = cfg.encryption === 'ssl';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const transportOptions: Record<string, any> = {
    host: cfg.host,
    port: cfg.port,
    secure,
    auth: { user: cfg.username, pass: cfg.password },
    connectionTimeout: 10_000,
    socketTimeout:     10_000,
  };
  if (cfg.host.includes('office365') || cfg.host.includes('outlook.com') || cfg.host.includes('exchange')) {
    transportOptions.requireTLS = true;
    transportOptions.tls        = { ciphers: 'SSLv3', rejectUnauthorized: false };
  } else if (cfg.encryption === 'tls') {
    transportOptions.tls = { rejectUnauthorized: false };
  }

  try {
    const nodemailer = await import('nodemailer');
    const transporter = nodemailer.default.createTransport(transportOptions);
    const info = await transporter.sendMail({
      from: fromAddr,
      to: recipients.join(', '),
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      ...(msg.replyTo ? { replyTo: msg.replyTo } : {}),
    });
    return { sent: true, transport: 'smtp' };
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    console.error('[email] SMTP send failed:', e.message);
    captureException(e, { context: 'email.send.smtp' });
    return {
      sent: false,
      reason: 'smtp_error',
      error: e.message,
      transport: 'smtp',
    };
  }
}
