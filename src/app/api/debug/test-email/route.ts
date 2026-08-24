
import { NextResponse } from 'next/server';
import { processNotificationRules } from '@/lib/notifications';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export async function GET() {
    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

    try {
        console.log('[Debug] Manually triggering SR_CREATED notification');

        const result = await processNotificationRules('SR_CREATED', {
            requestId: 'TEST-SR-001',
            status: 'Pending',
            assignee: 'Test User',
            description: 'Manual Test Description',
            vehicle: 'TEST-PLAT-01'
        }, 'alex@exlsolutions.ae');

        return NextResponse.json({ success: true, message: 'Triggered notification logic', result });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
