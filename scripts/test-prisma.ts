
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    try {
        console.log('Fetching drivers...');
        const drivers = await prisma.driver.findMany({
            orderBy: { name: 'asc' },
            include: { assignedVehicle: true }
        });
        console.log('Successfully fetched drivers:', drivers.length);
        if (drivers.length > 0) {
            console.log('First driver vehicle:', drivers[0].assignedVehicle);
        }
    } catch (error) {
        console.error('Error fetching drivers:', error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
