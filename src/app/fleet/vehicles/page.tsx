'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { lookupVehicle, KNOWN_MAKES, getModelsForMake, type VehicleKnowledge } from '@/lib/vehicle-knowledge-base';

interface Vehicle {
  id: string;
  vehicleCode: string;
  make: string;
  model: string;
  year: number;
  licensePlate: string;
  status: string;
  // enhanced fields
  chassisNo: string;
  color: string;
  yearOfManufacture: number;
  registrationNo: string;
  plateNumber: string;
  plateCode: string;
  plateCategory: string;
  emirate: string;
  vehicleTypeId: string;
  vehicleUsage: string;
  hierarchyId: string;
  hierarchyName: string;
  branchId: string;
  branchName: string;
  deviceId: string;
  simCardNo: string;
  lifecycleStage: string;
  purchaseDate: string;
  purchasePrice: number;
  odometerReading: number;
  fuelLevel: number;
  acquisitionType: string;
  assignedDriverId: string;
  registrationExpiryDate: string;
  insuranceExpiryDate: string;
  notes: string;
  category: string;
}

interface VehicleType { id: string; code: string; name: string; }

const EMPTY_VEHICLE: Partial<Vehicle> = {
  vehicleCode: '', make: '', model: '', year: new Date().getFullYear(),
  licensePlate: '', status: 'AVAILABLE',
  chassisNo: '', color: '', yearOfManufacture: new Date().getFullYear(),
  registrationNo: '', plateNumber: '', plateCode: '', plateCategory: 'PRIVATE',
  emirate: 'DUBAI', vehicleTypeId: '', vehicleUsage: 'RENTAL',
  hierarchyName: '', branchName: '',
  deviceId: '', simCardNo: '', lifecycleStage: 'ACTIVE',
  purchaseDate: '', purchasePrice: 0, odometerReading: 0, fuelLevel: 100,
  acquisitionType: 'PURCHASE', assignedDriverId: '',
  registrationExpiryDate: '', insuranceExpiryDate: '',
  notes: '', category: '',
};

const STATUSES = ['AVAILABLE', 'RENTED', 'MAINTENANCE', 'RESERVED', 'INACTIVE', 'SOLD'];
const LIFECYCLE_STAGES = ['ACTIVE', 'ALLOCATED', 'MAINTENANCE', 'IDLE', 'SOLD', 'WRITTEN_OFF'];
const USAGES = ['RENTAL', 'STAFF', 'SCHOOL_BUS', 'LOGISTICS', 'AMBULANCE', 'POOL', 'EXECUTIVE'];
const EMIRATES = ['DUBAI', 'ABU_DHABI', 'SHARJAH', 'AJMAN', 'RAK', 'FUJAIRAH', 'UAQ'];
const PLATE_CATS = ['PRIVATE', 'EXPORT', 'DIPLOMATIC', 'COMMERCIAL', 'MOTORCYCLE'];
const ACQUISITION_TYPES = ['PURCHASE', 'LEASE', 'HIRE_PURCHASE', 'DONATED'];

/** Industry-standard vehicle segment ladder used in RAC pricing & fleet reporting */
const VEHICLE_SEGMENTS = [
  { value: 'ECONOMY',       label: 'Economy',          desc: 'Yaris, Sunny, City, Accent — budget & fuel-efficient' },
  { value: 'COMPACT',       label: 'Compact',           desc: 'Corolla, Civic, Elantra — small family sedans' },
  { value: 'MID_SIZE',      label: 'Mid-size',          desc: 'Camry, Accord, Altima — standard family sedans' },
  { value: 'FULL_SIZE',     label: 'Full-size',         desc: 'Avalon, Maxima, Sonata — large sedans' },
  { value: 'COMPACT_SUV',   label: 'SUV – Compact',     desc: 'Tucson, CR-V, RAV4, Sportage' },
  { value: 'MID_SIZE_SUV',  label: 'SUV – Mid-size',    desc: 'Fortuner, Pajero, Explorer, Pilot' },
  { value: 'FULL_SIZE_SUV', label: 'SUV – Full-size',   desc: 'Prado, Pathfinder, Sequoia, Expedition' },
  { value: 'LUXURY',        label: 'Luxury',            desc: 'E-Class, 5-Series, A6, XF' },
  { value: 'PREMIUM',       label: 'Premium',           desc: 'S-Class, 7-Series, A8, Continental' },
  { value: 'SPORTS',        label: 'Sports',            desc: 'Mustang, 911, Cayman, M3' },
  { value: 'VAN',           label: 'Van / People Mover',desc: 'Hiace, Urvan, Sprinter, Starex' },
  { value: 'PICKUP',        label: 'Pickup / Commercial',desc: 'Hilux, Ranger, D-Max, Navara' },
  { value: 'BUS',           label: 'Bus',               desc: 'Minibus, school bus, full-size coach' },
  { value: 'SPECIAL',       label: 'Special / Heavy',   desc: 'Ambulance, truck, crane, heavy equipment' },
];

