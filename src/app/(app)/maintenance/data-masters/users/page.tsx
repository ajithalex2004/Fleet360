'use client';

import { useState, useEffect } from 'react';
import { getUsers, api } from '@/services/mockData';

// Define User type locally for now as it's new
type User = {
    id: string;
    username: string;
    email: string;
    mobileNumber?: string;
    hierarchy?: string;
    userType?: string;
    firstName?: string;
    lastName?: string;
    department?: string;
    position?: string;
    employeeId?: string;
};

export default function UsersPage() {
    const [users, setUsers] = useState<User[]>([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [activeTab, setActiveTab] = useState('basic');

    const [formData, setFormData] = useState({
        // Basic Info
        username: '',
        email: '',
        mobileNumber: '',
        hierarchy: '',
        userType: '',

        // Localized Content
        firstName: '',
        lastName: '',
        fullName: '', // Auto-generated

        // User Details
        department: '',
        position: '',
        employeeId: '',
    });

    useEffect(() => {
        loadUsers();
    }, []);

    const loadUsers = async () => {
        try {
            const data = await getUsers();
            setUsers(data);
        } catch (error) {
            console.error('Failed to load users', error);
        }
    };

    const handleEdit = (user: User) => {
        setFormData({
            username: user.username,
            email: user.email,
            mobileNumber: user.mobileNumber || '',
            hierarchy: user.hierarchy || '',
            userType: user.userType || '',
            firstName: user.firstName || '',
            lastName: user.lastName || '',
            fullName: `${user.firstName || ''} ${user.lastName || ''}`,
            department: user.department || '',
            position: user.position || '',
            employeeId: user.employeeId || '',
        });
        setEditingId(user.id);
        setIsModalOpen(true);
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this user?')) return;
        try {
            await api.delete(`users/${id}`);
            alert('User deleted successfully');
            loadUsers();
        } catch (error) {
            alert(`Failed to delete user: ${(error as Error).message}`);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            if (editingId) {
                await api.patch(`users/${editingId}`, formData);
                alert('User updated successfully');
            } else {
                await api.post('users', formData);
                alert('User created successfully');
            }
            setIsModalOpen(false);
            setEditingId(null);
            loadUsers();
        } catch (error) {
            alert(`Failed to save user: ${(error as Error).message}`);
        }
    };

    // Add editingId state
    const [editingId, setEditingId] = useState<string | null>(null);

    // Reset form when opening modal for create
    const openCreateModal = () => {
        setEditingId(null);
        setFormData({
            username: '', email: '', mobileNumber: '', hierarchy: '', userType: '',
            firstName: '', lastName: '', fullName: '',
            department: '', position: '', employeeId: '',
        });
        setIsModalOpen(true);
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-[var(--text-main)]">User Management</h1>
                    <p className="text-xs text-[var(--text-faint)]">Manage system users.</p>
                </div>
                <button
                    onClick={openCreateModal}
                    className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                >
                    Create New User
                </button>
            </div>

            {/* List View */}
            <div className="bg-[var(--bg-surface)] rounded-xl border border-[var(--border-subtle)] shadow-sm overflow-hidden">
                <table className="min-w-full divide-y divide-white/10">
                    <thead className="bg-[var(--bg-surface)]/50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-[var(--text-faint)] uppercase tracking-wider">Username</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-[var(--text-faint)] uppercase tracking-wider">Email</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-[var(--text-faint)] uppercase tracking-wider">Department</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-[var(--text-faint)] uppercase tracking-wider">Type</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-[var(--text-faint)] uppercase tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="bg-[var(--bg-surface)] divide-y divide-white/10">
                        {users.map((user) => (
                            <tr key={user.id} className="hover:bg-[var(--bg-surface-hover)]">
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-[var(--text-main)]">{user.username}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-[var(--text-muted)]">{user.email}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-[var(--text-muted)]">{user.department}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-[var(--text-muted)]">{user.userType}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                    <button onClick={() => handleEdit(user)} className="text-blue-600 hover:text-blue-300 mr-4">Edit</button>
                                    <button onClick={() => handleDelete(user.id)} className="text-red-600 hover:text-red-300">Delete</button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Create Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-[var(--bg-surface)] rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
                        <div className="flex justify-between items-center p-6 border-b border-[var(--border-subtle)]">
                            <h2 className="text-xl font-bold text-[var(--text-main)]">{editingId ? 'Edit User' : 'Create New User'}</h2>
                            <button onClick={() => setIsModalOpen(false)} className="text-[var(--text-muted)] hover:text-[var(--text-muted)]">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="p-6">
                            {/* Tabs */}
                            <div className="flex border-b border-[var(--border-subtle)] mb-6">
                                <button
                                    type="button"
                                    onClick={() => setActiveTab('basic')}
                                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'basic' ? 'border-blue-600 text-blue-600' : 'border-transparent text-[var(--text-faint)] hover:text-[var(--text-muted)]'}`}
                                >
                                    Basic Information
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setActiveTab('localized')}
                                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'localized' ? 'border-blue-600 text-blue-600' : 'border-transparent text-[var(--text-faint)] hover:text-[var(--text-muted)]'}`}
                                >
                                    Localized Content
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setActiveTab('details')}
                                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'details' ? 'border-blue-600 text-blue-600' : 'border-transparent text-[var(--text-faint)] hover:text-[var(--text-muted)]'}`}
                                >
                                    User Details
                                </button>
                            </div>

                            {/* Tab Content */}
                            <div className="space-y-4">
                                {activeTab === 'basic' && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-[var(--text-muted)] mb-1">Username</label>
                                            <input type="text" className="w-full rounded-lg border-[var(--border-subtle)] text-sm text-[var(--text-main)]" placeholder="Enter username" value={formData.username} onChange={e => setFormData({ ...formData, username: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-[var(--text-muted)] mb-1">Email</label>
                                            <input type="email" className="w-full rounded-lg border-[var(--border-subtle)] text-sm text-[var(--text-main)]" placeholder="Enter email address" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-[var(--text-muted)] mb-1">Mobile Number</label>
                                            <div className="flex">
                                                <span className="inline-flex items-center px-3 rounded-l-lg border border-r-0 border-[var(--border-subtle)] bg-[var(--bg-surface)]/50 text-[var(--text-faint)] text-sm">+971</span>
                                                <input type="text" className="w-full rounded-r-lg border-[var(--border-subtle)] text-sm text-[var(--text-main)]" placeholder="Phone number" value={formData.mobileNumber} onChange={e => setFormData({ ...formData, mobileNumber: e.target.value })} />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-[var(--text-muted)] mb-1">Hierarchy</label>
                                            <input type="text" className="w-full rounded-lg border-[var(--border-subtle)] text-sm text-[var(--text-main)]" placeholder="Select hierarchy" value={formData.hierarchy} onChange={e => setFormData({ ...formData, hierarchy: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-[var(--text-muted)] mb-1">User Type</label>
                                            <input type="text" className="w-full rounded-lg border-[var(--border-subtle)] text-sm text-[var(--text-main)]" placeholder="Operator" value={formData.userType} onChange={e => setFormData({ ...formData, userType: e.target.value })} />
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'localized' && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-[var(--text-muted)] mb-1">First Name</label>
                                            <input type="text" className="w-full rounded-lg border-[var(--border-subtle)] text-sm text-[var(--text-main)]" placeholder="Enter first name (English)" value={formData.firstName} onChange={e => setFormData({ ...formData, firstName: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-[var(--text-muted)] mb-1">Last Name</label>
                                            <input type="text" className="w-full rounded-lg border-[var(--border-subtle)] text-sm text-[var(--text-main)]" placeholder="Enter last name (English)" value={formData.lastName} onChange={e => setFormData({ ...formData, lastName: e.target.value })} />
                                        </div>
                                        <div className="md:col-span-2">
                                            <label className="block text-sm font-medium text-[var(--text-muted)] mb-1">Full Name</label>
                                            <input type="text" className="w-full rounded-lg border-[var(--border-subtle)] bg-[var(--bg-surface)]/50 text-sm text-[var(--text-main)]" placeholder="Auto-generated from first and last name" value={`${formData.firstName} ${formData.lastName}`} readOnly />
                                        </div>
                                    </div>
                                )}

                                {activeTab === 'details' && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-[var(--text-muted)] mb-1">Department</label>
                                            <input type="text" className="w-full rounded-lg border-[var(--border-subtle)] text-sm text-[var(--text-main)]" placeholder="Enter department" value={formData.department} onChange={e => setFormData({ ...formData, department: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-[var(--text-muted)] mb-1">Position</label>
                                            <input type="text" className="w-full rounded-lg border-[var(--border-subtle)] text-sm text-[var(--text-main)]" placeholder="Enter position" value={formData.position} onChange={e => setFormData({ ...formData, position: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-[var(--text-muted)] mb-1">Employee ID</label>
                                            <input type="text" className="w-full rounded-lg border-[var(--border-subtle)] text-sm text-[var(--text-main)]" placeholder="Enter employee ID" value={formData.employeeId} onChange={e => setFormData({ ...formData, employeeId: e.target.value })} />
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="mt-8 flex justify-end gap-3 pt-6 border-t border-[var(--border-subtle)]">
                                <button
                                    type="button"
                                    onClick={() => setIsModalOpen(false)}
                                    className="px-4 py-2 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] rounded-lg transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="px-6 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors shadow-sm"
                                >
                                    Create User
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
