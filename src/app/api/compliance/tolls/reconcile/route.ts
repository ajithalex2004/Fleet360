import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { 
  reconcileTollCrossings, 
  TollCrossingEvent, 
  ShiftOrTripContext 
} from '@/lib/fines/toll-reconciliation';

export const dynamic = 'force-dynamic';

/**
 * POST /api/compliance/tolls/reconcile
 * Executes spatial-temporal reconciliation between toll crossings and active trips/shifts
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuthorizedTenant(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const rawBody = await req.json();
    const body = stripTenantOwnershipFields(rawBody);

    const tollCrossings: TollCrossingEvent[] = Array.isArray(body.tollCrossings) && body.tollCrossings.length > 0
      ? body.tollCrossings
      : [
          {
            id: 'TOLL-001',
            tollSystem: 'SALIK',
            gateName: 'Al Barsha Gate (Sheikh Zayed Road)',
            vehiclePlate: 'DXB-54210',
            crossingTimestamp: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
            tollAmountAed: 4.0,
          },
          {
            id: 'TOLL-002',
            tollSystem: 'SALIK',
            gateName: 'Airport Tunnel Gate',
            vehiclePlate: 'DXB-54210',
            crossingTimestamp: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
            tollAmountAed: 4.0,
          },
          {
            id: 'TOLL-003',
            tollSystem: 'DARB',
            gateName: 'Sheikh Zayed Bridge Gate',
            vehiclePlate: 'AUH-19283',
            crossingTimestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
            tollAmountAed: 4.0,
          },
          {
            id: 'TOLL-004',
            tollSystem: 'SALIK',
            gateName: 'Al Safa Gate',
            vehiclePlate: 'DXB-99999', // Unknown/Off-duty vehicle
            crossingTimestamp: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
            tollAmountAed: 4.0,
          },
        ];

    const activeContexts: ShiftOrTripContext[] = Array.isArray(body.activeContexts) && body.activeContexts.length > 0
      ? body.activeContexts
      : [
          {
            id: 'TRIP-ST-8821',
            type: 'STAFF_TRANSPORT',
            vehiclePlate: 'DXB-54210',
            driverName: 'Muhammad Rashid',
            customerName: 'Emaar Hospitality Group',
            startTime: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
            endTime: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
            routeCode: 'ROUTE-DSO-DOWNTOWN',
            contractTollsIncluded: false, // Pass-through to customer
          },
          {
            id: 'TRIP-LOG-4412',
            type: 'LOGISTICS_FREIGHT',
            vehiclePlate: 'AUH-19283',
            driverName: 'Suresh Kumar',
            customerName: 'ADNOC Distribution',
            startTime: new Date(Date.now() - 120 * 60 * 1000).toISOString(),
            endTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            routeCode: 'AUH-KIZAD-EXPRESS',
            contractTollsIncluded: true, // Absorbed in monthly contract
          },
        ];

    const tolerance = Number(body.toleranceMinutes || 10);
    const summary = reconcileTollCrossings(tollCrossings, activeContexts, tolerance);

    return NextResponse.json({
      success: true,
      toleranceMinutes: tolerance,
      summary,
    });
  } catch (err: any) {
    console.error('Error in toll reconciliation API:', err);
    return NextResponse.json({ error: 'Failed to reconcile toll crossings', details: err.message }, { status: 500 });
  }
}
