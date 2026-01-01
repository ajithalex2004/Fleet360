// Remove conflicting fetch import if on Node 18+ or use dynamic import if needed
// const fetch = require('node-fetch'); 

async function probe() {
    const id = "v1";
    const url = `http://127.0.0.1:8080/api/vehicles/${id}`;

    /*
    console.log(`--- Probing DELETE ${url} ---`);
    try {
        const res = await fetch(url, { method: 'DELETE' });
        console.log(`Status: ${res.status}`);
        const text = await res.text();
        console.log(`Body: ${text}`);
    } catch (e: any) {
        console.error("DELETE failed:", e.message);
    }
    */

    console.log(`\n--- Probing GET ${url} ---`);
    try {
        const res = await fetch(url, { method: 'GET' });
        console.log(`Status: ${res.status}`);
        const text = await res.text();
        console.log(`Body: ${text}`);
    } catch (e: any) {
        console.error("GET failed:", e.message);
    }
}

probe();
