
import { createMaintenanceRequest } from '../src/services/mockData';

async function test() {
    console.log('--- Testing Maintenance Request Creation ---');

    const rawDatePayload = {
        vehicleId: 'v1',
        driverId: 'd1',
        requestDate: '2026-01-02', // INTENTIONALLY BAD FORMAT
        description: 'Test Raw Date',
        estimatedCost: 100
    };

    console.log('Sending RAW date payload...');
    try {
        await createMaintenanceRequest(rawDatePayload as any);
        console.log('SUCCESS (Unexpected): Raw date accepted.');
    } catch (e: any) {
        console.log('ERROR (Expected):', e.message);
    }

    const isoDatePayload = {
        vehicleId: 'v1',
        driverId: 'd1',
        requestDate: new Date('2026-01-02').toISOString(), // CORRECT FORMAT
        description: 'Test ISO Date',
        estimatedCost: 100
    };

    console.log('\nSending ISO date payload...');
    try {
        await createMaintenanceRequest(isoDatePayload as any);
        console.log('SUCCESS: ISO date accepted.');
    } catch (e: any) {
        console.log('ERROR (Unexpected):', e.message);
    }
}

test();
