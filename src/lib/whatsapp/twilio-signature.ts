/**
 * Twilio request signature validation.
 *
 * Twilio signs every webhook POST with an X-Twilio-Signature header:
 *   base64(HMAC-SHA1(authToken, url + sortedParams))
 * where sortedParams is every POST param, sorted by key, each key+value
 * pair appended directly to the URL string with no separator.
 * https://www.twilio.com/docs/usage/webhooks/webhooks-security
 *
 * No official Twilio SDK is installed in this project, so this
 * reimplements the (short, well-specified) algorithm directly rather
 * than pulling in the full `twilio` package for one function.
 */
import { createHmac, timingSafeEqual } from 'crypto';

export function verifyTwilioSignature(
  url: string,
  params: URLSearchParams,
  signatureHeader: string | null,
  authToken: string | undefined,
): boolean {
  if (!signatureHeader || !authToken) return false;

  const sortedKeys = [...params.keys()].sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + params.get(key);
  }

  const expected = createHmac('sha1', authToken).update(data, 'utf8').digest('base64');

  const expectedBuf = Buffer.from(expected, 'utf8');
  const actualBuf = Buffer.from(signatureHeader, 'utf8');
  if (expectedBuf.length !== actualBuf.length) return false;

  try {
    return timingSafeEqual(expectedBuf, actualBuf);
  } catch {
    return false;
  }
}

/**
 * Reconstructs the exact public URL Twilio computed its signature
 * against. Prefers NEXT_PUBLIC_APP_URL (the app's documented canonical
 * origin, already used the same way for billing/approval links) since
 * req.url can report the wrong scheme/host behind a reverse proxy that
 * doesn't forward x-forwarded-* — a mismatch here silently breaks every
 * signature check.
 */
export function twilioWebhookUrl(req: { url: string }, pathname: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
  return new URL(pathname, base).toString();
}
