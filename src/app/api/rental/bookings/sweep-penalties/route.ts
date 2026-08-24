/**
 * POST /api/rental/bookings/sweep-penalties
 *
 * Daily sweep over all non-terminal RentalBookings:
 *   - PENDING/CONFIRMED past pickup + 4h → flip to NO_SHOW + add no-show fee
 *   - ACTIVE past dropoff + 30 min grace → add late-return fee (status stays ACTIVE)
 *
 * TENANT-001: uses withSystemJob — per-tenant iteration, never unscoped.
 * Idempotent — fingerprinted in additional-charge notes.
 *
 * Auth: optional CRON_SECRET Bearer for external cron.
 * Query: ?dryRun=1 to preview without writing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withSystemJob } from '@/lib/rls';
import {
  detectPenalties,
  chargeTypeFor,
  type BookingForPenalty,
  type BookingStatus,
} from '@/lib/rental-booking-state';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const cronSecret = process.env.CRON_SECRET;
  const tenantHeader = req.headers.get('x-tenant-id');
  if (cronSecret && !tenantHeader) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
  }

  try {
    const dryRun = req.nextUrl.searchParams.get('dryRun') === '1';
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    type PerTenantResult = {
      tenantId: string;
      assessed: number;
      noShow: number;
      lateReturn: number;
      skipped: number;
      errors: { bookingId: string; message: string }[];
    };

    const perTenant = await withSystemJob<PerTenantResult>(
      prisma,
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
          },
        });

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
            if (a.action === 'NO_SHOW') counts.noShow += 1;
            else if (a.action === 'LATE_RETURN') counts.lateReturn += 1;
            else counts.skipped += 1;
          }
          return {
            tenantId,
            assessed: assessments.length,
            ...counts,
            errors,
          };
        }

        for (const a of assessments) {
          try {
            if (a.action === 'SKIP' || !a.action) {
              counts.skipped += 1;
              continue;
            }

            const chargeType = chargeTypeFor(a.action);
            const amount = a.amount ?? 0;
            const noteFingerprint = `${chargeType}:${a.bookingId}:${today.toISOString().slice(0, 10)}`;

            const agreement = await tx.rentalAgreement.findFirst({
              where: { tenantId, bookingId: a.bookingId } as any,
              select: { id: true },
            });

            const existingCharge = await tx.rentalAdditionalCharge.findFirst({
              where: {
                tenantId,
                notes: { contains: noteFingerprint },
                createdAt: { gte: today },
              } as any,
            });

            if (!existingCharge && amount > 0) {
              await tx.rentalAdditionalCharge.create({
                data: {
                  tenantId,
                  bookingId: a.bookingId,
                  agreementId: agreement?.id ?? null,
                  chargeType,
                  amount,
                  currency: a.currency ?? 'AED',
                  notes: noteFingerprint,
                } as any,
              });
            }

            if (a.action === 'NO_SHOW') {
              await tx.rentalBooking.updateMany({
                where: { id: a.bookingId, tenantId } as any,
                data: { status: 'NO_SHOW' },
              });
              counts.noShow += 1;
            } else if (a.action === 'LATE_RETURN') {
              counts.lateReturn += 1;
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : 'unknown';
            errors.push({ bookingId: a.bookingId, message });
            captureException(err, {
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
      { tenantHeader: tenantHeader ?? undefined },
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
      { assessed: 0, noShow: 0, lateReturn: 0, skipped: 0, errors: [] as { bookingId: string; message: string }[] },
    );

    if (!dryRun && (totals.noShow > 0 || totals.lateReturn > 0)) {
      void logAudit({
        tenantId: tenantHeader ?? undefined,
        userId: req.headers.get('x-user-id') ?? 'system:cron',
        userRole: req.headers.get('x-user-role') ?? 'SYSTEM',
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
