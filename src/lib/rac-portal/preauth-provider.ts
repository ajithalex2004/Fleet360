/**
 * Pluggable Card Pre-Authorization, Incremental Hold & Capture Provider
 * for RAC Security Deposits and B2B Online Reservations.
 *
 * Supports UAE/Global gateways via `getRacPreAuthProvider(preferredProvider?)` / `RAC_PAYMENT_PROVIDER`:
 *   - `stripe`  — Stripe PaymentIntents (`capture_method: 'manual'`, `/increment_authorization` + update fallback, `/capture`, `/cancel`) when `STRIPE_SECRET_KEY` is set
 *   - `telr`    — Telr Remote API (`https://secure.telr.com/gateway/remote.json`, `auth` / `capture` / `release` / continuous-authority top-up `cont`) when `TELR_STORE_ID` + `TELR_AUTH_KEY` are set
 *   - `ngenius` — Network International N-Genius Orders API (`AUTH`, `/authorizations`, `/captures`, `/cancel`) when `NGENIUS_API_KEY` + `NGENIUS_OUTLET_REF` are set
 *   - `sandbox` — Deterministic PCI-safe tokenized pre-authorization fallback when live env vars are absent
 *
 * PCI-DSS note: Raw PAN / CVV are NEVER logged or persisted to Postgres. Only
 * tokenized references (`tok_*`), card brand, last 4 digits, cardholder name,
 * and authorization code (`AUTH-XXXXXX`) are stored.
 */

import crypto from 'crypto';

export interface CardPreAuthInput {
  tenantId: string;
  customerId: string;
  amount: number;
  currency: string;
  cardToken?: string | null;
  cardLast4?: string | null;
  cardBrand?: string | null;
  cardholderName?: string | null;
  expiryMonth?: number | null;
  expiryYear?: number | null;
  description?: string;
}

export interface CardPreAuthResult {
  status: 'AUTHORIZED' | 'PENDING' | 'FAILED';
  provider: string;
  providerIntentId: string;
  cardToken: string;
  authorizationCode: string;
  cardBrand: string;
  cardLast4: string;
  expiresAt: string;
  checkoutUrl: string | null;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface IncrementPreAuthInput {
  providerIntentId: string;
  authorizationCode?: string | null;
  additionalAmount: number;
  newTotalAmount: number;
  currency: string;
  reason?: string | null;
  cardToken?: string | null;
  customerId?: string | null;
}

export interface IncrementPreAuthResult {
  status: 'INCREMENTED' | 'FAILED';
  provider: string;
  providerRef: string;
  additionalAmount: number;
  newTotalAmount: number;
  authorizationCode: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface CardCaptureResult {
  status: 'CAPTURED' | 'FAILED';
  capturedAmount: number;
  providerRef: string;
  message: string;
}

export interface CardReleaseResult {
  status: 'RELEASED' | 'FAILED';
  providerRef: string;
  message: string;
}

export interface RacPreAuthProvider {
  readonly id: string;
  authorizeHold(input: CardPreAuthInput): Promise<CardPreAuthResult>;
  incrementHold(input: IncrementPreAuthInput): Promise<IncrementPreAuthResult>;
  captureHold(args: { providerIntentId: string; amount: number; currency: string }): Promise<CardCaptureResult>;
  releaseHold(args: { providerIntentId: string }): Promise<CardReleaseResult>;
}

function generateAuthCode(): string {
  const bytes = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `AUTH-${bytes}`;
}

export class SandboxPreAuthProvider implements RacPreAuthProvider {
  readonly id = 'sandbox';

