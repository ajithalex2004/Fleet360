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
    Invoice,
    PaymentStatus,
    InvoiceCategory,
    ServiceRequest,
    QuotationStatus,
    Quotation,
} from '../types/maintenance';

// DEPRECATED: These arrays are kept for backward compatibility during migration.
// Use the async functions (getVehicles, etc.) instead.
export const mockVehicles: Vehicle[] = [];
export const mockDrivers: Driver[] = [];
export const mockGarages: Garage[] = [];
export const mockMaintenanceRequests: MaintenanceRequest[] = [];
export const mockAlerts: Alert[] = [];
export const mockSchedules: ServiceSchedule[] = [];
export const mockInvoices: Invoice[] = [];
export let mockServiceRequests: ServiceRequest[] = [];
export const mockAlertConfigs: any[] = []; // Placeholder

// API Helpers
export const api = {
    get: async (endpoint: string) => {
        const res = await fetch(`/api/${endpoint}`, { cache: 'no-store' });
        if (!res.ok) {
            let errorDetails = `Status: ${res.status}`;
            try {
                const text = await res.text();
                if (text) errorDetails += `, Details: ${text}`;
            } catch (e) {
                // Ignore text reading error
            }
            throw new Error(`Failed to fetch ${endpoint} (${errorDetails})`);
        }
        return res.json();
    },
    post: async (endpoint: string, data: any) => {
        const response = await fetch(`/api/${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to POST ${endpoint}: ${errorText}`);
        }
        return response.json();
    },
    delete: async (endpoint: string) => {
        const response = await fetch(`/api/${endpoint}`, {
            method: 'DELETE',
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to DELETE ${endpoint}: ${errorText}`);
        }
        return response.json();
    },
    patch: async (endpoint: string, data: any) => {
        const response = await fetch(`/api/${endpoint}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to PATCH ${endpoint}: ${errorText}`);
        }
        return response.json();
    },
    put: async (endpoint: string, data: any) => {
        const response = await fetch(`/api/${endpoint}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to PUT ${endpoint}: ${errorText}`);
        }
        return response.json();
    },
};
// Vehicles
export const getVehicles = () => api.get('vehicles');
export const getVehicleById = async (id: string) => api.get(`vehicles/${id}`);
export const createVehicle = (vehicle: any) => api.post('vehicles', vehicle);
export const updateVehicle = (id: string, updates: any) => api.patch(`vehicles/${id}`, updates);
export const deleteVehicle = (id: string) => api.delete(`vehicles/${id}`);

// Drivers
export const getDrivers = () => api.get('drivers');
export const getDriverById = async (id: string) => api.get(`drivers/${id}`);
export const createDriver = (driver: any) => api.post('drivers', driver);
export const updateDriver = (id: string, updates: any) => api.patch(`drivers/${id}`, updates);
export const deleteDriver = (id: string) => api.delete(`drivers/${id}`);

// Users
export const getUsers = () => api.get('users');
export const createUser = (user: any) => api.post('users', user);
export const updateUser = (id: string, updates: any) => api.patch(`users/${id}`, updates);
export const deleteUser = (id: string) => api.delete(`users/${id}`);

// Garages
export const getGarages = () => api.get('garages');
export const createGarage = (garage: Garage) => api.post('garages', garage);
export const updateGarage = (id: string, garage: Garage) => api.put(`garages/${id}`, garage);
export const deleteGarage = (id: string) => api.delete(`garages/${id}`);



// Maintenance Requests
export const getMaintenanceRequests = () => api.get('maintenance-requests');
export const getMaintenanceRequestById = (id: string) => api.get(`maintenance-requests/${id}`);
export const createMaintenanceRequest = (request: Omit<MaintenanceRequest, 'id' | 'status' | 'comments'>) => api.post('maintenance-requests', request);
export const updateMaintenanceRequest = (id: string, updates: Partial<MaintenanceRequest>) => api.patch(`maintenance-requests/${id}`, updates);

// Quotations
export const createQuotation = (quotation: any) => api.post('quotations', quotation);
export const updateQuotation = (id: string, updates: any) => api.patch(`quotations/${id}`, updates);

// Work Orders
export const createWorkOrder = (workOrder: any) => api.post('work-orders', workOrder);

// Alerts
export const getAlerts = () => api.get('alerts');
export const createAlert = (alert: any) => api.post('alerts', alert);
export const updateAlert = (id: string, updates: Partial<Alert>) => api.patch(`alerts/${id}`, updates);

// Invoices (Mock for now)
export const getInvoices = () => Promise.resolve(mockInvoices);
export const createInvoice = (invoice: Invoice) => {
    mockInvoices.push(invoice);
    return Promise.resolve(invoice);
};

// Service Requests
export const getServiceRequests = async () => {
    const requests: ServiceRequest[] = await api.get('service-requests');
    return requests.map(r => ({
        ...r,
        date: r.date.toString().split('T')[0]
    }));
};

export const createServiceRequest = (request: ServiceRequest) => {
    const payload = {
        ...request,
        date: new Date(request.date).toISOString()
    };
    return api.post('service-requests', payload);
};

export const updateServiceRequest = (updatedRequest: ServiceRequest) => {
    const payload = {
        ...updatedRequest,
        date: new Date(updatedRequest.date).toISOString()
    };
    return api.patch(`service-requests/${updatedRequest.id}`, payload);
};


// Schedules (Mock for now)
export const getSchedules = () => Promise.resolve(mockSchedules);


import { sendNotification } from '../utils/notifications';

export const sendEmailNotification = async (to: string, subject: string, body: string) => {
    console.log(`[EMAIL-MOCK-OVERRIDE] To: ${to}, Subject: ${subject}`);
    await sendNotification(to, subject, body, 'Email', 'Service Request Update');
    return Promise.resolve();
};

// Alert Configs
export const getAlertConfigs = () => api.get('alert-configs');
export const createAlertConfig = (config: any) => api.post('alert-configs', config);
export const updateAlertConfig = (id: string, updates: any) => api.patch(`alert-configs/${id}`, updates);
export const deleteAlertConfig = (id: string) => api.delete(`alert-configs/${id}`);
// File Upload
export const uploadFile = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`/api/upload`, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        throw new Error('File upload failed');
    }

    return response.json();
};
