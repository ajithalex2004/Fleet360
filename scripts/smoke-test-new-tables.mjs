// Smoke test for the 8 new tables from the gap-closure work.
//
// Tests:
//   1. dvir_defects FK CASCADE — parent DVIR delete cascades to defects
//   2. customer_interactions FK RESTRICT — customer delete blocked while interaction exists
//   3-9. Basic CRUD on each of the 8 new tables (insert, read, update, delete)
//   10-12. UNIQUE constraints on finance_expenses.expense_no,
//          finance_collection_cases.case_no, incidents.incident_no
//
// Tenant isolation: every test row uses a unique tenant_id so cleanup
// is a single DELETE per table.
//
// Note: superuser (neondb_owner) bypasses RLS, so we can write
// any tenant_id without setting app.tenant_id.

import pg from 'pg';
const { Client } = pg;
const c = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const TEST_TENANT = `smoke-${Date.now()}`;
const TEST_TAG = `smoke-test-${Date.now()}`;
let passed = 0, failed = 0;
const failMessages = [];

function ok(msg) { console.log(`  ✅ ${msg}`); passed++; }
function bad(msg, e) {
  console.log(`  ❌ ${msg}: ${e?.message ?? e}`);
  failed++;
  failMessages.push(`${msg}: ${e?.message ?? e}`);
}
function expectEq(actual, expected, what) {
  if (actual !== expected) {
    throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
async function expectThrows(fn, codeMatch, what) {
  try {
    await fn();
    throw new Error(`${what}: expected an error but none was thrown`);
  } catch (e) {
    if (codeMatch && !e.message.includes(codeMatch) && e.code !== codeMatch) {
      throw new Error(`${what}: expected error matching "${codeMatch}", got "${e.message}" (code=${e.code})`);
    }
  }
}

const uuid = () => crypto.randomUUID();

// ============================================================================
// Test 1: dvir_defects FK CASCADE
// ============================================================================
console.log('\n[1] dvir_defects FK CASCADE');
try {
  const dvirId = uuid();
  const scheduleId = uuid();
  // Create parent DVIR (minimal required fields; schedule_id is UUID in the DB)
  await c.query(`
    INSERT INTO bus_pretrip_checks (id, schedule_id, performed_at, check_items, overall_pass, fail_count, tenant_id)
    VALUES ($1, $2, NOW(), '[]'::jsonb, true, 0, $3)
  `, [dvirId, scheduleId, TEST_TENANT]);

  // Create 3 defects against it
  for (let i = 0; i < 3; i++) {
    await c.query(`
      INSERT INTO dvir_defects (dvir_id, component, severity, description, status, tenant_id)
      VALUES ($1, $2, 'MINOR', $3, 'OPEN', $4)
    `, [dvirId, `brake-${i}`, `test defect ${i}`, TEST_TENANT]);
  }

  const before = await c.query('SELECT count(*)::int AS n FROM dvir_defects WHERE dvir_id = $1', [dvirId]);
  expectEq(before.rows[0].n, 3, 'defects before parent delete');

  // Delete parent — should cascade to defects
  await c.query('DELETE FROM bus_pretrip_checks WHERE id = $1', [dvirId]);

  const after = await c.query('SELECT count(*)::int AS n FROM dvir_defects WHERE dvir_id = $1', [dvirId]);
  expectEq(after.rows[0].n, 0, 'defects after parent delete (CASCADE)');
  ok('parent DVIR delete cascaded to 3 defects');
} catch (e) { bad('dvir_defects CASCADE', e); }

// ============================================================================
// Test 2: customer_interactions FK RESTRICT
// ============================================================================
console.log('\n[2] customer_interactions FK RESTRICT');
let test2CustomerId;
try {
  test2CustomerId = `smoke-cust-${Date.now()}`;
  // Create customer
  await c.query(`
    INSERT INTO customers (id, customer_type, name_en, tenant_id)
    VALUES ($1, 'INDIVIDUAL', 'Smoke Test Customer', $2)
  `, [test2CustomerId, TEST_TENANT]);

  // Create interaction
  const interactionId = uuid();
  await c.query(`
    INSERT INTO customer_interactions (id, customer_id, interaction_type, occurred_at, notes, tenant_id)
    VALUES ($1, $2, 'NOTE', NOW(), 'smoke test note', $3)
  `, [interactionId, test2CustomerId, TEST_TENANT]);

  // Try to delete customer — should be blocked by RESTRICT
  let blocked = false;
  try {
    await c.query('DELETE FROM customers WHERE id = $1', [test2CustomerId]);
  } catch (e) {
    if (e.code === '23503' || e.message.includes('foreign key')) {
      blocked = true;
    } else {
      throw e;
    }
  }
  if (!blocked) throw new Error('customer delete was NOT blocked — RESTRICT failed');
  ok('customer delete blocked by interaction (RESTRICT works)');

  // Cleanup: delete interaction, then customer
  await c.query('DELETE FROM customer_interactions WHERE id = $1', [interactionId]);
  await c.query('DELETE FROM customers WHERE id = $1', [test2CustomerId]);
  test2CustomerId = null;
  ok('cleanup of customer + interaction succeeded');
} catch (e) { bad('customer_interactions RESTRICT', e); }

// ============================================================================
// Test 3: vehicle_issue_reports basic CRUD
// ============================================================================
console.log('\n[3] vehicle_issue_reports CRUD');
try {
  const id = uuid();
  await c.query(`
    INSERT INTO vehicle_issue_reports (id, vehicle_id, driver_id, issue_type, severity, description, tenant_id)
    VALUES ($1, 'smoke-vehicle-1', 'smoke-driver-1', 'MECHANICAL', 'MINOR', 'strange noise', $2)
  `, [id, TEST_TENANT]);

  const read1 = await c.query('SELECT severity, status FROM vehicle_issue_reports WHERE id = $1', [id]);
  expectEq(read1.rows[0].severity, 'MINOR', 'severity after insert');
  expectEq(read1.rows[0].status, 'OPEN', 'status default');

  await c.query(`UPDATE vehicle_issue_reports SET status = 'TRIAGED' WHERE id = $1`, [id]);
  const read2 = await c.query('SELECT status FROM vehicle_issue_reports WHERE id = $1', [id]);
  expectEq(read2.rows[0].status, 'TRIAGED', 'status after update');

  await c.query('DELETE FROM vehicle_issue_reports WHERE id = $1', [id]);
  const read3 = await c.query('SELECT count(*)::int AS n FROM vehicle_issue_reports WHERE id = $1', [id]);
  expectEq(read3.rows[0].n, 0, 'rows after delete');
  ok('insert / read / update / delete round-trip');
} catch (e) { bad('vehicle_issue_reports CRUD', e); }

// ============================================================================
// Test 4: incidents basic CRUD + UNIQUE on incident_no
// ============================================================================
console.log('\n[4] incidents CRUD + UNIQUE on incident_no');
try {
  const id = uuid();
  const incidentNo = `INC-${Date.now()}`;
  await c.query(`
    INSERT INTO incidents (id, incident_no, tenant_id, occurred_at, incident_type, severity, description)
    VALUES ($1, $2, $3, NOW(), 'WORKPLACE', 'LOW', 'slip on wet floor')
  `, [id, incidentNo, TEST_TENANT]);

  // Try to insert another with same incident_no — should fail
  const id2 = uuid();
  let blocked = false;
  try {
    await c.query(`
      INSERT INTO incidents (id, incident_no, tenant_id, occurred_at, incident_type, severity)
      VALUES ($1, $2, $3, NOW(), 'WORKPLACE', 'LOW')
    `, [id2, incidentNo, TEST_TENANT]);
  } catch (e) {
    if (e.code === '23505' || e.message.includes('unique') || e.message.includes('duplicate')) {
      blocked = true;
    } else {
      throw e;
    }
  }
  if (!blocked) throw new Error('duplicate incident_no was NOT blocked — UNIQUE failed');
  ok('insert + UNIQUE on incident_no enforced');

  await c.query('DELETE FROM incidents WHERE id = $1', [id]);
} catch (e) { bad('incidents CRUD + UNIQUE', e); }

// ============================================================================
// Test 5: finance_expenses basic CRUD + UNIQUE on expense_no
// ============================================================================
console.log('\n[5] finance_expenses CRUD + UNIQUE on expense_no');
try {
  const id = uuid();
  const expenseNo = `EXP-${Date.now()}`;
  await c.query(`
    INSERT INTO finance.finance_expenses (id, expense_no, category, description, amount, currency, total_amount, expense_date, tenant_id)
    VALUES ($1, $2, 'FUEL', 'smoke test fuel', 50.00, 'AED', 52.50, CURRENT_DATE, $3)
  `, [id, expenseNo, TEST_TENANT]);

  const read1 = await c.query('SELECT category, status FROM finance.finance_expenses WHERE id = $1', [id]);
  expectEq(read1.rows[0].category, 'FUEL', 'category');
  expectEq(read1.rows[0].status, 'DRAFT', 'status default');

  // Duplicate expense_no — should fail
  const id2 = uuid();
  let blocked = false;
  try {
    await c.query(`
      INSERT INTO finance.finance_expenses (id, expense_no, category, description, amount, currency, total_amount, expense_date, tenant_id)
      VALUES ($1, $2, 'FUEL', 'dup', 1, 'AED', 1, CURRENT_DATE, $3)
    `, [id2, expenseNo, TEST_TENANT]);
  } catch (e) {
    if (e.code === '23505' || e.message.includes('unique') || e.message.includes('duplicate')) {
      blocked = true;
    } else {
      throw e;
    }
  }
  if (!blocked) throw new Error('duplicate expense_no was NOT blocked — UNIQUE failed');
  ok('insert + UNIQUE on expense_no enforced');

  await c.query('DELETE FROM finance.finance_expenses WHERE id = $1', [id]);
} catch (e) { bad('finance_expenses CRUD + UNIQUE', e); }

// ============================================================================
// Test 6: finance_pdc_cheques basic CRUD
// ============================================================================
console.log('\n[6] finance_pdc_cheques CRUD');
try {
  const id = uuid();
  await c.query(`
    INSERT INTO finance.finance_pdc_cheques (id, cheque_number, bank_name, cheque_date, amount, currency, direction, tenant_id)
    VALUES ($1, $2, 'Smoke Bank', CURRENT_DATE, 1000.00, 'AED', 'INCOMING', $3)
  `, [id, `CHQ-${Date.now()}`, TEST_TENANT]);

  const read1 = await c.query("SELECT status, direction FROM finance.finance_pdc_cheques WHERE id = $1", [id]);
  expectEq(read1.rows[0].status, 'HELD', 'status default');
  expectEq(read1.rows[0].direction, 'INCOMING', 'direction');

  await c.query(`UPDATE finance.finance_pdc_cheques SET status = 'CLEARED', cleared_at = NOW() WHERE id = $1`, [id]);
  const read2 = await c.query('SELECT status FROM finance.finance_pdc_cheques WHERE id = $1', [id]);
  expectEq(read2.rows[0].status, 'CLEARED', 'status after update');

  await c.query('DELETE FROM finance.finance_pdc_cheques WHERE id = $1', [id]);
  const read3 = await c.query('SELECT count(*)::int AS n FROM finance.finance_pdc_cheques WHERE id = $1', [id]);
  expectEq(read3.rows[0].n, 0, 'rows after delete');
  ok('insert / read / update / delete round-trip');
} catch (e) { bad('finance_pdc_cheques CRUD', e); }

// ============================================================================
// Test 7: finance_collection_cases basic CRUD + UNIQUE on case_no
// ============================================================================
console.log('\n[7] finance_collection_cases CRUD + UNIQUE on case_no');
try {
  const id = uuid();
  const caseNo = `CASE-${Date.now()}`;
  await c.query(`
    INSERT INTO finance.finance_collection_cases (id, case_no, invoice_id, invoice_no, client_name, invoice_amount, outstanding_amount, due_date, tenant_id)
    VALUES ($1, $2, 'inv-smoke-1', 'INV-SMOKE-1', 'Smoke Client', 1000.00, 1000.00, CURRENT_DATE, $3)
  `, [id, caseNo, TEST_TENANT]);

  const read1 = await c.query("SELECT status, days_overdue FROM finance.finance_collection_cases WHERE id = $1", [id]);
  expectEq(read1.rows[0].status, 'OPEN', 'status default');
  expectEq(read1.rows[0].days_overdue, 0, 'days_overdue default');

  // Duplicate case_no
  const id2 = uuid();
  let blocked = false;
  try {
    await c.query(`
      INSERT INTO finance.finance_collection_cases (id, case_no, invoice_id, invoice_no, client_name, invoice_amount, outstanding_amount, due_date, tenant_id)
      VALUES ($1, $2, 'inv-x', 'INV-X', 'X', 1, 1, CURRENT_DATE, $3)
    `, [id2, caseNo, TEST_TENANT]);
  } catch (e) {
    if (e.code === '23505' || e.message.includes('unique') || e.message.includes('duplicate')) {
      blocked = true;
    } else {
      throw e;
    }
  }
  if (!blocked) throw new Error('duplicate case_no was NOT blocked — UNIQUE failed');
  ok('insert + UNIQUE on case_no enforced');

  await c.query('DELETE FROM finance.finance_collection_cases WHERE id = $1', [id]);
} catch (e) { bad('finance_collection_cases CRUD + UNIQUE', e); }

// ============================================================================
// Test 8: finance_bank_accounts basic CRUD
// ============================================================================
console.log('\n[8] finance_bank_accounts CRUD');
try {
  const id = uuid();
  await c.query(`
    INSERT INTO finance.finance_bank_accounts (id, bank_name, account_name, account_number, currency, is_active, tenant_id)
    VALUES ($1, 'Smoke Bank', 'Smoke Operating', '1234567890', 'AED', true, $2)
  `, [id, TEST_TENANT]);

  const read1 = await c.query("SELECT is_default, is_active FROM finance.finance_bank_accounts WHERE id = $1", [id]);
  expectEq(read1.rows[0].is_default, false, 'is_default default');
  expectEq(read1.rows[0].is_active, true, 'is_active set to true');

  await c.query('UPDATE finance.finance_bank_accounts SET current_balance = 50000.00 WHERE id = $1', [id]);
  const read2 = await c.query('SELECT current_balance FROM finance.finance_bank_accounts WHERE id = $1', [id]);
  expectEq(Number(read2.rows[0].current_balance), 50000, 'current_balance after update');

  await c.query('DELETE FROM finance.finance_bank_accounts WHERE id = $1', [id]);
  const read3 = await c.query('SELECT count(*)::int AS n FROM finance.finance_bank_accounts WHERE id = $1', [id]);
  expectEq(read3.rows[0].n, 0, 'rows after delete');
  ok('insert / read / update / delete round-trip');
} catch (e) { bad('finance_bank_accounts CRUD', e); }

// ============================================================================
// Final cleanup — sweep any stray test rows by tenant_id
// ============================================================================
console.log('\n[final cleanup]');
try {
  const cleanupTables = [
    'dvir_defects',
    'vehicle_issue_reports',
    'customer_interactions',
    'incidents',
    'finance.finance_pdc_cheques',
    'finance.finance_expenses',
    'finance.finance_collection_cases',
    'finance.finance_bank_accounts',
  ];
  for (const t of cleanupTables) {
    await c.query(`DELETE FROM ${t} WHERE tenant_id = $1`, [TEST_TENANT]);
  }
  // Also clean up any test customers by their smoke-cust-* pattern
  await c.query(`DELETE FROM customers WHERE id LIKE 'smoke-cust-%'`);
  ok(`swept test data with tenant_id = ${TEST_TENANT}`);
} catch (e) { bad('cleanup', e); }

await c.end();

console.log('\n=========================================');
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('=========================================');
if (failed > 0) {
  console.log('\nFailures:');
  failMessages.forEach((m) => console.log(`  - ${m}`));
  process.exit(1);
}
process.exit(0);
