/**
 * Email sender — platform Resend HTTPS API, platform SMTP via nodemailer, and
 * SendGrid fallback.
 *
 * Transport selection (first match wins):
 *   1. If `platform_settings.email_provider === 'resend'`, send via Resend REST
 *      API (`https://api.resend.com/emails`) using `email_api_key` (falling
 *      back to `RESEND_API_KEY` env var).
 *   2. If `RESEND_API_KEY` env var is set and `email_provider` is not
 *      explicitly `'smtp'`, send via Resend REST API.
 *   3. If `SENDGRID_API_KEY` env var is set, use SendGrid v3 REST API.
 *   4. Otherwise, use platform SMTP stored in `platform_settings`.
 *   5. If none is configured, return `not_configured` / `smtp_not_configured`
 *      so callers can decide how to proceed.
 *
 * Platform email settings are cached in-memory for 60 s to avoid hitting the
 * DB on every email. The cache is invalidated by `invalidateSmtpCache()`.
 */

import { prisma } from './prisma';
import { captureException } from './sentry';
import { smtpTlsOptions } from './smtp-tls';
import { redactPlatformSettingSecrets } from './platform-settings-secrets';

export const RESEND_API_ENDPOINT = 'https://api.resend.com/emails';

export interface EmailSendResult {
  sent: boolean;
  reason?:
    | 'not_configured'
    | 'no_recipient'
    | 'smtp_not_configured'
    | 'resend_not_configured'
    | 'resend_error'
    | 'sendgrid_error'
    | 'smtp_error'
    | 'network_error'
    | 'quarantined_in_staging';
  status?: number;
  error?: string;
  transport?: 'resend' | 'sendgrid' | 'smtp' | 'quarantined';
  /** For a failed send: DEFINITE_FAILURE when the message certainly was not
   *  accepted (safe to retry), UNCERTAIN when it may have been. Callers that
   *  must never send twice (dunning notices) rely on this. */
  errorClass?: 'DEFINITE_FAILURE' | 'UNCERTAIN';
  /** Provider message id of a sent message, when known. */
  id?: string;
}

/**
 * Whether a nodemailer failure happened before the message could have been
 * accepted: at or before RCPT nothing was transmitted. Anything later, or
 * unidentifiable, is UNCERTAIN.
 */
export function classifySmtpError(err: unknown): 'DEFINITE_FAILURE' | 'UNCERTAIN' {
  const command = (err as { command?: string } | undefined)?.command;
  return command === 'CONN' || command === 'AUTH' || command === 'MAIL' || command === 'RCPT'
    ? 'DEFINITE_FAILURE'
    : 'UNCERTAIN';
}

