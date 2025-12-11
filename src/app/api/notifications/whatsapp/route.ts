import { NextResponse } from 'next/server';

export async function POST(request: Request) {
    try {
        const { to, message } = await request.json();

        if (!to || !message) {
            return NextResponse.json({ success: false, error: 'Missing "to" or "message" field' }, { status: 400 });
        }

        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;
        const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER;

        if (!accountSid || !authToken || !fromNumber) {
            console.warn('[WhatsApp] Twilio credentials missing. Mocking success.');
            return NextResponse.json({ success: true, data: { sid: 'mock-sid', status: 'queued' }, mock: true });
        }

        const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
        const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

        // Ensure numbers have 'whatsapp:' prefix
        const formattedTo = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
        const formattedFrom = fromNumber.startsWith('whatsapp:') ? fromNumber : `whatsapp:${fromNumber}`;

        const formData = new URLSearchParams();
        formData.append('To', formattedTo);
        formData.append('From', formattedFrom);
        formData.append('Body', message);

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: formData,
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error('Twilio API Error:', errorData);
            return NextResponse.json({ success: false, error: errorData.message || 'Failed to send message' }, { status: response.status });
        }

        const data = await response.json();
        return NextResponse.json({ success: true, data });

    } catch (error) {
        console.error('Error sending WhatsApp message:', error);
        return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
    }
}
