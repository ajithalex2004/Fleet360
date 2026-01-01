
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function check() {
    console.log('--- Checking Vehicle AD-10-96448 Data ---');

    const vehicle = await prisma.vehicle.findFirst({
        where: { licensePlate: 'AD-10-96448' }
    });

    if (!vehicle) {
        console.log('Vehicle not found.');
        return;
    }
    console.log(`Vehicle ${vehicle.licensePlate} found. Current Mileage: ${vehicle.currentMileage}`);

    const schedule = await prisma.serviceSchedule.findFirst({
        where: { vehicleId: vehicle.id }
    });

    if (!schedule) {
        console.log('CRITICAL: No Service Schedule found! Alert cannot trigger.');
        return;
    }

    console.log('Service Schedule found:', schedule);
    console.log(`Last Service Mileage: ${schedule.lastServiceMileage}`);

    console.log('--- Finding Alert Configs ---');
    const configs = await prisma.alertConfig.findMany({
        where: {
            alertType: 'Maintenance Service',
            alertFor: 'Vehicle'
        }
    });

    const activeConfig = configs.find(c => c.assignedIds.includes(vehicle.id));

    if (!activeConfig) {
        console.log('CRITICAL: No Alert Config assigned to this vehicle.');
        return;
    }

    console.log('Config found:', activeConfig);

    // Logic calc
    const freqVal = activeConfig.frequencyValue || 0;
    const threshVal = activeConfig.thresholdValue || 0;
    const lastSvc = schedule.lastServiceMileage;
    const current = vehicle.currentMileage || 0;

    const nextDue = lastSvc + freqVal;
    const diff = nextDue - current;

    console.log(`\nLogic Check:`);
    console.log(`Next Due: ${nextDue} (${lastSvc} + ${freqVal})`);
    console.log(`Current: ${current}`);
    console.log(`Difference: ${diff}`);
    console.log(`Threshold: ${threshVal}`);

    if (diff <= threshVal && diff > 0) {
        console.log('RESULT: SHOULD TRIGGER (DUE SOON)');
    } else if (diff <= 0) {
        console.log('RESULT: SHOULD TRIGGER (OVERDUE)');
    } else {
        console.log('RESULT: NO TRIGGER (Not due yet)');
    }

    // Check existing alerts
    const alerts = await prisma.alert.findMany({
        where: { vehicleId: vehicle.id }
    });
    console.log(`\nExisting Alerts in DB for this vehicle: ${alerts.length}`);
    alerts.forEach(a => console.log(`- ${a.title} (${a.status})`));
}

check()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
