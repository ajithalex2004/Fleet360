// Verify the 4 newly-created finance tables and their structure
import pg from 'pg';
const { Client } = pg;
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const tables = await c.query(`
  SELECT table_schema, table_name
    FROM information_schema.tables
   WHERE table_schema = 'finance'
     AND table_name IN (
       'finance_pdc_cheques','finance_expenses',
       'finance_collection_cases','finance_bank_accounts'
     )
   ORDER BY table_name
`);
console.log('--- target tables ---');
console.table(tables.rows);

for (const t of ['finance_pdc_cheques','finance_expenses','finance_collection_cases','finance_bank_accounts']) {
  const cols = await c.query(`
    SELECT column_name, data_type, is_nullable, column_default IS NOT NULL AS has_default
      FROM information_schema.columns
     WHERE table_schema = 'finance' AND table_name = $1
     ORDER BY ordinal_position
  `, [t]);
  const cnt = await c.query(`SELECT count(*)::int AS n FROM finance.${t}`);
  console.log(`\n--- ${t} (${cols.rows.length} cols, ${cnt.rows[0].n} rows) ---`);
  console.table(cols.rows);
}

await c.end();