const segmentColor: Record<string, string> = {
  ECONOMY:       'bg-green-500/15 text-green-400 border border-green-500/20',
  COMPACT:       'bg-teal-500/15 text-teal-400 border border-teal-500/20',
  MID_SIZE:      'bg-blue-500/15 text-blue-400 border border-blue-500/20',
  FULL_SIZE:     'bg-indigo-500/15 text-indigo-400 border border-indigo-500/20',
  COMPACT_SUV:   'bg-cyan-500/15 text-cyan-400 border border-cyan-500/20',
  MID_SIZE_SUV:  'bg-sky-500/15 text-sky-400 border border-sky-500/20',
  FULL_SIZE_SUV: 'bg-violet-500/15 text-violet-400 border border-violet-500/20',
  LUXURY:        'bg-amber-500/15 text-amber-400 border border-amber-500/20',
  PREMIUM:       'bg-orange-500/15 text-orange-400 border border-orange-500/20',
  SPORTS:        'bg-red-500/15 text-red-400 border border-red-500/20',
  VAN:           'bg-slate-500/15 text-slate-300 border border-slate-500/20',
  PICKUP:        'bg-yellow-500/15 text-yellow-400 border border-yellow-500/20',
  BUS:           'bg-purple-500/15 text-purple-400 border border-purple-500/20',
  SPECIAL:       'bg-pink-500/15 text-pink-400 border border-pink-500/20',
};

const statusColor: Record<string, string> = {
  AVAILABLE: 'bg-green-500/20 text-green-400',
  RENTED: 'bg-blue-500/20 text-blue-400',
  MAINTENANCE: 'bg-amber-500/20 text-amber-400',
  RESERVED: 'bg-purple-500/20 text-purple-400',
  INACTIVE: 'bg-slate-500/20 text-slate-400',
  SOLD: 'bg-red-500/20 text-red-400',
};

