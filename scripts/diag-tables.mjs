// Diagnostic: inspect the actual DB state for the finance tables
// that migration 003 is trying to alter. Helps understand why
// ON CONFLICT (code) can't find a matching constraint.
import pg from 'pg';
const { Client } = pg;

const c = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const r = await c.query(`
  SELECT table_schema, table_name, column_name, data_type, is_nullable
    FROM information_schema.columns
   WHERE table_name IN (
     'finance_tax_categories','finance_vat_audit_logs',
     'finance_reminder_schedules','finance_reminder_log',
     'finance_chart_of_accounts'
   )
   ORDER BY table_schema, table_name, ordinal_position
`);
console.log('--- columns ---');
console.table(r.rows);

const cons = await c.query(`
  SELECT conname, contype,
         conrelid::regclass::text AS table_name,
         pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
   WHERE conrelid::regclass::text IN (
     'finance_tax_categories','finance_reminder_schedules','finance_chart_of_accounts'
   )
   ORDER BY conrelid::regclass::text, conname
`);
console.log('--- constraints ---');
console.table(cons.rows);

const idx = await c.query(`
  SELECT schemaname, tablename, indexname, indexdef
    FROM pg_indexes
   WHERE tablename IN (
     'finance_tax_categories','finance_reminder_schedules','finance_chart_of_accounts'
   )
   ORDER BY tablename, indexname
`);
console.log('--- indexes ---');
console.table(idx.rows);

const cnt = await c.query(`
  SELECT 'finance_tax_categories' AS t, count(*)::int AS n FROM finance_tax_categories
  UNION ALL SELECT 'finance_vat_audit_logs', count(*)::int FROM finance_vat_audit_logs
  UNION ALL SELECT 'finance_reminder_schedules', count(*)::int FROM finance_reminder_schedules
  UNION ALL SELECT 'finance_reminder_log', count(*)::int FROM finance_reminder_log
  UNION ALL SELECT 'finance_chart_of_accounts', count(*)::int FROM finance_chart_of_accounts
`);
console.log('--- row counts ---');
console.table(cnt.rows);

await c.end();
