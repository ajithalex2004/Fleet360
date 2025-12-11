import { PrismaClient, MaintenanceStatus, AlertSeverity, AlertType, ActionStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    // Vehicles
    const v1 = await prisma.vehicle.upsert({
        where: { licensePlate: 'DXB-12345' },
        update: {},
        create: {
            id: 'v1',
            make: 'Toyota',
            model: 'Hilux',
            type: 'Pickup Truck',
            year: 2022,
            licensePlate: 'DXB-12345',
            vin: 'JTE1234567890',
            currentMileage: 45000,
            status: 'Active',
            registrationExpiry: new Date('2025-12-01'),
            insuranceExpiry: new Date('2025-12-01'),
            registrationLastRenewed: new Date('2024-12-01'),
            insuranceLastRenewed: new Date('2024-12-01'),
        },
    });

    const v2 = await prisma.vehicle.upsert({
        where: { licensePlate: 'DXB-67890' },
        update: {},
        create: {
            id: 'v2',
            make: 'Nissan',
            model: 'Urvan',
            type: 'Van',
            year: 2021,
            licensePlate: 'DXB-67890',
            vin: 'JN11234567890',
            currentMileage: 82000,
            status: 'In Service',
            registrationExpiry: new Date('2024-06-15'),
            insuranceExpiry: new Date('2024-06-15'),
            registrationLastRenewed: new Date('2023-06-15'),
            insuranceLastRenewed: new Date('2023-06-15'),
        },
    });

    const v3 = await prisma.vehicle.upsert({
        where: { licensePlate: 'DXB-54321' },
        update: {},
        create: {
            id: 'v3',
            make: 'Ford',
            model: 'Transit',
            type: 'Van',
            year: 2023,
            licensePlate: 'DXB-54321',
            vin: 'WF01234567890',
            currentMileage: 12000,
            status: 'Active',
            registrationExpiry: new Date('2026-01-20'),
            insuranceExpiry: new Date('2026-01-20'),
            registrationLastRenewed: new Date('2025-01-20'),
            insuranceLastRenewed: new Date('2025-01-20'),
        },
    });

    // Drivers
    const d1 = await prisma.driver.upsert({
        where: { licenseNumber: 'UAE-1234567' },
        update: {},
        create: {
            id: 'd1',
            name: 'Ahmed Al-Farsi',
            licenseNumber: 'UAE-1234567',
            licenseExpiry: new Date('2026-05-10'),
            assignedVehicleId: 'v1',
            contactNumber: '+971501234567',
            licenseLastRenewed: new Date('2021-05-10'),
        },
    });

    const d2 = await prisma.driver.upsert({
        where: { licenseNumber: 'UAE-7654321' },
        update: {},
        create: {
            id: 'd2',
            name: 'John Smith',
            licenseNumber: 'UAE-7654321',
            licenseExpiry: new Date('2024-08-22'),
            assignedVehicleId: 'v2',
            contactNumber: '+971559876543',
            licenseLastRenewed: new Date('2019-08-22'),
        },
    });

    // Garages
    const g1 = await prisma.garage.create({
        data: {
            id: 'g1',
            name: 'AutoPro Service Center',
            location: 'Al Quoz, Dubai',
            contactPerson: 'Mohammed Ali',
            designation: 'Service Manager',
            email: 'mohammed.ali@autopro.ae',
            contactNumber: '+97141234567',
            specialties: ['General Service', 'Tires', 'AC', 'Oil Change'],
            isInternal: false,
        }
    });

    const g2 = await prisma.garage.create({
        data: {
            id: 'g2',
            name: 'Dynatrade',
            location: 'Nadd Al Hamar, Dubai',
            contactPerson: 'Suresh Kumar',
            designation: 'Operations Head',
            email: 'suresh@dynatrade.ae',
            contactNumber: '+97149876543',
            specialties: ['Preventive', 'Corrective'],
            isInternal: false,
        }
    });

    // Maintenance Requests
    await prisma.maintenanceRequest.create({
        data: {
            id: 'MR#241001',
            readableId: 'MR#241001',
            vehicleId: 'v2',
            driverId: 'd2',
            requestDate: new Date('2024-05-20T09:00:00Z'),
            description: 'Engine making strange rattling noise when accelerating.',
            status: MaintenanceStatus.UNDER_MAINTENANCE,
            garageId: 'g2',
            estimatedCost: 1500,
            history: {
                create: [
                    { status: MaintenanceStatus.REQUESTED, date: new Date('2024-05-20T09:00:00Z'), note: 'Request created', actor: 'John Doe (Driver)' },
                    { status: MaintenanceStatus.ACCEPTED, date: new Date('2024-05-20T10:30:00Z'), note: 'Request Accepted', actor: 'Sarah Connor (Fleet Manager)' },
                ]
            },
            comments: {
                create: [
                    { author: 'John Smith', text: 'Noise started this morning.' },
                ]
            }
        }
    });

    await prisma.maintenanceRequest.create({
        data: {
            id: 'MR#241002',
            readableId: 'MR#241002',
            vehicleId: 'v1',
            driverId: 'd1',
            requestDate: new Date('2024-05-24T14:30:00Z'),
            description: 'Periodic maintenance due (50k service).',
            status: MaintenanceStatus.UNDER_ESTIMATION,
        }
    });

    console.log('Seeding completed.');
}

main()
    .then(async () => {
        await prisma.$disconnect();
    })
    .catch(async (e) => {
        console.error(e);
        await prisma.$disconnect();
        process.exit(1);
    });
