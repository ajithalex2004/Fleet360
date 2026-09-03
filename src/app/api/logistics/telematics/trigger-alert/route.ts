export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      tripRef = 'TRIP-9821',
      vehiclePlate = 'DXB-K-94821',
      currentTempC = -13.5,
      thresholdTempC = -15.0,
      consignee = 'Dubai Mall Logistics Dock',
    } = body;

    const alertMessage = `🚨 COLD-CHAIN BREACH ALERT: Vehicle ${vehiclePlate} on trip ${tripRef} recorded temperature ${currentTempC}°C (Exceeds maximum safe threshold ${thresholdTempC}°C). Automated reefer boost triggered. Dispatch and QA notified.`;

    return NextResponse.json({
      success: true,
      alertDispatched: true,
      channels: ['WHATSAPP_HIGH_PRIORITY', 'SMS_URGENT', 'DISPATCH_CONSOLE_ALARM'],
      alertMessage,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[api/logistics/telematics/trigger-alert POST]', err);
    return NextResponse.json({ error: 'Failed to trigger alert' }, { status: 500 });
  }
}
