/**
 * Pluggable payment-provider interface (G4).
 *
 * No live payment gateway is configured anywhere in this deployment (not
 * even STRIPE_SECRET_KEY, which the existing tenant-SaaS billing
 * integration in src/lib/billing.ts also needs and doesn't have). Real
 * bank/card processing needs a merchant account and credentials this
 * codebase can't self-provision — that's a business decision, not a
 * coding gap.
 *
 * What this DOES fix: the plumbing. Every call site (staff reconciliation,
 * the lessee portal's "Pay now") goes through getPaymentProvider() rather
 * than talking to a specific gateway directly. Swapping in a real gateway
 * later — Stripe, PayTabs, Telr, Network International, whichever the
 * business picks — means implementing this interface and switching
 * PAYMENT_PROVIDER, not rewiring every call site.
 *
 * Until then, StubPaymentProvider records a real PENDING payment intent
 * (see payment-schema.ts) and returns manual-payment instructions. This
 * is a legitimate, common pattern for a leasing business without a live
 * gateway yet — bank transfer + staff reconciliation — not a placeholder
 * pretending to move money.
 */

export interface PaymentInitiationInput {
  tenantId: string;
  invoiceId: string;
  lesseeId: string;
  amount: number;
  currency: string;
  method: 'BANK_TRANSFER' | 'CHEQUE' | 'CARD' | 'OTHER';
  initiatedBy: 'LESSEE' | 'STAFF';
  initiatedByUser?: string | null;
}

export interface PaymentInitiationResult {
  status: 'PENDING' | 'RECEIVED';
  provider: string;
  providerRef: string | null;
  referenceCode: string;
  /** Present only for providers that redirect to a hosted checkout page. */
  checkoutUrl: string | null;
  /** Human-readable instructions to show the lessee (e.g. bank details). */
  instructions: string;
}

export interface PaymentProvider {
  readonly id: string;
  initiatePayment(input: PaymentInitiationInput): Promise<PaymentInitiationResult>;
}

function generateReferenceCode(): string {
  // Short, human-quotable reference for bank transfer memos — not a
  // security token, so no need for crypto-strength randomness.
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `PAY-${rand}`;
}

class StubPaymentProvider implements PaymentProvider {
  readonly id = 'stub';

  async initiatePayment(input: PaymentInitiationInput): Promise<PaymentInitiationResult> {
    const referenceCode = generateReferenceCode();
    const bankDetails = process.env.LEASING_BANK_TRANSFER_DETAILS;
    const instructions = input.method === 'CARD'
      ? 'Online card payment isn’t connected yet. Please use bank transfer or contact your account manager.'
      : bankDetails
        ? `Pay ${input.currency} ${input.amount.toLocaleString()} by bank transfer using reference ${referenceCode}. ${bankDetails}`
        : `Pay ${input.currency} ${input.amount.toLocaleString()} by bank transfer, quoting reference ${referenceCode}, then notify your account manager. Bank details are not yet configured — contact your account manager for them.`;

    return {
      status: 'PENDING',
      provider: this.id,
      providerRef: null,
      referenceCode,
      checkoutUrl: null,
      instructions,
    };
  }
}

let _provider: PaymentProvider | null = null;

export function getPaymentProvider(): PaymentProvider {
  if (_provider) return _provider;
  // Only 'stub' exists today. The env var is read now (rather than
  // hardcoding StubPaymentProvider directly) so a future real provider
  // can be switched on with a config change, not a code change.
  const selected = process.env.PAYMENT_PROVIDER ?? 'stub';
  if (selected !== 'stub') {
    console.warn(`[payment-provider] PAYMENT_PROVIDER="${selected}" is not implemented — falling back to stub.`);
  }
  _provider = new StubPaymentProvider();
  return _provider;
}
