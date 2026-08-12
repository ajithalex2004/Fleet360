'use client';

import { useState, useEffect } from 'react';
import { getDrivers, api } from '@/services/mockData';
import { Driver } from '@/types/maintenance';

export default function DriversPage() {
    const [drivers, setDrivers] = useState<Driver[]>([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [activeTab, setActiveTab] = useState('basic');

    const [formData, setFormData] = useState({
        // Basic Info
        id: '',
        firstName: '',
        lastName: '',
        fullName: '', // Auto-generated usually, but editable
        hierarchy: '',
        driverType: '',

        // Personal Info
        nationality: '',
        dob: '',
        emiratesId: '',
        communicationLanguage: '',

        // Contact & Employment
        contactNumber: '',
        email: '',
        dateOfJoin: '',
        dallasId: '',
        licenseNumber: '',
        licenseExpiry: '',
    });

    useEffect(() => {
        loadDrivers();
    }, []);

    const loadDrivers = async () => {
        try {
            const data = await getDrivers();
            setDrivers(data);
        } catch (error) {
            console.error('Failed to load drivers', error);
        }
    };

    const handleEdit = (driver: Driver) => {
        setFormData({
            id: driver.id,
            firstName: driver.name.split(' ')[0] || '',
            lastName: driver.name.split(' ').slice(1).join(' ') || '',
            fullName: driver.name,
            hierarchy: driver.hierarchy || '',
            driverType: driver.driverType || '',
            nationality: driver.nationality || '',
            dob: driver.dob ? new Date(driver.dob).toISOString().split('T')[0] : '',
            emiratesId: driver.emiratesId || '',
            communicationLanguage: driver.communicationLanguage || '',
            contactNumber: driver.contactNumber,
            email: driver.email || '',
            dateOfJoin: driver.dateOfJoin ? new Date(driver.dateOfJoin).toISOString().split('T')[0] : '',
            dallasId: driver.dallasId || '',
            licenseNumber: driver.licenseNumber,
            licenseExpiry: driver.licenseExpiry ? new Date(driver.licenseExpiry).toISOString().split('T')[0] : '',
        });
        setEditingId(driver.id);
        setIsModalOpen(true);
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this driver?')) return;
        try {
            await api.delete(`drivers/${id}`);
            alert('Driver deleted successfully');
            loadDrivers();
        } catch (error) {
            alert(`Failed to delete driver: ${(error as Error).message}`);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const payload = {
                ...formData,
                name: `${formData.firstName} ${formData.lastName}`,
                dob: formData.dob ? new Date(formData.dob) : null,
                dateOfJoin: formData.dateOfJoin ? new Date(formData.dateOfJoin) : null,
                licenseExpiry: new Date(formData.licenseExpiry),
            };

            if (editingId) {
                await api.patch(`drivers/${editingId}`, payload);
                alert('Driver updated successfully');
            } else {
                await api.post('drivers', payload);
                alert('Driver created successfully');
            }
            setIsModalOpen(false);
            setEditingId(null);
            loadDrivers();
        } catch (error) {
            alert(`Failed to save driver: ${(error as Error).message}`);
        }
    };

    // Add editingId state
    const [editingId, setEditingId] = useState<string | null>(null);

    // Reset form when opening modal for create
    const openCreateModal = () => {
        setEditingId(null);
        setFormData({
            id: '', firstName: '', lastName: '', fullName: '', hierarchy: '', driverType: '',
            nationality: '', dob: '', emiratesId: '', communicationLanguage: '',
            contactNumber: '', email: '', dateOfJoin: '', dallasId: '', licenseNumber: '', licenseExpiry: '',
        });
        setIsModalOpen(true);
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-white">Driver Management</h1>
                    <p className="text-slate-500">Manage your fleet drivers.</p>
                </div>
                <button
                    onClick={openCreateModal}
                    className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                >
                    Create New Driver
                </button>
            </div>

            {/* List View */}
            <div className="bg-slate-900 rounded-xl border border-white/10 shadow-sm overflow-hidden">
                <table className="min-w-full divide-y divide-white/10">
                    <thead className="bg-slate-800/50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Driver ID</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Name</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">License Number</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Contact</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="bg-slate-900 divide-y divide-white/10">
                        {drivers.map((driver) => (
                            <tr key={driver.id} className="hover:bg-white/5">
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">{driver.id}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-300">{driver.name}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-300">{driver.licenseNumber}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-300">{driver.contactNumber}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                    <button onClick={() => handleEdit(driver)} className="text-blue-600 hover:text-blue-300 mr-4">Edit</button>
                                    <button onClick={() => handleDelete(driver.id)} className="text-red-600 hover:text-red-300">Delete</button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Create Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-slate-900 rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
                        <div className="flex justify-between items-center p-6 border-b border-white/5">
                            <h2 className="text-xl font-bold text-white">{editingId ? 'Edit Driver' : 'Create New Driver'}</h2>
                            <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-300">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="p-6">
                            {/* Tabs */}
                            <div className="flex border-b border-white/10 mb-6">
                                <button
                                    type="button"
                                    onClick={() => setActiveTab('basic')}
                                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'basic' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
                                >
                                    Basic Information
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setActiveTab('personal')}
                                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'personal' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
                                >
                                    Personal Information
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setActiveTab('contact')}
                                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'contact' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
                                >
                                    Contact & Employment
                                </button>
                            </div>

                            {/* Tab Content */}
                            <div className="space-y-4">
                                {activeTab === 'basic' && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-slate-300 mb-1">Driver ID</label>
                                            <input type="text" className="w-full rounded-lg border-white/15 text-sm text-white" placeholder="e.g., DRV001" value={formData.id} onChange={e => setFormData({ ...formData, id: e.target.value })} />
                                        </div>
                                        <div className="md:col-span-2 grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-sm font-medium text-slate-300 mb-1">First Name</label>
                                                <input type="text" className="w-full rounded-lg border-white/15 text-sm text-white" value={formData.firstName} onChange={e => setFormData({ ...formData, firstName: e.target.value })} />
                                            </div>
                                            <div>
                                                <label className="block text-sm font-medium text-slate-300 mb-1">Last Name</label>
                                                <input type="text" className="w-full rounded-lg border-white/15 text-sm text-white" value={formData.lastName} onChange={e => setFormData({ ...formData, lastName: e.target.value })} />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-300 mb-1">Hierarchy</label>
                                            <input type="text" className="w-full rounded-lg border-white/15 text-sm text-white" value={formData.hierarchy} onChange={e => setFormData({ ...formData, hierarchy: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-300 mb-1">Driver Type</label>
                                            <input type="text" className="w-full rounded-lg border-white/15 text-sm text-white" value={formData.driverType} onChange={e => setFormData({ ...formData, driverType: e.target.value })} />
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'personal' && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-slate-300 mb-1">Nationality</label>
                                            <input type="text" className="w-full rounded-lg border-white/15 text-sm text-white" value={formData.nationality} onChange={e => setFormData({ ...formData, nationality: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-300 mb-1">Date of Birth</label>
                                            <input type="date" className="w-full rounded-lg border-white/15 text-sm text-white" value={formData.dob} onChange={e => setFormData({ ...formData, dob: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-300 mb-1">Emirates ID</label>
                                            <input type="text" className="w-full rounded-lg border-white/15 text-sm text-white" value={formData.emiratesId} onChange={e => setFormData({ ...formData, emiratesId: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-300 mb-1">Communication Language</label>
                                            <input type="text" className="w-full rounded-lg border-white/15 text-sm text-white" value={formData.communicationLanguage} onChange={e => setFormData({ ...formData, communicationLanguage: e.target.value })} />
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'contact' && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-slate-300 mb-1">Mobile Number</label>
                                            <input type="text" className="w-full rounded-lg border-white/15 text-sm text-white" value={formData.contactNumber} onChange={e => setFormData({ ...formData, contactNumber: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-300 mb-1">Email</label>
                                            <input type="email" className="w-full rounded-lg border-white/15 text-sm text-white" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-300 mb-1">Date of Join</label>
                                            <input type="date" className="w-full rounded-lg border-white/15 text-sm text-white" value={formData.dateOfJoin} onChange={e => setFormData({ ...formData, dateOfJoin: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-300 mb-1">Dallas ID</label>
                                            <input type="text" className="w-full rounded-lg border-white/15 text-sm text-white" value={formData.dallasId} onChange={e => setFormData({ ...formData, dallasId: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-300 mb-1">License Number</label>
                                            <input type="text" className="w-full rounded-lg border-white/15 text-sm text-white" value={formData.licenseNumber} onChange={e => setFormData({ ...formData, licenseNumber: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-300 mb-1">License Expiry</label>
                                            <input type="date" className="w-full rounded-lg border-white/15 text-sm text-white" value={formData.licenseExpiry} onChange={e => setFormData({ ...formData, licenseExpiry: e.target.value })} />
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="mt-8 flex justify-end gap-3 pt-6 border-t border-white/5">
                                <button
                                    type="button"
                                    onClick={() => setIsModalOpen(false)}
                                    className="px-4 py-2 text-sm font-medium text-slate-300 hover:bg-white/5 rounded-lg transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="px-6 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors shadow-sm"
                                >
                                    Create Driver
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