function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function formatFromHeader(fromName: string | undefined, fromAddr: string): string {
  const cleanAddr = sanitizeHeaderValue(fromAddr);
  const cleanName = sanitizeHeaderValue(fromName ?? '').replace(/"/g, '');
  if (!cleanName || cleanAddr.includes('<')) return cleanAddr;
  return `"${cleanName}" <${cleanAddr}>`;
}

/** Whether sendEmail has a real transport (not quarantined, Resend, SendGrid, or platform SMTP set up). */
export async function isEmailTransportConfigured(): Promise<boolean> {
  if (process.env.DISABLE_OUTBOUND_NOTIFICATIONS === 'true' || process.env.MOCK_NOTIFICATIONS === 'true') return false;
  const platformCfg = await getPlatformEmailConfig();
  if (platformCfg?.provider === 'resend') {
    const apiKey = platformCfg.apiKey || process.env.RESEND_API_KEY?.trim() || '';
    const fromAddr = platformCfg.fromAddr || process.env.EMAIL_FROM?.trim() || process.env.SMTP_FROM?.trim() || '';
    return Boolean(apiKey && fromAddr);
  }
  if (platformCfg?.provider !== 'smtp' && process.env.RESEND_API_KEY?.trim()) {
    const fromAddr = platformCfg?.fromAddr || process.env.EMAIL_FROM?.trim() || process.env.SMTP_FROM?.trim() || '';
    if (fromAddr) return true;
  }
  if (process.env.SENDGRID_API_KEY) return Boolean(process.env.EMAIL_FROM ?? process.env.SMTP_FROM);
  return Boolean(platformCfg?.smtp);
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
  replyTo?:   string;
}

interface PlatformEmailConfig {
  provider: string;       // '' | 'none' | 'smtp' | 'resend' | ...
  apiKey:   string;
  fromName: string;
  fromAddr: string;
  replyTo:  string;
  smtp:     SmtpConfig | null;
}

// ── Platform email settings cache ────────────────────────────────────────────

const TTL_MS = 60_000;

let _emailCache: PlatformEmailConfig | null = null;
let _emailCacheAt = 0;
let _emailLoading: Promise<PlatformEmailConfig | null> | null = null;

async function loadPlatformEmailConfigFromDb(): Promise<PlatformEmailConfig | null> {
  const rows = await prisma.$queryRawUnsafe<Array<{ key: string; value: string }>>(
    `SELECT key, value FROM platform_settings
     WHERE key IN ('email_provider', 'email_api_key', 'smtp_host', 'smtp_port',
                    'smtp_username', 'smtp_password', 'smtp_encryption',
                    'email_from_name', 'email_from_address', 'email_reply_to')`,
  );
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const s: Record<string, string> = {};
  for (const r of rows) s[r.key] = r.value ?? '';

  const provider = (s['email_provider'] || '').trim().toLowerCase();
  const fromName = (s['email_from_name'] || 'Fleet360').trim() || 'Fleet360';
  const fromAddr = (s['email_from_address'] || '').trim();
  const replyTo  = (s['email_reply_to'] || '').trim();
  const apiKey   = (s['email_api_key'] || '').trim();

  const host     = (s['smtp_host'] || '').trim();
  const username = (s['smtp_username'] || '').trim();
  const password = (s['smtp_password'] || '').trim();
  const smtp: SmtpConfig | null =
    host && username && password
      ? {
          host,
          port:       parseInt(s['smtp_port'] || '587', 10),
          username,
          password,
          encryption: s['smtp_encryption'] || 'tls',
          fromName,
          fromAddr:   fromAddr || username,
          ...(replyTo ? { replyTo } : {}),
        }
      : null;

  return { provider, apiKey, fromName, fromAddr, replyTo, smtp };
}

async function getPlatformEmailConfig(): Promise<PlatformEmailConfig | null> {
  const now = Date.now();
  if (_emailCache && now - _emailCacheAt < TTL_MS) return _emailCache;
  if (_emailLoading) { await _emailLoading; return _emailCache; }
  const loadPromise = (async () => {
    try {
      _emailCache = await loadPlatformEmailConfigFromDb();
      _emailCacheAt = Date.now();
    } catch (e) {
      console.error('[email] failed to load platform email config:', e);
      _emailCache = _emailCache;  // keep stale
    }
  })() as unknown as Promise<PlatformEmailConfig | null>;
  _emailLoading = loadPromise;
  try { await loadPromise; } finally { _emailLoading = null; }
  return _emailCache;
}

/** Drop the platform email/SMTP cache. Call after /admin/platform-settings writes. */
export function invalidateSmtpCache(): void {
  _emailCache = null;
  _emailCacheAt = 0;
}

// ── Main entry point ─────────────────────────────────────────────────────────

export async function sendEmail(msg: EmailMessage): Promise<EmailSendResult> {
  const recipients = Array.isArray(msg.to) ? msg.to.filter(Boolean) : [msg.to].filter(Boolean);
  if (recipients.length === 0) return { sent: false, reason: 'no_recipient' };

  if (
    process.env.DISABLE_OUTBOUND_NOTIFICATIONS === 'true' ||
    process.env.MOCK_NOTIFICATIONS === 'true'
  ) {
    return { sent: false, reason: 'quarantined_in_staging', transport: 'quarantined' };
  }

  const platformCfg = await getPlatformEmailConfig();

  // 1. Explicit platform Resend API provider
  if (platformCfg?.provider === 'resend') {
    return sendViaResend(msg, recipients, platformCfg);
  }

  // 2. Environment RESEND_API_KEY fallback (unless admin explicitly chose SMTP)
  if (platformCfg?.provider !== 'smtp' && process.env.RESEND_API_KEY?.trim()) {
    return sendViaResend(msg, recipients, platformCfg);
  }

  // 3. SendGrid takes priority if explicitly configured (legacy)
  if (process.env.SENDGRID_API_KEY) {
    return sendViaSendGrid(msg, recipients);
  }

  // 4. Otherwise use platform SMTP from platform_settings
  return sendViaSmtp(msg, recipients, platformCfg?.smtp ?? null);
}

// ── Resend HTTPS API path ────────────────────────────────────────────────────

async function sendViaResend(
  msg: EmailMessage,
  recipients: string[],
  platformCfg: PlatformEmailConfig | null,
): Promise<EmailSendResult> {
  const apiKey = (platformCfg?.apiKey || process.env.RESEND_API_KEY || '').trim();
  const defaultAddr = (
    platformCfg?.fromAddr ||
    process.env.EMAIL_FROM ||
    process.env.SMTP_FROM ||
    ''
  ).trim();
  const fromHeader = msg.from
    ? sanitizeHeaderValue(msg.from)
    : defaultAddr
      ? formatFromHeader(platformCfg?.fromName, defaultAddr)
      : '';

  if (!apiKey || !fromHeader) {
    return { sent: false, reason: 'resend_not_configured', transport: 'resend' };
  }

  const replyTo = sanitizeHeaderValue(msg.replyTo || platformCfg?.replyTo || '');
  const payload: Record<string, unknown> = {
    from: fromHeader,
    to: recipients,
    subject: msg.subject,
    ...(msg.html ? { html: msg.html } : {}),
    ...(msg.text ? { text: msg.text } : {}),
    ...(!msg.html && !msg.text ? { text: msg.subject } : {}),
    ...(replyTo ? { reply_to: replyTo } : {}),
  };

  try {
    const res = await fetch(RESEND_API_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Fleet360/1.0',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });

    if (res.status >= 200 && res.status < 300) {
      const data = (await res.json().catch(() => null)) as { id?: unknown } | null;
      return {
        sent: true,
        status: res.status,
        transport: 'resend',
        id: typeof data?.id === 'string' ? data.id : undefined,
      };
    }

    const rawText = await res.text().catch(() => '');
    const safeText = redactPlatformSettingSecrets(rawText.slice(0, 300), [apiKey]);
    const err = new Error(`Resend ${res.status}: ${safeText}`);
    console.error('[email] Resend send failed:', err.message);
    captureException(err, { context: 'email.send.resend', tags: { status: String(res.status) } });
    // 4xx = Resend explicitly rejected before acceptance (safe to retry after fix).
    // 5xx = server-side failure where acceptance is uncertain.
    const errorClass = res.status >= 400 && res.status < 500 ? 'DEFINITE_FAILURE' : 'UNCERTAIN';
    return {
      sent: false,
      reason: 'resend_error',
      status: res.status,
      error: err.message,
      transport: 'resend',
      errorClass,
    };
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    const safeMsg = redactPlatformSettingSecrets(rawMsg, [apiKey]);
    const safeErr = new Error(safeMsg);
    console.error('[email] Resend network error:', safeMsg);
    captureException(safeErr, { context: 'email.send.resend' });
    return {
      sent: false,
      reason: 'network_error',
      error: safeMsg,
      transport: 'resend',
      errorClass: 'UNCERTAIN',
    };
  }
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
      return { sent: true, status: res.status, transport: 'sendgrid', id: res.headers.get('x-message-id') ?? undefined };
    }
    const text = await res.text();
    const err = new Error(`SendGrid ${res.status}: ${text.slice(0, 300)}`);
    captureException(err, { context: 'email.send.sendgrid', tags: { status: String(res.status) } });
    // SendGrid answered and refused: nothing was accepted.
    return { sent: false, reason: 'sendgrid_error', status: res.status, error: err.message, transport: 'sendgrid', errorClass: 'DEFINITE_FAILURE' };
  } catch (err) {
    captureException(err, { context: 'email.send.sendgrid' });
    // No answer: SendGrid may have accepted the request.
    return { sent: false, reason: 'network_error', error: err instanceof Error ? err.message : String(err), transport: 'sendgrid', errorClass: 'UNCERTAIN' };
  }
}

