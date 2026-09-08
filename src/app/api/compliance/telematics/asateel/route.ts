import { NextRequest, NextResponse } from 'next/server';
import { 
  formatAsateelIngestionPayload, 
  evaluateAsateelDispatchGating, 
  AsateelTelemetryPing,
  AsateelGatingCheck 
} from '@/lib/compliance/asateel-telematics';

export const dynamic = 'force-dynamic';

/**
 * POST /api/compliance/telematics/asateel
 * Mode 1: Action = 'format_ping' -> Transforms raw GPS stream into ITC Asateel v2.4 JSON payload
 * Mode 2: Action = 'evaluate_gating' -> Executes cross-emirate dispatch compliance gate
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = body.action || 'evaluate_gating';

    if (action === 'format_ping') {
      const pingData = body.ping as AsateelTelemetryPing;
      if (!pingData || !pingData.vehiclePlate || !pingData.latitude || !pingData.longitude) {
        return NextResponse.json({ error: 'Missing required telematics ping fields (vehiclePlate, latitude, longitude)' }, { status: 400 });
      }

      const payload = formatAsateelIngestionPayload(pingData);
      return NextResponse.json({
        success: true,
        protocol: 'ITC_ASATEEL_V2.4',
        asateelPayload: payload,
      });
    }

    if (action === 'evaluate_gating') {
      const checkData = (body.check || body) as AsateelGatingCheck;
      if (!checkData.vehicleId && !checkData.plateNumber) {
        return NextResponse.json({ error: 'Missing vehicle identification details (vehicleId or plateNumber)' }, { status: 400 });
      }

      const result = evaluateAsateelDispatchGating({
        vehicleId: checkData.vehicleId || 'VEH-001',
        plateNumber: checkData.plateNumber || 'DXB-12345',
        plateEmirate: checkData.plateEmirate || 'DXB',
        hasAsateelPermit: Boolean(checkData.hasAsateelPermit),
        asateelPermitExpiry: checkData.asateelPermitExpiry,
        gpsLastPingTimestamp: checkData.gpsLastPingTimestamp || new Date().toISOString(),
        driverEmiratesId: checkData.driverEmiratesId || '784-1990-1234567-1',
        routeOriginsAndDestinations: checkData.routeOriginsAndDestinations || ['Dubai'],
      });

      return NextResponse.json({
        success: true,
        evaluation: result,
      });
    }

    return NextResponse.json({ error: `Unknown action: '${action}'. Expected 'format_ping' or 'evaluate_gating'.` }, { status: 400 });
  } catch (err: any) {
    console.error('Error in Asateel Telematics API:', err);
    return NextResponse.json({ error: 'Failed to process Asateel telematics request', details: err.message }, { status: 500 });
  }
}
