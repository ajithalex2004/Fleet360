
const fetch = require('node-fetch');

async function testUpdate() {
    // Replace with a valid ID from your database or create one first
    // For now, let's try to fetch all requests to get a valid ID
    try {
        const listRes = await fetch('http://localhost:3000/api/maintenance-requests');
        if (!listRes.ok) {
            console.error('Failed to fetch list:', await listRes.text());
            return;
        }
        const list = await listRes.json();
        if (list.length === 0) {
            console.log('No requests found to update.');
            return;
        }

        const targetId = list[0].id;
        console.log(`Testing update on request ID: ${targetId}`);

        const payload = {
            odometer: 12345,
            maintenanceType: 'PREVENTIVE', // Uppercase as per new enum
            priority: 'HIGH', // Uppercase as per new enum
            description: 'Test Description Updated',
            maintenanceJobs: ['Oil Change', 'Filter Replacement'],
            expectedEndDate: new Date().toISOString()
        };

        console.log('Sending payload:', JSON.stringify(payload, null, 2));

        const updateRes = await fetch(`http://localhost:3000/api/maintenance-requests/${targetId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!updateRes.ok) {
            const errorText = await updateRes.text();
            console.error('Update FAILED:', errorText);
        } else {
            const updated = await updateRes.json();
            console.log('Update SUCCESS:', updated);
        }

    } catch (error) {
        console.error('Script error:', error);
    }
}

testUpdate();
