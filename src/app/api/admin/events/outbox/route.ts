/**
 * GET /api/admin/events/outbox
 *
 * Outbox observability endpoint — returns the health of the transactional
 * event outbox and consumer inbox so operators can monitor queue depth,
 * dead-letter (parked) rows, consumer failures, and end-to-end latency
 * without needing direct DB access.
 *
 * Query params:
 *   days  — look-back window for throughput / latency stats (default 1, max 30)
 *
 * Auth: Platform-admin wrap (same as /api/admin/dispatch-stats).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma }                    from '@/lib/prisma';
import { withPlatformAdmin }         from '@/lib/rls';

type Row = Record<string, unknown>;
const n = (v: unknown) => parseFloat(String(v ?? 0)) || 0;
const s = (v: unknown) => String(v ?? '');

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    return await withPlatformAdmin(prisma, async (tx) => {
      const sp   = new URL(req.url).searchParams;
      const days = Math.min(30, Math.max(1, parseInt(sp.get('days') ?? '1')));

      // ── 1. Summary counts ─────────────────────────────────────────────────
      const [summaryRow] = await tx.$queryRawUnsafe<Row[]>(`
        SELECT
          COUNT(*) FILTER (WHERE published_at IS NULL
                            AND  (failed_at IS NULL OR retry_count < 5))   AS pending,
          COUNT(*) FILTER (WHERE published_at IS NULL
                            AND  failed_at IS NOT NULL
                            AND  retry_count >= 5)                          AS parked,
          COUNT(*) FILTER (WHERE published_at >= NOW() - INTERVAL '${days} days') AS published_window,
          COUNT(*) FILTER (WHERE failed_at IS NOT NULL
                            AND  published_at IS NULL)                      AS total_failed
        FROM event_outbox
      `).catch(() => [{}] as Row[]);

      const pending         = n(summaryRow?.pending);
      const parkedCount     = n(summaryRow?.parked);
      const publishedWindow = n(summaryRow?.published_window);
      const totalFailed     = n(summaryRow?.total_failed);

      // ── 2. Pending queue depth by event type ─────────────────────────────
      const pendingTypeRows = await tx.$queryRawUnsafe<Row[]>(`
        SELECT
          event_type,
          COUNT(*)                                     AS cnt,
          MIN(occurred_at)                             AS oldest_occurred_at
        FROM event_outbox
        WHERE published_at IS NULL
          AND (failed_at IS NULL OR retry_count < 5)
        GROUP BY event_type
        ORDER BY cnt DESC
      `).catch(() => [] as Row[]);

      const pendingByType = pendingTypeRows.map(r => ({
        eventType:        s(r.event_type),
        count:            n(r.cnt),
        oldestOccurredAt: s(r.oldest_occurred_at),
      }));

      // ── 3. Queue lag — age of oldest non-parked pending event ────────────
      const [lagRow] = await tx.$queryRawUnsafe<Row[]>(`
        SELECT
          EXTRACT(EPOCH FROM (NOW() - MIN(occurred_at))) * 1000 AS lag_ms
        FROM event_outbox
        WHERE published_at IS NULL
          AND (failed_at IS NULL OR retry_count < 5)
      `).catch(() => [{}] as Row[]);

      const queueLagMs = lagRow?.lag_ms != null ? Math.round(n(lagRow.lag_ms)) : null;

      // ── 4. Parked (dead-letter) rows ─────────────────────────────────────
      const parkedRows = await tx.$queryRawUnsafe<Row[]>(`
        SELECT
          event_id::text,
          event_type,
          aggregate_type,
          aggregate_id,
          source_module,
          tenant_id::text,
          retry_count,
          occurred_at,
          failed_at,
          failure_reason
        FROM event_outbox
        WHERE published_at IS NULL
          AND failed_at IS NOT NULL
          AND retry_count >= 5
        ORDER BY failed_at DESC
        LIMIT 50
      `).catch(() => [] as Row[]);

      const deadLetter = parkedRows.map(r => ({
        eventId:       s(r.event_id),
        eventType:     s(r.event_type),
        aggregateType: s(r.aggregate_type),
        aggregateId:   s(r.aggregate_id),
        sourceModule:  s(r.source_module),
        tenantId:      s(r.tenant_id),
        retryCount:    n(r.retry_count),
        occurredAt:    s(r.occurred_at),
        failedAt:      s(r.failed_at),
        failureReason: s(r.failure_reason),
      }));

      // ── 5. Consumer inbox stats ───────────────────────────────────────────
      const consumerRows = await tx.$queryRawUnsafe<Row[]>(`
        SELECT
          consumer_name,
          COUNT(*) FILTER (WHERE status = 'PROCESSED')  AS processed,
          COUNT(*) FILTER (WHERE status = 'FAILED')     AS failed,
          COUNT(*) FILTER (WHERE status = 'PROCESSING') AS processing,
          MAX(processed_at)                              AS last_processed_at
        FROM event_consumer_inbox
        GROUP BY consumer_name
        ORDER BY consumer_name
      `).catch(() => [] as Row[]);

      const consumerStats = consumerRows.map(r => ({
        consumerName:    s(r.consumer_name),
        processed:       n(r.processed),
        failed:          n(r.failed),
        processing:      n(r.processing),
        lastProcessedAt: s(r.last_processed_at),
      }));

      // ── 6. Consumer inbox failed rows ─────────────────────────────────────
      const inboxFailedRows = await tx.$queryRawUnsafe<Row[]>(`
        SELECT
          consumer_name,
          event_id::text,
          event_type,
          tenant_id::text,
          error_message,
          processed_at
        FROM event_consumer_inbox
        WHERE status = 'FAILED'
        ORDER BY processed_at DESC
        LIMIT 50
      `).catch(() => [] as Row[]);

      const inboxFailed = inboxFailedRows.map(r => ({
        consumerName:  s(r.consumer_name),
        eventId:       s(r.event_id),
        eventType:     s(r.event_type),
        tenantId:      s(r.tenant_id),
        errorMessage:  s(r.error_message),
        processedAt:   s(r.processed_at),
      }));

      // ── 7. Hourly throughput (published events) ───────────────────────────
      const throughputRows = await tx.$queryRawUnsafe<Row[]>(`
        SELECT
          DATE_TRUNC('hour', published_at AT TIME ZONE 'UTC') AS hour,
          COUNT(*)                                             AS published,
          COUNT(*) FILTER (WHERE failure_reason IS NOT NULL)  AS had_retries
        FROM event_outbox
        WHERE published_at >= NOW() - INTERVAL '${days} days'
        GROUP BY hour
        ORDER BY hour ASC
      `).catch(() => [] as Row[]);

      const throughputHourly = throughputRows.map(r => ({
        hour:       s(r.hour).replace('T', ' ').slice(0, 16) + 'Z',
        published:  n(r.published),
        hadRetries: n(r.had_retries),
      }));

      // ── 8. Avg end-to-end latency (occurred_at → published_at) ───────────
      const [latencyRow] = await tx.$queryRawUnsafe<Row[]>(`
        SELECT
          AVG(EXTRACT(EPOCH FROM (published_at - occurred_at)) * 1000) AS avg_latency_ms,
          PERCENTILE_CONT(0.95) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (published_at - occurred_at)) * 1000
          )                                                             AS p95_latency_ms
        FROM event_outbox
        WHERE published_at >= NOW() - INTERVAL '${days} days'
      `).catch(() => [{}] as Row[]);

      const avgLatencyMs = latencyRow?.avg_latency_ms != null
        ? Math.round(n(latencyRow.avg_latency_ms))
        : null;
      const p95LatencyMs = latencyRow?.p95_latency_ms != null
        ? Math.round(n(latencyRow.p95_latency_ms))
        : null;

      // ── 9. Per-type published throughput (window) ─────────────────────────
      const typeStatsRows = await tx.$queryRawUnsafe<Row[]>(`
        SELECT
          event_type,
          COUNT(*) FILTER (WHERE published_at IS NOT NULL)          AS published,
          COUNT(*) FILTER (WHERE published_at IS NULL
                            AND  failed_at IS NOT NULL
                            AND  retry_count >= 5)                  AS parked,
          AVG(EXTRACT(EPOCH FROM (published_at - occurred_at)) * 1000)
            FILTER (WHERE published_at IS NOT NULL)                  AS avg_latency_ms
        FROM event_outbox
        WHERE created_at >= NOW() - INTERVAL '${days} days'
        GROUP BY event_type
        ORDER BY published DESC
      `).catch(() => [] as Row[]);

      const byEventType = typeStatsRows.map(r => ({
        eventType:    s(r.event_type),
        published:    n(r.published),
        parked:       n(r.parked),
        avgLatencyMs: r.avg_latency_ms != null ? Math.round(n(r.avg_latency_ms)) : null,
      }));

      return NextResponse.json({
        period: { days },
        summary: {
          pending,
          parked:          parkedCount,
          publishedWindow,
          totalFailed,
          queueLagMs,
          avgLatencyMs,
          p95LatencyMs,
        },
        pendingByType,
        deadLetter,
        inboxFailed,
        consumerStats,
        throughputHourly,
        byEventType,
      });
    });
  } catch (err) {
    console.error('[admin/events/outbox GET]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
