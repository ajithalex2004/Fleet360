/**
 * A payable's amounts from its lines: subtotal (sum of line amounts), VAT
 * (the amount given, else 5% of the subtotal) and total. Null when no line
 * has a positive amount.
 */
export interface PayableLine { description: string; amount: number }

const round2 = (n: number) => Math.round(n * 100) / 100;

export function payableTotals(lines: unknown, vat?: unknown) {
  if (!Array.isArray(lines)) return null;
  const lineItems: PayableLine[] = lines
    .map((l) => ({
      description: String((l as { description?: unknown })?.description ?? '').trim(),
      amount: round2(Number((l as { amount?: unknown })?.amount)),
    }))
    .filter((l) => Number.isFinite(l.amount) && l.amount > 0);
  if (!lineItems.length) return null;
  const subtotal = round2(lineItems.reduce((s, l) => s + l.amount, 0));
  const given = vat === undefined || vat === null || vat === '' ? NaN : Number(vat);
  const vatAmount = Number.isFinite(given) && given >= 0 ? round2(given) : round2(subtotal * 0.05);
  return { lineItems, subtotal, vatAmount, total: round2(subtotal + vatAmount) };
}
