import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function withRetry(fn, tries = 10) {
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) {
      if (i === tries - 1) throw e;
      console.log(`attempt ${i+1} failed: ${e.message.split('\n')[0]}, retrying in 8s...`);
      await new Promise(r => setTimeout(r, 8000));
    }
  }
}
async function main() {
  try {
    const rows = await withRetry(() => prisma.$queryRawUnsafe(`
      SELECT
        pu.id::text,
        mr.vehicle_id AS "vehicleId",
        COALESCE(v.vehicle_code, v.plate_number, 'VEH') AS "vehicleCode",
        w.id::text AS "workOrderId",
        COALESCE(g.name, 'Garage') AS "garageName",
        pu."partName" AS "partName",
        pu."unitCost"::float8 AS "invoicedPartPrice",
        w."totalLaborHours"::float8 AS "invoicedLaborHours",
        w."startDate"::text AS "serviceDate"
      FROM "WorkOrder" w
      JOIN "PartUsage" pu ON pu."workOrderId" = w.id
      LEFT JOIN maintenance_requests mr ON mr.id = w."requestId"
      LEFT JOIN garages g ON g.id = w."garageId"
      LEFT JOIN vehicles v ON v.id = mr.vehicle_id
      WHERE w.tenant_id = $1 AND mr.vehicle_id IS NOT NULL
      ORDER BY w."startDate" DESC
      LIMIT 500
    `, 'default'));
    console.log('QUERY SUCCEEDED. Row count:', rows.length);
    console.log(JSON.stringify(rows.slice(0, 3), null, 2));

    const woCount = await withRetry(() => prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS c FROM "WorkOrder"`));
    const puCount = await withRetry(() => prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS c FROM "PartUsage"`));
    console.log('Total WorkOrder rows in DB:', woCount[0].c, '| Total PartUsage rows:', puCount[0].c);
  } catch (e) {
    console.error('QUERY FAILED:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}
main();