  async authorizeHold(input: CardPreAuthInput): Promise<CardPreAuthResult> {
    if (!(input.amount > 0)) {
      throw new Error('Pre-authorization hold amount must be greater than zero');
    }
    const last4 = (input.cardLast4 ?? '4242').replace(/\D/g, '').slice(-4).padStart(4, '0');
    if (last4 === '0002') {
      return {
        status: 'FAILED',
        provider: this.id,
        providerIntentId: `pi_declined_${crypto.randomBytes(6).toString('hex')}`,
        cardToken: input.cardToken ?? `tok_${crypto.randomBytes(8).toString('hex')}`,
        authorizationCode: 'DECLINED',
        cardBrand: input.cardBrand ?? 'VISA',
        cardLast4: last4,
        expiresAt: new Date().toISOString(),
        checkoutUrl: null,
        message: 'Card issuer declined the pre-authorization hold.',
      };
    }

    const nowYear = new Date().getFullYear();
    const nowMonth = new Date().getMonth() + 1;
    if (
      input.expiryYear != null &&
      input.expiryMonth != null &&
      (input.expiryYear < nowYear || (input.expiryYear === nowYear && input.expiryMonth < nowMonth))
    ) {
      throw new Error('Corporate card is expired');
    }

    const authorizationCode = generateAuthCode();
    const providerIntentId = `pi_rac_${crypto.randomBytes(8).toString('hex')}`;
    const cardToken = input.cardToken?.trim() || `tok_rac_${crypto.randomBytes(8).toString('hex')}`;
    const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString(); // Standard 7-day issuer hold

    return {
      status: 'AUTHORIZED',
      provider: this.id,
      providerIntentId,
      cardToken,
      authorizationCode,
      cardBrand: (input.cardBrand ?? 'VISA').toUpperCase(),
      cardLast4: last4,
      expiresAt,
      checkoutUrl: null,
      message: `Pre-authorized ${input.currency} ${input.amount.toLocaleString('en-AE', { minimumFractionDigits: 2 })} hold (${authorizationCode}) valid for 7 days.`,
    };
  }

  async incrementHold(input: IncrementPreAuthInput): Promise<IncrementPreAuthResult> {
    if (!(input.additionalAmount > 0)) {
      throw new Error('Incremental hold additionalAmount must be greater than zero');
    }
    if (input.providerIntentId.includes('declined')) {
      return {
        status: 'FAILED',
        provider: this.id,
        providerRef: input.providerIntentId,
        additionalAmount: input.additionalAmount,
        newTotalAmount: input.newTotalAmount,
        authorizationCode: input.authorizationCode ?? 'DECLINED',
        message: 'Card issuer declined the incremental pre-authorization hold.',
      };
    }
    const authCode = input.authorizationCode?.trim() || generateAuthCode();
    const providerRef = `inc_${input.providerIntentId.slice(-10)}_${crypto.randomBytes(3).toString('hex')}`;
    return {
      status: 'INCREMENTED',
      provider: this.id,
      providerRef,
      additionalAmount: input.additionalAmount,
      newTotalAmount: input.newTotalAmount,
      authorizationCode: authCode,
      message: `Incremented pre-authorization hold by ${input.currency} ${input.additionalAmount.toFixed(2)} to ${input.currency} ${input.newTotalAmount.toFixed(2)} (${authCode}).`,
      metadata: {
        mode: 'sandbox',
        reason: input.reason ?? null,
        incrementedAt: new Date().toISOString(),
      },
    };
  }

  async captureHold(args: { providerIntentId: string; amount: number; currency: string }): Promise<CardCaptureResult> {
    return {
      status: 'CAPTURED',
      capturedAmount: args.amount,
      providerRef: `cap_${args.providerIntentId.slice(-10)}`,
      message: `Captured ${args.currency} ${args.amount.toFixed(2)} against pre-authorization hold.`,
    };
  }

  async releaseHold(args: { providerIntentId: string }): Promise<CardReleaseResult> {
    return {
      status: 'RELEASED',
      providerRef: `rel_${args.providerIntentId.slice(-10)}`,
      message: 'Card pre-authorization hold released back to cardholder.',
    };
  }
}

export class StripeManualCaptureProvider implements RacPreAuthProvider {
  readonly id = 'stripe';
  constructor(private readonly secretKey: string) {}

