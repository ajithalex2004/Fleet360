'use client';

import { useEffect, useState } from 'react';
import { Garage } from '@/types/maintenance';
import { getGarages, createGarage, updateGarage } from '@/services/mockData';

export default function GaragePage() {
    const [garages, setGarages] = useState<Garage[]>([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingGarage, setEditingGarage] = useState<Garage | null>(null);
    const [formData, setFormData] = useState({
        id: '',
        name: '',
        location: '',
        contactPerson: '',
        designation: '',
        email: '',
        contactNumber: '',
        specialties: [] as string[],
        isInternal: false,
    });

    const availableServices = [
        "General Service",
        "Engine Repair",
        "Body Shop",
        "AC Service",
        "Tires",
        "Electrical",
        "Painting",
        "Denting",
        "Oil Change",
        "Brake Service",
        "Mechanical Services",
        "Accident Support & Insurance"
    ];

    useEffect(() => {
        getGarages().then((data) => {
            setGarages(data);
            setLoading(false);
        });
    }, []);

    const openAddModal = () => {
        setEditingGarage(null);
        setFormData({
            id: `g${garages.length + 1}`,
            name: '',
            location: '',
            contactPerson: '',
            designation: '',
            email: '',
            contactNumber: '',
            specialties: [],
            isInternal: false,
        });
        setIsModalOpen(true);
    };

    const openEditModal = (garage: Garage) => {
        setEditingGarage(garage);
        setFormData({
            id: garage.id,
            name: garage.name,
            location: garage.location,
            contactPerson: garage.contactPerson,
            designation: garage.designation,
            email: garage.email,
            contactNumber: garage.contactNumber,
            specialties: garage.specialties || [],
            isInternal: garage.isInternal,
        });
        setIsModalOpen(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        try {
            if (editingGarage) {
                // Update existing garage
                const updatedGarage = await updateGarage(editingGarage.id, {
                    ...formData,
                    id: editingGarage.id, // Ensure ID is preserved
                    specialties: formData.specialties || [],
                    isInternal: formData.isInternal
                });

                // Update local state with response
                setGarages(garages.map(g => g.id === editingGarage.id ? updatedGarage : g));
            } else {
                // Add new garage
                const newGarage = await createGarage({
                    ...formData,
                    id: formData.id || '', // Let backend generate if empty, but form has ID field so we send it
                    specialties: formData.specialties || [],
                    isInternal: formData.isInternal
                });

                setGarages([...garages, newGarage]);
            }

            setIsModalOpen(false);
            setEditingGarage(null);
        } catch (error: any) {
            console.error("Failed to save garage:", error);
            alert(`Failed to save garage: ${error.message || 'Unknown error'}`);
        }
    };

    if (loading) return <div className="p-8 text-center">Loading garages...</div>;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white">Garage Management</h1>
                    <p className="mt-1 text-slate-500">Manage internal and external service providers.</p>
                </div>
                <button
                    onClick={openAddModal}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-blue-500/30 transition-all hover:bg-blue-700 hover:shadow-blue-500/50"
                >
                    + Add Garage
                </button>
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {Array.isArray(garages) && garages.map((garage) => (
                    <div key={garage.id} className="rounded-xl border border-white/10 bg-slate-900 p-6 shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex items-start justify-between">
                            <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                    <h3 className="text-lg font-semibold text-white">{garage.name}</h3>
                                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${garage.isInternal
                                        ? 'bg-emerald-500/20 text-green-700'
                                        : 'bg-blue-500/20 text-blue-700'
                                        }`}>
                                        {garage.isInternal ? 'Internal' : 'External'}
                                    </span>
                                </div>
                                <div className="mb-1">
                                    <span className="text-xs text-slate-400 font-mono bg-slate-800/50 px-1.5 py-0.5 rounded border border-white/5">
                                        ID: {garage.id}
                                    </span>
                                </div>
                                <p className="text-sm text-slate-500">{garage.location}</p>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => openEditModal(garage)}
                                    className="rounded-full p-2 text-slate-600 hover:bg-blue-500/10 hover:text-blue-600 transition-colors"
                                    title="Edit garage"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                                    </svg>
                                </button>
                                <div className="rounded-full bg-slate-700/40 p-2 text-slate-600">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.703-.127 1.5.168 2.37 1.945 2.37 1.945a.563.563 0 0 1-.67.67s-1.777-.869-1.944-2.37c-.061-.539-.037-1.152.126-1.703ZM13.253 13.253l4.003-4.003M9.53 2.47a.75.75 0 0 1 .34.952h-.001l-1.96 4.896c-.198.495-.157 1.051.109 1.514.265.463.714.78 1.226.865l5.29.882c.513.085 1.04-.04 1.43-.341l4.586-3.525a.75.75 0 0 1 .91 1.183l-4.586 3.525a3.003 3.003 0 0 1-2.146.51l-5.29-.882a3.001 3.001 0 0 1-1.838-1.298c-.398-.694-.46-1.527-.163-2.27l1.96-4.896a.75.75 0 0 1 .952-.34Z" />
                                    </svg>
                                </div>
                            </div >
                        </div >

                        <div className="mt-4 space-y-2">
                            <div className="flex items-center gap-2 text-sm text-slate-600">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 text-slate-400">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                                </svg>
                                <div>
                                    <span className="font-medium">{garage.contactPerson}</span>
                                    <span className="text-slate-400"> • {garage.designation}</span>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 text-sm text-slate-600">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 text-slate-400">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
                                </svg>
                                {garage.email}
                            </div>
                            <div className="flex items-center gap-2 text-sm text-slate-600">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 text-slate-400">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
                                </svg>
                                {garage.contactNumber}
                            </div>
                        </div>

                        <div className="mt-4">
                            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Services Offered</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                                {garage.specialties?.map((spec) => (
                                    <span key={spec} className="rounded-md bg-slate-700/40 px-2 py-1 text-xs font-medium text-slate-600">
                                        {spec}
                                    </span>
                                )) || <span className="text-xs text-slate-400">No services listed</span>}
                            </div>
                        </div>
                    </div >
                ))
                }
            </div >

            {/* Add/Edit Garage Modal */}
            {
                isModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                        <div className="w-full max-w-2xl rounded-xl bg-slate-900 p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-bold text-white">
                                    {editingGarage ? 'Edit Garage' : 'Add New Garage'}
                                </h3>
                                <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-300">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-6 w-6">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>

                            <form onSubmit={handleSubmit} className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-300">Garage ID</label>
                                    <input
                                        type="text"
                                        className={`mt-1 block w-full rounded-lg border border-white/15 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 ${editingGarage ? 'bg-slate-700/40 text-white cursor-not-allowed' : ''}`}
                                        value={formData.id}
                                        onChange={(e) => setFormData({ ...formData, id: e.target.value })}
                                        disabled={!!editingGarage}
                                    />
                                </div>
                                <div className="grid gap-4 md:grid-cols-2">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-300">Garage Name *</label>
                                        <input
                                            type="text"
                                            required
                                            className="mt-1 block w-full rounded-lg border border-white/15 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 text-white"
                                            value={formData.name}
                                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-300">Location *</label>
                                        <input
                                            type="text"
                                            required
                                            className="mt-1 block w-full rounded-lg border border-white/15 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 text-white"
                                            value={formData.location}
                                            onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-300">Contact Person *</label>
                                        <input
                                            type="text"
                                            required
                                            className="mt-1 block w-full rounded-lg border border-white/15 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 text-white"
                                            value={formData.contactPerson}
                                            onChange={(e) => setFormData({ ...formData, contactPerson: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-300">Designation *</label>
                                        <input
                                            type="text"
                                            required
                                            className="mt-1 block w-full rounded-lg border border-white/15 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 text-white"
                                            value={formData.designation}
                                            onChange={(e) => setFormData({ ...formData, designation: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-300">Email *</label>
                                        <input
                                            type="email"
                                            required
                                            className="mt-1 block w-full rounded-lg border border-white/15 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 text-white"
                                            value={formData.email}
                                            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-300">Contact Number *</label>
                                        <input
                                            type="tel"
                                            required
                                            className="mt-1 block w-full rounded-lg border border-white/15 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 text-white"
                                            value={formData.contactNumber}
                                            onChange={(e) => setFormData({ ...formData, contactNumber: e.target.value })}
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-2">Services Offered *</label>
                                    <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto p-2 border border-white/10 rounded-lg bg-slate-800/50">
                                        {availableServices.map(service => (
                                            <label key={service} className="flex items-center space-x-2 text-sm text-slate-300 cursor-pointer hover:bg-white/10 p-1 rounded">
                                                <input
                                                    type="checkbox"
                                                    className="rounded border-white/15 text-blue-600 focus:ring-blue-500"
                                                    checked={(formData.specialties || []).includes(service)}
                                                    onChange={(e) => {
                                                        const checked = e.target.checked;
                                                        setFormData(prev => ({
                                                            ...prev,
                                                            specialties: checked
                                                                ? [...prev.specialties, service]
                                                                : prev.specialties.filter(s => s !== service)
                                                        }));
                                                    }}
                                                />
                                                <span>{service}</span>
                                            </label>
                                        ))}
                                    </div>
                                    {formData.specialties.length === 0 && (
                                        <p className="text-xs text-red-500 mt-1">Please select at least one service.</p>
                                    )}
                                </div>

                                <div className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        id="isInternal"
                                        className="h-4 w-4 rounded border-white/15 text-blue-600 focus:ring-blue-500"
                                        checked={formData.isInternal}
                                        onChange={(e) => setFormData({ ...formData, isInternal: e.target.checked })}
                                    />
                                    <label htmlFor="isInternal" className="text-sm font-medium text-slate-300">
                                        Internal Garage
                                    </label>
                                </div>

                                <div className="flex justify-end gap-3 pt-4">
                                    <button
                                        type="button"
                                        onClick={() => setIsModalOpen(false)}
                                        className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 hover:bg-white/10"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700"
                                    >
                                        {editingGarage ? 'Update Garage' : 'Add Garage'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )
            }
        </div >
    );
}
