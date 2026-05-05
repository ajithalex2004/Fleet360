/**
 * Lightweight email sender — SendGrid v3 REST API via fetch (no SDK dep).
 *
 * Same best-effort pattern as src/lib/whatsapp.ts: returns a structured
 * result, never throws, and no-ops cleanly when SENDGRID_API_KEY is missing
 * so dev environments can run without the integration configured.
 *
 * If SendGrid isn't configured, will fall back to a noop-with-reason. We do
 * NOT use the heavier nodemailer-based src/lib/notifications.ts here because
 * it requires a DB-stored IntegrationConfig row and runs more queries per
 * send — too heavy for a follow-up sweep that may emit dozens of notifications.
 */

import { captureException } from './sentry';

export interface EmailSendResult {
  sent: boolean;
  reason?: 'not_configured' | 'no_recipient' | 'sendgrid_error' | 'network_error';
  status?: number;
  error?: string;
}

export interface EmailMessage {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string;          // override default
  replyTo?: string;
}

export async function sendEmail(msg: EmailMessage): Promise<EmailSendResult> {
  const apiKey = process.env.SENDGRID_API_KEY;
  const defaultFrom = process.env.EMAIL_FROM ?? process.env.SMTP_FROM;
  if (!apiKey || !defaultFrom) {
    return { sent: false, reason: 'not_configured' };
  }

  const recipients = Array.isArray(msg.to) ? msg.to.filter(Boolean) : [msg.to].filter(Boolean);
  if (recipients.length === 0) return { sent: false, reason: 'no_recipient' };

  // Parse "Name <email@x>" or just "email@x" for the from field.
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
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (res.status >= 200 && res.status < 300) {
      return { sent: true, status: res.status };
    }
    const text = await res.text();
    const err = new Error(`SendGrid ${res.status}: ${text.slice(0, 300)}`);
    captureException(err, { context: 'email.send', tags: { status: String(res.status) } });
    return { sent: false, reason: 'sendgrid_error', status: res.status, error: err.message };
  } catch (err) {
    captureException(err, { context: 'email.send' });
    return {
      sent: false,
      reason: 'network_error',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
