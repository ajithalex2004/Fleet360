'use client';
import React, { useState, useEffect, useCallback } from 'react';
import {
  lookupVehicle, KNOWN_MAKES, getSegmentDefaults,
  type VehicleKnowledge,
} from '@/lib/vehicle-knowledge-base';
import { getModelsForMakeAndVehicleType } from '@/lib/vehicleMaster';

interface VehicleType {
  id: string;
  code: string;
  make: string;
  model: string;
  name: string;
  description: string;
  vehicleGroup: string;
  vehicleClass: string;
  transmissionType: string;
  fuelType: string;
  numPassengers: number;
  maxSpeedKmh: number;
  fuelEfficiencyKml: number;
  costPerKm: number;
  idleFuelConsumption: number;
  co2EmissionFactor: number;
  isActive: boolean;
  notes: string;
}

const EMPTY: Partial<VehicleType> = {
  code: '', make: '', model: '', name: '', description: '',
  vehicleGroup: 'PASSENGER', vehicleClass: 'SEDAN',
  transmissionType: 'AUTOMATIC', fuelType: 'PETROL',
  numPassengers: 5, maxSpeedKmh: 0, fuelEfficiencyKml: 0,
  costPerKm: 0, idleFuelConsumption: 0, co2EmissionFactor: 0,
  isActive: true, notes: '',
};

const VEHICLE_GROUPS = ['PASSENGER', 'LIGHT_COMMERCIAL', 'HEAVY_COMMERCIAL', 'BUS', 'MOTORCYCLE', 'SPECIAL'];

/** Classes available per group — selecting a group resets class to the first in this list */
const GROUP_CLASS_MAP: Record<string, string[]> = {
  PASSENGER:         ['SEDAN', 'SUV', 'HATCHBACK', 'COUPE', 'CONVERTIBLE', 'WAGON', 'CROSSOVER', 'MPV'],
  LIGHT_COMMERCIAL:  ['PICKUP', 'VAN', 'MINIVAN', 'PANEL_VAN', 'CHASSIS_CAB'],
  HEAVY_COMMERCIAL:  ['TRUCK', 'TIPPER', 'FLATBED', 'TANKER', 'BOX_TRUCK', 'TRAILER', 'SEMI_TRAILER'],
  BUS:               ['MINIBUS', 'MIDIBUS', 'FULL_BUS', 'SCHOOL_BUS', 'COACH', 'ARTICULATED_BUS'],
  MOTORCYCLE:        ['MOTORCYCLE', 'SCOOTER', 'MOPED', 'TRIKE'],
  SPECIAL:           ['AMBULANCE', 'FIRE_TRUCK', 'CRANE', 'FORKLIFT', 'EXCAVATOR', 'SWEEPER', 'UTILITY'],
};

/** All unique classes (used for filtering display in the table only) */
const ALL_VEHICLE_CLASSES = Array.from(new Set(Object.values(GROUP_CLASS_MAP).flat()));

const TRANSMISSIONS = ['AUTOMATIC', 'MANUAL', 'CVT', 'SEMI_AUTOMATIC'];
const FUEL_TYPES = ['PETROL', 'DIESEL', 'ELECTRIC', 'HYBRID', 'CNG', 'LPG'];

