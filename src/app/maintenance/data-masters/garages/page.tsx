'use client';

import { useState, useEffect } from 'react';
import { getGarages, api } from '@/services/mockData';
import { Garage } from '@/types/maintenance';

export default function GaragesPage() {
    const [garages, setGarages] = useState<Garage[]>([]);
    const [isModalOpen, setIsModalOpen] = useState(false);

    const [formData, setFormData] = useState({
        name: '',
        location: '',
        contactPerson: '',
        designation: '',
        email: '',
        contactNumber: '',
        specialties: '', // Comma separated string for input
        isInternal: false,
    });

    useEffect(() => {
        loadGarages();
    }, []);

    const loadGarages = async () => {
        try {
            const data = await getGarages();
            setGarages(data);
        } catch (error) {
            console.error('Failed to load garages', error);
        }
    };

    const handleEdit = (garage: Garage) => {
        setFormData({
            name: garage.name,
            location: garage.location,
            contactPerson: garage.contactPerson,
            designation: garage.designation || '',
            email: garage.email || '',
            contactNumber: garage.contactNumber,
            specialties: garage.specialties.join(', '),
            isInternal: garage.isInternal,
        });
        setEditingId(garage.id);
        setIsModalOpen(true);
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this garage?')) return;
        try {
            await api.delete(`garages/${id}`);
            alert('Garage deleted successfully');
            loadGarages();
        } catch (error) {
            alert(`Failed to delete garage: ${(error as Error).message}`);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const payload = {
                ...formData,
                specialties: formData.specialties.split(',').map(s => s.trim()),
            };

            if (editingId) {
                await api.patch(`garages/${editingId}`, payload);
                alert('Garage updated successfully');
            } else {
                await api.post('garages', payload);
                alert('Garage created successfully');
            }
            setIsModalOpen(false);
            setEditingId(null);
            loadGarages();
        } catch (error) {
            alert(`Failed to save garage: ${(error as Error).message}`);
        }
    };

    // Add editingId state
    const [editingId, setEditingId] = useState<string | null>(null);

    // Reset form when opening modal for create
    const openCreateModal = () => {
        setEditingId(null);
        setFormData({
            name: '', location: '', contactPerson: '', designation: '', email: '', contactNumber: '', specialties: '', isInternal: false,
        });
        setIsModalOpen(true);
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">Garage Management</h1>
                    <p className="text-slate-500">Manage service providers and garages.</p>
                </div>
                <button
                    onClick={openCreateModal}
                    className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                >
                    Create New Garage
                </button>
            </div>

            {/* List View */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <table className="min-w-full divide-y divide-slate-200">
                    <thead className="bg-slate-50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Name</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Location</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Contact Person</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Contact Number</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-200">
                        {garages.map((garage) => (
                            <tr key={garage.id} className="hover:bg-slate-50">
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900">{garage.name}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">{garage.location}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">{garage.contactPerson}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">{garage.contactNumber}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                    <button onClick={() => handleEdit(garage)} className="text-blue-600 hover:text-blue-900 mr-4">Edit</button>
                                    <button onClick={() => handleDelete(garage.id)} className="text-red-600 hover:text-red-900">Delete</button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Create Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                        <div className="flex justify-between items-center p-6 border-b border-slate-100">
                            <h2 className="text-xl font-bold text-slate-900">{editingId ? 'Edit Garage' : 'Create New Garage'}</h2>
                            <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Garage Name</label>
                                <input type="text" className="w-full rounded-lg border-slate-300 text-sm" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Location</label>
                                <input type="text" className="w-full rounded-lg border-slate-300 text-sm" value={formData.location} onChange={e => setFormData({ ...formData, location: e.target.value })} />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Contact Person</label>
                                    <input type="text" className="w-full rounded-lg border-slate-300 text-sm" value={formData.contactPerson} onChange={e => setFormData({ ...formData, contactPerson: e.target.value })} />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Designation</label>
                                    <input type="text" className="w-full rounded-lg border-slate-300 text-sm" value={formData.designation} onChange={e => setFormData({ ...formData, designation: e.target.value })} />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                                    <input type="email" className="w-full rounded-lg border-slate-300 text-sm" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Contact Number</label>
                                    <input type="text" className="w-full rounded-lg border-slate-300 text-sm" value={formData.contactNumber} onChange={e => setFormData({ ...formData, contactNumber: e.target.value })} />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Specialties (comma separated)</label>
                                <input type="text" className="w-full rounded-lg border-slate-300 text-sm" placeholder="e.g., Tires, Oil Change, AC" value={formData.specialties} onChange={e => setFormData({ ...formData, specialties: e.target.value })} />
                            </div>
                            <div className="flex items-center">
                                <input
                                    type="checkbox"
                                    id="isInternal"
                                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                    checked={formData.isInternal}
                                    onChange={e => setFormData({ ...formData, isInternal: e.target.checked })}
                                />
                                <label htmlFor="isInternal" className="ml-2 text-sm text-slate-700">Internal Garage</label>
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
                                    Create Garage
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
