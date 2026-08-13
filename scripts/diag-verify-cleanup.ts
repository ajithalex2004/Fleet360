// Verify the test fully cleans up after itself
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

const TEST_TENANT = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

const outbox = await p.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM event_outbox WHERE tenant_id = ${TEST_TENANT}::uuid`;
const inbox  = await p.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM event_consumer_inbox WHERE tenant_id = ${TEST_TENANT}::uuid`;
const exp    = await p.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM finance.finance_expenses WHERE tenant_id = ${TEST_TENANT}`;
const veh    = await p.vehicle.count({ where: { tenantId: TEST_TENANT } });
const drv    = await p.driver.count({ where: { tenantId: TEST_TENANT } });
const ten    = await p.tenant.count({ where: { id: TEST_TENANT } });

console.log('orphan counts:');
console.log(`  event_outbox         : ${outbox[0].n}`);
console.log(`  event_consumer_inbox : ${inbox[0].n}`);
console.log(`  finance_expenses     : ${exp[0].n}`);
console.log(`  vehicles             : ${veh}`);
console.log(`  drivers              : ${drv}`);
console.log(`  tenants              : ${ten}`);

const total = outbox[0].n + inbox[0].n + exp[0].n + veh + drv + ten;
console.log(`\nTOTAL orphans: ${total}`);
await p.$disconnect();
process.exit(total === 0 ? 0 : 1);
