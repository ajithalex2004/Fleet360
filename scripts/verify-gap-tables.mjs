// Verify the 4 new tables from gap closure exist and have the right structure
import pg from 'pg';
const { Client } = pg;
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const tables = await c.query(`
  SELECT table_schema, table_name
    FROM information_schema.tables
   WHERE table_name IN (
     'dvir_defects','vehicle_issue_reports','customer_interactions','incidents',
     'event_outbox','event_consumer_inbox'
   )
   ORDER BY table_name
`);
console.log('--- target tables ---');
console.table(tables.rows);

for (const t of ['dvir_defects','vehicle_issue_reports','customer_interactions','incidents']) {
  const cols = await c.query(`
    SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
     WHERE table_name = $1
     ORDER BY ordinal_position
  `, [t]);
  console.log(`\n--- ${t} columns (${cols.rows.length}) ---`);
  console.table(cols.rows);
}

await c.end();
