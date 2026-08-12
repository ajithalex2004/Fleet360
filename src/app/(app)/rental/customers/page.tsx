'use client';
import React, { useState, useEffect, useCallback } from 'react';

interface Customer {
  id: string;
  fullName: string;
  nationality?: string;
  passportNo?: string;
  drivingLicenseNo?: string;
  licenseExpiry?: string;
  email?: string;
  phone?: string;
  blacklisted?: boolean;
  createdAt?: string;
}

export default function CustomersPage() {
  const [customers, setCustomers]   = useState<Customer[]>([]);
  const [search, setSearch]         = useState('');
  const [showModal, setShowModal]   = useState(false);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');
  const [editCustomer, setEditCustomer] = useState<Customer | null>(null);

  const [formData, setFormData] = useState({
    fullName: '', nationality: '', passportNo: '',
    drivingLicenseNo: '', licenseExpiry: '',
    email: '', phone: '', blacklisted: false,
  });

  const loadCustomers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/rental/customers');
      const data = await res.json();
      setCustomers(Array.isArray(data) ? data : []);
    } catch {
      setError('Failed to load customers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadCustomers(); }, [loadCustomers]);

  const openNew = () => {
    setEditCustomer(null);
    setFormData({ fullName:'', nationality:'', passportNo:'', drivingLicenseNo:'', licenseExpiry:'', email:'', phone:'', blacklisted:false });
    setShowModal(true);
  };

  const openEdit = (c: Customer) => {
    setEditCustomer(c);
    setFormData({
      fullName: c.fullName, nationality: c.nationality ?? '', passportNo: c.passportNo ?? '',
      drivingLicenseNo: c.drivingLicenseNo ?? '',
      licenseExpiry: c.licenseExpiry ? c.licenseExpiry.slice(0, 10) : '',
      email: c.email ?? '', phone: c.phone ?? '', blacklisted: c.blacklisted ?? false,
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...formData,
        licenseExpiry: formData.licenseExpiry ? new Date(formData.licenseExpiry).toISOString() : null,
      };
      const url = editCustomer ? `/api/rental/customers/${editCustomer.id}` : '/api/rental/customers';
      const method = editCustomer ? 'PATCH' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error('Failed');
      setShowModal(false);
      loadCustomers();
    } catch {
      setError('Failed to save customer');
    } finally {
      setSaving(false);
    }
  };

  const handleBlacklist = async (c: Customer) => {
    if (!confirm(`${c.blacklisted ? 'Remove from' : 'Add to'} blacklist?`)) return;
    try {
      await fetch(`/api/rental/customers/${c.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blacklisted: !c.blacklisted }),
      });
      loadCustomers();
    } catch {
      setError('Failed to update');
    }
  };

  const filtered = customers.filter(c =>
    c.fullName.toLowerCase().includes(search.toLowerCase()) ||
    (c.email ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (c.phone ?? '').includes(search)
  );

  if (loading) return <div className="flex items-center justify-center h-full"><div className="text-slate-400 animate-pulse">Loading customers...</div></div>;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-white mb-2">Customers</h1>
          <p className="text-slate-400">{customers.length} registered customers</p>
        </div>
        <button onClick={openNew} className="rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-3 text-sm font-medium text-white hover:opacity-90">
          + New Customer
        </button>
      </div>

      {error && <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-400 text-sm">{error}</div>}

      <input
        value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, email or phone..."
        className="w-full max-w-md px-4 py-2 rounded-lg bg-slate-800/50 border border-white/10 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
      />

      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 backdrop-blur-sm overflow-x-auto">
        {filtered.length === 0 ? (
          <div className="text-center text-slate-400 py-12">No customers found</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-300">Name</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-300">Nationality</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-300">Passport / ID</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-300">License No.</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-300">License Expiry</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-300">Contact</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-300">Status</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-slate-300">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                  <td className="px-4 py-4 text-sm font-medium text-white">{c.fullName}</td>
                  <td className="px-4 py-4 text-sm text-white">{c.nationality ?? '-'}</td>
                  <td className="px-4 py-4 text-sm text-white">{c.passportNo ?? '-'}</td>
                  <td className="px-4 py-4 text-sm text-white">{c.drivingLicenseNo ?? '-'}</td>
                  <td className="px-4 py-4 text-sm text-slate-200">
                    {c.licenseExpiry ? new Date(c.licenseExpiry).toLocaleDateString() : '-'}
                  </td>
                  <td className="px-4 py-4 text-sm text-white">
                    <div>{c.phone ?? '-'}</div>
                    <div className="text-slate-300 text-xs">{c.email ?? ''}</div>
                  </td>
                  <td className="px-4 py-4">
                    {c.blacklisted
                      ? <span className="px-3 py-1 rounded-full text-xs font-medium bg-rose-500/20 text-rose-400 border border-rose-500/30">Blacklisted</span>
                      : <span className="px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">Active</span>}
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex gap-2">
                      <button onClick={() => openEdit(c)} className="text-xs px-2 py-1 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30">Edit</button>
                      <button onClick={() => handleBlacklist(c)} className={`text-xs px-2 py-1 rounded border ${c.blacklisted ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-rose-500/20 text-rose-400 border-rose-500/30'} hover:opacity-80`}>
                        {c.blacklisted ? 'Unblock' : 'Blacklist'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-slate-800/95 border border-white/10 rounded-2xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white">{editCustomer ? 'Edit Customer' : 'New Customer'}</h2>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label:'Full Name *', key:'fullName', type:'text', placeholder:'Ahmed Al-Mansouri', required:true },
                  { label:'Nationality', key:'nationality', type:'text', placeholder:'UAE' },
                  { label:'Passport No.', key:'passportNo', type:'text', placeholder:'A12345678' },
                  { label:'Driving License No.', key:'drivingLicenseNo', type:'text', placeholder:'DL-00000' },
                  { label:'License Expiry', key:'licenseExpiry', type:'date', placeholder:'' },
                  { label:'Email', key:'email', type:'email', placeholder:'customer@email.com' },
                  { label:'Phone', key:'phone', type:'text', placeholder:'+971 50 000 0000' },
                ].map(({ label, key, type, placeholder, required }) => (
                  <div key={key}>
                    <label className="block text-sm font-medium text-slate-300 mb-2">{label}</label>
                    <input type={type} value={(formData as any)[key]} onChange={e => setFormData(p => ({...p, [key]: e.target.value}))} placeholder={placeholder} required={required}
                      className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none" />
                  </div>
                ))}
                <div className="flex items-center gap-3 col-span-2">
                  <input type="checkbox" id="blacklisted" checked={formData.blacklisted} onChange={e => setFormData(p => ({...p, blacklisted: e.target.checked}))}
                    className="w-4 h-4 rounded accent-rose-500 text-white" />
                  <label htmlFor="blacklisted" className="text-sm text-slate-300">Mark as Blacklisted</label>
                </div>
              </div>
              <div className="flex gap-4 justify-end pt-4">
                <button type="button" onClick={() => setShowModal(false)} className="px-6 py-2 rounded-lg border border-white/10 text-white hover:bg-white/5">Cancel</button>
                <button type="submit" disabled={saving} className="px-6 py-2 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 text-white hover:opacity-90 disabled:opacity-50">
                  {saving ? 'Saving...' : editCustomer ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
