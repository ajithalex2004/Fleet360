// @ts-nocheck — one-off CLI script, types not maintained
// `export {}` marks this file as an ES module rather than a global
// script — without it, every top-level const/let here (e.g. `req`)
// leaks into the ambient global scope for the whole project, since
// tsconfig's `include` covers scripts/*.ts too.
export {};
const http = require('http');

const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/',
    method: 'GET',
};

const req = http.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => {
        data += chunk;
    });
    res.on('end', () => {
        console.log(`STATUS: ${res.statusCode}`);
        // Extract CSS link
        const match = data.match(/layout\.css\?v=([0-9]+)/);
        if (match) {
            console.log(`CURRENT_VERSION: ${match[1]}`);
        } else {
            console.log('No layout.css version found in HTML.');
            // Print first 500 chars to debug
            console.log(data.substring(0, 500));
        }
    });
});

req.on('error', (e) => {
    console.error(`problem with request: ${e.message}`);
});

req.end();
