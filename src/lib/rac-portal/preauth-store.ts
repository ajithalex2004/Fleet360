/**
 * Card Pre-Authorization Hold Store (`rac_card_preauths`).
 *
 * Tenant-isolated via `withTenantRls` + PostgreSQL `FORCE ROW LEVEL SECURITY`.
 * Tracks AUTHORIZED → CAPTURED / RELEASED holds across online B2B bookings,
 * counter handovers, and final invoice closeouts.
 */

import { prisma } from '@/lib/prisma';
import { withTenantRls, type TxClient } from '@/lib/rls';
import { withSavepoint } from '@/lib/rental/locks';
import {
  getRacPreAuthProvider,
  type CardPreAuthResult,
  type IncrementPreAuthResult,
} from './preauth-provider';

export type PreAuthStatus =
  | 'PENDING'
  | 'AUTHORIZED'
  | 'CAPTURING'
  | 'CAPTURED'
  | 'RELEASING'
  | 'RELEASED'
  | 'FAILED'
  | 'EXPIRED';

export interface RacCardPreAuth {
  id: string;
  tenantId: string;
  customerId: string;
  bookingId: string | null;
  agreementId: string | null;
  invoiceId: string | null;
  amount: number;
  incrementalAmount?: number;
  capturedAmount: number;
  currency: string;
  provider: string;
  providerIntentId: string | null;
  cardToken: string | null;
  authorizationCode: string;
  cardBrand: string | null;
  cardLast4: string | null;
  cardholderName: string | null;
  status: PreAuthStatus;
  expiresAt: string | null;
  capturedAt: string | null;
  releasedAt: string | null;
  initiatedBy: string;
  initiatedByUser: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Redacted pre-authorization shape safe to serialize in API JSON responses.
 * Never exposes reusable `cardToken` or gateway `providerIntentId`.
 */
export interface PublicRacCardPreAuth {
  id: string;
  tenantId: string;
  customerId: string;
  bookingId: string | null;
  agreementId: string | null;
  invoiceId: string | null;
  provider: string;
  cardBrand: string | null;
  cardLast4: string | null;
  cardholderName: string | null;
  expiryMonth: number | null;
  expiryYear: number | null;
  /** Alias for `authorizedAmount` preserved for portal UI display compatibility. */
  amount: number;
  authorizedAmount: number;
  incrementalAmount: number;
  capturedAmount: number;
  releasedAmount: number;
  currency: string;
  status: PreAuthStatus;
  authorizationCode: string;
  expiresAt: string | null;
  capturedAt: string | null;
  releasedAt: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toPublicRacPreAuth(record: RacCardPreAuth): PublicRacCardPreAuth {
  const authorizedAmount = Number(record.amount ?? 0);
  const incrementalAmount = Number(record.incrementalAmount ?? 0);
  const capturedAmount = Number(record.capturedAmount ?? 0);
  const releasedAmount =
    record.status === 'RELEASED'
      ? Math.max(0, Number((authorizedAmount - capturedAmount).toFixed(2)))
      : 0;

  return {
    id: record.id,
    tenantId: record.tenantId,
    customerId: record.customerId,
    bookingId: record.bookingId,
    agreementId: record.agreementId,
    invoiceId: record.invoiceId,
    provider: record.provider,
    cardBrand: record.cardBrand,
    cardLast4: record.cardLast4,
    cardholderName: record.cardholderName,
    expiryMonth: null,
    expiryYear: null,
    amount: authorizedAmount,
    authorizedAmount,
    incrementalAmount,
    capturedAmount,
    releasedAmount,
    currency: record.currency,
    status: record.status,
    authorizationCode: record.authorizationCode,
    expiresAt: record.expiresAt,
    capturedAt: record.capturedAt,
    releasedAt: record.releasedAt,
    failureReason: record.status === 'FAILED' ? record.notes : null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

interface Row {
  id: string;
  tenant_id: string;
  customer_id: string;
  booking_id: string | null;
  agreement_id: string | null;
  invoice_id: string | null;
  amount: string;
  captured_amount: string;
  currency: string;
  provider: string;
  provider_intent_id: string | null;
  card_token: string | null;
  authorization_code: string;
  card_brand: string | null;
  card_last4: string | null;
  cardholder_name: string | null;
  status: string;
  expires_at: string | null;
  captured_at: string | null;
  released_at: string | null;
  initiated_by: string;
  initiated_by_user: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const SELECT = `id::text, tenant_id, customer_id, booking_id, agreement_id, invoice_id,
  amount::text, captured_amount::text, currency, provider, provider_intent_id, card_token,
  authorization_code, card_brand, card_last4, cardholder_name, status,
  expires_at::text, captured_at::text, released_at::text,
  initiated_by, initiated_by_user, notes, created_at::text, updated_at::text`;

function rowToApi(r: Row): RacCardPreAuth {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    customerId: r.customer_id,
    bookingId: r.booking_id,
    agreementId: r.agreement_id,
    invoiceId: r.invoice_id,
    amount: Number(r.amount),
    capturedAmount: Number(r.captured_amount ?? 0),
    currency: r.currency,
    provider: r.provider,
    providerIntentId: r.provider_intent_id,
    cardToken: r.card_token,
    authorizationCode: r.authorization_code,
    cardBrand: r.card_brand,
    cardLast4: r.card_last4,
    cardholderName: r.cardholder_name,
    status: r.status as PreAuthStatus,
    expiresAt: r.expires_at,
    capturedAt: r.captured_at,
    releasedAt: r.released_at,
    initiatedBy: r.initiated_by,
    initiatedByUser: r.initiated_by_user,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function runInTxOrTenant<T>(
  tenantId: string,
  existingTx: TxClient | undefined,
  fn: (tx: TxClient) => Promise<T>,
): Promise<T> {
  if (existingTx) return fn(existingTx);
  return withTenantRls(prisma, tenantId, fn);
}

export async function authorizeGatewayHold(args: {
  tenantId: string;
  customerId: string;
  amount: number;
  currency?: string;
  provider?: string | null;
  cardToken?: string | null;
  cardBrand?: string | null;
  cardLast4?: string | null;
  cardholderName?: string | null;
  expiryMonth?: number | null;
  expiryYear?: number | null;
  notes?: string | null;
}): Promise<CardPreAuthResult> {
  const provider = getRacPreAuthProvider(args.provider);
  const currency = args.currency ?? 'AED';
  const gatewayRes = await provider.authorizeHold({
    tenantId: args.tenantId,
    customerId: args.customerId,
    amount: args.amount,
    currency,
    cardToken: args.cardToken,
    cardBrand: args.cardBrand,
    cardLast4: args.cardLast4,
    cardholderName: args.cardholderName,
    expiryMonth: args.expiryMonth,
    expiryYear: args.expiryYear,
    description: args.notes ?? undefined,
  });

  if (gatewayRes.status === 'FAILED') {
    throw new Error(gatewayRes.message);
  }
  return gatewayRes;
}

export async function bestEffortReleaseGatewayHold(
  providerIntentId: string | null | undefined,
  providerName?: string | null,
): Promise<void> {
  if (!providerIntentId) return;
  const provider = getRacPreAuthProvider(providerName);
  await provider.releaseHold({ providerIntentId }).catch((err) => {
    console.warn('[preauth-store] Best-effort gateway releaseHold failed:', err);
  });
}

async function assertPreAuthForeignLinksInTx(
  tx: TxClient,
  args: {
    tenantId: string;
    customerId: string;
    bookingId?: string | null;
    agreementId?: string | null;
  },
): Promise<void> {
  if (args.agreementId) {
    const agrCheck = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id::text AS id
         FROM rental_agreements
        WHERE id = $1
          AND tenant_id::text = $2
          AND customer_id = $3
          AND deleted_at IS NULL
        LIMIT 1`,
      args.agreementId,
      args.tenantId,
      args.customerId,
    );
    if (!agrCheck[0]) {
      throw new Error('Agreement not found for customer');
    }
  }

  if (args.bookingId) {
    const bkCheck = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id::text AS id
         FROM rental_bookings
        WHERE id = $1
          AND tenant_id = $2
          AND customer_id = $3
          AND deleted_at IS NULL
        LIMIT 1`,
      args.bookingId,
      args.tenantId,
      args.customerId,
    );
    if (!bkCheck[0]) {
      throw new Error('Booking not found for customer');
    }
  }
}

export async function recordAuthorizedPreAuthInTx(
  tx: TxClient,
  args: {
    tenantId: string;
    customerId: string;
    bookingId?: string | null;
    agreementId?: string | null;
    invoiceId?: string | null;
    amount: number;
    capturedAmount?: number;
    currency?: string;
    cardholderName?: string | null;
    initiatedBy: 'PORTAL_USER' | 'STAFF';
    initiatedByUser?: string | null;
    notes?: string | null;
    statusOverride?: 'AUTHORIZED' | 'CAPTURED';
  },
  gatewayRes: CardPreAuthResult,
): Promise<RacCardPreAuth> {
  await assertPreAuthForeignLinksInTx(tx, {
    tenantId: args.tenantId,
    customerId: args.customerId,
    bookingId: args.bookingId,
    agreementId: args.agreementId,
  });

  const currency = args.currency ?? 'AED';
  const effectiveStatus = args.statusOverride ?? gatewayRes.status;
  const isCaptured = effectiveStatus === 'CAPTURED';
  const capturedAmt = isCaptured ? Number(args.capturedAmount ?? args.amount) : 0;

  const rows = await tx.$queryRawUnsafe<Row[]>(
    `INSERT INTO rac_card_preauths
       (tenant_id, customer_id, booking_id, agreement_id, invoice_id, amount, captured_amount, currency,
        provider, provider_intent_id, card_token, authorization_code,
        card_brand, card_last4, cardholder_name, status, expires_at, captured_at,
        initiated_by, initiated_by_user, notes)
     VALUES
       ($1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12,
        $13, $14, $15, $16, $17::timestamptz, CASE WHEN $18::boolean THEN NOW() ELSE NULL END,
        $19, $20, $21)
     RETURNING ${SELECT}`,
    args.tenantId,
    args.customerId,
    args.bookingId ?? null,
    args.agreementId ?? null,
    args.invoiceId ?? null,
    args.amount,
    capturedAmt,
    currency,
    gatewayRes.provider,
    gatewayRes.providerIntentId,
    gatewayRes.cardToken,
    gatewayRes.authorizationCode,
    gatewayRes.cardBrand,
    gatewayRes.cardLast4,
    args.cardholderName?.trim() ?? null,
    effectiveStatus,
    gatewayRes.expiresAt,
    isCaptured,
    args.initiatedBy,
    args.initiatedByUser ?? null,
    args.notes ?? null,
  );
  if (!rows[0]) throw new Error('Failed to record card pre-authorization');

  // Sync agreement deposit & card token metadata if linked to an agreement as an active hold
  if (args.agreementId && effectiveStatus === 'AUTHORIZED') {
    await tx.$executeRawUnsafe(
      `UPDATE rental_agreements
          SET security_deposit = $1,
              deposit_status = 'PAID',
              authorization_code = $2,
              credit_card_last4 = $3,
              credit_card_token = $4,
              updated_at = NOW()
        WHERE id = $5 AND tenant_id::text = $6 AND customer_id = $7`,
      args.amount,
      gatewayRes.authorizationCode,
      gatewayRes.cardLast4,
      gatewayRes.cardToken,
      args.agreementId,
      args.tenantId,
      args.customerId,
    );
  }

  return rowToApi(rows[0]);
}

export async function createRacCardPreAuth(args: {
  tenantId: string;
  customerId: string;
  bookingId?: string | null;
  agreementId?: string | null;
  amount: number;
  currency?: string;
  cardToken?: string | null;
  cardBrand?: string | null;
  cardLast4?: string | null;
  cardholderName?: string | null;
  expiryMonth?: number | null;
  expiryYear?: number | null;
  initiatedBy: 'PORTAL_USER' | 'STAFF';
  initiatedByUser?: string | null;
  notes?: string | null;
  tx?: TxClient;
}): Promise<{ preauth: RacCardPreAuth; message: string }> {
  // Phase 0: when not inside an existing tx and foreign links are specified,
  // validate ownership in a short RLS read BEFORE authorizing a hold on the card.
  if (!args.tx && (args.agreementId || args.bookingId)) {
    await withTenantRls(prisma, args.tenantId, (tx) =>
      assertPreAuthForeignLinksInTx(tx, {
        tenantId: args.tenantId,
        customerId: args.customerId,
        bookingId: args.bookingId,
        agreementId: args.agreementId,
      }),
    );
  }

  // Phase 1 (outside DB tx when args.tx is omitted): authorize hold at external gateway
  const gatewayRes = await authorizeGatewayHold(args);

  // Phase 2: persist hold in short RLS tx; if DB persistence fails, release gateway hold
  try {
    const preauth = await runInTxOrTenant(args.tenantId, args.tx, (tx) =>
      recordAuthorizedPreAuthInTx(tx, args, gatewayRes),
    );
    return { preauth, message: gatewayRes.message };
  } catch (dbErr) {
    await bestEffortReleaseGatewayHold(gatewayRes.providerIntentId);
    throw dbErr;
  }
}

export async function linkPreAuthToBookingInTx(
  tx: TxClient,
  args: {
    tenantId: string;
    preauthId: string;
    customerId: string;
    bookingId: string;
  },
): Promise<RacCardPreAuth | null> {
  const rows = await tx.$queryRawUnsafe<Row[]>(
    `UPDATE rac_card_preauths
        SET booking_id = $1, updated_at = NOW()
      WHERE id = $2::uuid
        AND tenant_id = $3
        AND customer_id = $4
        AND status = 'AUTHORIZED'
        AND (booking_id IS NULL OR booking_id = $1)
      RETURNING ${SELECT}`,
    args.bookingId,
    args.preauthId,
    args.tenantId,
    args.customerId,
  );
  return rows[0] ? rowToApi(rows[0]) : null;
}

export async function listPreAuthsForCustomer(
  tenantId: string,
  customerId: string,
): Promise<RacCardPreAuth[]> {
  return withTenantRls(prisma, tenantId, async (tx) => {
    const rows = await tx.$queryRawUnsafe<Row[]>(
      `SELECT ${SELECT}
         FROM rac_card_preauths
        WHERE tenant_id = $1 AND customer_id = $2
        ORDER BY created_at DESC`,
      tenantId,
      customerId,
    );
    return rows.map(rowToApi);
  });
}

export async function listPreAuthsForTenant(
  tenantId: string,
  filters?: {
    customerId?: string | null;
    bookingId?: string | null;
    agreementId?: string | null;
    status?: string | null;
    limit?: number;
  },
): Promise<RacCardPreAuth[]> {
  return withTenantRls(prisma, tenantId, async (tx) => {
    const conds: string[] = ['tenant_id = $1'];
    const params: unknown[] = [tenantId];
    let pi = 2;

    if (filters?.customerId) {
      conds.push(`customer_id = $${pi++}`);
      params.push(filters.customerId);
    }
    if (filters?.bookingId) {
      conds.push(`booking_id = $${pi++}`);
      params.push(filters.bookingId);
    }
    if (filters?.agreementId) {
      conds.push(`agreement_id = $${pi++}`);
      params.push(filters.agreementId);
    }
    if (filters?.status) {
      conds.push(`status = $${pi++}`);
      params.push(filters.status.toUpperCase());
    }

    const limit = Math.min(200, Math.max(1, filters?.limit ?? 100));
    params.push(limit);

    const rows = await tx.$queryRawUnsafe<Row[]>(
      `SELECT ${SELECT}
         FROM rac_card_preauths
        WHERE ${conds.join(' AND ')}
        ORDER BY created_at DESC
        LIMIT $${pi}`,
      ...params,
    );
    return rows.map(rowToApi);
  });
}

export async function lockAndClaimPreAuthInTx(
  tx: TxClient,
  args: {
    tenantId: string;
    preauthId: string;
    customerId?: string | null;
    claimStatus: 'CAPTURING' | 'RELEASING';
  },
): Promise<RacCardPreAuth | null> {
  const existingRows = await tx.$queryRawUnsafe<Row[]>(
    `SELECT ${SELECT} FROM rac_card_preauths
      WHERE id = $1::uuid
        AND tenant_id = $2
        AND ($3::text IS NULL OR customer_id = $3)
      LIMIT 1
      FOR UPDATE`,
    args.preauthId,
    args.tenantId,
    args.customerId ?? null,
  );
  const existing = existingRows[0];
  if (!existing) return null;

  const hold = rowToApi(existing);
  if (hold.status !== 'AUTHORIZED') {
    return hold;
  }

  await withSavepoint(
    tx,
    `preauth_claim_${args.claimStatus.toLowerCase()}`,
    async () => {
      await tx.$executeRawUnsafe(
        `UPDATE rac_card_preauths
            SET status = $1,
                updated_at = NOW()
          WHERE id = $2::uuid
            AND tenant_id = $3
            AND status = 'AUTHORIZED'`,
        args.claimStatus,
        args.preauthId,
        args.tenantId,
      );
    },
    undefined,
  );

  return hold;
}

export async function revertPreAuthClaim(
  tenantId: string,
  preauthId: string,
  claimStatus: 'CAPTURING' | 'RELEASING',
): Promise<void> {
  await withTenantRls(prisma, tenantId, async (tx) => {
    await withSavepoint(
      tx,
      `preauth_revert_${claimStatus.toLowerCase()}`,
      async () => {
        await tx.$executeRawUnsafe(
          `UPDATE rac_card_preauths
              SET status = 'AUTHORIZED',
                  updated_at = NOW()
            WHERE id = $1::uuid
              AND tenant_id = $2
              AND status = $3`,
          preauthId,
          tenantId,
          claimStatus,
        );
      },
      undefined,
    );
  }).catch((err) => {
    console.warn('[preauth-store] Failed to revert preauth status to AUTHORIZED:', err);
  });
}

export async function finalizeCapturedPreAuthInTx(
  tx: TxClient,
  args: {
    tenantId: string;
    preauthId: string;
    customerId?: string | null;
    capturedAmount: number;
    invoiceId?: string | null;
  },
): Promise<RacCardPreAuth> {
  const updated = await tx.$queryRawUnsafe<Row[]>(
    `UPDATE rac_card_preauths
        SET status = 'CAPTURED',
            captured_amount = $1,
            invoice_id = COALESCE($2, invoice_id),
            captured_at = NOW(),
            updated_at = NOW()
      WHERE id = $3::uuid
        AND tenant_id = $4
        AND status IN ('CAPTURING', 'AUTHORIZED')
        AND ($5::text IS NULL OR customer_id = $5)
      RETURNING ${SELECT}`,
    args.capturedAmount,
    args.invoiceId ?? null,
    args.preauthId,
    args.tenantId,
    args.customerId ?? null,
  );
  if (!updated[0]) {
    throw new Error('Pre-authorization hold could not be captured (concurrent update)');
  }
  return rowToApi(updated[0]);
}

export async function finalizeReleasedPreAuthInTx(
  tx: TxClient,
  args: {
    tenantId: string;
    preauthId: string;
    customerId?: string | null;
    notes?: string | null;
    agreementId?: string | null;
    depositStatus?: 'RELEASED' | 'REFUNDED';
  },
): Promise<RacCardPreAuth> {
  const updated = await tx.$queryRawUnsafe<Row[]>(
    `UPDATE rac_card_preauths
        SET status = 'RELEASED',
            released_at = NOW(),
            notes = COALESCE($1, notes),
            updated_at = NOW()
      WHERE id = $2::uuid
        AND tenant_id = $3
        AND status IN ('RELEASING', 'AUTHORIZED')
        AND ($4::text IS NULL OR customer_id = $4)
      RETURNING ${SELECT}`,
    args.notes ?? null,
    args.preauthId,
    args.tenantId,
    args.customerId ?? null,
  );
  if (!updated[0]) {
    throw new Error('Pre-authorization hold could not be released (concurrent update)');
  }

  const resolvedAgreementId = args.agreementId ?? updated[0].agreement_id;
  if (resolvedAgreementId) {
    const nextDepStatus = args.depositStatus ?? 'REFUNDED';
    await tx.$executeRawUnsafe(
      `UPDATE rental_agreements
          SET deposit_status = $1,
              updated_at = NOW()
        WHERE id = $2 AND tenant_id::text = $3`,
      nextDepStatus,
      resolvedAgreementId,
      args.tenantId,
    );
  }

  return rowToApi(updated[0]);
}

export async function captureRacCardPreAuth(args: {
  tenantId: string;
  preauthId: string;
  customerId?: string | null;
  captureAmount?: number;
  invoiceId?: string | null;
  actorId?: string | null;
  tx?: TxClient;
}): Promise<RacCardPreAuth> {
  if (args.tx) {
    const tx = args.tx;
    const hold = await lockAndClaimPreAuthInTx(tx, {
      tenantId: args.tenantId,
      preauthId: args.preauthId,
      customerId: args.customerId,
      claimStatus: 'CAPTURING',
    });
    if (!hold) throw new Error('Pre-authorization hold not found');
    if (hold.status !== 'AUTHORIZED') {
      throw new Error(`Cannot capture hold in status ${hold.status}`);
    }
    const maxAmount = Math.max(0, Number((hold.amount - hold.capturedAmount).toFixed(2)));
    const amountToCapture = args.captureAmount != null ? Number(args.captureAmount) : maxAmount;
    if (!(amountToCapture > 0) || amountToCapture > maxAmount + 0.0001) {
      throw new Error(`Capture amount must be between 0.01 and ${maxAmount.toFixed(2)}`);
    }
    const provider = getRacPreAuthProvider(hold.provider);
    await provider.captureHold({
      providerIntentId: hold.providerIntentId ?? hold.id,
      amount: amountToCapture,
      currency: hold.currency,
    });
    return finalizeCapturedPreAuthInTx(tx, {
      tenantId: args.tenantId,
      preauthId: args.preauthId,
      customerId: args.customerId,
      capturedAmount: amountToCapture,
      invoiceId: args.invoiceId,
    });
  }

  // 3-phase lock-safe execution: never hold DB FOR UPDATE across external gateway HTTP
  const { hold, amountToCapture } = await withTenantRls(prisma, args.tenantId, async (tx) => {
    const claimed = await lockAndClaimPreAuthInTx(tx, {
      tenantId: args.tenantId,
      preauthId: args.preauthId,
      customerId: args.customerId,
      claimStatus: 'CAPTURING',
    });
    if (!claimed) throw new Error('Pre-authorization hold not found');
    if (claimed.status !== 'AUTHORIZED') {
      throw new Error(`Cannot capture hold in status ${claimed.status}`);
    }

    const maxAmount = Math.max(0, Number((claimed.amount - claimed.capturedAmount).toFixed(2)));
    const requested = args.captureAmount != null ? Number(args.captureAmount) : maxAmount;
    if (!(requested > 0) || requested > maxAmount + 0.0001) {
      await withSavepoint(
        tx,
        'preauth_unclaim_invalid_amt',
        () =>
          tx.$executeRawUnsafe(
            `UPDATE rac_card_preauths SET status = 'AUTHORIZED', updated_at = NOW() WHERE id = $1::uuid AND tenant_id = $2`,
            args.preauthId,
            args.tenantId,
          ),
        0,
      );
      throw new Error(`Capture amount must be between 0.01 and ${maxAmount.toFixed(2)}`);
    }

    return { hold: claimed, amountToCapture: requested };
  });

  const provider = getRacPreAuthProvider(hold.provider);
  try {
    await provider.captureHold({
      providerIntentId: hold.providerIntentId ?? hold.id,
      amount: amountToCapture,
      currency: hold.currency,
    });
  } catch (gatewayErr) {
    await revertPreAuthClaim(args.tenantId, args.preauthId, 'CAPTURING');
    throw gatewayErr;
  }

  return withTenantRls(prisma, args.tenantId, (tx) =>
    finalizeCapturedPreAuthInTx(tx, {
      tenantId: args.tenantId,
      preauthId: args.preauthId,
      customerId: args.customerId,
      capturedAmount: amountToCapture,
      invoiceId: args.invoiceId,
    }),
  );
}

export async function releaseRacCardPreAuth(args: {
  tenantId: string;
  preauthId: string;
  customerId?: string | null;
  notes?: string | null;
  depositStatus?: 'RELEASED' | 'REFUNDED';
  tx?: TxClient;
}): Promise<RacCardPreAuth> {
  if (args.tx) {
    const tx = args.tx;
    const hold = await lockAndClaimPreAuthInTx(tx, {
      tenantId: args.tenantId,
      preauthId: args.preauthId,
      customerId: args.customerId,
      claimStatus: 'RELEASING',
    });
    if (!hold) throw new Error('Pre-authorization hold not found');
    if (hold.status !== 'AUTHORIZED') {
      throw new Error(`Cannot release hold in status ${hold.status}`);
    }
    const provider = getRacPreAuthProvider(hold.provider);
    await provider.releaseHold({
      providerIntentId: hold.providerIntentId ?? hold.id,
    });
    return finalizeReleasedPreAuthInTx(tx, {
      tenantId: args.tenantId,
      preauthId: args.preauthId,
      customerId: args.customerId,
      notes: args.notes,
      agreementId: hold.agreementId,
      depositStatus: args.depositStatus,
    });
  }

  // 3-phase lock-safe execution: never hold DB FOR UPDATE across external gateway HTTP
  const hold = await withTenantRls(prisma, args.tenantId, async (tx) => {
    const claimed = await lockAndClaimPreAuthInTx(tx, {
      tenantId: args.tenantId,
      preauthId: args.preauthId,
      customerId: args.customerId,
      claimStatus: 'RELEASING',
    });
    if (!claimed) throw new Error('Pre-authorization hold not found');
    if (claimed.status !== 'AUTHORIZED') {
      throw new Error(`Cannot release hold in status ${claimed.status}`);
    }
    return claimed;
  });

  const provider = getRacPreAuthProvider(hold.provider);
  try {
    await provider.releaseHold({
      providerIntentId: hold.providerIntentId ?? hold.id,
    });
  } catch (gatewayErr) {
    await revertPreAuthClaim(args.tenantId, args.preauthId, 'RELEASING');
    throw gatewayErr;
  }

  return withTenantRls(prisma, args.tenantId, (tx) =>
    finalizeReleasedPreAuthInTx(tx, {
      tenantId: args.tenantId,
      preauthId: args.preauthId,
      customerId: args.customerId,
      notes: args.notes,
      agreementId: hold.agreementId,
      depositStatus: args.depositStatus,
    }),
  );
}

/**
 * Increments an active `AUTHORIZED` card pre-authorization hold in 3 lock-safe phases:
 *   Phase 1 (short RLS tx): validate `AUTHORIZED` row & compute `newTotalAmount`
 *   Phase 2 (outside RLS):  call `provider.incrementHold(...)` at Stripe / Telr / N-Genius / Sandbox
 *   Phase 3 (short RLS tx): atomically increment `amount` & `incremental_amount` + store `gateway_metadata`
 */
export async function incrementRacCardPreAuth(args: {
  tenantId: string;
  preauthId: string;
  customerId?: string | null;
  additionalAmount: number;
  reason?: string | null;
  initiatedByUser?: string | null;
}): Promise<{ preauth: RacCardPreAuth; increment: IncrementPreAuthResult }> {
  const addAmt = Number((Number(args.additionalAmount) || 0).toFixed(2));
  if (!(addAmt > 0)) {
    throw new Error('Incremental pre-authorization amount must be greater than zero');
  }

  // Phase 1 (Short RLS tx): read and verify AUTHORIZED row
  const hold = await withTenantRls(prisma, args.tenantId, async (tx) => {
    const rows = await tx.$queryRawUnsafe<Row[]>(
      `SELECT ${SELECT}
         FROM rac_card_preauths
        WHERE id = $1::uuid
          AND tenant_id = $2
          AND ($3::text IS NULL OR customer_id = $3)
        LIMIT 1`,
      args.preauthId,
      args.tenantId,
      args.customerId ?? null,
    );
    const existing = rows[0];
    if (!existing) {
      throw new Error('Pre-authorization hold not found');
    }
    const parsed = rowToApi(existing);
    if (parsed.status !== 'AUTHORIZED') {
      throw new Error(`Cannot increment hold in status ${parsed.status}`);
    }
    return parsed;
  });

  const newTotalAmount = Number((hold.amount + addAmt).toFixed(2));

  // Phase 2 (Outside RLS tx): call gateway incrementHold with zero DB locks held
  const provider = getRacPreAuthProvider(hold.provider);
  const incRes = await provider.incrementHold({
    providerIntentId: hold.providerIntentId ?? hold.id,
    authorizationCode: hold.authorizationCode,
    additionalAmount: addAmt,
    newTotalAmount,
    currency: hold.currency,
    reason: args.reason ?? null,
    cardToken: hold.cardToken,
    customerId: hold.customerId,
  });

  if (incRes.status === 'FAILED') {
    throw new Error(incRes.message || 'Gateway rejected incremental pre-authorization hold');
  }

  // Phase 3 (Short RLS tx): persist incremented hold amount & metadata
  const updatedPreauth = await withTenantRls(prisma, args.tenantId, async (tx) => {
    const noteAppend = args.reason
      ? `Incremental hold +${hold.currency} ${addAmt.toFixed(2)} (${args.reason})`
      : `Incremental hold +${hold.currency} ${addAmt.toFixed(2)}`;
    const metaPatch = JSON.stringify({
      lastIncrement: {
        additionalAmount: addAmt,
        newTotalAmount,
        providerRef: incRes.providerRef,
        authorizationCode: incRes.authorizationCode,
        initiatedByUser: args.initiatedByUser ?? null,
        incrementedAt: new Date().toISOString(),
        ...(incRes.metadata ?? {}),
      },
    });

    type RowWithInc = Row & { incremental_amount?: string | null };
    const updatedWithNewCols = await withSavepoint<RowWithInc[] | null>(
      tx,
      'preauth_inc_new_cols',
      () =>
        tx.$queryRawUnsafe<RowWithInc[]>(
          `UPDATE rac_card_preauths
              SET amount = ROUND((amount + $1::numeric)::numeric, 2),
                  incremental_amount = ROUND((COALESCE(incremental_amount, 0) + $1::numeric)::numeric, 2),
                  gateway_metadata = COALESCE(gateway_metadata, '{}'::jsonb) || $2::jsonb,
                  notes = CASE WHEN notes IS NULL OR notes = '' THEN $3 ELSE notes || ' | ' || $3 END,
                  updated_at = NOW()
            WHERE id = $4::uuid
              AND tenant_id = $5
              AND status = 'AUTHORIZED'
            RETURNING ${SELECT}, COALESCE(incremental_amount, 0)::text AS incremental_amount`,
          addAmt,
          metaPatch,
          noteAppend,
          args.preauthId,
          args.tenantId,
        ),
      null,
    );

    let mapped: RacCardPreAuth;
    if (updatedWithNewCols && updatedWithNewCols[0]) {
      mapped = {
        ...rowToApi(updatedWithNewCols[0]),
        incrementalAmount: Number(updatedWithNewCols[0].incremental_amount ?? addAmt),
      };
    } else {
      const fallbackRows = await tx.$queryRawUnsafe<Row[]>(
        `UPDATE rac_card_preauths
            SET amount = ROUND((amount + $1::numeric)::numeric, 2),
                notes = CASE WHEN notes IS NULL OR notes = '' THEN $2 ELSE notes || ' | ' || $2 END,
                updated_at = NOW()
          WHERE id = $3::uuid
            AND tenant_id = $4
            AND status = 'AUTHORIZED'
          RETURNING ${SELECT}`,
        addAmt,
        noteAppend,
        args.preauthId,
        args.tenantId,
      );
      if (!fallbackRows[0]) {
        throw new Error('Pre-authorization hold could not be incremented (concurrent status change)');
      }
      mapped = {
        ...rowToApi(fallbackRows[0]),
        incrementalAmount: addAmt,
      };
    }

    if (mapped.agreementId) {
      await withSavepoint(
        tx,
        'preauth_inc_sync_agr',
        () =>
          tx.$executeRawUnsafe(
            `UPDATE rental_agreements
                SET security_deposit = GREATEST(COALESCE(security_deposit, 0), $1::numeric),
                    updated_at = NOW()
              WHERE id = $2 AND tenant_id::text = $3`,
            mapped.amount,
            mapped.agreementId,
            args.tenantId,
          ),
        0,
      );
    }

    return mapped;
  });

  return { preauth: updatedPreauth, increment: incRes };
}
