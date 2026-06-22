/**
 * SMS sender via Twilio's Messages API (no SDK dependency — just fetch).
 *
 * Mirrors src/lib/whatsapp.ts but sends a plain SMS: the To number has no
 * `whatsapp:` prefix and the From is TWILIO_SMS_NUMBER (falling back to
 * TWILIO_FROM_NUMBER). Like the WhatsApp helper, it is best-effort and never
 * throws — a failed send returns { sent: false, reason } so callers (e.g. the
 * ETA notifier) can fan out to email regardless.
 *
 * Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_SMS_NUMBER (or
 * TWILIO_FROM_NUMBER). Missing config → no-op (reason 'not_configured'),
 * which is the correct dev/test behaviour.
 */

export interface SmsSendResult {
  sent: boolean;
  sid?: string;
  reason?: 'not_configured' | 'no_phone' | 'twilio_error' | 'network_error';
  error?: string;
}

/** Normalise to E.164-ish: keep leading +, strip spaces/dashes/parens. */
export function formatSmsTo(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/[\s()-]/g, '');
  // Must be a plausible phone: optional + then 7-15 digits.
  if (!/^\+?\d{7,15}$/.test(cleaned)) return null;
  return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
}

// Test seam — default is the global fetch.
let fetchImpl: typeof fetch = (...args) => fetch(...args);
export function _setFetchForTests(impl: typeof fetch): void { fetchImpl = impl; }
export function _resetFetchForTests(): void { fetchImpl = (...args) => fetch(...args); }

export async function sendSms(opts: { to: string; body: string }): Promise<SmsSendResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_SMS_NUMBER || process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) {
    return { sent: false, reason: 'not_configured' };
  }
  const to = formatSmsTo(opts.to);
  if (!to) return { sent: false, reason: 'no_phone' };

  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const form = new URLSearchParams({ From: from, To: to, Body: opts.body });

  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { sent: false, reason: 'twilio_error', error: `Twilio ${res.status}: ${text.slice(0, 200)}` };
    }
    const json = (await res.json()) as { sid?: string };
    return { sent: true, sid: json.sid };
  } catch (err) {
    return { sent: false, reason: 'network_error', error: err instanceof Error ? err.message : String(err) };
  }
}
