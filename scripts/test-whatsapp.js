const https = require('https');
const fs = require('fs');
const path = require('path');

// Load .env manually since we are running this with node
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
    console.log('Loading .env file...');
    let envConfig = fs.readFileSync(envPath, 'utf8');

    // Strip Byte Order Mark (BOM) if present
    if (envConfig.charCodeAt(0) === 0xFEFF) {
        envConfig = envConfig.slice(1);
    }

    envConfig.split('\n').forEach(line => {
        // Cleaning line
        line = line.trim();
        if (!line || line.startsWith('#')) return;

        const parts = line.split('=');
        if (parts.length >= 2) {
            // Strip null bytes (\0) caused by UTF-16 encoding issues
            const key = parts[0].replace(/\0/g, '').trim();
            let value = parts.slice(1).join('=').replace(/\0/g, '').trim();

            // Remove quotes if present
            if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
            if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);

            console.log(`Loaded key: [${key}] (Cleaned)`);
            process.env[key] = value;
        }
    });

    // Debugging specific keys
    const accountSidKey = 'TWILIO_ACCOUNT_SID';
    const val = process.env[accountSidKey];
    console.log(`Direct check '${accountSidKey}':`, val ? (val.substring(0, 5) + '...') : 'UNDEFINED');

} else {
    console.warn('.env file not found at:', envPath);
}

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER;

console.log('--- WhatsApp Diagnostic ---');
console.log('Account SID:', accountSid ? `${accountSid.substring(0, 6)}...` : 'MISSING');
console.log('Auth Token:', authToken ? 'PRESENT' : 'MISSING');
console.log('From Number:', fromNumber || 'MISSING');

if (!accountSid || !authToken || !fromNumber) {
    console.error('ERROR: Missing required credentials.');
    process.exit(1);
}

// Ask for recipient
const recipient = process.argv[2];
if (!recipient) {
    console.error('Usage: node scripts/test-whatsapp.js <recipient_number_with_country_code>');
    console.error('Example: node scripts/test-whatsapp.js +971501234567');
    process.exit(1);
}

console.log(`Attempting to send to: ${recipient}`);

const body = new URLSearchParams({
    'To': `whatsapp:${recipient}`,
    'From': fromNumber.startsWith('whatsapp:') ? fromNumber : `whatsapp:${fromNumber}`,
    'Body': 'Hello from C1 Gravity Diagnostic Tool!'
}).toString();

const options = {
    hostname: 'api.twilio.com',
    port: 443,
    path: `/2010-04-01/Accounts/${accountSid}/Messages.json`,
    method: 'POST',
    headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': body.length,
        'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64')
    }
};

const req = https.request(options, (res) => {
    console.log(`Status Code: ${res.statusCode}`);

    let data = '';

    res.on('data', (chunk) => {
        data += chunk;
    });

    res.on('end', () => {
        try {
            const json = JSON.parse(data);
            if (res.statusCode >= 200 && res.statusCode < 300) {
                console.log('SUCCESS! Message Data:');
                console.log(JSON.stringify(json, null, 2));
                console.log('\nIMPORTANT: If you did not receive the message, checks:');
                console.log('1. Are you using Twilio Sandbox? If so, did you send the join code?');
                console.log('2. Is the destination number correct?');
            } else {
                console.error('FAILED. API Response:');
                console.error(JSON.stringify(json, null, 2));
            }
        } catch (e) {
            console.log('Response:', data);
        }
    });
});

req.on('error', (error) => {
    console.error('Network Error:', error);
});

req.write(body);
req.end();
