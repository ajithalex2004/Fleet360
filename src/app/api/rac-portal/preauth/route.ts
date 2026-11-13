export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { stripTenantOwnershipFields } from '@/lib/tenant-context';
import {
  authorizeGatewayHold,
  bestEffortReleaseGatewayHold,
  listPreAuthsForCustomer,
  recordAuthorizedPreAuthInTx,
  toPublicRacPreAuth,
} from '@/lib/rac-portal/preauth-store';
import {
  ALL_RAC_PORTAL_ROLES,
  BOOKING_RAC_PORTAL_ROLES,
  enforceRacPortalPaymentRateLimit,
  PREAUTH_RAC_PORTAL_ROLES,
  requireRacPortalRole,
} from '../_helpers';

const CreatePreAuthSchema = z
  .object({
    amount: z.number().positive('Hold amount must be greater than zero').max(250_000),
    currency: z.string().trim().toUpperCase().default('AED'),
    cardToken: z.string().trim().min(3).max(160).optional(),
    cardBrand: z.string().trim().min(2).max(32).default('VISA'),
    cardLast4: z
      .string()
      .trim()
      .regex(/^\d{4}$/, 'cardLast4 must be exactly 4 digits')
      .default('4242'),
    cardholderName: z.string().trim().min(2, 'Cardholder name is required').max(120),
    expiryMonth: z.number().int().min(1).max(12),
    expiryYear: z.number().int().min(2024).max(2099),
    purpose: z.enum(['BOOKING', 'INVOICE']).optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .strict();

export async function GET(req: NextRequest) {
  const ctx = await requireRacPortalRole(req, ALL_RAC_PORTAL_ROLES);
  if (ctx instanceof NextResponse) return ctx;

  try {
    const preauths = await listPreAuthsForCustomer(ctx.tenantId, ctx.customerId);
    return NextResponse.json({ preauths: preauths.map(toPublicRacPreAuth) });
  } catch (err) {
    console.error('[rac-portal/preauth] GET failed:', err);
    return NextResponse.json(
      { error: 'Failed to load card pre-authorization holds' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const ctx = await requireRacPortalRole(
    req,
    PREAUTH_RAC_PORTAL_ROLES,
    'Corporate Booker, Finance, or Admin role is required to place card pre-authorization holds.',
  );
  if (ctx instanceof NextResponse) return ctx;

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

    // Prevent RAC_B2B_FINANCE from placing orphaned booking holds before touching the payment gateway
    const rawPurpose =
      rawBody && typeof rawBody === 'object' && 'purpose' in rawBody
        ? String((rawBody as Record<string, unknown>).purpose ?? '').trim().toUpperCase()
        : '';
    if (rawPurpose === 'BOOKING' && !BOOKING_RAC_PORTAL_ROLES.includes(ctx.user.role)) {
      return NextResponse.json(
        {
          error:
            'Corporate Booker (RAC_B2B_BOOKER) or B2B Admin (RAC_B2B_ADMIN) role is required to place booking card pre-authorization holds.',
          requiredRoles: BOOKING_RAC_PORTAL_ROLES,
        },
        { status: 403 },
      );
    }

    const sanitizedBody =
      rawBody && typeof rawBody === 'object'
        ? stripTenantOwnershipFields(rawBody as Record<string, unknown>)
        : rawBody;
    const parsed = CreatePreAuthSchema.safeParse(sanitizedBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid pre-authorization request' },
        { status: 400 },
      );
    }

    if (parsed.data.purpose === 'BOOKING' && !BOOKING_RAC_PORTAL_ROLES.includes(ctx.user.role)) {
      return NextResponse.json(
        {
          error:
            'Corporate Booker (RAC_B2B_BOOKER) or B2B Admin (RAC_B2B_ADMIN) role is required to place booking card pre-authorization holds.',
          requiredRoles: BOOKING_RAC_PORTAL_ROLES,
        },
        { status: 403 },
      );
    }

    const paymentRl = await enforceRacPortalPaymentRateLimit(ctx.customerId);
    if (paymentRl) return paymentRl;

    // Phase 1 (Short RLS read): verify corporate customer exists and is not blacklisted
    const customerCheck = await withTenantRls(prisma, ctx.tenantId, async (tx) => {
      const rows = await tx.$queryRawUnsafe<Array<{ id: string; blacklisted: boolean | null }>>(
        `SELECT id, blacklisted
           FROM rental_customers
          WHERE id = $1 AND tenant_id::text = $2 AND deleted_at IS NULL
          LIMIT 1`,
        ctx.customerId,
        ctx.tenantId,
      );
      return rows[0] ?? null;
    });

    if (!customerCheck) {
      return NextResponse.json({ error: 'Corporate customer not found' }, { status: 404 });
    }
    if (customerCheck.blacklisted) {
      return NextResponse.json(
        {
          error:
            'Corporate account is restricted and cannot place card holds. Contact your account manager.',
        },
        { status: 403 },
      );
    }

    const data = parsed.data;
    const holdNotes = data.notes ?? 'Online B2B Portal Security Deposit Pre-Authorization';

    // Phase 2 (Outside DB tx): authorize hold at external payment gateway
    let gatewayRes;
    try {
      gatewayRes = await authorizeGatewayHold({
        tenantId: ctx.tenantId,
        customerId: ctx.customerId,
        amount: data.amount,
        currency: data.currency,
        cardToken: data.cardToken ?? null,
        cardBrand: data.cardBrand,
        cardLast4: data.cardLast4,
        cardholderName: data.cardholderName,
        expiryMonth: data.expiryMonth,
        expiryYear: data.expiryYear,
        notes: holdNotes,
      });
    } catch (gatewayErr) {
      const message =
        gatewayErr instanceof Error
          ? gatewayErr.message
          : 'Card pre-authorization was declined by the issuer';
      return NextResponse.json({ error: message }, { status: 402 });
    }

    // Phase 3 (Short RLS tx): persist hold; if DB insert fails, best-effort release hold
    let preauth;
    try {
      preauth = await withTenantRls(prisma, ctx.tenantId, (tx) =>
        recordAuthorizedPreAuthInTx(
          tx,
          {
            tenantId: ctx.tenantId,
            customerId: ctx.customerId,
            amount: data.amount,
            currency: data.currency,
            cardholderName: data.cardholderName,
            initiatedBy: 'PORTAL_USER',
            initiatedByUser: ctx.user.email,
            notes: holdNotes,
          },
          gatewayRes,
        ),
      );
    } catch (dbErr) {
      await bestEffortReleaseGatewayHold(gatewayRes.providerIntentId);
      throw dbErr;
    }

    return NextResponse.json(
      { ok: true, preauth: toPublicRacPreAuth(preauth), message: gatewayRes.message },
      { status: 201 },
    );
  } catch (err) {
    console.error('[rac-portal/preauth] POST failed:', err);
    return NextResponse.json(
      { error: 'Failed to process card pre-authorization hold' },
      { status: 500 },
    );
  }
}
