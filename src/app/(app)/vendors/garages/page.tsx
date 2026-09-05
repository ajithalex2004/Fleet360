/**
 * Garage Management — owned by the Vendors module (Phase B migration from Maintenance).
 * Previously split across /maintenance/garage and /maintenance/data-masters/garages.
 */
'use client';

import { useEffect, useState } from 'react';
import { Building2, Mail, MapPin, Phone, User, X } from 'lucide-react';
import { getGarages, createGarage } from '@/services/mockData';
import { Garage } from '@/types/maintenance';
import { useToast } from '@/contexts/ToastContext';

const EMPTY_FORM = {
  name: '',
  location: '',
  contactPerson: '',
  designation: '',
  email: '',
  contactNumber: '',
  specialties: '',
  isInternal: false,
};

export default function VendorGaragesPage() {
  const { addToast } = useToast();
  const [garages, setGarages] = useState<Garage[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getGarages();
        if (!cancelled) setGarages(data);
      } catch (error) {
        console.error('Failed to load garages:', error);
        if (!cancelled) addToast('Failed to load garages', 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAddGarage = async () => {
    if (!form.name.trim()) {
      addToast('Garage name is required', 'error');
      return;
    }

    setSaving(true);
    try {
      const created = await createGarage({
        name: form.name.trim(),
        location: form.location.trim(),
        contactPerson: form.contactPerson.trim(),
        designation: form.designation.trim(),
        email: form.email.trim(),
        contactNumber: form.contactNumber.trim(),
        specialties: form.specialties.split(',').map(s => s.trim()).filter(Boolean),
        isInternal: form.isInternal,
      } as Garage);

      setGarages(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setShowAddModal(false);
      setForm(EMPTY_FORM);
      addToast('Garage added successfully', 'success');
    } catch (error) {
      console.error('Failed to create garage:', error);
      addToast('Failed to add garage', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Garage Management</h1>
          <p className="text-xs mt-1 text-slate-500">Register and manage approved repair centres.</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          + Add Garage
        </button>
      </div>

      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
        <p className="text-sm text-amber-300">
          <span className="font-semibold">Domain ownership:</span> Garage master data is managed
          here. Previously split across{' '}
          <code className="rounded bg-slate-800 px-1 text-xs">/maintenance/garage</code> and{' '}
          <code className="rounded bg-slate-800 px-1 text-xs">/maintenance/data-masters/garages</code>.
          Maintenance retains a read-only view at{' '}
          <code className="rounded bg-slate-800 px-1 text-xs">/maintenance/garage-assignments</code>.
        </p>
      </div>

      {loading ? (
        <div className="p-12 text-center text-slate-500">Loading garages...</div>
      ) : garages.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-slate-900 p-12 text-center">
          <Building2 className="mx-auto h-8 w-8 text-slate-600" />
          <p className="mt-3 font-medium text-white">No garages registered yet</p>
          <p className="mt-1 text-sm text-slate-500">Click "+ Add Garage" to register your first repair centre.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {garages.map(g => (
            <div key={g.id} className="rounded-xl border border-white/10 bg-slate-900 p-5 space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-white">{g.name}</h3>
                  {g.location && (
                    <div className="flex items-center gap-1 mt-1 text-xs text-slate-500">
                      <MapPin className="h-3 w-3" />
                      {g.location}
                    </div>
                  )}
                </div>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  g.isInternal ? 'bg-blue-500/20 text-blue-300' : 'bg-emerald-500/20 text-emerald-300'
                }`}>
                  {g.isInternal ? 'Internal' : 'External'}
                </span>
              </div>

              {(g.contactPerson || g.email) && (
                <div className="space-y-1 text-xs text-slate-400 border-t border-white/5 pt-3">
                  {g.contactPerson && (
                    <div className="flex items-center gap-1">
                      <User className="h-3 w-3" />
                      {g.contactPerson}{g.designation ? ` · ${g.designation}` : ''}
                    </div>
                  )}
                  {g.email && (
                    <div className="flex items-center gap-1">
                      <Mail className="h-3 w-3" />
                      {g.email}
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center gap-3 text-xs text-slate-400 border-t border-white/5 pt-3">
                {g.specialties?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {g.specialties.map((s, i) => (
                      <span key={i} className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-300">
                        {s}
                      </span>
                    ))}
                  </div>
                )}
                {g.contactNumber && (
                  <span className="flex items-center gap-1 ml-auto whitespace-nowrap">
                    <Phone className="h-3 w-3" />
                    {g.contactNumber}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-slate-900 rounded-2xl w-full max-w-lg shadow-2xl">
            <div className="p-6 border-b border-white/10 flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">Add Garage</h3>
              <button
                onClick={() => { setShowAddModal(false); setForm(EMPTY_FORM); }}
                className="text-slate-400 hover:text-slate-300"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Garage Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  className="w-full rounded-lg border border-white/15 px-3 py-2 bg-slate-900 text-white"
                  placeholder="e.g. Autopro Service Centre"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Location</label>
                <input
                  type="text"
                  value={form.location}
                  onChange={e => setForm({ ...form, location: e.target.value })}
                  className="w-full rounded-lg border border-white/15 px-3 py-2 bg-slate-900 text-white"
                  placeholder="e.g. Musaffah, Abu Dhabi"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Contact Person</label>
                  <input
                    type="text"
                    value={form.contactPerson}
                    onChange={e => setForm({ ...form, contactPerson: e.target.value })}
                    className="w-full rounded-lg border border-white/15 px-3 py-2 bg-slate-900 text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Designation</label>
                  <input
                    type="text"
                    value={form.designation}
                    onChange={e => setForm({ ...form, designation: e.target.value })}
                    className="w-full rounded-lg border border-white/15 px-3 py-2 bg-slate-900 text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Email</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={e => setForm({ ...form, email: e.target.value })}
                    className="w-full rounded-lg border border-white/15 px-3 py-2 bg-slate-900 text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Contact Number</label>
                  <input
                    type="text"
                    value={form.contactNumber}
                    onChange={e => setForm({ ...form, contactNumber: e.target.value })}
                    className="w-full rounded-lg border border-white/15 px-3 py-2 bg-slate-900 text-white"
                    placeholder="+971 2 555 0101"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Specialties</label>
                <input
                  type="text"
                  value={form.specialties}
                  onChange={e => setForm({ ...form, specialties: e.target.value })}
                  className="w-full rounded-lg border border-white/15 px-3 py-2 bg-slate-900 text-white"
                  placeholder="Comma-separated, e.g. General, Electrical, Heavy Vehicles"
                />
              </div>

              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={form.isInternal}
                  onChange={e => setForm({ ...form, isInternal: e.target.checked })}
                  className="h-4 w-4 rounded border-white/15"
                />
                Internal garage (owned/operated in-house)
              </label>
            </div>

            <div className="p-6 border-t border-white/10 flex justify-end gap-3">
              <button
                onClick={() => { setShowAddModal(false); setForm(EMPTY_FORM); }}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                onClick={handleAddGarage}
                disabled={saving || !form.name.trim()}
                className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed"
              >
                {saving ? 'Saving...' : 'Add Garage'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
