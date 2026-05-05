'use client';

import { useState, useEffect } from 'react';
import { AttachmentType } from '@/types/maintenance';

interface AttachmentTypeMaster {
    id: string;
    name: string;
    description: string;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

export default function AttachmentTypeMasterPage() {
    const [attachmentTypes, setAttachmentTypes] = useState<AttachmentTypeMaster[]>([]);
    const [showAddModal, setShowAddModal] = useState(false);
    const [editingType, setEditingType] = useState<AttachmentTypeMaster | null>(null);
    const [formData, setFormData] = useState({
        name: '',
        description: '',
        isActive: true
    });
    const [searchQuery, setSearchQuery] = useState('');

    // Initialize with existing enum values
    useEffect(() => {
        const initialTypes: AttachmentTypeMaster[] = Object.values(AttachmentType).map((type, index) => ({
            id: `att-type-${index + 1}`,
            name: type,
            description: `${type} documents and files`,
            isActive: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        }));
        setAttachmentTypes(initialTypes);
    }, []);

    const handleAdd = () => {
        const newType: AttachmentTypeMaster = {
            id: `att-type-${Date.now()}`,
            name: formData.name,
            description: formData.description,
            isActive: formData.isActive,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        setAttachmentTypes([...attachmentTypes, newType]);
        setShowAddModal(false);
        resetForm();
    };

    const handleEdit = (type: AttachmentTypeMaster) => {
        setEditingType(type);
        setFormData({
            name: type.name,
            description: type.description,
            isActive: type.isActive
        });
        setShowAddModal(true);
    };

    const handleUpdate = () => {
        if (!editingType) return;
        const updated = attachmentTypes.map(t =>
            t.id === editingType.id
                ? { ...t, ...formData, updatedAt: new Date().toISOString() }
                : t
        );
        setAttachmentTypes(updated);
        setShowAddModal(false);
        setEditingType(null);
        resetForm();
    };

    const handleToggleActive = (id: string) => {
        const updated = attachmentTypes.map(t =>
            t.id === id
                ? { ...t, isActive: !t.isActive, updatedAt: new Date().toISOString() }
                : t
        );
        setAttachmentTypes(updated);
    };

    const handleDelete = (id: string) => {
        if (confirm('Are you sure you want to delete this attachment type?')) {
            setAttachmentTypes(attachmentTypes.filter(t => t.id !== id));
        }
    };

    const resetForm = () => {
        setFormData({ name: '', description: '', isActive: true });
    };

    const filteredTypes = attachmentTypes.filter(type =>
        type.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        type.description.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white">Attachment Type Master</h1>
                    <p className="text-sm text-slate-500 mt-1">Manage attachment types for maintenance requests</p>
                </div>
                <button
                    onClick={() => {
                        setEditingType(null);
                        resetForm();
                        setShowAddModal(true);
                    }}
                    className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    Add Attachment Type
                </button>
            </div>

            {/* Search */}
            <div className="rounded-xl border border-white/10 bg-slate-900 p-4 shadow-sm">
                <div className="relative">
                    <input
                        type="text"
                        placeholder="Search attachment types..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full rounded-lg border border-white/15 px-4 py-2 pl-10 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 text-white"
                    />
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="absolute left-3 top-2.5 h-5 w-5 text-slate-400">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                    </svg>
                </div>
            </div>

            {/* Stats */}
            <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-xl border border-white/10 bg-slate-900 p-6 shadow-sm">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-slate-500">Total Types</p>
                            <p className="text-2xl font-bold text-white mt-1">{attachmentTypes.length}</p>
                        </div>
                        <div className="rounded-full bg-blue-500/20 p-3">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-blue-600">
                                <path strokeLinecap="round" strokeLinejoin="round" d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13" />
                            </svg>
                        </div>
                    </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-slate-900 p-6 shadow-sm">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-slate-500">Active</p>
                            <p className="text-2xl font-bold text-green-600 mt-1">{attachmentTypes.filter(t => t.isActive).length}</p>
                        </div>
                        <div className="rounded-full bg-emerald-500/20 p-3">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-green-600">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                            </svg>
                        </div>
                    </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-slate-900 p-6 shadow-sm">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-slate-500">Inactive</p>
                            <p className="text-2xl font-bold text-slate-400 mt-1">{attachmentTypes.filter(t => !t.isActive).length}</p>
                        </div>
                        <div className="rounded-full bg-slate-700/40 p-3">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-slate-400">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636" />
                            </svg>
                        </div>
                    </div>
                </div>
            </div>

            {/* Table */}
            <div className="rounded-xl border border-white/10 bg-slate-900 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-slate-800/50 border-b border-white/10">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Type Name</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Description</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Status</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Last Updated</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/10">
                            {filteredTypes.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-6 py-12 text-center text-slate-300">
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-12 h-12 mx-auto text-white mb-2">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                                        </svg>
                                        <p className="text-sm">No attachment types found</p>
                                    </td>
                                </tr>
                            ) : (
                                filteredTypes.map((type) => (
                                    <tr key={type.id} className="hover:bg-white/5">
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="flex items-center">
                                                <div className="flex-shrink-0 h-10 w-10 rounded-full bg-blue-500/20 flex items-center justify-center">
                                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-blue-600">
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="m18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13" />
                                                    </svg>
                                                </div>
                                                <div className="ml-4">
                                                    <div className="text-sm font-medium text-white">{type.name}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="text-sm text-slate-300">{type.description}</div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${type.isActive
                                                    ? 'bg-emerald-500/20 text-emerald-300'
                                                    : 'bg-slate-700/40 text-slate-200'
                                                }`}>
                                                {type.isActive ? 'Active' : 'Inactive'}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-300">
                                            {new Date(type.updatedAt).toLocaleDateString()}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                            <div className="flex items-center justify-end gap-2">
                                                <button
                                                    onClick={() => handleToggleActive(type.id)}
                                                    className={`rounded-lg px-3 py-1.5 text-xs font-medium ${type.isActive
                                                            ? 'bg-slate-700/40 text-slate-300 hover:bg-slate-200'
                                                            : 'bg-emerald-500/20 text-green-700 hover:bg-green-200'
                                                        }`}
                                                >
                                                    {type.isActive ? 'Deactivate' : 'Activate'}
                                                </button>
                                                <button
                                                    onClick={() => handleEdit(type)}
                                                    className="rounded-lg bg-blue-500/20 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-200"
                                                >
                                                    Edit
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(type.id)}
                                                    className="rounded-lg bg-red-500/20 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-200"
                                                >
                                                    Delete
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Add/Edit Modal */}
            {showAddModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div className="w-full max-w-md rounded-xl bg-slate-900 p-6 shadow-2xl">
                        <h3 className="text-lg font-bold text-white">
                            {editingType ? 'Edit Attachment Type' : 'Add Attachment Type'}
                        </h3>
                        <p className="mt-1 text-sm text-slate-500">
                            {editingType ? 'Update the attachment type details' : 'Create a new attachment type'}
                        </p>

                        <div className="mt-4 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-300">Type Name</label>
                                <input
                                    type="text"
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    className="mt-1 block w-full rounded-lg border border-white/15 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 text-white"
                                    placeholder="e.g., Purchase Order"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-300">Description</label>
                                <textarea
                                    value={formData.description}
                                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                    rows={3}
                                    className="mt-1 block w-full rounded-lg border border-white/15 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    placeholder="Describe this attachment type..."
                                />
                            </div>

                            <div className="flex items-center">
                                <input
                                    type="checkbox"
                                    id="isActive"
                                    checked={formData.isActive}
                                    onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                                    className="h-4 w-4 rounded border-white/15 text-blue-600 focus:ring-blue-500"
                                />
                                <label htmlFor="isActive" className="ml-2 text-sm text-slate-300">
                                    Active
                                </label>
                            </div>
                        </div>

                        <div className="mt-6 flex justify-end gap-3">
                            <button
                                onClick={() => {
                                    setShowAddModal(false);
                                    setEditingType(null);
                                    resetForm();
                                }}
                                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 hover:bg-white/10"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={editingType ? handleUpdate : handleAdd}
                                disabled={!formData.name.trim()}
                                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {editingType ? 'Update' : 'Add'} Type
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
