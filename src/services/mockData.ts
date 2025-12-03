import {
    Vehicle,
    Driver,
    Garage,
    MaintenanceRequest,
    Alert,
    MaintenanceStatus,
    AlertSeverity,
    AlertType,
    ActionStatus,
    ServiceSchedule,
} from '../types/maintenance';

// Mock Vehicles
export const mockVehicles: Vehicle[] = [
    {
        id: 'v1',
        make: 'Toyota',
        model: 'Hilux',
        type: 'Pickup Truck',
        year: 2022,
        licensePlate: 'DXB-12345',
        vin: 'JTE1234567890',
        currentMileage: 45000,
        status: 'Active',
        registrationExpiry: '2025-12-01',
        insuranceExpiry: '2025-12-01',
    },
    {
        id: 'v2',
        make: 'Nissan',
        model: 'Urvan',
        type: 'Van',
        year: 2021,
        licensePlate: 'DXB-67890',
        vin: 'JN11234567890',
        currentMileage: 82000,
        status: 'In Service',
        registrationExpiry: '2024-06-15',
        insuranceExpiry: '2024-06-15',
    },
    {
        id: 'v3',
        make: 'Ford',
        model: 'Transit',
        type: 'Van',
        year: 2023,
        licensePlate: 'DXB-54321',
        vin: 'WF01234567890',
        currentMileage: 12000,
        status: 'Active',
        registrationExpiry: '2026-01-20',
        insuranceExpiry: '2026-01-20',
    },
];

// Mock Drivers
export const mockDrivers: Driver[] = [
    {
        id: 'd1',
        name: 'Ahmed Al-Farsi',
        licenseNumber: 'UAE-1234567',
        licenseExpiry: '2026-05-10',
        assignedVehicleId: 'v1',
        contactNumber: '+971501234567',
    },
    {
        id: 'd2',
        name: 'John Smith',
        licenseNumber: 'UAE-7654321',
        licenseExpiry: '2024-08-22',
        assignedVehicleId: 'v2',
        contactNumber: '+971559876543',
    },
];

// Mock Garages
export const mockGarages: Garage[] = [
    {
        id: 'g1',
        name: 'AutoPro Service Center',
        location: 'Al Quoz, Dubai',
        contactPerson: 'Mohammed Ali',
        designation: 'Service Manager',
        email: 'mohammed.ali@autopro.ae',
        contactNumber: '+97141234567',
        specialties: ['General Service', 'Tires', 'AC', 'Oil Change', 'Filter Replacement', 'Tire Rotation', 'Brake Inspection', 'AC System'],
        isInternal: false,
    },
    {
        id: 'g2',
        name: 'Dynatrade',
        location: 'Nadd Al Hamar, Dubai',
        contactPerson: 'Suresh Kumar',
        designation: 'Operations Head',
        email: 'suresh@dynatrade.ae',
        contactNumber: '+97149876543',
        specialties: ['Preventive', 'Corrective', 'Emergency', 'Inspection'],
        isInternal: false,
    },
];

// Mock Maintenance Requests
export const mockMaintenanceRequests: MaintenanceRequest[] = [
    {
        id: 'MR#241001',
        vehicleId: 'v2',
        driverId: 'd2',
        requestDate: '2024-05-20T09:00:00Z',
        description: 'Engine making strange rattling noise when accelerating.',
        status: MaintenanceStatus.UNDER_MAINTENANCE,
        garageId: 'g2',
        estimatedCost: 1500,
        statusTimeline: {
            [MaintenanceStatus.REQUESTED]: '2024-05-20T09:00:00Z',
            [MaintenanceStatus.AWAITING_APPROVAL]: '2024-05-20T10:30:00Z',
            [MaintenanceStatus.APPROVED]: '2024-05-20T14:15:00Z',
            [MaintenanceStatus.UNDER_ESTIMATION]: '2024-05-21T09:00:00Z',
            [MaintenanceStatus.UNDER_MAINTENANCE]: '2024-05-22T08:30:00Z',
        } as Record<MaintenanceStatus, string>,
        comments: [
            {
                id: 'c1',
                author: 'John Smith',
                text: 'Noise started this morning.',
                timestamp: '2024-05-20T09:05:00Z',
            },
            {
                id: 'c2',
                author: 'Fleet Manager',
                text: 'Approved for inspection at Dynatrade.',
                timestamp: '2024-05-20T10:00:00Z',
            },
        ],
    },
    {
        id: 'MR#241002',
        vehicleId: 'v1',
        driverId: 'd1',
        requestDate: '2024-05-24T14:30:00Z',
        description: 'Periodic maintenance due (50k service).',
        status: MaintenanceStatus.UNDER_ESTIMATION,
        comments: [],
    },
    {
        id: 'MR#241003',
        vehicleId: 'v3',
        driverId: 'd2',
        requestDate: '2024-05-10T08:00:00Z',
        description: 'Brake pad replacement',
        status: MaintenanceStatus.MAINTENANCE_COMPLETED,
        garageId: 'g1',
        estimatedCost: 600,
        actualCost: 650,
        completionDate: '2024-05-15T16:00:00Z',
        statusTimeline: {
            [MaintenanceStatus.REQUESTED]: '2024-05-10T08:00:00Z',
            [MaintenanceStatus.APPROVED]: '2024-05-10T10:00:00Z',
            [MaintenanceStatus.UNDER_MAINTENANCE]: '2024-05-11T09:00:00Z',
            [MaintenanceStatus.MAINTENANCE_COMPLETED]: '2024-05-15T16:00:00Z',
        } as Record<MaintenanceStatus, string>,
        comments: [],
    },
    {
        id: 'MR#241004',
        vehicleId: 'v2',
        driverId: 'd2',
        requestDate: '2024-05-25T10:00:00Z',
        description: 'AC not cooling properly.',
        status: MaintenanceStatus.UNDER_ESTIMATION,
        comments: [],
    }
];

