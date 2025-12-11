
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log('--- Debugging Garages ---');

    // 1. Fetch all garages (raw count)
    const allCount = await prisma.garage.count();
    console.log(`Total Garages in DB: ${allCount}`);

    // 2. Fetch specific details
    const garages = await prisma.garage.findMany({
        select: {
            id: true,
            name: true,
            deletedAt: true,
            isInternal: true,
            specialties: true
        }
    });

    console.log('\nGarage List:');
    garages.forEach(g => {
        console.log(`- [${g.name}] ID: "${g.id}" (Internal: ${g.isInternal}) DeletedAt: ${g.deletedAt ? g.deletedAt : 'ACTIVE'}`);
        console.log(`  Specialties: ${JSON.stringify(g.specialties)}`);
        // Test matching logic
        const isGeneralService = g.specialties && g.specialties.some(s => s.toLowerCase().includes('general service'));
        console.log(`  Matches "General Service"?: ${isGeneralService}`);
    });

    // 3. Check for triggers
    try {
        const triggers = await prisma.$queryRaw`
        SELECT trigger_name
        FROM information_schema.triggers
        WHERE event_object_table = 'garages'
      `;
        console.log('\nTriggers:', triggers);
    } catch (e) {
        console.log('Error checking triggers:', e.message);
    }
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
