// Quick inventory: which finance_* tables exist in public vs finance schema
// in the dev DB. Tells us which ALTER TABLE ... SET SCHEMA in migration 005
// will fail.
import pg from 'pg';
const { Client } = pg;
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const r = await c.query(`
  SELECT table_schema, table_name
    FROM information_schema.tables
   WHERE table_schema IN ('public','finance','ai')
     AND (table_name LIKE 'finance\\_%' ESCAPE '\\'
          OR table_name IN ('agent_anomaly_flags','event_outbox','event_consumer_inbox')
          OR table_name = 'finance_anomaly_flags')
   ORDER BY table_name, table_schema
`);
console.log('--- tables by schema ---');
console.table(r.rows);

const coa = await c.query(`SELECT count(*)::int AS n FROM finance_chart_of_accounts`);
console.log('--- row counts ---');
console.log('finance_chart_of_accounts:', coa.rows[0].n);

const rls = await c.query(`
  SELECT schemaname, tablename, rowsecurity
    FROM pg_tables t JOIN pg_class c ON c.relname = t.tablename
   WHERE schemaname IN ('public','finance')
     AND tablename LIKE 'finance\\_%'
   GROUP BY schemaname, tablename, rowsecurity
   ORDER BY tablename
   LIMIT 30
`);
console.log('--- RLS status (sample) ---');
console.table(rls.rows);

await c.end();