  async authorizeHold(input: CardPreAuthInput): Promise<CardPreAuthResult> {
    const params = new URLSearchParams({
      amount: String(Math.round(input.amount * 100)),
      currency: input.currency.toLowerCase(),
      capture_method: 'manual',
      'payment_method_options[card][request_incremental_authorization_support]': 'if_available',
      description: input.description ?? `Fleet360 RAC Pre-Auth (${input.customerId})`,
    });
    if (input.cardToken && input.cardToken.startsWith('pm_')) {
      params.set('payment_method', input.cardToken);
      params.set('confirm', 'true');
      params.set('automatic_payment_methods[enabled]', 'true');
      params.set('automatic_payment_methods[allow_redirects]', 'never');
    }

    const res = await fetch('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      const errObj = (data.error as Record<string, unknown> | undefined) ?? {};
      throw new Error(String(errObj.message ?? 'Stripe pre-authorization failed'));
    }

    const status = data.status === 'requires_capture' ? 'AUTHORIZED' : 'PENDING';
    const authorizationCode = generateAuthCode();
    return {
      status,
      provider: this.id,
      providerIntentId: String(data.id),
      cardToken: input.cardToken ?? String(data.payment_method ?? ''),
      authorizationCode,
      cardBrand: (input.cardBrand ?? 'CARD').toUpperCase(),
      cardLast4: (input.cardLast4 ?? '0000').slice(-4),
      expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      checkoutUrl: null,
      message:
        status === 'AUTHORIZED'
          ? `Stripe hold authorized (${authorizationCode})`
          : 'Stripe PaymentIntent created; awaiting client confirmation.',
      metadata: {
        stripeStatus: data.status ?? null,
        latestCharge: data.latest_charge ?? null,
      },
    };
  }

  async incrementHold(input: IncrementPreAuthInput): Promise<IncrementPreAuthResult> {
    if (!(input.additionalAmount > 0)) {
      throw new Error('Incremental hold additionalAmount must be greater than zero');
    }
    const newTotalMinor = String(Math.round(input.newTotalAmount * 100));
    const incParams = new URLSearchParams({ amount: newTotalMinor });
    if (input.reason) {
      incParams.set('description', input.reason);
    }

    // Attempt native Stripe /increment_authorization first
    const incRes = await fetch(
      `https://api.stripe.com/v1/payment_intents/${encodeURIComponent(input.providerIntentId)}/increment_authorization`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: incParams.toString(),
        signal: AbortSignal.timeout(15_000),
      },
    );
    const incData = (await incRes.json().catch(() => ({}))) as Record<string, unknown>;
    if (incRes.ok) {
      const authCode = input.authorizationCode?.trim() || generateAuthCode();
      return {
        status: 'INCREMENTED',
        provider: this.id,
        providerRef: String(incData.id ?? input.providerIntentId),
        additionalAmount: input.additionalAmount,
        newTotalAmount: input.newTotalAmount,
        authorizationCode: authCode,
        message: `Incremented Stripe hold to ${input.currency} ${input.newTotalAmount.toFixed(2)}.`,
        metadata: { method: 'increment_authorization', stripeStatus: incData.status ?? null },
      };
    }

