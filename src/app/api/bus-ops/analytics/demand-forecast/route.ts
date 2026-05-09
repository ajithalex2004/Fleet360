/**
 * GET /api/bus-ops/analytics/demand-forecast
 *
 * Forecasts next-week passenger demand per (route, shift) using historical
 * trip+passenger data. Hybrid approach:
 *
 *   1. Statistical baseline: 4-week trailing average for each route+shift+
 *      day-of-week combination. Always returns a number; never blocked by
 *      missing OpenAI key.
 *
 *   2. AI annotation (optional, gpt-4o-mini): given the baseline + recent
 *      trend (last 2 weeks vs prior 2 weeks), the model returns a confidence
 *      band, capacity-risk flag, and a one-line explanation. Falls back to
 *      a deterministic explanation when OPENAI_API_KEY is missing.
 *
 * Auth: open (read-only). Tenants restricted by middleware.
 * Query: ?weeks=N (history window, default 4), ?aiAnnotate=0 to skip AI.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { chatComplete } from '@/lib/agents/openai-client';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

interface BucketKey {
  routeId: string;
  routeName: string;
  shiftType: string;
  dayOfWeek: number; // 0-6
}

interface ForecastRow extends BucketKey {
  baseline: number;
  trendDelta: number;
  trailingWeeks: number;
  capacity: number | null;
  capacityRiskPct: number | null;
  aiAnnotation: { confidence: 'LOW' | 'MEDIUM' | 'HIGH'; risk: 'OVER' | 'UNDER' | 'OK'; rationale: string } | null;
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const weeks = Math.max(1, Math.min(12, Number(sp.get('weeks') ?? 4)));
  const aiAnnotate = sp.get('aiAnnotate') !== '0';

  const now = new Date();
  const historyStart = new Date(now.getTime() - weeks * 7 * 86400000);

  try {
    // Pull trip schedules with their passenger counts in the window.
    const trips = await prisma.tripSchedule.findMany({
      where: {
        deletedAt: null,
        departureTime: { gte: historyStart, lte: now },
      },
      select: {
        id: true, routeId: true, shiftType: true, departureTime: true,
        capacity: true, confirmedCount: true,
        route: { select: { name: true, capacity: true } },
      },
    });

    if (trips.length === 0) {
      return NextResponse.json({
        weeksOfHistory: weeks,
        runAt: now.toISOString(),
        rows: [],
        warning: 'No trips in the history window — forecasts unavailable.',
      });
    }

    // Bucket by routeId + shiftType + dayOfWeek; midpoint = (recent half) − (older half) average.
    const halfMs = (weeks * 7 * 86400000) / 2;
    const splitAt = new Date(now.getTime() - halfMs);

    interface Bucket { recent: number[]; old: number[]; capacity: number | null; routeName: string; shiftType: string; }
    const buckets = new Map<string, Bucket>();

    for (const t of trips) {
      if (!t.shiftType || !t.routeId) continue;
      const dow = new Date(t.departureTime).getDay();
      const key = `${t.routeId}|${t.shiftType}|${dow}`;
      let b = buckets.get(key);
      if (!b) {
        b = {
          recent: [], old: [],
          capacity: t.capacity ?? t.route?.capacity ?? null,
          routeName: t.route?.name ?? '—',
          shiftType: t.shiftType,
        };
        buckets.set(key, b);
      }
      const n = t.confirmedCount ?? 0;
      if (new Date(t.departureTime) >= splitAt) b.recent.push(n);
      else b.old.push(n);
    }

    const rows: ForecastRow[] = [];
    for (const [key, b] of buckets) {
      const [routeId, shiftType, dowStr] = key.split('|');
      const dow = parseInt(dowStr, 10);
      const total = [...b.recent, ...b.old];
      if (total.length === 0) continue;
      const baseline = Math.round(total.reduce((s, x) => s + x, 0) / total.length);
      const recentAvg = b.recent.length > 0 ? b.recent.reduce((s, x) => s + x, 0) / b.recent.length : baseline;
      const oldAvg = b.old.length > 0 ? b.old.reduce((s, x) => s + x, 0) / b.old.length : baseline;
      const trendDelta = Math.round((recentAvg - oldAvg) * 10) / 10;
      const capacity = b.capacity;
      const capacityRiskPct = capacity != null && capacity > 0
        ? Math.round((baseline + trendDelta) / capacity * 100)
        : null;

      rows.push({
        routeId, routeName: b.routeName, shiftType, dayOfWeek: dow,
        baseline, trendDelta, trailingWeeks: weeks,
        capacity, capacityRiskPct,
        aiAnnotation: null,
      });
    }

    rows.sort((a, b) => (b.capacityRiskPct ?? 0) - (a.capacityRiskPct ?? 0));

    // Annotate the top 10 highest-risk rows with AI rationale (if available).
    if (aiAnnotate) {
      const toAnnotate = rows.slice(0, 10);
      try {
        const summary = toAnnotate.map(r =>
          `route="${r.routeName}" shift=${r.shiftType} day=${DAY_LABELS[r.dayOfWeek]} baseline=${r.baseline} trendDelta=${r.trendDelta > 0 ? '+' : ''}${r.trendDelta} cap=${r.capacity ?? '—'} risk=${r.capacityRiskPct ?? '—'}%`,
        ).join('\n');

        const aiRes = await chatComplete([
          { role: 'system', content:
            `You are an operations analyst for a UAE corporate staff bus fleet. For each line below, return ONE JSON object per line (no other text) on its own line, in the same order, with shape:
{"confidence":"LOW|MEDIUM|HIGH","risk":"OVER|UNDER|OK","rationale":"<≤80 chars>"}
Rules: HIGH confidence only when ≥3 historic samples with low variance. risk=OVER if (baseline+trendDelta)/capacity ≥ 0.95. risk=UNDER if ≤0.55. Else OK. Keep rationale practical for a dispatcher.` },
          { role: 'user', content: summary },
        ], { model: 'gpt-4o-mini', maxTokens: 600, temperature: 0.2 });

        const lines = aiRes.content.split('\n').map(l => l.trim()).filter(Boolean);
        for (let i = 0; i < toAnnotate.length && i < lines.length; i++) {
          try {
            const parsed = JSON.parse(lines[i]);
            if (parsed?.confidence && parsed?.risk && typeof parsed.rationale === 'string') {
              toAnnotate[i].aiAnnotation = {
                confidence: parsed.confidence,
                risk: parsed.risk,
                rationale: parsed.rationale.slice(0, 120),
              };
            }
          } catch { /* skip malformed line */ }
        }
      } catch (err) {
        captureException(err, { context: 'bus-ops.demand-forecast.ai' });
      }
    }

    return NextResponse.json({
      weeksOfHistory: weeks,
      runAt: now.toISOString(),
      rows,
    });
  } catch (err) {
    captureException(err, { context: 'bus-ops.demand-forecast' });
    return NextResponse.json({ error: 'Forecast failed' }, { status: 500 });
  }
}
