import {
    Vehicle,
    Driver,
    Garage,
    MaintenanceRequest,
    ServiceRequest,
} from '@/types/maintenance';

const API_BASE_URL = 'http://127.0.0.1:8080/api';

async function fetchAPI<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options?.headers,
        },
    });

    if (!response.ok) {
        throw new Error(`API call failed: ${response.statusText}`);
    }

    return response.json();
}

// Vehicles
export const getVehicles = () => fetchAPI<Vehicle[]>('/vehicles');
export const getVehicleById = (id: string) => fetchAPI<Vehicle>(`/vehicles/${id}`);

// Maintenance Requests
export const getMaintenanceRequests = () => fetchAPI<MaintenanceRequest[]>('/maintenance-requests');
export const createMaintenanceRequest = (data: Partial<MaintenanceRequest>) =>
    fetchAPI<MaintenanceRequest>('/maintenance-requests', {
        method: 'POST',
        body: JSON.stringify(data),
    });

// Service Requests
export const getServiceRequests = () => fetchAPI<ServiceRequest[]>('/service-requests');
export const createServiceRequest = (data: Partial<ServiceRequest>) =>
    fetchAPI<ServiceRequest>('/service-requests', {
        method: 'POST',
        body: JSON.stringify(data),
    });

// Drivers (Placeholder - need to implement backend handler)
export const getDrivers = () => fetchAPI<Driver[]>('/drivers');