    // Fallback: PaymentIntent amount update (supported prior to capture when card network doesn't expose incremental auth)
    const updRes = await fetch(
      `https://api.stripe.com/v1/payment_intents/${encodeURIComponent(input.providerIntentId)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: incParams.toString(),
        signal: AbortSignal.timeout(15_000),
      },
    );
    const updData = (await updRes.json().catch(() => ({}))) as Record<string, unknown>;
    if (!updRes.ok) {
      const errObj =
        (updData.error as Record<string, unknown> | undefined) ??
        (incData.error as Record<string, unknown> | undefined) ??
        {};
      throw new Error(String(errObj.message ?? 'Stripe incremental pre-authorization failed'));
    }

    const authCode = input.authorizationCode?.trim() || generateAuthCode();
    return {
      status: 'INCREMENTED',
      provider: this.id,
      providerRef: String(updData.id ?? input.providerIntentId),
      additionalAmount: input.additionalAmount,
      newTotalAmount: input.newTotalAmount,
      authorizationCode: authCode,
      message: `Updated Stripe PaymentIntent hold to ${input.currency} ${input.newTotalAmount.toFixed(2)}.`,
      metadata: { method: 'payment_intent_update', stripeStatus: updData.status ?? null },
    };
  }

  async captureHold(args: { providerIntentId: string; amount: number; currency: string }): Promise<CardCaptureResult> {
    const params = new URLSearchParams({
      amount_to_capture: String(Math.round(args.amount * 100)),
    });
    const res = await fetch(
      `https://api.stripe.com/v1/payment_intents/${encodeURIComponent(args.providerIntentId)}/capture`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
        signal: AbortSignal.timeout(15_000),
      },
    );
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      const errObj = (data.error as Record<string, unknown> | undefined) ?? {};
      throw new Error(String(errObj.message ?? 'Stripe capture failed'));
    }
    return {
      status: 'CAPTURED',
      capturedAmount: args.amount,
      providerRef: String(data.latest_charge ?? data.id),
      message: `Captured ${args.currency} ${args.amount.toFixed(2)} via Stripe.`,
    };
  }

  async releaseHold(args: { providerIntentId: string }): Promise<CardReleaseResult> {
    const res = await fetch(
      `https://api.stripe.com/v1/payment_intents/${encodeURIComponent(args.providerIntentId)}/cancel`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.secretKey}` },
        signal: AbortSignal.timeout(15_000),
      },
    );
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      const errObj = (data.error as Record<string, unknown> | undefined) ?? {};
      throw new Error(String(errObj.message ?? 'Stripe hold release failed'));
    }
    return {
      status: 'RELEASED',
      providerRef: String(data.id),
      message: 'Stripe pre-authorization hold cancelled/released.',
    };
  }
}

/**
 * UAE Telr Payment Gateway Provider (`https://secure.telr.com/gateway/remote.json`)
 * Supports `tran.type = 'auth'` (`class = 'ecom' | 'cont'`), `capture`, `release`,
 * and continuous-authority (`cont`) top-up authorization for `incrementHold`.
 */
export class TelrPreAuthProvider implements RacPreAuthProvider {
  readonly id = 'telr';
  private readonly endpoint: string;
  private readonly testMode: string;

  constructor(
    private readonly storeId: string,
    private readonly authKey: string,
    opts?: { endpoint?: string; testMode?: string },
  ) {
    this.endpoint = opts?.endpoint?.trim() || process.env.TELR_API_URL?.trim() || 'https://secure.telr.com/gateway/remote.json';
    this.testMode =
      opts?.testMode ??
      process.env.TELR_TEST_MODE?.trim() ??
      (process.env.NODE_ENV === 'production' ? '0' : '1');
  }

  private async postRemote(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        store: this.storeId,
        authkey: this.authKey,
        ...payload,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const errObj = (data.error as Record<string, unknown> | undefined) ?? {};
      throw new Error(String(errObj.message ?? errObj.note ?? `Telr gateway HTTP ${res.status}`));
    }
    if (data.error && typeof data.error === 'object') {
      const errObj = data.error as Record<string, unknown>;
      throw new Error(String(errObj.message ?? errObj.note ?? 'Telr gateway rejected transaction'));
    }
    return data;
  }

  async authorizeHold(input: CardPreAuthInput): Promise<CardPreAuthResult> {
    if (!(input.amount > 0)) {
      throw new Error('Pre-authorization hold amount must be greater than zero');
    }
    const cartId = `RAC-${input.tenantId.slice(0, 6)}-${Date.now()}`;
    const hasSavedRef = Boolean(input.cardToken && input.cardToken.trim());

    const data = await this.postRemote({
      method: 'create',
      tran: {
        test: this.testMode,
        type: 'auth',
        class: hasSavedRef ? 'cont' : 'ecom',
        cartid: cartId,
        description: input.description ?? `Fleet360 RAC Security Deposit Hold (${input.customerId})`,
        currency: input.currency.toUpperCase(),
        amount: input.amount.toFixed(2),
        ...(hasSavedRef ? { ref: input.cardToken!.trim() } : {}),
      },
    });

    const txObj = (data.transaction as Record<string, unknown> | undefined) ?? {};
    const orderObj = (data.order as Record<string, unknown> | undefined) ?? {};
    const txStatus = String(txObj.status ?? '').toUpperCase();
    const txRef = String(txObj.ref ?? orderObj.ref ?? `telr_${crypto.randomBytes(6).toString('hex')}`);
    const checkoutUrl = typeof orderObj.url === 'string' && orderObj.url.trim() ? orderObj.url.trim() : null;
    const authCode = String(txObj.code ?? '').trim() || generateAuthCode();

    if (txStatus === 'D' || txStatus === 'E') {
      return {
        status: 'FAILED',
        provider: this.id,
        providerIntentId: txRef,
        cardToken: input.cardToken ?? txRef,
        authorizationCode: 'DECLINED',
        cardBrand: (input.cardBrand ?? 'CARD').toUpperCase(),
        cardLast4: (input.cardLast4 ?? '0000').slice(-4),
        expiresAt: new Date().toISOString(),
        checkoutUrl: null,
        message: String(txObj.message ?? 'Telr declined pre-authorization hold.'),
      };
    }

    const resolvedStatus: 'AUTHORIZED' | 'PENDING' =
      txStatus === 'A' || txStatus === 'H' || (!checkoutUrl && hasSavedRef) ? 'AUTHORIZED' : 'PENDING';

    return {
      status: resolvedStatus,
      provider: this.id,
      providerIntentId: txRef,
      cardToken: input.cardToken?.trim() || txRef,
      authorizationCode: authCode,
      cardBrand: (input.cardBrand ?? 'CARD').toUpperCase(),
      cardLast4: (input.cardLast4 ?? '0000').slice(-4),
      expiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      checkoutUrl,
      message:
        resolvedStatus === 'AUTHORIZED'
          ? `Telr hold authorized (${authCode})`
          : 'Telr Hosted Payment Page created; awaiting customer authentication.',
      metadata: { telrCartId: cartId, telrStatus: txStatus || null },
    };
  }

  async incrementHold(input: IncrementPreAuthInput): Promise<IncrementPreAuthResult> {
    if (!(input.additionalAmount > 0)) {
      throw new Error('Incremental hold additionalAmount must be greater than zero');
    }
    const cartId = `RAC-INC-${Date.now()}`;
    const contRef = input.cardToken?.trim() || input.providerIntentId;

    const data = await this.postRemote({
      tran: {
        test: this.testMode,
        type: 'auth',
        class: 'cont',
        ref: contRef,
        cartid: cartId,
        description: input.reason ?? 'Fleet360 RAC Extension Incremental Deposit Hold',
        currency: input.currency.toUpperCase(),
        amount: input.additionalAmount.toFixed(2),
      },
    });

    const txObj = (data.transaction as Record<string, unknown> | undefined) ?? {};
    const txStatus = String(txObj.status ?? '').toUpperCase();
    if (txStatus && txStatus !== 'A' && txStatus !== 'H') {
      return {
        status: 'FAILED',
        provider: this.id,
        providerRef: String(txObj.ref ?? input.providerIntentId),
        additionalAmount: input.additionalAmount,
        newTotalAmount: input.newTotalAmount,
        authorizationCode: input.authorizationCode ?? 'DECLINED',
        message: String(txObj.message ?? 'Telr continuous-authority top-up hold declined.'),
      };
    }

    const authCode = String(txObj.code ?? '').trim() || input.authorizationCode?.trim() || generateAuthCode();
    const newRef = String(txObj.ref ?? input.providerIntentId);
    return {
      status: 'INCREMENTED',
      provider: this.id,
      providerRef: newRef,
      additionalAmount: input.additionalAmount,
      newTotalAmount: input.newTotalAmount,
      authorizationCode: authCode,
      message: `Telr continuous-authority top-up authorized (+${input.currency} ${input.additionalAmount.toFixed(2)}, total ${input.currency} ${input.newTotalAmount.toFixed(2)}).`,
      metadata: { topUpTranRef: newRef, parentTranRef: input.providerIntentId, cartId },
    };
  }

  async captureHold(args: { providerIntentId: string; amount: number; currency: string }): Promise<CardCaptureResult> {
    const data = await this.postRemote({
      tran: {
        test: this.testMode,
        type: 'capture',
        class: 'ecom',
        ref: args.providerIntentId,
        currency: args.currency.toUpperCase(),
        amount: args.amount.toFixed(2),
        description: 'Fleet360 RAC Pre-Auth Capture',
      },
    });
    const txObj = (data.transaction as Record<string, unknown> | undefined) ?? {};
    const txStatus = String(txObj.status ?? 'A').toUpperCase();
    if (txStatus !== 'A' && txStatus !== 'H') {
      throw new Error(String(txObj.message ?? 'Telr capture failed'));
    }
    return {
      status: 'CAPTURED',
      capturedAmount: args.amount,
      providerRef: String(txObj.ref ?? args.providerIntentId),
      message: `Captured ${args.currency} ${args.amount.toFixed(2)} via Telr.`,
    };
  }

  async releaseHold(args: { providerIntentId: string }): Promise<CardReleaseResult> {
    const data = await this.postRemote({
      tran: {
        test: this.testMode,
        type: 'release',
        class: 'ecom',
        ref: args.providerIntentId,
        description: 'Fleet360 RAC Pre-Auth Release',
      },
    });
    const txObj = (data.transaction as Record<string, unknown> | undefined) ?? {};
    const txStatus = String(txObj.status ?? 'A').toUpperCase();
    if (txStatus === 'D' || txStatus === 'E') {
      throw new Error(String(txObj.message ?? 'Telr hold release failed'));
    }
    return {
      status: 'RELEASED',
      providerRef: String(txObj.ref ?? args.providerIntentId),
      message: 'Telr pre-authorization hold released.',
    };
  }
}

