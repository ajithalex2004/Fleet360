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
    console.log(`STATUS: ${res.statusCode}`);
    res.on('data', (chunk) => {
        // just consume
    });
    res.on('end', () => {
        console.log('No more data in response.');
    });
});

req.on('error', (e) => {
    console.error(`problem with request: ${e.message}`);
});

req.end();
