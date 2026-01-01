
const BASE_URL = 'http://localhost:3000/api/alert-configs';

async function main() {
    console.log('--- Testing Alert Config Deletion ---');

    // 1. Create a dummy config
    console.log('Creating dummy config...');
    const createRes = await fetch(BASE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            alertFor: 'Vehicle',
            alertType: 'Test Deletion',
            frequency: 'By Odometer',
            frequencyValue: 1000,
            thresholdValue: 100,
            notificationEnabled: false,
            assignedIds: []
        })
    });

    if (!createRes.ok) {
        console.error('Failed to create config:', await createRes.text());
        return;
    }

    const created = await createRes.json();
    console.log('Created Config ID:', created.id);

    // 2. Delete the config
    console.log(`Deleting config ${created.id}...`);
    const deleteRes = await fetch(`${BASE_URL}/${created.id}`, {
        method: 'DELETE'
    });

    if (!deleteRes.ok) {
        console.error('Failed to delete config:', await deleteRes.text());
        return;
    }

    console.log('Delete status:', deleteRes.status);
    const deleteJson = await deleteRes.json();
    console.log('Delete response:', deleteJson);

    // 3. Verify it's gone (optional, but good)
    // We haven't implemented GET /id yet, only DELETE and PATCH exist in that file!
    // But we can check GET /api/alert-configs list
    const listRes = await fetch(BASE_URL);
    const list = await listRes.json();
    const found = list.find((c: any) => c.id === created.id);

    if (found) {
        console.error('ERROR: Config still exists in list!');
    } else {
        console.log('SUCCESS: Config confirmed deleted from list.');
    }
}

main().catch(console.error);
