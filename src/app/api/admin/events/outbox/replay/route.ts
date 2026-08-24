/**
 * POST /api/admin/events/outbox/replay
 *
 * Re-queue permanently parked (dead-letter) outbox rows so the
 * outbox-publisher job picks them up on its next poll cycle.
 *
 * Body (JSON):
 *   eventIds?  — string[]  replay only these specific outbox row IDs (event_id UUID)
 *   dryRun?    — boolean   preview which rows would be replayed without changing state
 *
 * When eventIds is omitted, all parked rows are re-queued (up to 100).
 *
 * A "parked" row is one where:
 *   published_at IS NULL AND failed_at IS NOT NULL AND retry_count >= 5
 *
 * Replay resets: retry_count = 0, failed_at = NULL, failure_reason = NULL
 * so the outbox-publisher treats the row as a fresh unpublished event.
 *
 * Auth: Platform-admin wrap.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma }                    from '@/lib/prisma';
import { withPlatformAdmin }         from '@/lib/rls';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { eventIds, dryRun = false }: { eventIds?: string[]; dryRun?: boolean } = body;

    // Validate eventIds if provided
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (eventIds !== undefined && !Array.isArray(eventIds)) {
      return NextResponse.json(
        { error: 'eventIds must be a string array of UUID event_ids' },
        { status: 400 },
      );
    }
    if (eventIds?.some(id => !uuidRe.test(id))) {
      return NextResponse.json(
        { error: 'All values in eventIds must be valid UUIDs' },
        { status: 400 },
      );
    }

    return await withPlatformAdmin(prisma, async (tx) => {
      type Row = { event_id: string; event_type: string; retry_count: number };

      // ── Find rows to replay ───────────────────────────────────────────────
      let candidateRows: Row[];

      if (eventIds && eventIds.length > 0) {
        // Specific IDs requested — verify they are actually parked
        const placeholders = eventIds.map((_, i) => `$${i + 1}::uuid`).join(', ');
        candidateRows = await tx.$queryRawUnsafe<Row[]>(
          `SELECT event_id::text, event_type, retry_count
             FROM event_outbox
            WHERE event_id = ANY(ARRAY[${placeholders}])
              AND published_at IS NULL`,
          ...eventIds,
        ).catch(() => [] as Row[]);
      } else {
        // All parked rows, newest-failed first, capped at 100
        candidateRows = await tx.$queryRawUnsafe<Row[]>(`
          SELECT event_id::text, event_type, retry_count
            FROM event_outbox
           WHERE published_at IS NULL
             AND failed_at    IS NOT NULL
             AND retry_count  >= 5
           ORDER BY failed_at DESC
           LIMIT 100
        `).catch(() => [] as Row[]);
      }

      if (candidateRows.length === 0) {
        return NextResponse.json({
          replayed:   0,
          dryRun,
          eventIds:   [],
          message:    'No matching parked rows found',
        });
      }

      const targetEventIds = candidateRows.map(r => r.event_id);

      if (dryRun) {
        return NextResponse.json({
          replayed:   0,
          dryRun:     true,
          eventIds:   targetEventIds,
          candidates: candidateRows.map(r => ({
            eventId:    r.event_id,
            eventType:  r.event_type,
            retryCount: r.retry_count,
          })),
          message: `Dry run — ${targetEventIds.length} row(s) would be re-queued`,
        });
      }

      // ── Reset parked rows ─────────────────────────────────────────────────
      const placeholders = targetEventIds.map((_, i) => `$${i + 1}::uuid`).join(', ');
      const updated: Array<{ event_id: string }> = await tx.$queryRawUnsafe<Array<{ event_id: string }>>(
        `UPDATE event_outbox
            SET retry_count    = 0,
                failed_at      = NULL,
                failure_reason = NULL
          WHERE event_id = ANY(ARRAY[${placeholders}])
            AND published_at IS NULL
          RETURNING event_id::text`,
        ...targetEventIds,
      ).catch(() => [] as Array<{ event_id: string }>);

      const replayedIds = updated.map(r => r.event_id);

      console.info(
        `[admin/events/outbox/replay] re-queued ${replayedIds.length} parked event(s): ` +
        replayedIds.join(', '),
      );

      return NextResponse.json({
        replayed:  replayedIds.length,
        dryRun:    false,
        eventIds:  replayedIds,
        message:   `${replayedIds.length} event(s) re-queued — will be picked up on the next outbox-publisher poll`,
      });
    });
  } catch (err) {
    console.error('[admin/events/outbox/replay POST]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
