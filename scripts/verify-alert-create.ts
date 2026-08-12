
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Default tenant for the dev verify script — multi-tenant layer requires
// tenantId on every Alert row.
const DEFAULT_TENANT_ID = process.env.SEED_TENANT_ID ?? 'dev-tenant';

async function test() {
    console.log('--- Verifying Alert Creation (Schema Compliance) ---');

    try {
        const newAlert = await prisma.alert.create({
            data: {
                tenantId: DEFAULT_TENANT_ID,
                title: 'Test Alert Schema',
                description: 'Verifying relatedEntityId mapping',
                status: 'PENDING',
                type: 'SYSTEM_TEST',
                severity: 'LOW',
                relatedEntityId: 'test-vehicle-id-123', // Testing the mapped field
                dateCreated: new Date()
            }
        });
        console.log('SUCCESS: Alert created successfully!');
        console.log(newAlert);

        // Cleanup
        await prisma.alert.delete({ where: { id: newAlert.id } });
        console.log('Cleanup successful.');
    } catch (e: any) {
        console.error('FAILURE: Alert creation failed.');
        console.error(e.message);
        process.exit(1);
    }
}

test()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
