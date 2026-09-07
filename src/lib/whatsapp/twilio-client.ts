/**
 * Shared Twilio WhatsApp send client.
 * Used by both the outbound /api/whatsapp/send route and the inbound
 * webhook's auto-reply path, so there's one place that talks to Twilio.
 */
const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID ?? '';
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN ?? '';
const FROM_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER ?? 'whatsapp:+14155238886';

export async function sendWhatsAppMessage(to: string, body: string): Promise<{ sid: string; status: string } | null> {
  if (!ACCOUNT_SID || !AUTH_TOKEN) return null;

  const formData = new URLSearchParams();
  formData.append('From', FROM_NUMBER);
  formData.append('To', to.startsWith('whatsapp:') ? to : `whatsapp:${to}`);
  formData.append('Body', body);

  const resp = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    }
  );

  if (!resp.ok) {
    const errText = await resp.text();
    console.error('[WhatsApp] Twilio send error:', errText);
    return null;
  }

  return await resp.json() as { sid: string; status: string };
}

export const WHATSAPP_FROM_NUMBER = FROM_NUMBER.replace('whatsapp:', '');
