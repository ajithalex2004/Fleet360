'use client';

import { useState, useEffect } from 'react';
import { getVehicles, api } from '@/services/mockData';
import { Vehicle } from '@/types/maintenance';

export default function VehiclesPage() {
    const [vehicles, setVehicles] = useState<Vehicle[]>([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [activeTab, setActiveTab] = useState('basic');

    const [formData, setFormData] = useState({
        // Basic Info
        id: '',
        registrationNumber: '',
        deviceId: '',
        hierarchy: '',
        vehicleGroup: '',
        vehicleClass: '',
        vehicleUsage: '',
        simCardNumber: '',
        emirate: '',

        // Registration Details
        plateNumber: '', // Maps to licensePlate
        plateCategory: '',
        plateCode: '',
        registrationExpiry: '',
        insuranceExpiry: '',

        // Vehicle Specifications
        make: '',
        model: '',
        year: new Date().getFullYear(),
        chassisNumber: '', // Maps to vin
        vin: '',
        color: '',
        fuelType: '',
        transmissionType: '',
        passengerCapacity: 0,
        currentMileage: 0,
        type: '', // Vehicle Type
    });

    useEffect(() => {
        loadVehicles();
    }, []);

    const loadVehicles = async () => {
        try {
            const data = await getVehicles();
            setVehicles(data);
        } catch (error) {
            console.error('Failed to load vehicles', error);
        }
    };

    const handleEdit = (vehicle: Vehicle) => {
        setFormData({
            id: vehicle.id,
            registrationNumber: vehicle.registrationNumber || '',
            deviceId: vehicle.deviceId || '',
            hierarchy: vehicle.hierarchy || '',
            vehicleGroup: vehicle.vehicleGroup || '',
            vehicleClass: vehicle.vehicleClass || '',
            vehicleUsage: vehicle.vehicleUsage || '',
            simCardNumber: vehicle.simCardNumber || '',
            emirate: vehicle.emirate || '',
            plateNumber: vehicle.licensePlate || '',
            plateCategory: vehicle.plateCategory || '',
            plateCode: vehicle.plateCode || '',
            registrationExpiry: vehicle.registrationExpiry ? new Date(vehicle.registrationExpiry).toISOString().split('T')[0] : '',
            insuranceExpiry: vehicle.insuranceExpiry ? new Date(vehicle.insuranceExpiry).toISOString().split('T')[0] : '',
            make: vehicle.make || '',
            model: vehicle.model || '',
            year: vehicle.year || new Date().getFullYear(),
            chassisNumber: vehicle.chassisNumber || '',
            vin: vehicle.vin || '',
            color: vehicle.color || '',
            fuelType: vehicle.fuelType || '',
            transmissionType: vehicle.transmissionType || '',
            passengerCapacity: vehicle.passengerCapacity || 0,
            currentMileage: vehicle.currentMileage || 0,
            type: vehicle.type || '',
        });
        setIsModalOpen(true);
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this vehicle?')) return;
        try {
            await api.delete(`vehicles/${id}`);
            // Optimistic update: Remove from local state immediately
            setVehicles(prev => prev.filter(v => v.id !== id));
            alert('Vehicle deleted successfully');
        } catch (error) {
            alert(`Failed to delete vehicle: ${(error as Error).message}`);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            // Exclude ID and non-schema fields from payload
            const { id, plateNumber, ...rest } = formData;

            // Sanitize numeric fields
            const year = isNaN(Number(formData.year)) ? new Date().getFullYear() : Number(formData.year);
            const passengerCapacity = isNaN(Number(formData.passengerCapacity)) ? null : Number(formData.passengerCapacity);
            const currentMileage = isNaN(Number(formData.currentMileage)) ? 0 : Number(formData.currentMileage);

            // Validate dates
            const regDate = new Date(formData.registrationExpiry);
            const insDate = new Date(formData.insuranceExpiry);

            if (isNaN(regDate.getTime()) || isNaN(insDate.getTime())) {
                alert('Please provide valid Registration and Insurance expiry dates.');
                return;
            }

            // Explicitly construct payload to ensure only schema fields are present
            const payload = {
                id: formData.id,
                make: formData.make,
                model: formData.model,
                type: formData.type,
                year: parseInt(String(formData.year)) || new Date().getFullYear(),
                licensePlate: formData.plateNumber,
                vin: formData.vin || formData.chassisNumber,
                currentMileage: parseInt(String(formData.currentMileage)) || 0,
                status: 'Active',
                registrationExpiry: regDate,
                insuranceExpiry: insDate,

                // Optional fields
                registrationNumber: formData.registrationNumber,
                deviceId: formData.deviceId,
                hierarchy: formData.hierarchy,
                vehicleGroup: formData.vehicleGroup,
                vehicleClass: formData.vehicleClass,
                vehicleUsage: formData.vehicleUsage,
                simCardNumber: formData.simCardNumber,
                emirate: formData.emirate,
                plateCategory: formData.plateCategory,
                plateCode: formData.plateCode,
                chassisNumber: formData.chassisNumber,
                color: formData.color,
                fuelType: formData.fuelType,
                transmissionType: formData.transmissionType,
                passengerCapacity: formData.passengerCapacity ? parseInt(String(formData.passengerCapacity)) : null,
            };

            // Check if we are updating or creating (based on if ID exists in list, but ID is editable so this is tricky. 
            // Ideally we should have a separate 'isEditing' state or hidden ID field.
            // For now, I'll assume if ID matches an existing vehicle, it's an update? No, ID is editable.
            // Let's rely on a separate state for 'editingId'

            // Actually, I'll just try to create. If it fails due to ID conflict, it fails.
            // But wait, I need to support UPDATE.
            // I'll add an 'editingId' state.

            if (editingId) {
                await api.patch(`vehicles/${editingId}`, payload);
                alert('Vehicle updated successfully');
            } else {
                // Only include ID if it's provided, otherwise let backend generate UUID
                const createPayload = formData.id ? { ...payload, id: formData.id } : payload;
                await api.post('vehicles', createPayload);
                alert('Vehicle created successfully');
            }

            setIsModalOpen(false);
            setEditingId(null); // Reset
            loadVehicles();
        } catch (error) {
            alert(`Failed to save vehicle: ${(error as Error).message}`);
        }
    };

    // Add editingId state
    const [editingId, setEditingId] = useState<string | null>(null);

    // Reset form when opening modal for create
    const openCreateModal = () => {
        setEditingId(null);
        setFormData({
            id: '', registrationNumber: '', deviceId: '', hierarchy: '', vehicleGroup: '', vehicleClass: '', vehicleUsage: '', simCardNumber: '', emirate: '',
            plateNumber: '', plateCategory: '', plateCode: '', registrationExpiry: '', insuranceExpiry: '',
            make: '', model: '', year: new Date().getFullYear(), chassisNumber: '', vin: '', color: '', fuelType: '', transmissionType: '', passengerCapacity: 0, currentMileage: 0, type: '',
        });
        setIsModalOpen(true);
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">Vehicle Management</h1>
                    <p className="text-slate-500">Manage your fleet vehicles.</p>
                </div>
                <button
                    onClick={openCreateModal}
                    className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                >
                    Create New Vehicle
                </button>
            </div>

            {/* List View */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <table className="min-w-full divide-y divide-slate-200">
                    <thead className="bg-slate-50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Vehicle ID</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Make/Model</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">License Plate</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Status</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-200">
                        {vehicles.map((vehicle) => (
                            <tr key={vehicle.id} className="hover:bg-slate-50">
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900">{vehicle.id}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">{vehicle.make} {vehicle.model}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">{vehicle.licensePlate}</td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${vehicle.status === 'Active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                        {vehicle.status}
                                    </span>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                    <button onClick={() => { setEditingId(vehicle.id); handleEdit(vehicle); }} className="text-blue-600 hover:text-blue-900 mr-4">Edit</button>
                                    <button onClick={() => handleDelete(vehicle.id)} className="text-red-600 hover:text-red-900">Delete</button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Create Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
                        <div className="flex justify-between items-center p-6 border-b border-slate-100">
                            <h2 className="text-xl font-bold text-slate-900">{editingId ? 'Edit Vehicle' : 'Create New Vehicle'}</h2>
                            <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="p-6">
                            {/* Tabs */}
                            <div className="flex border-b border-slate-200 mb-6">
                                <button
                                    type="button"
                                    onClick={() => setActiveTab('basic')}
                                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'basic' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                                >
                                    Basic Information
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setActiveTab('registration')}
                                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'registration' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                                >
                                    Registration Details
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setActiveTab('specs')}
                                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'specs' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                                >
                                    Vehicle Specifications
                                </button>
                            </div>

                            {/* Tab Content */}
                            <div className="space-y-4">
                                {activeTab === 'basic' && (
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Vehicle ID</label>
                                            <input type="text" className="w-full rounded-lg border-slate-300 text-sm" placeholder="e.g., AD-10-96448" value={formData.id} onChange={e => setFormData({ ...formData, id: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Registration Number</label>
                                            <input type="text" className="w-full rounded-lg border-slate-300 text-sm" value={formData.registrationNumber} onChange={e => setFormData({ ...formData, registrationNumber: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Device ID</label>
                                            <input type="text" className="w-full rounded-lg border-slate-300 text-sm" value={formData.deviceId} onChange={e => setFormData({ ...formData, deviceId: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Hierarchy</label>
                                            <input type="text" className="w-full rounded-lg border-slate-300 text-sm" value={formData.hierarchy} onChange={e => setFormData({ ...formData, hierarchy: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Vehicle Type</label>
                                            <input type="text" className="w-full rounded-lg border-slate-300 text-sm" value={formData.type} onChange={e => setFormData({ ...formData, type: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Vehicle Group</label>
                                            <input type="text" className="w-full rounded-lg border-slate-300 text-sm" value={formData.vehicleGroup} onChange={e => setFormData({ ...formData, vehicleGroup: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Vehicle Class</label>
                                            <input type="text" className="w-full rounded-lg border-slate-300 text-sm" value={formData.vehicleClass} onChange={e => setFormData({ ...formData, vehicleClass: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Vehicle Usage</label>
                                            <input type="text" className="w-full rounded-lg border-slate-300 text-sm" value={formData.vehicleUsage} onChange={e => setFormData({ ...formData, vehicleUsage: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">SIM Card Number</label>
                                            <input type="text" className="w-full rounded-lg border-slate-300 text-sm" value={formData.simCardNumber} onChange={e => setFormData({ ...formData, simCardNumber: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Emirate</label>
                                            <input type="text" className="w-full rounded-lg border-slate-300 text-sm" value={formData.emirate} onChange={e => setFormData({ ...formData, emirate: e.target.value })} />
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'registration' && (
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Plate Number</label>
                                            <input type="text" className="w-full rounded-lg border-slate-300 text-sm" value={formData.plateNumber} onChange={e => setFormData({ ...formData, plateNumber: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Plate Category</label>
                                            <input type="text" className="w-full rounded-lg border-slate-300 text-sm" value={formData.plateCategory} onChange={e => setFormData({ ...formData, plateCategory: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Plate Code</label>
                                            <input type="text" className="w-full rounded-lg border-slate-300 text-sm" value={formData.plateCode} onChange={e => setFormData({ ...formData, plateCode: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Registration Expiry</label>
                                            <input type="date" className="w-full rounded-lg border-slate-300 text-sm" value={formData.registrationExpiry} onChange={e => setFormData({ ...formData, registrationExpiry: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Insurance Expiry</label>
                                            <input type="date" className="w-full rounded-lg border-slate-300 text-sm" value={formData.insuranceExpiry} onChange={e => setFormData({ ...formData, insuranceExpiry: e.target.value })} />
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'specs' && (
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Make</label>
                                            <input type="text" className="w-full rounded-lg border-slate-300 text-sm" value={formData.make} onChange={e => setFormData({ ...formData, make: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Model</label>
                                            <input type="text" className="w-full rounded-lg border-slate-300 text-sm" value={formData.model} onChange={e => setFormData({ ...formData, model: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Year</label>
                                            <input type="number" className="w-full rounded-lg border-slate-300 text-sm" value={formData.year} onChange={e => setFormData({ ...formData, year: parseInt(e.target.value) })} />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Chassis No</label>
                                            <input type="text" className="w-full rounded-lg border-slate-300 text-sm" value={formData.chassisNumber} onChange={e => setFormData({ ...formData, chassisNumber: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">VIN</label>
                                            <input type="text" className="w-full rounded-lg border-slate-300 text-sm" value={formData.vin} onChange={e => setFormData({ ...formData, vin: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Color</label>
                                            <input type="text" className="w-full rounded-lg border-slate-300 text-sm" value={formData.color} onChange={e => setFormData({ ...formData, color: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Fuel Type</label>
                                            <input type="text" className="w-full rounded-lg border-slate-300 text-sm" value={formData.fuelType} onChange={e => setFormData({ ...formData, fuelType: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Transmission Type</label>
                                            <input type="text" className="w-full rounded-lg border-slate-300 text-sm" value={formData.transmissionType} onChange={e => setFormData({ ...formData, transmissionType: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Passenger Capacity</label>
                                            <input type="number" className="w-full rounded-lg border-slate-300 text-sm" value={formData.passengerCapacity} onChange={e => setFormData({ ...formData, passengerCapacity: parseInt(e.target.value) })} />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1">Current Mileage</label>
                                            <input type="number" className="w-full rounded-lg border-slate-300 text-sm" value={formData.currentMileage} onChange={e => setFormData({ ...formData, currentMileage: parseInt(e.target.value) })} />
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="mt-8 flex justify-end gap-3 pt-6 border-t border-slate-100">
                                <button
                                    type="button"
                                    onClick={() => setIsModalOpen(false)}
                                    className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 rounded-lg transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="px-6 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors shadow-sm"
                                >
                                    {editingId ? 'Update Vehicle' : 'Create Vehicle'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