// ── SMTP path (the default; reads from platform_settings) ───────────────────

async function sendViaSmtp(
  msg: EmailMessage,
  recipients: string[],
  cfg: SmtpConfig | null,
): Promise<EmailSendResult> {
  if (!cfg) {
    return { sent: false, reason: 'smtp_not_configured', transport: 'smtp' };
  }

  const fromAddr = msg.from ? sanitizeHeaderValue(msg.from) : formatFromHeader(cfg.fromName, cfg.fromAddr);
  const replyTo = sanitizeHeaderValue(msg.replyTo || cfg.replyTo || '');

  const secure = cfg.encryption.trim().toUpperCase() === 'SSL' || cfg.port === 465;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const transportOptions: Record<string, any> = {
    host: cfg.host,
    port: cfg.port,
    secure,
    auth: { user: cfg.username, pass: cfg.password },
    connectionTimeout: 10_000,
    socketTimeout:     10_000,
  };
  Object.assign(transportOptions, smtpTlsOptions(cfg.host, cfg.encryption));

  try {
    const nodemailer = await import('nodemailer');
    const transporter = nodemailer.default.createTransport(transportOptions);
    const info = await transporter.sendMail({
      from: fromAddr,
      to: recipients.join(', '),
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      ...(replyTo ? { replyTo } : {}),
    });
    return { sent: true, transport: 'smtp', id: typeof info?.messageId === 'string' ? info.messageId : undefined };
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    const safeMsg = redactPlatformSettingSecrets(rawMsg, [cfg.password, `${cfg.username}:${cfg.password}`]);
    const e = new Error(safeMsg);
    console.error('[email] SMTP send failed:', safeMsg);
    captureException(e, { context: 'email.send.smtp' });
    return {
      sent: false,
      reason: 'smtp_error',
      error: safeMsg,
      transport: 'smtp',
      errorClass: classifySmtpError(err),
    };
  }
}
