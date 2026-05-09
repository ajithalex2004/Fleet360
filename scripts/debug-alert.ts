// @ts-nocheck — one-off CLI script, types not maintained
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function debugVehicle() {
    console.log('--- Debugging Vehicle AD-10-96448 ---');

    // 1. Find Vehicle
    const vehicle = await prisma.vehicle.findFirst({
        where: { licensePlate: 'AD-10-96448' }
    });

    if (!vehicle) {
        console.error('ERROR: Vehicle AD-10-96448 not found!');
        return;
    }

    console.log('Vehicle Found:', {
        id: vehicle.id,
        make: vehicle.make,
        model: vehicle.model,
        licensePlate: vehicle.licensePlate,
        currentMileage: vehicle.currentMileage,
    });

    // 2. Find Schedule (Fetch separately as relation might be missing in schema)
    const schedule = await prisma.serviceSchedule.findFirst({
        where: { vehicleId: vehicle.id }
    });

    if (!schedule) {
        console.error('ERROR: No Service Schedule found for this vehicle!');
    } else {
        console.log('Service Schedule:', schedule);
    }

    // 3. Find Matching Alert Configs
    // Logic: `config.alertType === 'Maintenance Service' && config.alertFor === 'Vehicle' && config.assignedIds.includes(vehicleId)`
    const configs = await prisma.alertConfig.findMany({
        where: {
            alertType: 'Maintenance Service',
            alertFor: 'Vehicle'
        }
    });

    const activeConfigs = configs.filter(c => c.assignedIds.includes(vehicle.id));

    if (activeConfigs.length === 0) {
        console.error('ERROR: No Alert Configurations assigned to this vehicle!');
    }

    for (const config of activeConfigs) {
        console.log('\n--- Checking Config ---', config.id);
        console.log('Config:', config);

        if (!schedule) continue;

        let nextServiceMileage = 0;
        if (config.frequency === 'By Odometer') {
            nextServiceMileage = (schedule.lastServiceMileage ?? 0) + (config.frequencyValue ?? 0);
        }

        const mileageDiff = nextServiceMileage - (vehicle.currentMileage ?? 0);

        console.log('Calculation:');
        console.log(`Last Service Mileage: ${schedule.lastServiceMileage}`);
        console.log(`Frequency: ${config.frequencyValue}`);
        console.log(`Next Service Due At: ${nextServiceMileage}`);
        console.log(`Current Mileage: ${vehicle.currentMileage}`);
        console.log(`Diff (Due - Current): ${mileageDiff}`);
        console.log(`Threshold: ${config.thresholdValue}`);

        let isTriggered = false;
        let isOverdue = false;

        if (mileageDiff <= (config.thresholdValue ?? 0) && mileageDiff > 0) {
            isTriggered = true;
            console.log('RESULT: Triggered (Due Soon)');
        } else if (mileageDiff <= 0) {
            isTriggered = true;
            isOverdue = true;
            console.log('RESULT: Triggered (Overdue)');
        } else {
            console.log('RESULT: Not Triggered');
        }
    }
}

debugVehicle()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
