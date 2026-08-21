// scripts/check-db-conn.mjs
// One-off helper to inspect active connections to the dev DB.
// Useful for debugging Prisma "Transaction API error: Unable to start
// a transaction in the given time" — almost always pool exhaustion.

import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const r = await p.$queryRawUnsafe(`SELECT state, count(*) as cnt FROM pg_stat_activity WHERE datname = current_database() GROUP BY state ORDER BY cnt DESC`);
  console.log("Connections by state:");
  for (const row of r) console.log("  " + row.state + ": " + row.cnt);
  const r2 = await p.$queryRawUnsafe(`SELECT count(*) as total FROM pg_stat_activity WHERE datname = current_database()`);
  console.log("Total: " + r2[0].total);
  const r3 = await p.$queryRawUnsafe(`SELECT application_name, state, query_start::text, left(query, 80) as q FROM pg_stat_activity WHERE datname = current_database() AND state != 'idle' ORDER BY query_start`);
  console.log("Active queries:");
  for (const row of r3) console.log("  " + row.application_name + " " + row.state + " " + row.query_start + " " + row.q);
  await p.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
