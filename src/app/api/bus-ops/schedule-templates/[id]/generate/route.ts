export const dynamic = 'force-dynamic';

/**
 * POST /api/bus-ops/schedule-templates/[id]/generate
 *
 * Ops-triggered generation for a single template + explicit date window.
 * Delegates to the shared helper in src/lib/bus-ops/generate-schedule-template.ts
 * so the same logic runs for both this endpoint and the nightly cron
 * (POST /api/cron/bus-ops/generate-schedule-templates).
 *
 * Body: { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }
 * Response: { ok, generated, skippedAlreadyExisted, skippedOutOfWindow,
 *             skippedInactiveOrException, errors }
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { generateScheduleTemplate } from '@/lib/bus-ops/generate-schedule-template';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
interface GenBody { from?: string; to?: string }

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;
  const { id } = await ctx.params;

  let body: GenBody;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  if (!body.from || !body.to) return NextResponse.json({ error: 'from and to (YYYY-MM-DD) are required' }, { status: 400 });

  const from = new Date(body.from);
  const to   = new Date(body.to);
  if (isNaN(from.getTime()) || isNaN(to.getTime()) || to < from) {
    return NextResponse.json({ error: 'from/to must be valid dates and to must be >= from' }, { status: 400 });
  }
  const daysSpan = Math.floor((to.getTime() - from.getTime()) / 86400000) + 1;
  if (daysSpan > 366) {
    return NextResponse.json({ error: 'Generation window cannot exceed 366 days' }, { status: 400 });
  }

  try {
    const stats = await generateScheduleTemplate({ templateId: id, tenantId, from, to });
    return NextResponse.json({ ok: true, ...stats });
    } catch (e) {
    const msg = e instanceof Error ? e.message : 'Generation failed';
    if (msg.includes('not found')) return NextResponse.json({ error: msg }, { status: 404 });
    console.error('[schedule-templates/generate.POST]', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
