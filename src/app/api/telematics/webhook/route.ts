export const dynamic = 'force-dynamic';

/**
 * /api/telematics/webhook — Telematics ingestion (Pattern A).
 *
 * Accepts telemetry packets in the Flespi, Teltonika, Geotab, Traccar or
 * generic gateway formats and records them for the caller's tenant.
 *
 * Authentication: a signed-in staff session. This route is not public
 * (middleware answers 401 without one), and the tenant is the session's.
 * It used to take the tenant from ?tenantId= or x-tenant-id and a shared
 * secret with built-in fallbacks ('fleet360-telematics-live', 'demo-secret')
 * that shipped in the browser bundle, so any signed-in user could write
 * telemetry into another tenant. Gateways that post without a session need a
 * per-tenant device credential; they are not supported here.
 */

import { NextRequest, NextResponse } from 'next/server';
import { normalizeTelemetryBatch, processTelemetryBatch } from '@/lib/telematics/gateway-ingest';
import { requireAuthorizedTenant } from '@/lib/tenant-context';

export async function POST(req: NextRequest) {
  try {
    // ?tenantId= naming another tenant is refused (a platform admin may switch).
    const authz = requireAuthorizedTenant(req, { allowPlatformSwitch: true });
    if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
    if (!authz.userId) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    const { tenantId } = authz;

    const rawBody = await req.json().catch(() => null);
    if (!rawBody) {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    const pings = normalizeTelemetryBatch(rawBody);
    if (pings.length === 0) {
      return NextResponse.json({
        success: false,
        message: 'No valid telemetry coordinates or IMEI found in payload',
        received: Array.isArray(rawBody) ? rawBody.length : 1,
      }, { status: 422 });
    }

    const result = await processTelemetryBatch(tenantId, pings);

    return NextResponse.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[telematics-webhook] Ingest error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal Server Error' },
      { status: 500 },
    );
  }
}