// Mock Alerts
export const mockAlerts: Alert[] = [
    {
        id: 'a1',
        type: AlertType.REGISTRATION_RENEWAL,
        title: 'Vehicle Registration Expiring Soon',
        description: 'Registration for Nissan Urvan (DXB-67890) expires in 25 days.',
        severity: AlertSeverity.HIGH,
        dateCreated: '2024-05-21T08:00:00Z',
        relatedEntityId: 'v2',
        status: ActionStatus.PENDING,
    },
    {
        id: 'a2',
        type: AlertType.LICENSE_RENEWAL,
        title: 'Driver License Expiry Warning',
        description: 'License for John Smith expires in 3 months.',
        severity: AlertSeverity.MEDIUM,
        dateCreated: '2024-05-22T08:00:00Z',
        relatedEntityId: 'd2',
        status: ActionStatus.ACKNOWLEDGED,
        assignedTo: 'HR Manager',
    },
    {
        id: 'a3',
        type: AlertType.PREVENTIVE_MAINTENANCE,
        title: 'Service Due: Toyota Hilux',
        description: '50,000km service due for DXB-12345.',
        severity: AlertSeverity.MEDIUM,
        dateCreated: '2024-05-24T08:00:00Z',
        relatedEntityId: 'v1',
        status: ActionStatus.PENDING,
    },
];

// Mock Service Schedules
export const mockSchedules: ServiceSchedule[] = [
    {
        id: 's1',
        vehicleId: 'v1',
        serviceType: 'Regular Service (10k)',
        intervalMonths: 6,
        intervalMileage: 10000,
        lastServiceDate: '2023-12-01',
        lastServiceMileage: 40000,
        nextServiceDate: '2024-06-01',
        nextServiceMileage: 50000,
    },
    {
        id: 's2',
        vehicleId: 'v2',
        serviceType: 'Major Service (40k)',
        intervalMonths: 12,
        intervalMileage: 40000,
        lastServiceDate: '2023-06-15',
        lastServiceMileage: 40000,
        nextServiceDate: '2024-06-15',
        nextServiceMileage: 80000,
    },
];

// Alert Configuration Interface
export interface AlertConfig {
    id: string;
    alertType: string;
    alertFor: 'Vehicle' | 'Driver';
    thresholdType: 'Odometer' | 'Date';
    thresholdValue: number;
    notificationEnabled: boolean;
    whatsappEnabled?: boolean;
    assignedIds: string[];
}

// Mock Alert Configurations
export const mockAlertConfigs: AlertConfig[] = [
    {
        id: 'ac1',
        alertType: 'Maintenance Service',
        alertFor: 'Vehicle',
        thresholdType: 'Odometer',
        thresholdValue: 1000, // Alert 1000km before due
        notificationEnabled: true,
        whatsappEnabled: true,
        assignedIds: ['v1', 'v2'],
    },
    {
        id: 'ac2',
        alertType: 'License Expiry',
        alertFor: 'Driver',
        thresholdType: 'Date',
        thresholdValue: 30, // Alert 30 days before expiry
        notificationEnabled: true,
        whatsappEnabled: false,
        assignedIds: ['d1'],
    },
];

// Helper functions to simulate API calls
export const getVehicles = () => Promise.resolve(mockVehicles);
export const getVehicleById = (id: string) => Promise.resolve(mockVehicles.find((v) => v.id === id));
export const getDrivers = () => Promise.resolve(mockDrivers);
export const getDriverById = (id: string) => Promise.resolve(mockDrivers.find((d) => d.id === id));
export const getMaintenanceRequests = () => Promise.resolve(mockMaintenanceRequests);
export const getAlerts = () => Promise.resolve(mockAlerts);
export const getGarages = () => Promise.resolve(mockGarages);
export const getSchedules = () => Promise.resolve(mockSchedules);


export const createMaintenanceRequest = (request: Omit<MaintenanceRequest, 'id' | 'status' | 'comments'>) => {
    const currentYear = new Date().getFullYear().toString().slice(-2);
    const nextIdNumber = 1001 + mockMaintenanceRequests.length;
    const newId = `MR#${currentYear}${nextIdNumber}`;

    const newRequest: MaintenanceRequest = {
        ...request,
        id: newId,
        status: MaintenanceStatus.REQUESTED,
        comments: [],
    };
    mockMaintenanceRequests.push(newRequest);
    return Promise.resolve(newRequest);
};

export const updateMaintenanceRequest = (id: string, updates: Partial<MaintenanceRequest>) => {
    console.log('updateMaintenanceRequest called with:', { id, updates });
    console.log('Available request IDs:', mockMaintenanceRequests.map(r => r.id));
    const index = mockMaintenanceRequests.findIndex((r) => r.id === id);
    console.log('Found index:', index);
    if (index !== -1) {
        mockMaintenanceRequests[index] = { ...mockMaintenanceRequests[index], ...updates };
        return Promise.resolve(mockMaintenanceRequests[index]);
    }
    return Promise.reject(new Error('Request not found'));
};
