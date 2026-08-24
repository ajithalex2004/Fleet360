/**
 * src/app/api/driver-app/cba/continuous-driving-limit/route.ts
 *
 * GET /api/driver-app/cba/continuous-driving-limit
 *
 * Returns the tenant's CBA-driven limit for how long a driver may
 * drive continuously before being required to take a break.
 *
 * Resolution order:
 *   1. Tenant's default CBA rule set (cba_rule_sets.is_default = true)
 *      → look up MAX_DRIVING_HOURS_CONTINUOUS rule
 *   2. Platform default (4.5h) from DEFAULT_CBA_RULES
 *
 * Response shape:
 *   {
 *     limitHours: number,         // e.g. 4.5
 *     limitMinutes: number,       // e.g. 270
 *     limitMs: number,            // e.g. 16200000
 *     source: 'CBA' | 'PLATFORM_DEFAULT',
 *     rule: { id, name, value, unit } | null,  // the CBA rule that supplied the value
 *     jurisdiction: string | null,
 *     fetchedAt: ISO timestamp
 *   }
 *
 * The endpoint is cached for 5 min with 10 min SWR — the CBA config
 * changes rarely but the value is read on every page load.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { privateCacheControl } from '@/lib/server-cache';
import { requireDriverSession } from '@/lib/driver-session';
import { findRule, DEFAULT_CBA_RULES } from '@/lib/cba/types';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
const PLATFORM_DEFAULT_HOURS =
  DEFAULT_CBA_RULES.rules.find((r) => r.category === 'MAX_DRIVING_HOURS_CONTINUOUS')?.value ?? 4.5;

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const ctx = await requireDriverSession(req);
  if (ctx instanceof NextResponse) return ctx;

  // 1) Try the tenant's default CBA rule set
  let limitHours = PLATFORM_DEFAULT_HOURS;
  let source: 'CBA' | 'PLATFORM_DEFAULT' = 'PLATFORM_DEFAULT';
  let rule: { id: string; name: string; value: number; unit: string } | null = null;
  let jurisdiction: string | null = null;

  try {
    const ruleSet = await withTenantRls(prisma, ctx.tenantId, (tx) =>
      tx.cbaRuleSet.findFirst({
        where: { tenantId: ctx.tenantId, isDefault: true, deletedAt: null },
        select: { rulesJson: true, jurisdiction: true, schemaVersion: true },
      })
    );

    if (ruleSet?.rulesJson) {
      // rulesJson is typed as Json; the CBA schema lives in src/lib/cba/types.ts.
      // We treat it as the CbaRules shape and find the relevant rule.
      const cba = ruleSet.rulesJson as unknown as {
        schemaVersion?: number;
        rules?: Array<{ id: string; name: string; value: number; unit: string; category: string; enforced?: boolean }>;
      };
      const matched = cba.rules?.find(
        (r) => r.category === 'MAX_DRIVING_HOURS_CONTINUOUS' && r.enforced !== false,
      );
      if (matched && Number.isFinite(matched.value) && matched.value > 0) {
        limitHours = matched.value;
        source = 'CBA';
        rule = {
          id: matched.id,
          name: matched.name,
          value: matched.value,
          unit: matched.unit,
        };
        jurisdiction = ruleSet.jurisdiction ?? null;
      }
    }
  } catch (e) {
    // Fall through to platform default. Log so we can spot CBA load
    // failures without failing the driver.
    console.error('[cba/continuous-driving-limit] CBA lookup failed, using platform default:', e);
  }

  const limitMinutes = limitHours * 60;
  const limitMs = limitHours * 60 * 60 * 1000;

  return NextResponse.json(
    {
      limitHours,
      limitMinutes,
      limitMs,
      source,
      rule,
      jurisdiction,
      fetchedAt: new Date().toISOString(),
    },
    {
      headers: { 'Cache-Control': privateCacheControl(300, 600) },
    },
  );
}
