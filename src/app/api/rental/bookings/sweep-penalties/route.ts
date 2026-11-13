export const dynamic = 'force-dynamic';

/**
 * POST /api/rental/bookings/sweep-penalties
 *
 * Daily sweep over all non-terminal RentalBookings:
 *   - PENDING/CONFIRMED past pickup + 4h → flip to NO_SHOW + release vehicle + optional agreement fee
 *   - ACTIVE past dropoff + 30 min grace → add incremental late-return fee on RentalAgreement (status stays ACTIVE)
 *
 * TENANT-001: uses runSweep (withSystemJob) — per-tenant iteration, never unscoped.
 * Idempotent — fingerprinted in RentalAdditionalCharge.description / RentalBooking.notes.
 *
 * Auth:
 *   - Constant-time `CRON_SECRET` Bearer for external cron (sweeps all tenants or optional `x-tenant-id`).
 *   - Authenticated staff session requires `rental:approve:bookings` and is strictly scoped to `authz.tenantId`.
 * Query: ?dryRun=1 to preview without writing.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  detectPenalties,
  chargeTypeFor,
  type BookingForPenalty,
  type BookingStatus,
} from '@/lib/rental-booking-state';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { runSweep } from '@/lib/prisma-sweep';
import { withSavepoint } from '@/lib/rental/locks';
import { bearerToken, secretsEqual } from '@/lib/secure-compare';
import { requireRentalPermission } from '@/lib/rental/rbac';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET ?? '';
  const providedBearer = bearerToken(req.headers);
  const isCronAuthenticated = Boolean(
    cronSecret && providedBearer && secretsEqual(providedBearer, cronSecret),
  );

  let targetTenantId: string | undefined;

  if (isCronAuthenticated) {
    const rawHeader = (req.headers.get('x-tenant-id') ?? '').trim();
    targetTenantId = rawHeader || undefined;
  } else {
    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const permErr = await requireRentalPermission(
      req.headers,
      authz.tenantId,
      'approve',
      'bookings',
      req.nextUrl.pathname,
    );
    if (permErr) return permErr;

    // Staff-initiated sweeps MUST strictly target their own authorized tenant
    targetTenantId = authz.tenantId;
  }

  try {
    const dryRun = req.nextUrl.searchParams.get('dryRun') === '1';
    const dateStr = new Date().toISOString().slice(0, 10);

    type PerTenantResult = {
      tenantId: string;
      assessed: number;
      noShow: number;
      lateReturn: number;
      skipped: number;
      errors: { bookingId: string; message: string }[];
    };

    const perTenant = await runSweep<PerTenantResult>(
      async ({ tx, tenantId }) => {
        const bookings = await tx.rentalBooking.findMany({
          where: {
            tenantId,
            deletedAt: null,
            status: { in: ['PENDING', 'CONFIRMED', 'ACTIVE'] },
          },
          select: {
            id: true,
            bookingRef: true,
            status: true,
            pickupDate: true,
            dropoffDate: true,
            dailyRate: true,
            totalAmount: true,
            totalDays: true,
            currency: true,
            vehicleId: true,
            notes: true,
          },
        });

        const bookingById = new Map(bookings.map((b) => [b.id, b]));

        const inputs: BookingForPenalty[] = bookings.map((b) => ({
          id: b.id,
          bookingRef: b.bookingRef,
          status: (b.status ?? 'PENDING') as BookingStatus,
          pickupDate: b.pickupDate,
          dropoffDate: b.dropoffDate,
          dailyRate: b.dailyRate ? Number(b.dailyRate) : null,
          totalAmount: b.totalAmount ? Number(b.totalAmount) : null,
          totalDays: b.totalDays,
          currency: b.currency ?? 'AED',
        }));

        const assessments = detectPenalties({ bookings: inputs });
        const counts = { noShow: 0, lateReturn: 0, skipped: 0 };
        const errors: { bookingId: string; message: string }[] = [];

        if (dryRun) {
          for (const a of assessments) {
            if (a.kind === 'NO_SHOW') counts.noShow += 1;
            else if (a.kind === 'LATE_RETURN') counts.lateReturn += 1;
            else counts.skipped += 1;
          }
          return {
            tenantId,
            assessed: assessments.length,
            ...counts,
            errors,
          };
        }

        for (let idx = 0; idx < assessments.length; idx++) {
          const a = assessments[idx];
          let itemErr: unknown = null;

          const outcome = await withSavepoint<'noShow' | 'lateReturn' | 'skipped' | 'error'>(
            tx,
            `sweep_item_${idx}`,
            async () => {
              try {
                const booking = bookingById.get(a.bookingId);
                const chargeType = chargeTypeFor(a.kind);
                const amount = Math.round((a.feeAmount ?? 0) * 100) / 100;
                const fingerprint = `${chargeType}:${a.bookingId}:${dateStr}`;

                const agreement = await tx.rentalAgreement.findFirst({
                  where: { tenantId, bookingId: a.bookingId },
                  select: { id: true },
                });

                if (a.kind === 'NO_SHOW') {
                  const alreadyInNotes = Boolean(booking?.notes?.includes(fingerprint));
                  const existingCharge = agreement?.id
                    ? await tx.rentalAdditionalCharge.findFirst({
                        where: {
                          tenantId,
                          agreementId: agreement.id,
                          description: { contains: fingerprint },
                        },
                        select: { id: true },
                      })
                    : null;

                  if (alreadyInNotes || existingCharge) {
                    return 'skipped';
                  }

                  const noteEntry = `[${fingerprint}] ${a.rationale}`;
                  const updatedNotes = booking?.notes
                    ? `${booking.notes}\n${noteEntry}`
                    : noteEntry;

                  await tx.rentalBooking.updateMany({
                    where: {
                      id: a.bookingId,
                      tenantId,
                      status: { in: ['PENDING', 'CONFIRMED'] },
                    },
                    data: {
                      status: 'NO_SHOW',
                      notes: updatedNotes,
                    },
                  });

                  if (booking?.vehicleId) {
                    await withSavepoint(
                      tx,
                      `sweep_rel_${idx}`,
                      () =>
                        tx.$executeRawUnsafe(
                          `UPDATE vehicles
                              SET status = 'AVAILABLE'
                            WHERE id = $1
                              AND tenant_id::text = $2
                              AND status IN ('RESERVED', 'RENTED')
                              AND NOT EXISTS (
                                SELECT 1
                                  FROM rental_agreements ra
                                 WHERE ra.vehicle_id = $1
                                   AND ra.tenant_id::text = $2
                                   AND ra.status = 'ACTIVE'
                              )`,
                          booking.vehicleId,
                          tenantId,
                        ),
                      0,
                    );
                  }

                  if (agreement?.id && amount > 0) {
                    await tx.rentalAdditionalCharge.create({
                      data: {
                        tenantId,
                        agreementId: agreement.id,
                        chargeType,
                        description: `[${fingerprint}] ${a.rationale}`,
                        amount,
                        quantity: 1,
                        totalAmount: amount,
                        billedToCustomer: true,
                      },
                    });
                  }

                  return 'noShow';
                }

                if (a.kind === 'LATE_RETURN') {
                  if (!agreement?.id) {
                    if (booking && !booking.notes?.includes(fingerprint)) {
                      const noteEntry = `[${fingerprint}] Pending agreement — ${a.rationale}`;
                      const updatedNotes = booking.notes
                        ? `${booking.notes}\n${noteEntry}`
                        : noteEntry;
                      await tx.rentalBooking.updateMany({
                        where: { id: a.bookingId, tenantId },
                        data: { notes: updatedNotes },
                      });
                    }
                    return 'skipped';
                  }

                  const existingCharges = await tx.rentalAdditionalCharge.findMany({
                    where: {
                      tenantId,
                      agreementId: agreement.id,
                      chargeType: 'LATE_RETURN_FEE',
                    },
                    select: {
                      amount: true,
                      totalAmount: true,
                      description: true,
                    },
                  });

                  if (existingCharges.some((c) => (c.description ?? '').includes(fingerprint))) {
                    return 'skipped';
                  }

                  const alreadyBilled = existingCharges.reduce(
                    (sum, c) => sum + Number(c.totalAmount ?? c.amount ?? 0),
                    0,
                  );
                  const delta = Math.round((amount - alreadyBilled) * 100) / 100;

                  if (delta <= 0.01) {
                    return 'skipped';
                  }

                  await tx.rentalAdditionalCharge.create({
                    data: {
                      tenantId,
                      agreementId: agreement.id,
                      chargeType: 'LATE_RETURN_FEE',
                      description: `[${fingerprint}] Incremental late-return fee (${a.rationale})`,
                      amount,
                      quantity: 1,
                      totalAmount: delta,
                      billedToCustomer: true,
                    },
                  });

                  return 'lateReturn';
                }

                return 'skipped';
              } catch (err) {
                itemErr = err;
                throw err;
              }
            },
            'error',
          );

          if (outcome === 'noShow') counts.noShow += 1;
          else if (outcome === 'lateReturn') counts.lateReturn += 1;
          else if (outcome === 'skipped') counts.skipped += 1;
          else {
            const internalMsg = itemErr instanceof Error ? itemErr.message : 'unknown';
            errors.push({ bookingId: a.bookingId, message: 'Failed to process booking penalty' });
            captureException(itemErr ?? new Error(internalMsg), {
              context: 'rental.bookings.sweep-penalties.item',
              tags: { bookingId: a.bookingId, tenantId },
            });
          }
        }

        return {
          tenantId,
          assessed: assessments.length,
          ...counts,
          errors,
        };
      },
      { tenantHeader: targetTenantId },
    );

    const totals = perTenant.reduce(
      (acc, { result }) => {
        acc.assessed += result.assessed;
        acc.noShow += result.noShow;
        acc.lateReturn += result.lateReturn;
        acc.skipped += result.skipped;
        acc.errors.push(...result.errors);
        return acc;
      },
      {
        assessed: 0,
        noShow: 0,
        lateReturn: 0,
        skipped: 0,
        errors: [] as { bookingId: string; message: string }[],
      },
    );

    if (!dryRun && (totals.noShow > 0 || totals.lateReturn > 0)) {
      void logAudit({
        tenantId: targetTenantId,
        userId: isCronAuthenticated ? 'system:cron' : (req.headers.get('x-user-id') ?? 'staff'),
        userRole: isCronAuthenticated ? 'SYSTEM' : (req.headers.get('x-user-role') ?? 'STAFF'),
        entityType: 'RentalBooking',
        action: 'UPDATE',
        details: `Penalty sweep: assessed ${totals.assessed}, noShow ${totals.noShow}, lateReturn ${totals.lateReturn}, skipped ${totals.skipped}.`,
      });
    }

    return NextResponse.json({
      dryRun,
      tenantsProcessed: perTenant.length,
      ...totals,
      perTenant: perTenant.map((p) => p.result),
      runAt: new Date().toISOString(),
    });
  } catch (err) {
    captureException(err, { context: 'rental.bookings.sweep-penalties' });
    console.error('[sweep-penalties] error:', err);
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 });
  }
}
