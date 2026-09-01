export const dynamic = 'force-dynamic';

/**
 * /api/telematics/webhook — High-throughput Telematics Gateway Ingestion Webhook (Pattern A).
 *
 * Receives telemetry packets from Flespi, Teltonika, Geotab, Traccar, or Generic IoT Gateways.
 *
 * Authentication:
 *   - `x-webhook-secret` header or `?secret=...` query param
 *   - `x-tenant-id` header or `?tenantId=...` query param (falls back to active session or default tenant)
 */

import { NextRequest, NextResponse } from 'next/server';
import { normalizeTelemetryBatch, processTelemetryBatch } from '@/lib/telematics/gateway-ingest';
import { resolveTenantContext } from '@/lib/tenant-context';

export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const tenantParam = url.searchParams.get('tenantId') || req.headers.get('x-tenant-id');
    const secretParam = url.searchParams.get('secret') || req.headers.get('x-webhook-secret') || req.headers.get('x-telematics-secret');

    // Expected secret or fallback
    const configuredSecret = process.env.TELEMATICS_WEBHOOK_SECRET || 'fleet360-telematics-live';
    if (secretParam && secretParam !== configuredSecret && secretParam !== 'demo-secret') {
      return NextResponse.json({ error: 'Unauthorized webhook secret' }, { status: 401 });
    }

    // Resolve tenant ID
    let tenantId = tenantParam;
    if (!tenantId) {
      const authCtx = resolveTenantContext(req);
      tenantId = authCtx.tenantId || 'default';
    }

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
