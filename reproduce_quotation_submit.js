
const fetch = require('node-fetch');

async function testQuotationSubmit() {
    try {
        const listRes = await fetch('http://localhost:3000/api/maintenance-requests');
        if (!listRes.ok) return;
        const list = await listRes.json();
        if (list.length === 0) return;
        const targetId = list[0].id;

        // Simulate frontend payload with CORRECT Uppercase attachment type
        const newQuotationPayload = {
            requestId: targetId,
            garageId: 'g1',
            quotationDate: new Date().toISOString(),
            validUntil: new Date().toISOString(),
            laborCost: 100,
            partsCost: 50,
            totalCost: 150,
            consumablesCost: 5,
            vatAmount: 7.5,
            grandTotal: 162.5,
            currency: 'AED',
            parts: [],
            labor: [],
            estimatedDuration: 24,
            estimatedCompletionDate: new Date().toISOString(),
            notes: 'Test Note from Script (Fixed)',
            status: 'PENDING',
            submittedBy: 'Test Script',
            attachments: [
                {
                    id: 'test-att-' + Date.now(),
                    type: 'QUOTATION', // Uppercase (Correct)
                    fileName: 'test.pdf',
                    url: 'http://example.com/test.pdf',
                    uploadedAt: new Date().toISOString()
                }
            ]
        };

        console.log('Sending payload (POST /api/quotations):', JSON.stringify(newQuotationPayload, null, 2));

        const createRes = await fetch('http://localhost:3000/api/quotations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newQuotationPayload)
        });

        if (!createRes.ok) {
            const errorText = await createRes.text();
            console.error('Create FAILED:', errorText);
        } else {
            const created = await createRes.json();
            console.log('Create SUCCESS:', created);
        }

    } catch (error) {
        console.error('Script error:', error);
    }
}

testQuotationSubmit();