export default function VehicleTypesPage() {
  const [rows, setRows] = useState<VehicleType[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<VehicleType | null>(null);
  const [form, setForm] = useState<Partial<VehicleType>>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;

  // Smart auto-detection
  const [detectedInfo, setDetectedInfo] = useState<VehicleKnowledge | null>(null);
  const [detectedDismissed, setDetectedDismissed] = useState(false);
  const [autoFilledFields, setAutoFilledFields] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: String(limit), page: String(page) });
    if (search) params.set('search', search);
    if (groupFilter) params.set('vehicleGroup', groupFilter);
    try {
      const res = await fetch('/api/fleet/vehicle-types?' + params);
      const data = await res.json();
      const arr = Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : [];
      setRows(arr);
      setTotal(typeof data.total === 'number' ? data.total : arr.length);
    } catch {
      setError('Failed to load vehicle types');
    } finally {
      setLoading(false);
    }
  }, [search, groupFilter, page]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-detect when Make + Model typed
  useEffect(() => {
    if (!showModal) return;
    const make  = (form.make  ?? '').trim();
    const model = (form.model ?? '').trim();
    if (make.length >= 2 && model.length >= 2) {
      setDetectedInfo(lookupVehicle(make, model));
      setDetectedDismissed(false);
    } else {
      setDetectedInfo(null);
    }
  }, [form.make, form.model, showModal]);

  // Recalculate CO₂ factor when user manually changes Fuel Type (if we know the segment from detection)
  useEffect(() => {
    if (!showModal) return;
    if (!autoFilledFields.has('vehicleGroup')) return; // only if auto-fill was applied
    const seg = detectedInfo?.segment;
    if (!seg) return;
    const updated = getSegmentDefaults(seg, form.fuelType ?? 'PETROL');
    if (updated) {
      setForm(p => ({ ...p, co2EmissionFactor: updated.co2EmissionFactor, idleFuelConsumption: updated.idleFuelConsumption }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.fuelType]);

  const applyDetection = () => {
    if (!detectedInfo) return;
    const fuelType = detectedInfo.fuelType ?? form.fuelType ?? 'PETROL';
    const seg      = detectedInfo.segment;
    const computed = getSegmentDefaults(seg, fuelType);
    const applied: Partial<VehicleType> = {
      vehicleGroup:  detectedInfo.group,
      vehicleClass:  detectedInfo.vehicleClass,
      fuelType,
      numPassengers: detectedInfo.numPassengers ?? form.numPassengers,
    };
    if (computed) {
      applied.costPerKm           = computed.costPerKm;
      applied.idleFuelConsumption = computed.idleFuelConsumption;
      applied.co2EmissionFactor   = computed.co2EmissionFactor;
      applied.fuelEfficiencyKml   = computed.fuelEfficiencyKml;
      applied.maxSpeedKmh         = computed.maxSpeedKmh;
    }
    setForm(p => ({ ...p, ...applied }));
    setAutoFilledFields(new Set(Object.keys(applied)));
    setDetectedDismissed(true);
  };

  const openNew = () => {
    setEditing(null); setForm(EMPTY); setError('');
    setDetectedInfo(null); setDetectedDismissed(false); setAutoFilledFields(new Set());
    setShowModal(true);
  };
  const openEdit = (vt: VehicleType) => {
    setEditing(vt); setForm(vt); setError('');
    setDetectedInfo(null); setDetectedDismissed(false); setAutoFilledFields(new Set());
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.code || !form.name) { setError('Code and Name are required'); return; }
    setSaving(true); setError('');
    try {
      const url = editing ? `/api/fleet/vehicle-types/${editing.id}` : '/api/fleet/vehicle-types';
      const method = editing ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      if (!res.ok) { const d = await res.json(); setError(d.error ?? 'Save failed'); return; }
      setShowModal(false);
      fetchData();
    } catch { setError('Network error'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this vehicle type?')) return;
    await fetch(`/api/fleet/vehicle-types/${id}`, { method: 'DELETE' });
    fetchData();
  };

  const f = (k: keyof VehicleType, v: any) => setForm(p => ({ ...p, [k]: v }));

  const groupBadgeColor: Record<string, string> = {
    PASSENGER: 'bg-blue-500/20 text-blue-300',
    LIGHT_COMMERCIAL: 'bg-amber-500/20 text-amber-300',
    HEAVY_COMMERCIAL: 'bg-orange-500/20 text-orange-300',
    BUS: 'bg-purple-500/20 text-purple-300',
    MOTORCYCLE: 'bg-green-500/20 text-green-300',
    SPECIAL: 'bg-pink-500/20 text-pink-300',
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Vehicle Type Master</h1>
          <p className="text-slate-400 text-sm mt-0.5">Define vehicle categories, specifications, and cost parameters</p>
        </div>
        <button onClick={openNew} className="px-5 py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 text-white rounded-xl font-semibold text-sm hover:opacity-90 transition-opacity flex items-center gap-2">
          <span>+</span> New Vehicle Type
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search code, name, make, model..."
          className="flex-1 min-w-[220px] bg-slate-800/60 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-orange-500/50" />
        <select value={groupFilter} onChange={e => { setGroupFilter(e.target.value); setPage(1); }}
          className="bg-slate-800/60 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500/50">
          <option value="">All Groups</option>
          {VEHICLE_GROUPS.map(g => <option key={g} value={g}>{g.replace(/_/g, ' ')}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-slate-800/40 border border-white/10 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-800/60 border-b border-white/10">
              <tr>
                {['Code', 'Name', 'Make / Model', 'Group', 'Class', 'Transmission', 'Fuel', 'Pax', 'Cost/KM', 'Active', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                <tr><td colSpan={11} className="px-4 py-12 text-center text-slate-500">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={11} className="px-4 py-12 text-center text-slate-500">No vehicle types found. Click "New Vehicle Type" to add one.</td></tr>
              ) : rows.map(vt => (
                <tr key={vt.id} className="hover:bg-white/5 transition-colors">
                  <td className="px-4 py-3">
                    <span className="font-mono text-orange-400 font-semibold text-xs bg-orange-500/10 px-2 py-1 rounded">{vt.code}</span>
                  </td>
                  <td className="px-4 py-3 text-white font-medium">{vt.name}</td>
                  <td className="px-4 py-3 text-slate-300">{[vt.make, vt.model].filter(Boolean).join(' ') || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-lg text-xs font-semibold ${groupBadgeColor[vt.vehicleGroup] ?? 'bg-slate-700 text-slate-300'}`}>
                      {(vt.vehicleGroup ?? '').replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-300 text-xs">{vt.vehicleClass}</td>
                  <td className="px-4 py-3 text-slate-300 text-xs">{vt.transmissionType}</td>
                  <td className="px-4 py-3 text-slate-300 text-xs">{vt.fuelType}</td>
                  <td className="px-4 py-3 text-slate-300 text-center">{vt.numPassengers}</td>
                  <td className="px-4 py-3 text-slate-300 text-right">
                    {vt.costPerKm ? `AED ${Number(vt.costPerKm).toFixed(3)}` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-lg text-xs font-semibold ${vt.isActive ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                      {vt.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      <button onClick={() => openEdit(vt)} className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors">Edit</button>
                      <button onClick={() => handleDelete(vt.id)} className="px-3 py-1.5 text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors">Del</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Pagination */}
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
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="px-6 py-5 border-b border-white/10 flex items-center justify-between sticky top-0 bg-slate-900 z-10">
              <h2 className="text-lg font-semibold text-white">{editing ? 'Edit Vehicle Type' : 'Create New Vehicle Type'}</h2>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white text-2xl leading-none">×</button>
            </div>
            <div className="p-6 space-y-6">
              {error && <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-xl text-sm">{error}</div>}

              {/* Basic Info */}
              <div>
                <h3 className="text-sm font-semibold text-orange-400 uppercase tracking-wider mb-4">Basic Information</h3>

                {/* ── Smart Detection Banner ── */}
                {detectedInfo && !detectedDismissed && (() => {
                  const seg = detectedInfo.segment;
                  const ft  = detectedInfo.fuelType ?? form.fuelType ?? 'PETROL';
                  const computed = getSegmentDefaults(seg, ft);
                  return (
                    <div className="mb-5 bg-gradient-to-r from-blue-600/20 to-cyan-600/20 border border-blue-500/30 rounded-xl p-4">
                      <div className="flex items-start gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-3">
                            <span className="text-base">🤖</span>
                            <span className="text-sm font-semibold text-blue-300">Smart Detection — Vehicle Identified</span>
                            <span className="ml-auto text-xs text-blue-400/70 bg-blue-500/10 px-2 py-0.5 rounded-full">Auto-fill available</span>
                          </div>
                          {/* Row 1: Classification */}
                          <div className="grid grid-cols-4 gap-2 mb-2">
                            <div className="bg-slate-900/70 rounded-lg px-3 py-2">
                              <div className="text-xs text-slate-500 mb-0.5">Group</div>
                              <div className="text-sm font-semibold text-white">{detectedInfo.group.replace(/_/g, ' ')}</div>
                            </div>
                            <div className="bg-slate-900/70 rounded-lg px-3 py-2">
                              <div className="text-xs text-slate-500 mb-0.5">Class</div>
                              <div className="text-sm font-semibold text-white">{detectedInfo.vehicleClass.replace(/_/g, ' ')}</div>
                            </div>
                            <div className="bg-slate-900/70 rounded-lg px-3 py-2">
                              <div className="text-xs text-slate-500 mb-0.5">Fuel Type</div>
                              <div className="text-sm font-semibold text-white">{ft}</div>
                            </div>
                            <div className="bg-slate-900/70 rounded-lg px-3 py-2">
                              <div className="text-xs text-slate-500 mb-0.5">Passengers</div>
                              <div className="text-sm font-semibold text-white">{detectedInfo.numPassengers ?? '—'}</div>
                            </div>
                          </div>
                          {/* Row 2: Cost parameters */}
                          {computed && (
                            <div className="grid grid-cols-4 gap-2">
                              <div className="bg-slate-900/70 rounded-lg px-3 py-2">
                                <div className="text-xs text-slate-500 mb-0.5">Cost / KM</div>
                                <div className="text-sm font-semibold text-amber-300">AED {computed.costPerKm.toFixed(3)}</div>
                              </div>
                              <div className="bg-slate-900/70 rounded-lg px-3 py-2">
                                <div className="text-xs text-slate-500 mb-0.5">Idle Fuel (L/hr)</div>
                                <div className="text-sm font-semibold text-amber-300">{computed.idleFuelConsumption}</div>
                              </div>
                              <div className="bg-slate-900/70 rounded-lg px-3 py-2">
                                <div className="text-xs text-slate-500 mb-0.5">CO₂ (g/km)</div>
                                <div className={`text-sm font-semibold ${computed.co2EmissionFactor === 0 ? 'text-green-400' : 'text-amber-300'}`}>
                                  {computed.co2EmissionFactor === 0 ? '0 ✓ Electric' : computed.co2EmissionFactor}
                                </div>
                              </div>
                              <div className="bg-slate-900/70 rounded-lg px-3 py-2">
                                <div className="text-xs text-slate-500 mb-0.5">Efficiency (km/L)</div>
                                <div className="text-sm font-semibold text-amber-300">{computed.fuelEfficiencyKml || '—'}</div>
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col gap-2 ml-2">
                          <button type="button" onClick={applyDetection}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap">
                            ✓ Apply All
                          </button>
                          <button type="button" onClick={() => setDetectedDismissed(true)}
                            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded-lg transition-colors whitespace-nowrap">
                            Dismiss
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5">Code <span className="text-red-400">*</span></label>
                    <input value={form.code ?? ''} onChange={e => f('code', e.target.value.toUpperCase())}
                      placeholder="e.g. SEDAN-ECO"
                      className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm font-mono focus:outline-none focus:border-orange-500/50" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5">Name <span className="text-red-400">*</span></label>
                    <input value={form.name ?? ''} onChange={e => f('name', e.target.value)}
                      placeholder="e.g. Economy Sedan"
                      className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500/50" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5">Make
                      <span className="ml-1.5 text-slate-600 font-normal normal-case">— triggers smart detection</span>
                    </label>
                    <input
                      list="vt-makes-list"
                      value={form.make ?? ''}
                      onChange={e => setForm((prev) => ({ ...prev, make: e.target.value, model: '' }))}
                      placeholder="e.g. Toyota"
                      className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500/50" />
                    <datalist id="vt-makes-list">
                      {KNOWN_MAKES.map(m => <option key={m} value={m} />)}
                    </datalist>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5">Model
                      <span className="ml-1.5 text-slate-600 font-normal normal-case">— triggers smart detection</span>
                    </label>
                    <input
                      list="vt-models-list"
                      value={form.model ?? ''}
                      onChange={e => f('model', e.target.value)}
                      placeholder="e.g. Fortuner"
                      className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500/50" />
                    <datalist id="vt-models-list">
                      {getModelsForMakeAndVehicleType(form.make ?? '', form.vehicleClass ?? '').map((m) => (
                        <option key={m.model} value={m.model} />
                      ))}
                    </datalist>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs text-slate-400 mb-1.5">Description</label>
                    <textarea value={form.description ?? ''} onChange={e => f('description', e.target.value)} rows={2}
                      className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500/50 resize-none" />
                  </div>
                </div>
              </div>

              {/* Classification */}
              <div>
                <h3 className="text-sm font-semibold text-orange-400 uppercase tracking-wider mb-4">Classification</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="flex items-center gap-2 text-xs text-slate-400 mb-1.5">
                      Vehicle Group
                      {autoFilledFields.has('vehicleGroup') && <span className="text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded text-xs font-medium">Auto-filled</span>}
                    </label>
                    <select
                      value={form.vehicleGroup ?? 'PASSENGER'}
                      onChange={e => {
                        const grp = e.target.value;
                        const firstClass = GROUP_CLASS_MAP[grp]?.[0] ?? '';
                        setAutoFilledFields(prev => { const s = new Set(prev); s.delete('vehicleGroup'); s.delete('vehicleClass'); return s; });
                        setForm(p => ({ ...p, vehicleGroup: grp, vehicleClass: firstClass }));
                      }}
                      className={`w-full bg-slate-800 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none ${autoFilledFields.has('vehicleGroup') ? 'border border-blue-500/50' : 'border border-white/10 focus:border-orange-500/50'}`}>
                      {VEHICLE_GROUPS.map(g => <option key={g} value={g}>{g.replace(/_/g, ' ')}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="flex items-center gap-2 text-xs text-slate-400 mb-1.5">
                      Vehicle Class
                      {form.vehicleGroup && !autoFilledFields.has('vehicleClass') && (
                        <span className="text-orange-400/60 normal-case font-normal">
                          ({GROUP_CLASS_MAP[form.vehicleGroup]?.length ?? 0} for {form.vehicleGroup.replace(/_/g, ' ')})
                        </span>
                      )}
                      {autoFilledFields.has('vehicleClass') && <span className="text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded text-xs font-medium">Auto-filled</span>}
                    </label>
                    <select value={form.vehicleClass ?? ''}
                      onChange={e => {
                        const nextVehicleClass = e.target.value;
                        setAutoFilledFields(prev => { const s = new Set(prev); s.delete('vehicleClass'); return s; });
                        setForm((prev) => {
                          const modelStillValid = !prev.model
                            || getModelsForMakeAndVehicleType(prev.make ?? '', nextVehicleClass).some((m) => m.model === prev.model);
                          return {
                            ...prev,
                            vehicleClass: nextVehicleClass,
                            model: modelStillValid ? prev.model : '',
                          };
                        });
                      }}
                      className={`w-full bg-slate-800 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none ${autoFilledFields.has('vehicleClass') ? 'border border-blue-500/50' : 'border border-white/10 focus:border-orange-500/50'}`}>
                      {(GROUP_CLASS_MAP[form.vehicleGroup ?? ''] ?? ALL_VEHICLE_CLASSES).map(c => (
                        <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5">Transmission Type</label>
                    <select value={form.transmissionType ?? 'AUTOMATIC'} onChange={e => f('transmissionType', e.target.value)}
                      className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500/50">
                      {TRANSMISSIONS.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="flex items-center gap-2 text-xs text-slate-400 mb-1.5">
                      Fuel Type
                      {autoFilledFields.has('fuelType') && <span className="text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded text-xs font-medium">Auto-filled · CO₂ recalculates on change</span>}
                    </label>
                    <select value={form.fuelType ?? 'PETROL'}
                      onChange={e => { setAutoFilledFields(prev => { const s = new Set(prev); s.delete('fuelType'); return s; }); f('fuelType', e.target.value); }}
                      className={`w-full bg-slate-800 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none ${autoFilledFields.has('fuelType') ? 'border border-blue-500/50' : 'border border-white/10 focus:border-orange-500/50'}`}>
                      {FUEL_TYPES.map(ft => <option key={ft} value={ft}>{ft}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {/* Specs */}
              <div>
                <h3 className="text-sm font-semibold text-orange-400 uppercase tracking-wider mb-4">Technical Specifications</h3>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="flex items-center gap-2 text-xs text-slate-400 mb-1.5">
                      Passengers
                      {autoFilledFields.has('numPassengers') && <span className="text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded text-xs font-medium">Auto-filled</span>}
                    </label>
                    <input type="number" value={form.numPassengers ?? 5}
                      onChange={e => { setAutoFilledFields(prev => { const s = new Set(prev); s.delete('numPassengers'); return s; }); f('numPassengers', Number(e.target.value)); }}
                      className={`w-full bg-slate-800 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none ${autoFilledFields.has('numPassengers') ? 'border border-blue-500/50' : 'border border-white/10 focus:border-orange-500/50'}`} />
                  </div>
                  <div>
                    <label className="flex items-center gap-2 text-xs text-slate-400 mb-1.5">
                      Max Speed (km/h)
                      {autoFilledFields.has('maxSpeedKmh') && <span className="text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded text-xs font-medium">Auto-filled</span>}
                    </label>
                    <input type="number" value={form.maxSpeedKmh ?? 0}
                      onChange={e => { setAutoFilledFields(prev => { const s = new Set(prev); s.delete('maxSpeedKmh'); return s; }); f('maxSpeedKmh', Number(e.target.value)); }}
                      className={`w-full bg-slate-800 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none ${autoFilledFields.has('maxSpeedKmh') ? 'border border-blue-500/50' : 'border border-white/10 focus:border-orange-500/50'}`} />
                  </div>
                  <div>
                    <label className="flex items-center gap-2 text-xs text-slate-400 mb-1.5">
                      Fuel Efficiency (km/L)
                      {autoFilledFields.has('fuelEfficiencyKml') && <span className="text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded text-xs font-medium">Auto-filled</span>}
                    </label>
                    <input type="number" step="0.1" value={form.fuelEfficiencyKml ?? 0}
                      onChange={e => { setAutoFilledFields(prev => { const s = new Set(prev); s.delete('fuelEfficiencyKml'); return s; }); f('fuelEfficiencyKml', Number(e.target.value)); }}
                      className={`w-full bg-slate-800 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none ${autoFilledFields.has('fuelEfficiencyKml') ? 'border border-blue-500/50' : 'border border-white/10 focus:border-orange-500/50'}`} />
                  </div>
                </div>
              </div>

              {/* Cost Parameters */}
              <div>
                <h3 className="text-sm font-semibold text-orange-400 uppercase tracking-wider mb-4">
                  Cost Parameters
                  {(autoFilledFields.has('costPerKm') || autoFilledFields.has('idleFuelConsumption') || autoFilledFields.has('co2EmissionFactor')) && (
                    <span className="ml-3 text-xs text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-full font-medium normal-case">
                      ✓ Populated from segment benchmarks · Fuel Type change recalculates CO₂
                    </span>
                  )}
                </h3>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="flex items-center gap-2 text-xs text-slate-400 mb-1.5">
                      Cost per KM (AED)
                      {autoFilledFields.has('costPerKm') && <span className="text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded text-xs font-medium">Auto-filled</span>}
                    </label>
                    <input type="number" step="0.001" value={form.costPerKm ?? 0}
                      onChange={e => { setAutoFilledFields(prev => { const s = new Set(prev); s.delete('costPerKm'); return s; }); f('costPerKm', Number(e.target.value)); }}
                      className={`w-full bg-slate-800 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none ${autoFilledFields.has('costPerKm') ? 'border border-blue-500/50' : 'border border-white/10 focus:border-orange-500/50'}`} />
                  </div>
                  <div>
                    <label className="flex items-center gap-2 text-xs text-slate-400 mb-1.5">
                      Idle Fuel Consumption (L/hr)
                      {autoFilledFields.has('idleFuelConsumption') && <span className="text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded text-xs font-medium">Auto-filled</span>}
                    </label>
                    <input type="number" step="0.1" value={form.idleFuelConsumption ?? 0}
                      onChange={e => { setAutoFilledFields(prev => { const s = new Set(prev); s.delete('idleFuelConsumption'); return s; }); f('idleFuelConsumption', Number(e.target.value)); }}
                      className={`w-full bg-slate-800 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none ${autoFilledFields.has('idleFuelConsumption') ? 'border border-blue-500/50' : 'border border-white/10 focus:border-orange-500/50'}`} />
                  </div>
                  <div>
                    <label className="flex items-center gap-2 text-xs text-slate-400 mb-1.5">
                      CO₂ Emission Factor (g/km)
                      {autoFilledFields.has('co2EmissionFactor') && <span className="text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded text-xs font-medium">Auto-filled</span>}
                    </label>
                    <input type="number" step="1" value={form.co2EmissionFactor ?? 0}
                      onChange={e => { setAutoFilledFields(prev => { const s = new Set(prev); s.delete('co2EmissionFactor'); return s; }); f('co2EmissionFactor', Number(e.target.value)); }}
                      className={`w-full bg-slate-800 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none ${autoFilledFields.has('co2EmissionFactor') ? 'border border-blue-500/50' : 'border border-white/10 focus:border-orange-500/50'}`} />
                    {autoFilledFields.has('co2EmissionFactor') && (
                      <p className="mt-1 text-xs text-slate-500">Adjusted for {form.fuelType} · Changes automatically if Fuel Type changes</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Notes & Status */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">Notes</label>
                  <textarea value={form.notes ?? ''} onChange={e => f('notes', e.target.value)} rows={3}
                    className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500/50 resize-none" />
                </div>
                <div className="flex flex-col justify-center">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <div className={`w-12 h-6 rounded-full transition-colors ${form.isActive ? 'bg-orange-500' : 'bg-slate-600'}`}
                      onClick={() => f('isActive', !form.isActive)}>
                      <div className={`w-5 h-5 bg-white rounded-full m-0.5 transition-transform ${form.isActive ? 'translate-x-6' : 'translate-x-0'}`} />
                    </div>
                    <span className="text-sm text-slate-300">Active</span>
                  </label>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-white/10 flex justify-end gap-3 sticky bottom-0 bg-slate-900">
              <button onClick={() => setShowModal(false)} className="px-5 py-2.5 text-sm text-slate-400 hover:text-white transition-colors">Cancel</button>
              <button onClick={handleSave} disabled={saving}
                className="px-6 py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 text-white rounded-xl font-semibold text-sm hover:opacity-90 disabled:opacity-50 transition-opacity">
                {saving ? 'Saving…' : editing ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
