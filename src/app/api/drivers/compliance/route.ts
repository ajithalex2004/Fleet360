/**
 * Driver Management Hub — /api/drivers/compliance
 *
 * Returns a fleet-wide driver compliance dashboard:
 *  - Count of drivers by compliance alert level
 *  - List of drivers with issues (expired / expiring soon / missing docs)
 *
 * This endpoint is used by the Operations Assistant, Fleet dashboard,
 * and compliance reporting — no module maintains its own version.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

function serialize(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return obj.toString();
  if (obj instanceof Date) return obj.toISOString();
  if (Array.isArray(obj)) return obj.map(serialize);
  if (typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [k, serialize(v)])
    );
  }
  return obj;
}

function checkDoc(dt: Date | null | undefined, nowMs: number, thresholdMs: number) {
  if (!dt) return 'missing';
  const t = dt.getTime();
  if (t < nowMs)         return 'expired';
  if (t < thresholdMs)   return 'expiring_soon';
  return 'valid';
}

export async function GET(request: NextRequest) {
  try {
    const sp          = request.nextUrl.searchParams;
    const withinDays  = parseInt(sp.get('days') ?? '30', 10);
    const nowMs       = Date.now();
    const thresholdMs = nowMs + withinDays * 86400000;

    const drivers = await prisma.driver.findMany({
      where: { deletedAt: null, status: { not: 'INACTIVE' } },
      select: {
        id: true, name: true, firstName: true, lastName: true,
        licenseExpiry: true, emiratesIdExpiry: true,
        passportExpiry: true, visaExpiry: true,
        status: true, driverType: true,
        assignedVehicleId: true,
      },
    });

    const summary = {
      total:   drivers.length,
      ok:      0,
      warning: 0,
      critical:0,
      incomplete: 0,
    };

    const issues: Array<{
      id: string;
      name: string;
      alertLevel: string;
      docs: Record<string, string>;
    }> = [];

    for (const d of drivers) {
      const docs = {
        license:    checkDoc(d.licenseExpiry,    nowMs, thresholdMs),
        emiratesId: checkDoc(d.emiratesIdExpiry, nowMs, thresholdMs),
        passport:   checkDoc(d.passportExpiry,   nowMs, thresholdMs),
        visa:       checkDoc(d.visaExpiry,        nowMs, thresholdMs),
      };
      const vals = Object.values(docs);
      const alertLevel =
        vals.includes('expired')       ? 'critical'    :
        vals.includes('expiring_soon') ? 'warning'     :
        vals.includes('missing')       ? 'incomplete'  : 'ok';

      summary[alertLevel as keyof typeof summary]++;

      if (alertLevel !== 'ok') {
        issues.push({
          id:   d.id,
          name: d.name ?? [d.firstName, d.lastName].filter(Boolean).join(' ') ?? 'Unknown',
          alertLevel,
          docs,
        });
      }
    }

    // Sort: critical first, then warning, then incomplete
    const levelOrder = { critical: 0, warning: 1, incomplete: 2, ok: 3 };
    issues.sort((a, b) =>
      (levelOrder[a.alertLevel as keyof typeof levelOrder] ?? 3) -
      (levelOrder[b.alertLevel as keyof typeof levelOrder] ?? 3)
    );

    return NextResponse.json(serialize({ summary, issues, checkedWithinDays: withinDays }));
  } catch (error) {
    console.error('[Driver Hub] GET /api/drivers/compliance:', error);
    return NextResponse.json({ error: 'Failed to fetch compliance data' }, { status: 500 });
  }
}