export default function VehiclesPage() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehicleTypes, setVehicleTypes] = useState<VehicleType[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [usageFilter, setUsageFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [form, setForm] = useState<Partial<Vehicle>>(EMPTY_VEHICLE);
  const [tab, setTab] = useState<'basic' | 'fleet' | 'documents'>('basic');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;

  // Smart auto-detection state
  const [detectedInfo, setDetectedInfo] = useState<VehicleKnowledge | null>(null);
  const [detectedDismissed, setDetectedDismissed] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: String(limit), page: String(page) });
    if (search) params.set('search', search);
    if (statusFilter) params.set('status', statusFilter);
    if (usageFilter) params.set('vehicleUsage', usageFilter);
    if (categoryFilter) params.set('category', categoryFilter);
    try {
      const [vRes, vtRes] = await Promise.all([
        fetch('/api/fleet/vehicles?' + params),
        fetch('/api/fleet/vehicle-types?limit=200'),
      ]);
      const vData = await vRes.json();
      const vtData = await vtRes.json();
      const vArr = Array.isArray(vData.data) ? vData.data : Array.isArray(vData) ? vData : [];
      const vtArr = Array.isArray(vtData.data) ? vtData.data : Array.isArray(vtData) ? vtData : [];
      setVehicles(vArr);
      setTotal(typeof vData.total === 'number' ? vData.total : vArr.length);
      setVehicleTypes(vtArr);
    } catch { setError('Failed to load data'); }
    finally { setLoading(false); }
  }, [search, statusFilter, usageFilter, categoryFilter, page]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-detect vehicle info whenever Make or Model changes
  useEffect(() => {
    if (!showModal) return;
    const make = (form.make ?? '').trim();
    const model = (form.model ?? '').trim();
    if (make.length >= 2 && model.length >= 2) {
      const result = lookupVehicle(make, model);
      setDetectedInfo(result);
      setDetectedDismissed(false);
    } else {
      setDetectedInfo(null);
    }
  }, [form.make, form.model, showModal]);

  const applyDetection = () => {
    if (!detectedInfo) return;
    setForm(p => ({ ...p, category: detectedInfo.segment }));
    setDetectedDismissed(true);
  };

  const openNew = () => {
    setEditing(null); setForm(EMPTY_VEHICLE); setTab('basic'); setError('');
    setDetectedInfo(null); setDetectedDismissed(false); setShowModal(true);
  };
  const openEdit = (v: Vehicle) => {
    setEditing(v); setForm(v); setTab('basic'); setError('');
    setDetectedInfo(null); setDetectedDismissed(false); setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.make || !form.model) { setError('Make and Model are required'); return; }
    setSaving(true); setError('');
    try {
      const url = editing ? `/api/fleet/vehicles/${editing.id}` : '/api/fleet/vehicles';
      const method = editing ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      if (!res.ok) { const d = await res.json(); setError(d.error ?? 'Save failed'); return; }
      setShowModal(false); fetchData();
    } catch { setError('Network error'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this vehicle?')) return;
    await fetch(`/api/fleet/vehicles/${id}`, { method: 'DELETE' });
    fetchData();
  };

  const f = (k: keyof Vehicle, v: any) => setForm(p => ({ ...p, [k]: v }));

  const vtName = (id: string) => vehicleTypes.find(vt => vt.id === id)?.name ?? '—';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Vehicle Master</h1>
          <p className="text-slate-400 text-sm mt-0.5">Manage fleet vehicles, registration, and lifecycle tracking</p>
        </div>
        <button onClick={openNew} className="px-5 py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 text-white rounded-xl font-semibold text-sm hover:opacity-90 transition-opacity flex items-center gap-2">
          <span>+</span> Add Vehicle
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search vehicle code, plate, make, model…"
          className="flex-1 min-w-[220px] bg-slate-800/60 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-orange-500/50" />
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          className="bg-slate-800/60 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500/50">
          <option value="">All Status</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={usageFilter} onChange={e => { setUsageFilter(e.target.value); setPage(1); }}
          className="bg-slate-800/60 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500/50">
          <option value="">All Usage</option>
          {USAGES.map(u => <option key={u} value={u}>{u.replace(/_/g, ' ')}</option>)}
        </select>
        <select value={categoryFilter} onChange={e => { setCategoryFilter(e.target.value); setPage(1); }}
          className="bg-slate-800/60 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500/50">
          <option value="">All Segments</option>
          {VEHICLE_SEGMENTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-slate-800/40 border border-white/10 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/60 border-b border-white/10">
              <tr>
                {['Vehicle Code', 'Make / Model', 'Segment', 'Plate No.', 'Type', 'Usage', 'Lifecycle', 'Status', 'Odometer', 'Fuel', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                <tr><td colSpan={11} className="px-4 py-12 text-center text-slate-500">Loading…</td></tr>
              ) : vehicles.length === 0 ? (
                <tr><td colSpan={11} className="px-4 py-12 text-center text-slate-500">No vehicles found. Click "Add Vehicle" to get started.</td></tr>
              ) : vehicles.map(v => (
                <tr key={v.id} className="hover:bg-white/5 transition-colors">
                  <td className="px-4 py-3">
                    <span className="font-mono text-orange-400 font-semibold text-xs bg-orange-500/10 px-2 py-1 rounded">{v.vehicleCode || '—'}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-white font-medium">{v.make} {v.model}</div>
                    <div className="text-slate-500 text-xs">{v.yearOfManufacture || v.year || ''} • {v.color || ''}</div>
                  </td>
                  <td className="px-4 py-3">
                    {v.category ? (
                      <span className={`px-2 py-1 rounded-lg text-xs font-semibold ${segmentColor[v.category] ?? 'bg-slate-700/60 text-slate-300'}`}>
                        {VEHICLE_SEGMENTS.find(s => s.value === v.category)?.label ?? v.category}
                      </span>
                    ) : <span className="text-slate-600 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-300 text-xs">{v.plateNumber || v.licensePlate || '—'}</td>
                  <td className="px-4 py-3 text-slate-300 text-xs">{v.vehicleTypeId ? vtName(v.vehicleTypeId) : '—'}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-slate-400">{(v.vehicleUsage ?? '').replace(/_/g, ' ')}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-1 rounded-lg text-xs font-semibold bg-slate-700/60 text-slate-300">{v.lifecycleStage || '—'}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-lg text-xs font-semibold ${statusColor[v.status] ?? 'bg-slate-700 text-slate-300'}`}>{v.status}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-300 text-xs text-right">{v.odometerReading?.toLocaleString() ?? 0} km</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                        <div className="h-full bg-orange-500 rounded-full" style={{ width: `${v.fuelLevel ?? 0}%` }} />
                      </div>
                      <span className="text-xs text-slate-400">{v.fuelLevel ?? 0}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      <button onClick={() => openEdit(v)} className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors">Edit</button>
                      <button onClick={() => handleDelete(v.id)} className="px-3 py-1.5 text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors">Del</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {total > limit && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-white/10">
            <span className="text-xs text-slate-400">Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}</span>
            <div className="flex gap-2">
              <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1.5 text-xs bg-slate-700 disabled:opacity-40 hover:bg-slate-600 text-white rounded-lg">Prev</button>
              <button disabled={page * limit >= total} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 text-xs bg-slate-700 disabled:opacity-40 hover:bg-slate-600 text-white rounded-lg">Next</button>
            </div>
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl">
            {/* Modal Header */}
            <div className="px-6 py-5 border-b border-white/10 flex items-center justify-between flex-shrink-0">
              <div>
                <h2 className="text-lg font-semibold text-white">{editing ? `Edit Vehicle — ${editing.vehicleCode || editing.make}` : 'Add New Vehicle'}</h2>
                <p className="text-xs text-slate-400 mt-0.5">Fill in the vehicle details across sections</p>
              </div>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white text-2xl leading-none">×</button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-white/10 flex-shrink-0">
              {(['basic', 'fleet', 'documents'] as const).map(t => (
                <button key={t} onClick={() => setTab(t)}
                  className={`px-6 py-3 text-sm font-medium transition-colors border-b-2 ${tab === t ? 'border-orange-500 text-orange-400' : 'border-transparent text-slate-400 hover:text-slate-300'}`}>
                  {t === 'basic' ? '📋 Basic Details' : t === 'fleet' ? '🚗 Fleet Assignment' : '📄 Documents & Dates'}
                </button>
              ))}
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6">
              {error && <div className="mb-4 bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-xl text-sm">{error}</div>}

              {/* TAB: Basic Details */}
              {tab === 'basic' && (
                <div className="space-y-6">
                  {/* Vehicle Identification */}
                  <div>
                    <h3 className="text-sm font-semibold text-orange-400 uppercase tracking-wider mb-4">Vehicle Identification</h3>
                    {/* Smart Detection Banner */}
                    {detectedInfo && !detectedDismissed && (
                      <div className="mb-4 bg-gradient-to-r from-blue-600/20 to-cyan-600/20 border border-blue-500/30 rounded-xl p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-blue-400 text-base">🤖</span>
                              <span className="text-sm font-semibold text-blue-300">Smart Detection — Vehicle Identified</span>
                            </div>
                            <div className="grid grid-cols-4 gap-3 mt-3">
                              <div className="bg-slate-900/60 rounded-lg px-3 py-2">
                                <div className="text-xs text-slate-500 mb-0.5">Segment</div>
                                <div className="text-sm font-semibold text-white">
                                  {VEHICLE_SEGMENTS.find(s => s.value === detectedInfo.segment)?.label ?? detectedInfo.segment}
                                </div>
                              </div>
                              <div className="bg-slate-900/60 rounded-lg px-3 py-2">
                                <div className="text-xs text-slate-500 mb-0.5">Group</div>
                                <div className="text-sm font-semibold text-white">{detectedInfo.group.replace(/_/g, ' ')}</div>
                              </div>
                              <div className="bg-slate-900/60 rounded-lg px-3 py-2">
                                <div className="text-xs text-slate-500 mb-0.5">Class</div>
                                <div className="text-sm font-semibold text-white">{detectedInfo.vehicleClass.replace(/_/g, ' ')}</div>
                              </div>
                              <div className="bg-slate-900/60 rounded-lg px-3 py-2">
                                <div className="text-xs text-slate-500 mb-0.5">Suggested Type</div>
                                <div className="text-sm font-semibold text-white">{detectedInfo.suggestedType}</div>
                              </div>
                            </div>
                            {(detectedInfo.fuelType || detectedInfo.numPassengers) && (
                              <div className="flex gap-4 mt-2">
                                {detectedInfo.fuelType && <span className="text-xs text-slate-400">⛽ {detectedInfo.fuelType}</span>}
                                {detectedInfo.numPassengers && <span className="text-xs text-slate-400">👤 {detectedInfo.numPassengers} passengers</span>}
                              </div>
                            )}
                          </div>
                          <div className="flex flex-col gap-2">
                            <button type="button" onClick={applyDetection}
                              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap">
                              ✓ Apply
                            </button>
                            <button type="button" onClick={() => setDetectedDismissed(true)}
                              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded-lg transition-colors whitespace-nowrap">
                              Dismiss
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs text-slate-400 mb-1.5">Vehicle Code</label>
                        <input value={form.vehicleCode ?? ''} onChange={e => f('vehicleCode', e.target.value.toUpperCase())}
                          placeholder="Auto-generated"
                          className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm font-mono focus:outline-none focus:border-orange-500/50" />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1.5">Make <span className="text-red-400">*</span></label>
                        <input
                          list="makes-list"
                          value={form.make ?? ''}
                          onChange={e => f('make', e.target.value)}
                          placeholder="e.g. Toyota"
                          className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500/50" />
                        <datalist id="makes-list">
                          {KNOWN_MAKES.map(m => <option key={m} value={m} />)}
                        </datalist>
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1.5">Model <span className="text-red-400">*</span></label>
                        <input
                          list="models-list"
                          value={form.model ?? ''}
                          onChange={e => f('model', e.target.value)}
                          placeholder="e.g. Camry"
                          className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500/50" />
                        <datalist id="models-list">
                          {getModelsForMake(form.make ?? '').map(m => <option key={m} value={m} />)}
                        </datalist>
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1.5">Year of Manufacture</label>
                        <input type="number" value={form.yearOfManufacture ?? new Date().getFullYear()} onChange={e => f('yearOfManufacture', Number(e.target.value))}
                          className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500/50" />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1.5">Color</label>
                        <input value={form.color ?? ''} onChange={e => f('color', e.target.value)}
                          placeholder="e.g. White"
                          className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500/50" />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1.5">Chassis No.</label>
                        <input value={form.chassisNo ?? ''} onChange={e => f('chassisNo', e.target.value)}
                          placeholder="VIN / Chassis number"
                          className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm font-mono focus:outline-none focus:border-orange-500/50" />
                      </div>
                      {/* Segment — spans full width */}
                      <div className="col-span-3">
                        <label className="block text-xs text-slate-400 mb-2">
                          Vehicle Segment
                          <span className="ml-2 text-slate-500 normal-case font-normal">Used in RAC pricing rules and fleet reporting</span>
                        </label>
                        <div className="grid grid-cols-7 gap-2">
                          {VEHICLE_SEGMENTS.map(seg => (
                            <button
                              key={seg.value}
                              type="button"
                              title={seg.desc}
                              onClick={() => f('category', form.category === seg.value ? '' : seg.value)}
                              className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-all text-center ${
                                form.category === seg.value
                                  ? segmentColor[seg.value] + ' ring-1 ring-offset-1 ring-offset-slate-900 ring-orange-500'
                                  : 'bg-slate-800/60 border-white/10 text-slate-400 hover:border-orange-500/30 hover:text-slate-300'
                              }`}>
                              {seg.label}
                            </button>
                          ))}
                        </div>
                        {form.category && (
                          <p className="mt-2 text-xs text-slate-500">
                            {VEHICLE_SEGMENTS.find(s => s.value === form.category)?.desc}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Registration */}
                  <div>
                    <h3 className="text-sm font-semibold text-orange-400 uppercase tracking-wider mb-4">Registration Details</h3>
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs text-slate-400 mb-1.5">Plate Number</label>
                        <input value={form.plateNumber ?? ''} onChange={e => f('plateNumber', e.target.value)}
                          placeholder="e.g. 12345"
                          className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm font-mono focus:outline-none focus:border-orange-500/50" />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1.5">Plate Code</label>
                        <input value={form.plateCode ?? ''} onChange={e => f('plateCode', e.target.value)}
                          placeholder="e.g. A, B, AA"
                          className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm font-mono focus:outline-none focus:border-orange-500/50" />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1.5">Emirate</label>
                        <select value={form.emirate ?? 'DUBAI'} onChange={e => f('emirate', e.target.value)}
                          className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500/50">
                          {EMIRATES.map(em => <option key={em} value={em}>{em.replace(/_/g, ' ')}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1.5">Plate Category</label>
                        <select value={form.plateCategory ?? 'PRIVATE'} onChange={e => f('plateCategory', e.target.value)}
                          className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500/50">
                          {PLATE_CATS.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1.5">Registration No.</label>
                        <input value={form.registrationNo ?? ''} onChange={e => f('registrationNo', e.target.value)}
                          className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm font-mono focus:outline-none focus:border-orange-500/50" />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1.5">Status</label>
                        <select value={form.status ?? 'AVAILABLE'} onChange={e => f('status', e.target.value)}
                          className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500/50">
                          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Acquisition */}
                  <div>
                    <h3 className="text-sm font-semibold text-orange-400 uppercase tracking-wider mb-4">Acquisition Details</h3>
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs text-slate-400 mb-1.5">Acquisition Type</label>
                        <select value={form.acquisitionType ?? 'PURCHASE'} onChange={e => f('acquisitionType', e.target.value)}
                          className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500/50">
                          {ACQUISITION_TYPES.map(a => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1.5">Purchase Date</label>
                        <input type="date" value={form.purchaseDate ? form.purchaseDate.slice(0, 10) : ''} onChange={e => f('purchaseDate', e.target.value)}
                          className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500/50" />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1.5">Purchase Price (AED)</label>
                        <input type="number" value={form.purchasePrice ?? 0} onChange={e => f('purchasePrice', Number(e.target.value))}
                          className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500/50" />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB: Fleet Assignment */}
              {tab === 'fleet' && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-sm font-semibold text-orange-400 uppercase tracking-wider mb-4">Fleet Configuration</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs text-slate-400 mb-1.5">Vehicle Type</label>
                        <select value={form.vehicleTypeId ?? ''} onChange={e => f('vehicleTypeId', e.target.value)}
                          className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500/50">
                          <option value="">— Select Type —</option>
                          {vehicleTypes.map(vt => <option key={vt.id} value={vt.id}>{vt.name} ({vt.code})</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1.5">Vehicle Usage</label>
                        <select value={form.vehicleUsage ?? 'RENTAL'} onChange={e => f('vehicleUsage', e.target.value)}
                          className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500/50">
                          {USAGES.map(u => <option key={u} value={u}>{u.replace(/_/g, ' ')}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1.5">Lifecycle Stage</label>
                        <select value={form.lifecycleStage ?? 'ACTIVE'} onChange={e => f('lifecycleStage', e.target.value)}
                          className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500/50">
                          {LIFECYCLE_STAGES.map(l => <option key={l} value={l}>{l.replace(/_/g, ' ')}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1.5">Branch / Location</label>
                        <input value={form.branchName ?? ''} onChange={e => f('branchName', e.target.value)}
                          placeholder="e.g. Dubai Airport"
                          className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500/50" />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1.5">Assigned Driver ID</label>
                        <input value={form.assignedDriverId ?? ''} onChange={e => f('assignedDriverId', e.target.value)}
                          placeholder="Driver reference"
                          className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500/50" />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1.5">Hierarchy / Division</label>
                        <input value={form.hierarchyName ?? ''} onChange={e => f('hierarchyName', e.target.value)}
                          placeholder="e.g. Rental Division"
                          className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500/50" />
                      </div>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold text-orange-400 uppercase tracking-wider mb-4">Telematics & Equipment</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs text-slate-400 mb-1.5">Device ID / IMEI</label>
                        <input value={form.deviceId ?? ''} onChange={e => f('deviceId', e.target.value)}
                          placeholder="GPS/telematics device ID"
                          className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm font-mono focus:outline-none focus:border-orange-500/50" />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1.5">SIM Card No.</label>
                        <input value={form.simCardNo ?? ''} onChange={e => f('simCardNo', e.target.value)}
                          placeholder="SIM number"
                          className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm font-mono focus:outline-none focus:border-orange-500/50" />
                      </div>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold text-orange-400 uppercase tracking-wider mb-4">Current Readings</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs text-slate-400 mb-1.5">Odometer Reading (km)</label>
                        <input type="number" value={form.odometerReading ?? 0} onChange={e => f('odometerReading', Number(e.target.value))}
                          className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500/50" />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1.5">Fuel Level (%)</label>
                        <input type="number" min="0" max="100" value={form.fuelLevel ?? 100} onChange={e => f('fuelLevel', Number(e.target.value))}
                          className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500/50" />
                        <div className="mt-2 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                          <div className="h-full bg-orange-500 rounded-full transition-all" style={{ width: `${form.fuelLevel ?? 100}%` }} />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5">Notes</label>
                    <textarea value={form.notes ?? ''} onChange={e => f('notes', e.target.value)} rows={3}
                      className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500/50 resize-none" />
                  </div>
                </div>
              )}

              {/* TAB: Documents */}
              {tab === 'documents' && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-sm font-semibold text-orange-400 uppercase tracking-wider mb-4">Document Expiry Dates</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-slate-800/40 border border-white/10 rounded-xl p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <span className="text-lg">📋</span>
                          <h4 className="text-sm font-medium text-white">Vehicle Registration</h4>
                        </div>
                        <label className="block text-xs text-slate-400 mb-1.5">Expiry Date</label>
                        <input type="date" value={form.registrationExpiryDate ? form.registrationExpiryDate.slice(0, 10) : ''}
                          onChange={e => f('registrationExpiryDate', e.target.value)}
                          className="w-full bg-slate-700 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500/50" />
                        {form.registrationExpiryDate && (
                          <p className={`text-xs mt-2 ${new Date(form.registrationExpiryDate) < new Date() ? 'text-red-400' : new Date(form.registrationExpiryDate) < new Date(Date.now() + 30 * 86400000) ? 'text-amber-400' : 'text-green-400'}`}>
                            {new Date(form.registrationExpiryDate) < new Date() ? '⚠️ Expired' : new Date(form.registrationExpiryDate) < new Date(Date.now() + 30 * 86400000) ? '⚠️ Expiring soon' : '✓ Valid'}
                          </p>
                        )}
                      </div>
                      <div className="bg-slate-800/40 border border-white/10 rounded-xl p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <span className="text-lg">🛡️</span>
                          <h4 className="text-sm font-medium text-white">Insurance Policy</h4>
                        </div>
                        <label className="block text-xs text-slate-400 mb-1.5">Expiry Date</label>
                        <input type="date" value={form.insuranceExpiryDate ? form.insuranceExpiryDate.slice(0, 10) : ''}
                          onChange={e => f('insuranceExpiryDate', e.target.value)}
                          className="w-full bg-slate-700 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500/50" />
                        {form.insuranceExpiryDate && (
                          <p className={`text-xs mt-2 ${new Date(form.insuranceExpiryDate) < new Date() ? 'text-red-400' : new Date(form.insuranceExpiryDate) < new Date(Date.now() + 30 * 86400000) ? 'text-amber-400' : 'text-green-400'}`}>
                            {new Date(form.insuranceExpiryDate) < new Date() ? '⚠️ Expired' : new Date(form.insuranceExpiryDate) < new Date(Date.now() + 30 * 86400000) ? '⚠️ Expiring soon' : '✓ Valid'}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
                    <p className="text-amber-400 text-sm font-medium mb-1">📎 Document Attachments</p>
                    <p className="text-amber-300/70 text-xs">Upload Mulkiya, insurance certificate, and other vehicle documents from the Documents section after saving this vehicle.</p>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-white/10 flex items-center justify-between flex-shrink-0 bg-slate-900">
              <div className="flex gap-2">
                {(['basic', 'fleet', 'documents'] as const).filter(t => t !== tab).map(t => (
                  <button key={t} onClick={() => setTab(t)} className="px-4 py-2 text-xs text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors">
                    {t === 'basic' ? '← Basic Details' : t === 'fleet' ? '→ Fleet Assignment' : '→ Documents'}
                  </button>
                ))}
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowModal(false)} className="px-5 py-2.5 text-sm text-slate-400 hover:text-white transition-colors">Cancel</button>
                <button onClick={handleSave} disabled={saving}
                  className="px-6 py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 text-white rounded-xl font-semibold text-sm hover:opacity-90 disabled:opacity-50 transition-opacity">
                  {saving ? 'Saving…' : editing ? 'Update Vehicle' : 'Add Vehicle'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
