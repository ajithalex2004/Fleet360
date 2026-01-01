
async function check() {
    console.log('--- Checking /api/alerts Response ---');
    try {
        const res = await fetch('http://localhost:3000/api/alerts', {
            method: 'POST',
            body: JSON.stringify({
                title: 'Test Error Logging',
                // Missing required fields to FORCE an error.
                // But wait, schema has few required fields.
                // relatedEntityId is optional? No, usually not.
                // Let's send GARBAGE to cause a Prisma error.
                thisFieldDoesNotExist: 'foo'
            })
        });
        const text = await res.text();
        console.log('Status:', res.status);
        console.log('Body:', text);
    } catch (e: any) {
        console.log('Fetch Error:', e.message);
    }
}
check();
