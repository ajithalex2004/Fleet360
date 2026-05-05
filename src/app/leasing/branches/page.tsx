'use client';
import React, { useState, useEffect } from 'react';

interface Branch {
  id: string;
  name: string;
  code: string;
  city: string;
  country: string;
  contactPerson: string;
  phone: string;
  email: string;
  status: 'Active' | 'Inactive';
}

interface NewBranchForm {
  name: string;
  code: string;
  city: string;
  country: string;
  contactPerson: string;
  phone: string;
  email: string;
  status: 'Active' | 'Inactive';
}

export default function BranchesPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewBranch, setShowNewBranch] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const [newBranchForm, setNewBranchForm] = useState<NewBranchForm>({
    name: '',
    code: '',
    city: '',
    country: 'UAE',
    contactPerson: '',
    phone: '',
    email: '',
    status: 'Active',
  });

  useEffect(() => {
    const mockBranches: Branch[] = [
      {
        id: '1',
        name: 'Dubai Headquarters',
        code: 'DXB-HQ',
        city: 'Dubai',
        country: 'UAE',
        contactPerson: 'Ahmed Hassan',
        phone: '+971 4 123 4567',
        email: 'dubai@leasingco.ae',
        status: 'Active',
      },
      {
        id: '2',
        name: 'Abu Dhabi Branch',
        code: 'AUH-BR',
        city: 'Abu Dhabi',
        country: 'UAE',
        contactPerson: 'Hana Al-Mansouri',
        phone: '+971 2 765 4321',
        email: 'abudhabi@leasingco.ae',
        status: 'Active',
      },
      {
        id: '3',
        name: 'Sharjah Office',
        code: 'SHJ-OF',
        city: 'Sharjah',
        country: 'UAE',
        contactPerson: 'Mohammed Al-Qasimi',
        phone: '+971 6 543 2109',
        email: 'sharjah@leasingco.ae',
        status: 'Active',
      },
      {
        id: '4',
        name: 'Ras Al Khaimah Office',
        code: 'RAK-OF',
        city: 'Ras Al Khaimah',
        country: 'UAE',
        contactPerson: 'Fatima Al-Nakhli',
        phone: '+971 7 234 5678',
        email: 'rak@leasingco.ae',
        status: 'Inactive',
      },
    ];

    fetch('/api/leasing/branches')
      .then((r) => r.ok ? r.json() : Promise.reject(r))
      .then((data) => setBranches(data))
      .catch(() => setBranches(mockBranches))
      .finally(() => setLoading(false));
  }, []);

  const getStatusBadgeStyle = (status: string) => {
    return status === 'Active'
      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
      : 'bg-slate-500/20 text-slate-400 border-slate-500/30';
  };

  const filteredBranches = branches.filter(b =>
    b.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    b.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
    b.city.toLowerCase().includes(searchTerm.toLowerCase()) ||
    b.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleCreateBranch = async () => {
    console.log('Creating branch:', newBranchForm);
    try {
      const response = await fetch('/api/leasing/branches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newBranchForm),
      });
      if (response.ok) {
        const newBranch = await response.json();
        setBranches([...branches, { id: String(branches.length + 1), ...newBranchForm }]);
        setShowNewBranch(false);
        setNewBranchForm({
          name: '',
          code: '',
          city: '',
          country: 'UAE',
          contactPerson: '',
          phone: '',
          email: '',
          status: 'Active',
        });
      }
    } catch (error) {
      console.error('Error creating branch:', error);
    }
  };

  const handleUpdateBranch = async (branchId: string) => {
    const branch = branches.find(b => b.id === branchId);
    if (!branch) return;

    try {
      const response = await fetch(`/api/leasing/branches/${branchId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(branch),
      });
      if (response.ok) {
        setEditingId(null);
      }
    } catch (error) {
      console.error('Error updating branch:', error);
    }
  };

  const handleDeleteBranch = async (branchId: string) => {
    if (!confirm('Are you sure you want to delete this branch?')) return;

    try {
      const response = await fetch(`/api/leasing/branches/${branchId}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        setBranches(branches.filter(b => b.id !== branchId));
      }
    } catch (error) {
      console.error('Error deleting branch:', error);
    }
  };

  const updateBranchField = (id: string, field: string, value: any) => {
    setBranches(branches.map(b => b.id === id ? { ...b, [field]: value } : b));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-400">Loading branches...</div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-white mb-2">Branch Management</h1>
          <p className="text-slate-400">Manage leasing branch offices and locations</p>
        </div>
        <button
          onClick={() => setShowNewBranch(true)}
          className="rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-3 text-sm font-medium text-white hover:opacity-90 transition-opacity"
        >
          New Branch
        </button>
      </div>

      {/* Search Bar */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-4 backdrop-blur-sm">
        <input
          type="text"
          placeholder="Search by name, code, city, or email..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full px-4 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50"
        />
      </div>

      {/* Branches Table */}
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 backdrop-blur-sm overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-800/50">
            <tr className="border-b border-white/5">
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Branch Name</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Code</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">City</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Country</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Contact Person</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Phone</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Email</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Status</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredBranches.map((branch) => (
              <tr key={branch.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                {editingId === branch.id ? (
                  <>
                    <td className="px-4 py-4 text-sm">
                      <input
                        type="text"
                        value={branch.name}
                        onChange={(e) => updateBranchField(branch.id, 'name', e.target.value)}
                        className="w-full px-2 py-1 bg-slate-900/50 border border-white/10 rounded text-white"
                      />
                    </td>
                    <td className="px-4 py-4 text-sm">
                      <input
                        type="text"
                        value={branch.code}
                        onChange={(e) => updateBranchField(branch.id, 'code', e.target.value)}
                        className="w-full px-2 py-1 bg-slate-900/50 border border-white/10 rounded text-white"
                      />
                    </td>
                    <td className="px-4 py-4 text-sm">
                      <input
                        type="text"
                        value={branch.city}
                        onChange={(e) => updateBranchField(branch.id, 'city', e.target.value)}
                        className="w-full px-2 py-1 bg-slate-900/50 border border-white/10 rounded text-white"
                      />
                    </td>
                    <td className="px-4 py-4 text-sm">
                      <input
                        type="text"
                        value={branch.country}
                        onChange={(e) => updateBranchField(branch.id, 'country', e.target.value)}
                        className="w-full px-2 py-1 bg-slate-900/50 border border-white/10 rounded text-white"
                      />
                    </td>
                    <td className="px-4 py-4 text-sm">
                      <input
                        type="text"
                        value={branch.contactPerson}
                        onChange={(e) => updateBranchField(branch.id, 'contactPerson', e.target.value)}
                        className="w-full px-2 py-1 bg-slate-900/50 border border-white/10 rounded text-white"
                      />
                    </td>
                    <td className="px-4 py-4 text-sm">
                      <input
                        type="text"
                        value={branch.phone}
                        onChange={(e) => updateBranchField(branch.id, 'phone', e.target.value)}
                        className="w-full px-2 py-1 bg-slate-900/50 border border-white/10 rounded text-white"
                      />
                    </td>
                    <td className="px-4 py-4 text-sm">
                      <input
                        type="email"
                        value={branch.email}
                        onChange={(e) => updateBranchField(branch.id, 'email', e.target.value)}
                        className="w-full px-2 py-1 bg-slate-900/50 border border-white/10 rounded text-white"
                      />
                    </td>
                    <td className="px-4 py-4 text-sm">
                      <select
                        value={branch.status}
                        onChange={(e) => updateBranchField(branch.id, 'status', e.target.value)}
                        className="w-full px-2 py-1 bg-slate-900/50 border border-white/10 rounded text-white"
                      >
                        <option value="Active">Active</option>
                        <option value="Inactive">Inactive</option>
                      </select>
                    </td>
                    <td className="px-4 py-4 text-sm flex gap-2">
                      <button
                        onClick={() => handleUpdateBranch(branch.id)}
                        className="text-emerald-400 hover:text-emerald-300 font-medium"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="text-slate-200 hover:text-white font-medium"
                      >
                        Cancel
                      </button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-4 py-4 text-sm font-medium text-white">{branch.name}</td>
                    <td className="px-4 py-4 text-sm font-medium text-blue-400">{branch.code}</td>
                    <td className="px-4 py-4 text-sm text-white">{branch.city}</td>
                    <td className="px-4 py-4 text-sm text-slate-200">{branch.country}</td>
                    <td className="px-4 py-4 text-sm text-white">{branch.contactPerson}</td>
                    <td className="px-4 py-4 text-sm text-slate-200">{branch.phone}</td>
                    <td className="px-4 py-4 text-sm text-slate-200">{branch.email}</td>
                    <td className="px-4 py-4 text-sm">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium border ${getStatusBadgeStyle(branch.status)}`}>
                        {branch.status}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-sm flex gap-2">
                      <button
                        onClick={() => setEditingId(branch.id)}
                        className="text-blue-400 hover:text-blue-300 font-medium"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteBranch(branch.id)}
                        className="text-red-400 hover:text-red-300 font-medium"
                      >
                        Delete
                      </button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* New Branch Modal */}
      {showNewBranch && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-slate-800 border border-white/10 rounded-2xl p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white">New Branch</h2>
              <button
                onClick={() => setShowNewBranch(false)}
                className="text-slate-400 hover:text-white text-2xl"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Branch Name</label>
                <input
                  type="text"
                  value={newBranchForm.name}
                  onChange={(e) => setNewBranchForm({ ...newBranchForm, name: e.target.value })}
                  placeholder="e.g., Dubai Headquarters"
                  className="w-full px-4 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Branch Code</label>
                  <input
                    type="text"
                    value={newBranchForm.code}
                    onChange={(e) => setNewBranchForm({ ...newBranchForm, code: e.target.value })}
                    placeholder="e.g., DXB-HQ"
                    className="w-full px-4 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">City</label>
                  <input
                    type="text"
                    value={newBranchForm.city}
                    onChange={(e) => setNewBranchForm({ ...newBranchForm, city: e.target.value })}
                    placeholder="e.g., Dubai"
                    className="w-full px-4 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Country</label>
                <select
                  value={newBranchForm.country}
                  onChange={(e) => setNewBranchForm({ ...newBranchForm, country: e.target.value })}
                  className="w-full px-4 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500/50"
                >
                  <option value="UAE">UAE</option>
                  <option value="Saudi Arabia">Saudi Arabia</option>
                  <option value="Kuwait">Kuwait</option>
                  <option value="Qatar">Qatar</option>
                  <option value="Bahrain">Bahrain</option>
                  <option value="Oman">Oman</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Contact Person</label>
                <input
                  type="text"
                  value={newBranchForm.contactPerson}
                  onChange={(e) => setNewBranchForm({ ...newBranchForm, contactPerson: e.target.value })}
                  placeholder="Full name"
                  className="w-full px-4 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Phone</label>
                  <input
                    type="tel"
                    value={newBranchForm.phone}
                    onChange={(e) => setNewBranchForm({ ...newBranchForm, phone: e.target.value })}
                    placeholder="+971 4 123 4567"
                    className="w-full px-4 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Email</label>
                  <input
                    type="email"
                    value={newBranchForm.email}
                    onChange={(e) => setNewBranchForm({ ...newBranchForm, email: e.target.value })}
                    placeholder="branch@leasingco.ae"
                    className="w-full px-4 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/50"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Status</label>
                <select
                  value={newBranchForm.status}
                  onChange={(e) => setNewBranchForm({ ...newBranchForm, status: e.target.value as any })}
                  className="w-full px-4 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-white focus:outline-none focus:border-blue-500/50"
                >
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowNewBranch(false)}
                  className="flex-1 px-4 py-2 border border-white/10 rounded-lg text-white hover:bg-white/5 transition-colors font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateBranch}
                  className="flex-1 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 font-medium text-white hover:opacity-90 transition-opacity"
                >
                  Create Branch
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
