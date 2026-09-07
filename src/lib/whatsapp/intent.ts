/**
 * Regex/keyword-based intent classification for inbound WhatsApp messages.
 * Deliberately not an LLM call — this runs on every inbound message and
 * needs to reply in well under a second.
 */
export type WhatsAppIntent = 'INQUIRY' | 'PAYMENT' | 'RENEWAL' | 'GENERAL';

const PATTERNS: Array<{ intent: WhatsAppIntent; re: RegExp }> = [
  { intent: 'PAYMENT',  re: /\b(pay|payment|invoice|bill|billing|due|outstanding|amount owed|receipt)\b/i },
  { intent: 'RENEWAL',  re: /\b(renew|renewal|extend|extension|expir\w*|contract end)\b/i },
  { intent: 'INQUIRY',  re: /\b(price|quote|quotation|cost|available|availability|book|booking|rent|hire|vehicle|car)\b/i },
];

export function classifyIntent(text: string): WhatsAppIntent {
  const normalized = (text ?? '').trim();
  for (const { intent, re } of PATTERNS) {
    if (re.test(normalized)) return intent;
  }
  return 'GENERAL';
}