/**
 * UAE Network International N-Genius Payment Gateway Provider
 * Exchanges API key for OAuth bearer token and invokes N-Genius Orders API:
 *   - `action: 'AUTH'` on `/orders`
 *   - Incremental auth via `/authorizations`
 *   - Partial/full capture via `/captures`
 *   - Hold reversal via `/cancel`
 */
export class NGeniusPreAuthProvider implements RacPreAuthProvider {
  readonly id = 'ngenius';
  private readonly baseUrl: string;

  constructor(
    private readonly apiKey: string,
    private readonly outletRef: string,
    baseUrl?: string | null,
  ) {
    this.baseUrl = (
      baseUrl?.trim() ||
      process.env.NGENIUS_API_BASE_URL?.trim() ||
      (process.env.NGENIUS_ENV === 'live'
        ? 'https://api-gateway.ngenius-payments.com'
        : 'https://api-gateway.sandbox.ngenius-payments.com')
    ).replace(/\/+$/, '');
  }

  private async getAccessToken(): Promise<string> {
    const authHeader = this.apiKey.startsWith('Basic ') ? this.apiKey : `Basic ${this.apiKey}`;
    const res = await fetch(`${this.baseUrl}/identity/auth/access-token`, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/vnd.ni-identity.v1+json',
        Accept: 'application/vnd.ni-identity.v1+json',
      },
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || typeof data.access_token !== 'string') {
      throw new Error(String(data.message ?? data.error ?? 'N-Genius access token exchange failed'));
    }
    return data.access_token;
  }

  private extractPaymentRef(orderData: Record<string, unknown>): {
    orderRef: string;
    paymentRef: string | null;
    state: string;
    authCode: string | null;
    checkoutUrl: string | null;
  } {
    const orderRef = String(orderData.reference ?? '');
    const embedded = (orderData._embedded as Record<string, unknown> | undefined) ?? {};
    const payments = Array.isArray(embedded.payment) ? (embedded.payment as Record<string, unknown>[]) : [];
    const firstPayment = payments[0] ?? {};
    const rawId = typeof firstPayment._id === 'string' ? firstPayment._id : '';
    const paymentRef = rawId ? rawId.split(':').pop() ?? rawId : null;
    const state = String(firstPayment.state ?? orderData.state ?? '').toUpperCase();
    const authResp = (firstPayment.authResponse as Record<string, unknown> | undefined) ?? {};
    const authCode =
      typeof authResp.authorizationCode === 'string' && authResp.authorizationCode.trim()
        ? authResp.authorizationCode.trim()
        : null;
    const links = (orderData._links as Record<string, unknown> | undefined) ?? {};
    const paymentLink = (links.payment as Record<string, unknown> | undefined) ?? {};
    const checkoutUrl = typeof paymentLink.href === 'string' ? paymentLink.href : null;
    return { orderRef, paymentRef, state, authCode, checkoutUrl };
  }

  private async resolveOrderAndPayment(
    accessToken: string,
    providerIntentId: string,
  ): Promise<{ orderRef: string; paymentRef: string }> {
    if (providerIntentId.includes(':')) {
      const [orderRef, paymentRef] = providerIntentId.split(':', 2);
      if (orderRef && paymentRef) return { orderRef, paymentRef };
    }
    const res = await fetch(
      `${this.baseUrl}/transactions/outlets/${encodeURIComponent(this.outletRef)}/orders/${encodeURIComponent(providerIntentId)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.ni-payment.v2+json',
        },
        signal: AbortSignal.timeout(15_000),
      },
    );
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(String(data.message ?? 'Failed to retrieve N-Genius order reference'));
    }
    const extracted = this.extractPaymentRef(data);
    if (!extracted.orderRef || !extracted.paymentRef) {
      throw new Error('N-Genius order has no active payment reference');
    }
    return { orderRef: extracted.orderRef, paymentRef: extracted.paymentRef };
  }

  async authorizeHold(input: CardPreAuthInput): Promise<CardPreAuthResult> {
    if (!(input.amount > 0)) {
      throw new Error('Pre-authorization hold amount must be greater than zero');
    }
    const token = await this.getAccessToken();
    const res = await fetch(
      `${this.baseUrl}/transactions/outlets/${encodeURIComponent(this.outletRef)}/orders`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/vnd.ni-payment.v2+json',
          Accept: 'application/vnd.ni-payment.v2+json',
        },
        body: JSON.stringify({
          action: 'AUTH',
          amount: {
            currencyCode: input.currency.toUpperCase(),
            value: Math.round(input.amount * 100),
          },
          merchantOrderReference: `RAC-${input.customerId.slice(0, 8)}-${Date.now()}`,
          merchantAttributes: {
            skipConfirmationPage: true,
          },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(String(data.message ?? 'N-Genius pre-authorization order creation failed'));
    }

    const extracted = this.extractPaymentRef(data);
    if (extracted.state === 'FAILED' || extracted.state === 'DECLINED') {
      return {
        status: 'FAILED',
        provider: this.id,
        providerIntentId: extracted.orderRef,
        cardToken: input.cardToken ?? '',
        authorizationCode: 'DECLINED',
        cardBrand: (input.cardBrand ?? 'CARD').toUpperCase(),
        cardLast4: (input.cardLast4 ?? '0000').slice(-4),
        expiresAt: new Date().toISOString(),
        checkoutUrl: null,
        message: 'N-Genius pre-authorization was declined.',
      };
    }

    const status: 'AUTHORIZED' | 'PENDING' =
      extracted.state === 'AUTHORISED' || extracted.state === 'AUTHORIZED' ? 'AUTHORIZED' : 'PENDING';
    const authCode = extracted.authCode ?? generateAuthCode();
    const compositeIntentId = extracted.paymentRef
      ? `${extracted.orderRef}:${extracted.paymentRef}`
      : extracted.orderRef;

    return {
      status,
      provider: this.id,
      providerIntentId: compositeIntentId,
      cardToken: input.cardToken ?? compositeIntentId,
      authorizationCode: authCode,
      cardBrand: (input.cardBrand ?? 'CARD').toUpperCase(),
      cardLast4: (input.cardLast4 ?? '0000').slice(-4),
      expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      checkoutUrl: extracted.checkoutUrl,
      message:
        status === 'AUTHORIZED'
          ? `N-Genius hold authorized (${authCode})`
          : 'N-Genius AUTH order created; awaiting cardholder authorization.',
      metadata: { orderRef: extracted.orderRef, paymentRef: extracted.paymentRef, state: extracted.state },
    };
  }

  async incrementHold(input: IncrementPreAuthInput): Promise<IncrementPreAuthResult> {
    if (!(input.additionalAmount > 0)) {
      throw new Error('Incremental hold additionalAmount must be greater than zero');
    }
    const token = await this.getAccessToken();
    const { orderRef, paymentRef } = await this.resolveOrderAndPayment(token, input.providerIntentId);

    const res = await fetch(
      `${this.baseUrl}/transactions/outlets/${encodeURIComponent(this.outletRef)}/orders/${encodeURIComponent(orderRef)}/payments/${encodeURIComponent(paymentRef)}/authorizations`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/vnd.ni-payment.v2+json',
          Accept: 'application/vnd.ni-payment.v2+json',
        },
        body: JSON.stringify({
          amount: {
            currencyCode: input.currency.toUpperCase(),
            value: Math.round(input.additionalAmount * 100),
          },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(String(data.message ?? 'N-Genius incremental authorization failed'));
    }

    const authCode = input.authorizationCode?.trim() || generateAuthCode();
    return {
      status: 'INCREMENTED',
      provider: this.id,
      providerRef: `${orderRef}:${paymentRef}`,
      additionalAmount: input.additionalAmount,
      newTotalAmount: input.newTotalAmount,
      authorizationCode: authCode,
      message: `Incremented N-Genius AUTH hold by ${input.currency} ${input.additionalAmount.toFixed(2)} to ${input.currency} ${input.newTotalAmount.toFixed(2)}.`,
      metadata: { orderRef, paymentRef, state: data.state ?? null },
    };
  }

  async captureHold(args: { providerIntentId: string; amount: number; currency: string }): Promise<CardCaptureResult> {
    const token = await this.getAccessToken();
    const { orderRef, paymentRef } = await this.resolveOrderAndPayment(token, args.providerIntentId);

    const res = await fetch(
      `${this.baseUrl}/transactions/outlets/${encodeURIComponent(this.outletRef)}/orders/${encodeURIComponent(orderRef)}/payments/${encodeURIComponent(paymentRef)}/captures`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/vnd.ni-payment.v2+json',
          Accept: 'application/vnd.ni-payment.v2+json',
        },
        body: JSON.stringify({
          amount: {
            currencyCode: args.currency.toUpperCase(),
            value: Math.round(args.amount * 100),
          },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(String(data.message ?? 'N-Genius capture failed'));
    }
    return {
      status: 'CAPTURED',
      capturedAmount: args.amount,
      providerRef: `${orderRef}:${paymentRef}`,
      message: `Captured ${args.currency} ${args.amount.toFixed(2)} via N-Genius.`,
    };
  }

  async releaseHold(args: { providerIntentId: string }): Promise<CardReleaseResult> {
    const token = await this.getAccessToken();
    const { orderRef, paymentRef } = await this.resolveOrderAndPayment(token, args.providerIntentId);

    const cancelUrl = `${this.baseUrl}/transactions/outlets/${encodeURIComponent(this.outletRef)}/orders/${encodeURIComponent(orderRef)}/payments/${encodeURIComponent(paymentRef)}/cancel`;
    let res = await fetch(cancelUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.ni-payment.v2+json',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 405) {
      res = await fetch(cancelUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.ni-payment.v2+json',
        },
        signal: AbortSignal.timeout(15_000),
      });
    }
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(String(data.message ?? 'N-Genius AUTH reversal failed'));
    }
    return {
      status: 'RELEASED',
      providerRef: `${orderRef}:${paymentRef}`,
      message: 'N-Genius pre-authorization hold reversed/released.',
    };
  }
}

export function getRacPreAuthProvider(preferredProvider?: string | null): RacPreAuthProvider {
  const explicit = (preferredProvider ?? '').trim().toLowerCase();
  const envConfigured = (process.env.RAC_PAYMENT_PROVIDER ?? '').trim().toLowerCase();
  const selected = explicit || envConfigured;

  if (selected === 'sandbox') {
    return new SandboxPreAuthProvider();
  }
  if (selected === 'stripe' && process.env.STRIPE_SECRET_KEY) {
    return new StripeManualCaptureProvider(process.env.STRIPE_SECRET_KEY);
  }
  if (selected === 'telr' && process.env.TELR_STORE_ID && process.env.TELR_AUTH_KEY) {
    return new TelrPreAuthProvider(process.env.TELR_STORE_ID, process.env.TELR_AUTH_KEY);
  }
  if (selected === 'ngenius' && process.env.NGENIUS_API_KEY && process.env.NGENIUS_OUTLET_REF) {
    return new NGeniusPreAuthProvider(process.env.NGENIUS_API_KEY, process.env.NGENIUS_OUTLET_REF);
  }

  // Auto-detect live gateway credentials when neither preferredProvider nor RAC_PAYMENT_PROVIDER forced sandbox
  if (!selected) {
    if (process.env.TELR_STORE_ID && process.env.TELR_AUTH_KEY) {
      return new TelrPreAuthProvider(process.env.TELR_STORE_ID, process.env.TELR_AUTH_KEY);
    }
    if (process.env.NGENIUS_API_KEY && process.env.NGENIUS_OUTLET_REF) {
      return new NGeniusPreAuthProvider(process.env.NGENIUS_API_KEY, process.env.NGENIUS_OUTLET_REF);
    }
    if (process.env.STRIPE_SECRET_KEY && process.env.NODE_ENV !== 'test') {
      return new StripeManualCaptureProvider(process.env.STRIPE_SECRET_KEY);
    }
  }

  return new SandboxPreAuthProvider();
}
