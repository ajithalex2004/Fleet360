// Check actual column types for the FK targets
import pg from 'pg';
const { Client } = pg;
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const r = await c.query(`
  SELECT table_name, column_name, data_type, udt_name
    FROM information_schema.columns
   WHERE table_name IN ('customers','bus_pretrip_checks','vehicles','drivers','users','tenants','finance_invoices')
     AND column_name = 'id'
   ORDER BY table_name
`);
console.log('--- id column types ---');
console.table(r.rows);

// Also check tenant_id types
const t = await c.query(`
  SELECT table_name, column_name, data_type
    FROM information_schema.columns
   WHERE table_name IN ('customers','bus_pretrip_checks','vehicles','drivers','users')
     AND column_name = 'tenant_id'
   ORDER BY table_name
`);
console.log('--- tenant_id column types ---');
console.table(t.rows);

await c.end();
