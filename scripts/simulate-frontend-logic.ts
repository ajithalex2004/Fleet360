// @ts-nocheck — one-off CLI script, types not maintained
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function simulate() {
    console.log('--- Simulating Frontend Logic for AD-10-96448 ---');

    const vehicle = await prisma.vehicle.findFirst({
        where: { licensePlate: 'AD-10-96448' }
    });

    if (!vehicle) {
        console.log('Vehicle not found.');
        return;
    }

    // Fetch schedule (simulating frontend fetch)
    const schedule = await prisma.serviceSchedule.findFirst({
        where: { vehicleId: vehicle.id }
    });

    console.log('Vehicle Mileage:', vehicle.currentMileage);
    console.log('Schedule Found:', !!schedule);

    // FETCH ALERT CONFIG
    const configs = await prisma.alertConfig.findMany({
        where: {
            alertType: 'Maintenance Service',
            alertFor: 'Vehicle'
        }
    });
    const config = configs.find(c => c.assignedIds.includes(vehicle.id));

    if (!config) {
        console.log('No config found.');
        return;
    }

    console.log('Config Frequency:', config.frequencyValue);

    // --- NEW LOGIC START ---
    let nextServiceMileage = 0;
    let lastServiceMileage = 0;

    if (schedule) {
        lastServiceMileage = schedule.lastServiceMileage;
    } else {
        console.log('LOGIC: No schedule, using fallback lastServiceMileage = 0');
        lastServiceMileage = 0;
    }

    if (config.frequency === 'By Odometer') {
        nextServiceMileage = lastServiceMileage + (config.frequencyValue || 0);
    }

    const mileageDiff = nextServiceMileage - vehicle.currentMileage;
    console.log(`Calculated Diff: ${mileageDiff} (Next: ${nextServiceMileage} - Current: ${vehicle.currentMileage})`);

    let isTriggered = false;
    let isOverdue = false;

    if (mileageDiff <= (config.thresholdValue || 0) && mileageDiff > 0) {
        isTriggered = true;
    } else if (mileageDiff <= 0) {
        isTriggered = true;
        isOverdue = true;
    }
    // --- NEW LOGIC END ---

    console.log('Is Triggered:', isTriggered);
    console.log('Is Overdue:', isOverdue);

    if (isTriggered) {
        console.log('SUCCESS: Logic now triggers an alert!');
    } else {
        console.log('FAILURE: Logic still does not trigger.');
    }
}

simulate();
