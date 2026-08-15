// Use the prisma client from the project to query info
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const r = await prisma.$queryRawUnsafe(`
  SELECT column_name, data_type, udt_name
  FROM information_schema.columns
  WHERE table_schema = 'workforce' AND table_name = 'employees'
    AND column_name IN ('id','tenant_id')
`);
console.log(JSON.stringify(r, null, 2));
await prisma.$disconnect();
