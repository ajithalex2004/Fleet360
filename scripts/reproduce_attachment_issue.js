const fetch = require('node-fetch');

// Use localhost:8080/api as expected for the backend
const BASE_URL = 'http://localhost:8080/api';

async function run() {
    try {
        console.log('--- Starting Reproduction Script ---');

        // 0. Get Valid IDs
        console.log('0. Fetching valid Vehicle and Driver...');
        let vehicleId = 'v-test';
        let driverId = 'd-test';

        // Check/Create Vehicle
        const vRes = await fetch(`${BASE_URL}/vehicles`);
        const vehicles = await vRes.json();
        if (vehicles.length > 0) {
            vehicleId = vehicles[0].id;
        } else {
            const newV = await fetch(`${BASE_URL}/vehicles`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ make: 'TestMake', model: 'TestModel', year: 2022, licensePlate: 'TEST-999', vin: 'VIN999' })
            }).then(r => r.json());
            vehicleId = newV.id;
        }

        // Check/Create Driver
        const dRes = await fetch(`${BASE_URL}/drivers`);
        const drivers = await dRes.json();
        if (drivers.length > 0) {
            driverId = drivers[0].id;
        } else {
            const newD = await fetch(`${BASE_URL}/drivers`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'Test Driver', licenseNumber: 'LIC-999', contactNumber: '555-0199' })
            }).then(r => r.json());
            driverId = newD.id;
        }
        // Check/Create Garage
        let garageId = 'g-test';
        const gRes = await fetch(`${BASE_URL}/garages`);
        const garages = await gRes.json();
        if (garages.length > 0) {
            garageId = garages[0].id;
        } else {
            const newG = await fetch(`${BASE_URL}/garages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'Test Garage', location: 'Test Location', services: ['Test Service'], contactNumber: '555-0000', email: 'test@garage.com' })
            }).then(r => r.json());
            garageId = newG.id;
        }
        console.log(`   Using Vehicle: ${vehicleId}, Driver: ${driverId}, Garage: ${garageId}`);


        // 1. Create Maintenance Request
        console.log('1. Creating Maintenance Request...');
        const mrRes = await fetch(`${BASE_URL}/maintenance-requests`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                vehicleId: vehicleId,
                driverId: driverId,
                requestDate: new Date().toISOString(),
                description: 'Test MR for Attachment Debug',
                status: 'Requested',
                maintenanceType: 'Preventive'
            })
        });

        if (!mrRes.ok) throw new Error(`Failed to create MR: ${mrRes.status} ${await mrRes.text()}`);
        const mr = await mrRes.json();
        console.log(`   MR Created: ${mr.id}`);

        // 2. Create Quotation with Attachment
        console.log('2. Creating Quotation with Attachment...');
        const quoteRes = await fetch(`${BASE_URL}/quotations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                requestId: mr.id,
                garageId: garageId,
                totalCost: 500,
                status: 'PENDING',
                attachments: [{
                    type: 'QUOTATION',
                    fileName: 'quote.pdf',
                    url: 'http://example.com/quote.pdf' // Fake URL
                }]
            })
        });

        if (!quoteRes.ok) throw new Error(`Failed to create Quotation: ${quoteRes.status} ${await quoteRes.text()}`);
        const quote = await quoteRes.json();
        console.log(`   Quotation Created: ${quote.id}`);

        // 3. Update MR with Approved Attachment
        console.log('3. Updating MR with Approved Attachment...');
        // Simulate existing attachments (empty) + new one
        const newAttachment = {
            id: `att-test-${Date.now()}`, // Simulated Frontend ID
            type: 'APPROVED_ESTIMATE',
            fileName: 'approved.pdf',
            url: 'http://example.com/approved.pdf'
        };

        const patchRes = await fetch(`${BASE_URL}/maintenance-requests/${mr.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                status: 'Under Maintenance',
                attachments: [newAttachment]
            })
        });

        if (!patchRes.ok) throw new Error(`Failed to update MR: ${patchRes.status} ${await patchRes.text()}`);
        console.log('   MR Updated Successfully');

        // 4. Verification
        console.log('4. Verifying Attachment Persistence...');
        const getRes = await fetch(`${BASE_URL}/maintenance-requests/${mr.id}`);
        const updatedMr = await getRes.json();

        console.log(`   Attachments Count: ${updatedMr.attachments ? updatedMr.attachments.length : 0}`);
        if (updatedMr.attachments && updatedMr.attachments.length > 0) {
            console.log('   [SUCCESS] Attachment found:', updatedMr.attachments[0]);
        } else {
            console.log('   [FAILURE] No attachments found!');
        }

    } catch (error) {
        console.error('[ERROR]', error);
    }
}

run();
