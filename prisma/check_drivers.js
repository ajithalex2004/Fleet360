const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
    const drivers = await prisma.driver.findMany({
        where: {
            name: {
                contains: 'Ajith',
                mode: 'insensitive'
            }
        }
    });

    console.log(`Found ${drivers.length} drivers matching 'Ajith':`);
    if (drivers.length > 0) {
        console.log(JSON.stringify(drivers, null, 2));
    } else {
        // List all drivers to see what's there
        const allDrivers = await prisma.driver.findMany({ take: 5 });
        console.log('Sample of existing drivers:', JSON.stringify(allDrivers, null, 2));
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
