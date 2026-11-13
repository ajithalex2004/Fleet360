export const dynamic = 'force-dynamic';

/**
 * GET / POST /api/rental/preauth
 *
 * Staff counter endpoint for listing and placing tokenized card pre-authorization
 * security deposit holds (`rac_card_preauths`).
 *
 * Concurrency & PCI invariants:
 *   1. Raw PAN / CVV fields are strictly rejected (`400`).
 *   2. Phase 1 (`withTenantRls`): validates tenant foreign-key ownership & customer
 *      blacklist status BEFORE contacting the external payment gateway.
 *   3. Phase 2 (outside DB tx): executes `authorizeHold` with zero DB locks held.
 *   4. Phase 3 (`withTenantRls`): persists `rac_card_preauths`; if DB write fails,
 *      executes best-effort `releaseHold` in `catch` so no orphaned hold remains.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { logAudit } from '@/lib/audit';
import { requireRentalPermission } from '@/lib/rental/rbac';
import {
  RentalSecurityError,
  assertRentalForeignKeysInTenant,
  isRentalSecurityError,
} from '@/lib/rental/security-guards';
import {
  authorizeGatewayHold,
  bestEffortReleaseGatewayHold,
  listPreAuthsForTenant,
  recordAuthorizedPreAuthInTx,
  toPublicRacPreAuth,
} from '@/lib/rac-portal/preauth-store';

const StaffCreatePreAuthSchema = z.object({
  customerId: z.string().trim().min(1, 'customerId is required').max(128),
  bookingId: z.string().trim().min(1).max(128).optional().nullable(),
  agreementId: z.string().trim().min(1).max(128).optional().nullable(),
  amount: z.coerce.number().positive('Hold amount must be greater than zero').max(250_000),
  currency: z.string().trim().toUpperCase().default('AED'),
  cardToken: z.string().trim().min(3).max(160).optional().nullable(),
  cardBrand: z.string().trim().min(2).max(32).default('VISA'),
  cardLast4: z
    .string()
    .trim()
    .regex(/^\d{4}$/, 'cardLast4 must be exactly 4 digits')
    .default('4242'),
  cardholderName: z.string().trim().min(2).max(120).optional().nullable(),
  expiryMonth: z.coerce.number().int().min(1).max(12).optional().nullable(),
  expiryYear: z.coerce.number().int().min(2024).max(2099).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await requireRentalPermission(
    req.headers,
    tenantId,
    'view',
    'preauth',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  try {
    const sp = req.nextUrl.searchParams;
    const preauths = await listPreAuthsForTenant(tenantId, {
      customerId: sp.get('customerId')?.trim() || null,
      bookingId: sp.get('bookingId')?.trim() || null,
      agreementId: sp.get('agreementId')?.trim() || null,
      status: sp.get('status')?.trim() || null,
      limit: sp.get('limit') ? Number(sp.get('limit')) : 100,
    });

    return NextResponse.json({ preauths: preauths.map(toPublicRacPreAuth) });
  } catch (err) {
    console.error('[rental/preauth] GET error:', err);
    return NextResponse.json(
      { error: 'Failed to load card pre-authorization holds' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await requireRentalPermission(
    req.headers,
    tenantId,
    'create',
    'preauth',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  try {
    const rawBody = await req.json().catch(() => null);
    if (
      rawBody &&
      typeof rawBody === 'object' &&
      ('cardNumber' in rawBody || 'pan' in rawBody || 'cvv' in rawBody || 'cvc' in rawBody)
    ) {
      return NextResponse.json(
        {
          error:
            'PCI-DSS violation blocked: raw card numbers and CVV must never be transmitted to server APIs.',
        },
        { status: 400 },
      );
    }

    const cleaned = stripTenantOwnershipFields(
      (rawBody && typeof rawBody === 'object' ? rawBody : {}) as Record<string, unknown>,
    );
    const parsed = StaffCreatePreAuthSchema.safeParse(cleaned);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: parsed.error.issues[0]?.message ?? 'Invalid pre-authorization payload',
          details: parsed.error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        },
        { status: 400 },
      );
    }

    const data = parsed.data;
    const actorId = req.headers.get('x-user-id')?.trim() || 'staff';

    // Phase 1 (Short RLS tx): verify tenant foreign keys & customer blacklist before gateway call
    await withTenantRls(prisma, tenantId, async (tx) => {
      await assertRentalForeignKeysInTenant(tx, tenantId, {
        customerId: data.customerId,
        bookingId: data.bookingId ?? null,
        agreementId: data.agreementId ?? null,
      });

      const custRows = await tx.$queryRawUnsafe<
        Array<{ id: string; blacklisted: boolean | null }>
      >(
        `SELECT id, blacklisted
           FROM rental_customers
          WHERE id = $1 AND tenant_id::text = $2 AND deleted_at IS NULL
          LIMIT 1`,
        data.customerId,
        tenantId,
      );
      if (!custRows[0]) {
        throw new RentalSecurityError(404, 'CUSTOMER_NOT_FOUND', 'Rental customer not found');
      }
      if (custRows[0].blacklisted) {
        throw new RentalSecurityError(
          403,
          'CUSTOMER_BLACKLISTED',
          'Customer is blacklisted and cannot place card holds',
        );
      }
    });

    // Phase 2 (Outside DB tx): authorize hold at external payment gateway
    let gatewayRes;
    try {
      gatewayRes = await authorizeGatewayHold({
        tenantId,
        customerId: data.customerId,
        amount: data.amount,
        currency: data.currency,
        cardToken: data.cardToken ?? null,
        cardBrand: data.cardBrand,
        cardLast4: data.cardLast4,
        cardholderName: data.cardholderName ?? null,
        expiryMonth: data.expiryMonth ?? null,
        expiryYear: data.expiryYear ?? null,
        notes: data.notes ?? 'Staff Counter Security Deposit Pre-Authorization',
      });
    } catch (gatewayErr) {
      const msg =
        gatewayErr instanceof Error
          ? gatewayErr.message
          : 'Card pre-authorization was declined by the issuer';
      return NextResponse.json({ error: msg }, { status: 402 });
    }

    // Phase 3 (Short RLS tx): persist hold; best-effort release on DB failure
    let preauth;
    try {
      preauth = await withTenantRls(prisma, tenantId, (tx) =>
        recordAuthorizedPreAuthInTx(
          tx,
          {
            tenantId,
            customerId: data.customerId,
            bookingId: data.bookingId ?? null,
            agreementId: data.agreementId ?? null,
            amount: data.amount,
            currency: data.currency,
            cardholderName: data.cardholderName ?? null,
            initiatedBy: 'STAFF',
            initiatedByUser: actorId,
            notes: data.notes ?? 'Staff Counter Security Deposit Pre-Authorization',
          },
          gatewayRes,
        ),
      );
    } catch (dbErr) {
      await bestEffortReleaseGatewayHold(gatewayRes.providerIntentId);
      throw dbErr;
    }

    void logAudit({
      tenantId,
      userId: req.headers.get('x-user-id') ?? undefined,
      userRole: req.headers.get('x-user-role') ?? undefined,
      entityType: 'RacCardPreAuth',
      entityId: preauth.id,
      entityName: preauth.authorizationCode,
      action: 'CREATE',
      details: `Placed card pre-authorization hold ${preauth.authorizationCode} (${preauth.currency} ${preauth.amount}) for customer ${data.customerId}.`,
    });

    return NextResponse.json(
      { ok: true, preauth: toPublicRacPreAuth(preauth), message: gatewayRes.message },
      { status: 201 },
    );
  } catch (err) {
    if (isRentalSecurityError(err)) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    const msg = err instanceof Error ? err.message : '';
    if (msg.toLowerCase().includes('not found for customer')) {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    console.error('[rental/preauth] POST error:', err);
    return NextResponse.json(
      { error: 'Failed to place card pre-authorization hold' },
      { status: 500 },
    );
  }
}
