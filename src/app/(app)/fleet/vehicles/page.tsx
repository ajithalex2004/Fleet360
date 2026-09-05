'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { lookupVehicle, KNOWN_MAKES, getModelsForMake, type VehicleKnowledge } from '@/lib/vehicle-knowledge-base';
import SlideOverDrawer, { DrawerTab, DrawerAction } from '@/components/ui/SlideOverDrawer';
import { 
  Car, 
  Cpu, 
  FileText, 
  Wrench, 
  UserCheck, 
  MapPin, 
  Fuel, 
  Gauge, 
  Shield, 
  Calendar,
  Code,
  Edit2,
  Trash2
} from 'lucide-react';

interface Vehicle {
  id: string;
  vehicleCode: string;
  make: string;
  model: string;
  year: number;
  licensePlate: string;
  status: string;
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
  zoneId: string;
  zoneName: string;
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
interface ZonePlace { id: string; name: string; }

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
  VAN:           'bg-slate-500/15 text-[var(--text-muted)] border border-slate-500/20',
  PICKUP:        'bg-yellow-500/15 text-yellow-400 border border-yellow-500/20',
  BUS:           'bg-purple-500/15 text-purple-400 border border-purple-500/20',
  SPECIAL:       'bg-pink-500/15 text-pink-400 border border-pink-500/20',
};

const statusColor: Record<string, string> = {
  AVAILABLE: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  RENTED: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  MAINTENANCE: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  RESERVED: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  INACTIVE: 'bg-slate-500/20 text-[var(--text-muted)] border-slate-500/30',
  SOLD: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
};

export default function VehiclesPage() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehicleTypes, setVehicleTypes] = useState<VehicleType[]>([]);
  const [zones, setZones] = useState<ZonePlace[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [usageFilter, setUsageFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [zoneFilter, setZoneFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [form, setForm] = useState<Partial<Vehicle>>(EMPTY_VEHICLE);
  const [tab, setTab] = useState<'basic' | 'fleet' | 'documents'>('basic');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;

  // Slide-over drawer state
  const [inspectingVehicle, setInspectingVehicle] = useState<Vehicle | null>(null);
  const [drawerTab, setDrawerTab] = useState<string>('overview');

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
    if (zoneFilter) params.set('zoneId', zoneFilter);
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
  }, [search, statusFilter, usageFilter, categoryFilter, zoneFilter, page]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    fetch('/api/places?type=OPERATIONAL_ZONE')
      .then(r => r.json())
      .then(d => setZones(Array.isArray(d) ? d : []))
      .catch(() => setZones([]));
  }, []);

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
    setForm(p => ({
      ...p,
      category: detectedInfo.segment,
    }));
    setDetectedDismissed(true);
  };

  const openNew = () => {
    setEditing(null);
    setForm(EMPTY_VEHICLE);
    setTab('basic');
    setDetectedInfo(null);
    setDetectedDismissed(false);
    setShowModal(true);
  };

  const openEdit = (v: Vehicle) => {
    setEditing(v);
    setForm({ ...v });
    setTab('basic');
    setDetectedInfo(null);
    setDetectedDismissed(true);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.make || !form.model) { setError('Make and Model are required'); return; }
    setSaving(true); setError('');
    try {
      const url = editing ? `/api/fleet/vehicles/${editing.id}` : '/api/fleet/vehicles';
      const method = editing ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      if (!res.ok) { const d = await res.json(); setError(d.error ?? 'Save failed'); return; }
      setShowModal(false); 
      fetchData();
    } catch { setError('Network error'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this vehicle?')) return;
    await fetch(`/api/fleet/vehicles/${id}`, { method: 'DELETE' });
    if (inspectingVehicle?.id === id) setInspectingVehicle(null);
    fetchData();
  };

  const f = (k: keyof Vehicle, v: Vehicle[keyof Vehicle]) => setForm(p => ({ ...p, [k]: v }));
  const vtName = (id: string) => vehicleTypes.find(vt => vt.id === id)?.name ?? '—';

  const DRAWER_TABS: DrawerTab[] = [
    { id: 'overview', label: 'Overview', icon: <Car className="w-3.5 h-3.5" /> },
    { id: 'telematics', label: 'Telematics & Driver', icon: <Cpu className="w-3.5 h-3.5" /> },
    { id: 'documents', label: 'Documents & Expiry', icon: <FileText className="w-3.5 h-3.5" /> },
    { id: 'json', label: 'Raw Payload', icon: <Code className="w-3.5 h-3.5" /> },
  ];

  const getDrawerActions = (v: Vehicle): DrawerAction[] => [
    {
      label: 'Edit Vehicle',
      icon: <Edit2 className="w-3.5 h-3.5" />,
      variant: 'primary',
      onClick: () => {
        setInspectingVehicle(null);
        openEdit(v);
      },
    },
    {
      label: 'Delete',
      icon: <Trash2 className="w-3.5 h-3.5" />,
      variant: 'danger',
      onClick: () => handleDelete(v.id),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-main)]">Vehicle Master</h1>
          <p className="text-[var(--text-muted)] text-xs mt-0.5">Manage fleet vehicles, registration, and lifecycle tracking</p>
        </div>
        <button onClick={openNew} className="px-4 py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 text-white rounded-xl font-semibold text-xs hover:opacity-90 transition-opacity flex items-center gap-2 shadow-sm">
          <span>+</span> Add Vehicle
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2.5 flex-wrap">
        <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search vehicle code, plate, make, model…"
          className="flex-1 min-w-[220px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-4 py-2 text-[var(--text-main)] text-xs placeholder-[var(--text-muted)] focus:outline-none focus:border-orange-500/50" />
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-[var(--text-main)] text-xs focus:outline-none">
          <option value="">All Status</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={usageFilter} onChange={e => { setUsageFilter(e.target.value); setPage(1); }}
          className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-[var(--text-main)] text-xs focus:outline-none">
          <option value="">All Usage</option>
          {USAGES.map(u => <option key={u} value={u}>{u.replace(/_/g, ' ')}</option>)}
        </select>
        <select value={categoryFilter} onChange={e => { setCategoryFilter(e.target.value); setPage(1); }}
          className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-[var(--text-main)] text-xs focus:outline-none">
          <option value="">All Segments</option>
          {VEHICLE_SEGMENTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select value={zoneFilter} onChange={e => { setZoneFilter(e.target.value); setPage(1); }}
          className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-[var(--text-main)] text-xs focus:outline-none">
          <option value="">All Zones</option>
          {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--bg-surface-hover)]/50 border-b border-[var(--border-subtle)]">
              <tr>
                {['Vehicle Code', 'Make / Model', 'Segment', 'Plate No.', 'Type', 'Usage', 'Lifecycle', 'Status', 'Odometer', 'Fuel', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {loading ? (
                <tr><td colSpan={11} className="px-4 py-12 text-center text-[var(--text-muted)] text-sm">Loading fleet inventory…</td></tr>
              ) : vehicles.length === 0 ? (
                <tr><td colSpan={11} className="px-4 py-12 text-center text-[var(--text-muted)] text-sm">No vehicles found. Click &quot;Add Vehicle&quot; to get started.</td></tr>
              ) : vehicles.map(v => (
                <tr 
                  key={v.id} 
                  onClick={() => { setInspectingVehicle(v); setDrawerTab('overview'); }}
                  className="hover:bg-[var(--bg-surface-hover)] transition-colors cursor-pointer group"
                >
                  <td className="px-4 py-3">
                    <span className="font-mono text-orange-500 font-semibold text-xs bg-orange-500/10 border border-orange-500/20 px-2 py-0.5 rounded">{v.vehicleCode || '—'}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-[var(--text-main)] font-semibold text-xs">{v.make} {v.model}</div>
                    <div className="text-[var(--text-muted)] text-[11px]">{v.yearOfManufacture || v.year || ''} • {v.color || ''}</div>
                  </td>
                  <td className="px-4 py-3">
                    {v.category ? (
                      <span className={`px-2 py-0.5 rounded-md text-[11px] font-semibold ${segmentColor[v.category] ?? 'bg-[var(--bg-surface-hover)]/60 text-[var(--text-muted)]'}`}>
                        {VEHICLE_SEGMENTS.find(s => s.value === v.category)?.label ?? v.category}
                      </span>
                    ) : <span className="text-[var(--text-muted)] text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3 font-mono text-[var(--text-main)] text-xs">{v.plateNumber || v.licensePlate || '—'}</td>
                  <td className="px-4 py-3 text-[var(--text-muted)] text-xs">{v.vehicleTypeId ? vtName(v.vehicleTypeId) : '—'}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-[var(--text-muted)]">{(v.vehicleUsage ?? '').replace(/_/g, ' ')}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-muted)]">{v.lifecycleStage || '—'}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${statusColor[v.status] ?? 'bg-[var(--bg-surface-hover)] text-[var(--text-muted)]'}`}>{v.status}</span>
                  </td>
                  <td className="px-4 py-3 text-[var(--text-main)] text-xs font-mono">{v.odometerReading?.toLocaleString() ?? 0} km</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-14 h-1.5 bg-[var(--border-subtle)] rounded-full overflow-hidden">
                        <div className="h-full bg-orange-500 rounded-full" style={{ width: `${v.fuelLevel ?? 0}%` }} />
                      </div>
                      <span className="text-[11px] text-[var(--text-muted)] font-mono">{v.fuelLevel ?? 0}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-1.5 justify-end">
                      <button 
                        onClick={() => { setInspectingVehicle(v); setDrawerTab('overview'); }}
                        className="px-2.5 py-1 text-xs bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)] text-[var(--text-main)] rounded-lg transition-colors"
                      >
                        Inspect ↗
                      </button>
                      <button onClick={() => openEdit(v)} className="px-2.5 py-1 text-xs bg-[var(--bg-surface-hover)]/50 hover:bg-[var(--bg-surface-hover)] text-[var(--text-main)] rounded-lg transition-colors">Edit</button>
                      <button onClick={() => handleDelete(v.id)} className="px-2.5 py-1 text-xs bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 rounded-lg transition-colors">Del</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {total > limit && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)]">
            <span className="text-xs text-[var(--text-muted)]">Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}</span>
            <div className="flex gap-2">
              <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1.5 text-xs bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] disabled:opacity-40 text-[var(--text-main)] rounded-lg">Prev</button>
              <button disabled={page * limit >= total} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 text-xs bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] disabled:opacity-40 text-[var(--text-main)] rounded-lg">Next</button>
            </div>
          </div>
        )}
      </div>

      {/* Slide-Over Inspector Drawer for Vehicle */}
      {inspectingVehicle && (
        <SlideOverDrawer
          isOpen={!!inspectingVehicle}
          onClose={() => setInspectingVehicle(null)}
          title={`${inspectingVehicle.make} ${inspectingVehicle.model} (${inspectingVehicle.yearOfManufacture || inspectingVehicle.year || '—'})`}
          subtitle={`Code: ${inspectingVehicle.vehicleCode || inspectingVehicle.id.slice(0, 8)} • Plate: ${inspectingVehicle.plateNumber || inspectingVehicle.licensePlate || 'N/A'}`}
          badge={{
            text: inspectingVehicle.status,
            variant: (inspectingVehicle.status === 'AVAILABLE' ? 'emerald' : inspectingVehicle.status === 'RENTED' ? 'blue' : inspectingVehicle.status === 'MAINTENANCE' ? 'amber' : 'slate'),
          }}
          tabs={DRAWER_TABS}
          activeTab={drawerTab}
          onTabChange={setDrawerTab}
          actions={getDrawerActions(inspectingVehicle)}
          width="xl"
        >
          {drawerTab === 'overview' && (
            <div className="space-y-6">
              {/* Highlights cards */}
              <div className="grid grid-cols-3 gap-3 p-4 rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)]">
                <div>
                  <div className="text-[11px] text-[var(--text-muted)] uppercase font-semibold">Segment</div>
                  <div className="text-sm font-bold text-orange-500 mt-0.5">
                    {VEHICLE_SEGMENTS.find(s => s.value === inspectingVehicle.category)?.label ?? inspectingVehicle.category ?? '—'}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-[var(--text-muted)] uppercase font-semibold">Odometer</div>
                  <div className="text-sm font-bold text-[var(--text-main)] mt-0.5">
                    {inspectingVehicle.odometerReading?.toLocaleString() ?? 0} km
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-[var(--text-muted)] uppercase font-semibold">Fuel Level</div>
                  <div className="text-sm font-bold text-emerald-500 mt-0.5">
                    {inspectingVehicle.fuelLevel ?? 0}%
                  </div>
                </div>
              </div>

              {/* Specs Grid */}
              <div>
                <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-3">Vehicle Details</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                    <div className="text-xs text-[var(--text-muted)]">Chassis No. (VIN)</div>
                    <div className="text-xs font-mono font-bold text-[var(--text-main)] mt-1">{inspectingVehicle.chassisNo || 'Not specified'}</div>
                  </div>
                  <div className="p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                    <div className="text-xs text-[var(--text-muted)]">Color</div>
                    <div className="text-xs font-bold text-[var(--text-main)] mt-1">{inspectingVehicle.color || 'Not specified'}</div>
                  </div>
                  <div className="p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                    <div className="text-xs text-[var(--text-muted)]">Acquisition Type</div>
                    <div className="text-xs font-bold text-[var(--text-main)] mt-1">{inspectingVehicle.acquisitionType || 'PURCHASE'}</div>
                  </div>
                  <div className="p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                    <div className="text-xs text-[var(--text-muted)]">Purchase Price</div>
                    <div className="text-xs font-bold text-[var(--text-main)] mt-1">
                      {inspectingVehicle.purchasePrice ? `AED ${Number(inspectingVehicle.purchasePrice).toLocaleString()}` : '—'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Branch & Usage */}
              <div>
                <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-3">Branch & Allocation</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                    <div className="text-xs text-[var(--text-muted)]">Branch</div>
                    <div className="text-xs font-bold text-[var(--text-main)] mt-1">{inspectingVehicle.branchName || 'Main Headquarters'}</div>
                  </div>
                  <div className="p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                    <div className="text-xs text-[var(--text-muted)]">Usage Category</div>
                    <div className="text-xs font-bold text-[var(--text-main)] mt-1">{inspectingVehicle.vehicleUsage || 'RENTAL'}</div>
                  </div>
                </div>
              </div>

              {/* Notes */}
              {inspectingVehicle.notes && (
                <div>
                  <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Notes</h3>
                  <div className="p-3.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface-hover)] text-xs text-[var(--text-main)] leading-relaxed">
                    {inspectingVehicle.notes}
                  </div>
                </div>
              )}
            </div>
          )}

          {drawerTab === 'telematics' && (
            <div className="space-y-5">
              <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface-hover)] flex items-center justify-between">
                <div>
                  <div className="text-xs text-[var(--text-muted)] uppercase font-semibold">GPS Telematics Unit</div>
                  <div className="text-sm font-mono font-bold text-[var(--text-main)] mt-0.5">
                    {inspectingVehicle.deviceId || 'No Device Linked'}
                  </div>
                </div>
                <div className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  {inspectingVehicle.deviceId ? 'Signal Active' : 'Offline'}
                </div>
              </div>

              <div className="space-y-3">
                <div className="p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] flex justify-between items-center">
                  <span className="text-xs text-[var(--text-muted)]">SIM Card No.</span>
                  <span className="text-xs font-mono font-semibold text-[var(--text-main)]">{inspectingVehicle.simCardNo || '—'}</span>
                </div>
                <div className="p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] flex justify-between items-center">
                  <span className="text-xs text-[var(--text-muted)]">Assigned Driver</span>
                  <span className="text-xs font-semibold text-[var(--text-main)]">{inspectingVehicle.assignedDriverId || 'Unassigned / Customer Rented'}</span>
                </div>
                <div className="p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] flex justify-between items-center">
                  <span className="text-xs text-[var(--text-muted)]">Operational Zone</span>
                  <span className="text-xs font-semibold text-[var(--text-main)]">{inspectingVehicle.zoneName || 'All UAE Zones'}</span>
                </div>
              </div>
            </div>
          )}

          {drawerTab === 'documents' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-base">📋</span>
                    <span className="text-xs font-bold text-[var(--text-main)]">Registration (Mulkiya)</span>
                  </div>
                  {inspectingVehicle.registrationExpiryDate && (
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${
                      new Date(inspectingVehicle.registrationExpiryDate) < new Date() ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    }`}>
                      {new Date(inspectingVehicle.registrationExpiryDate) < new Date() ? 'Expired' : 'Valid'}
                    </span>
                  )}
                </div>
                <div className="text-xs text-[var(--text-muted)]">
                  Expiry Date: <span className="font-semibold text-[var(--text-main)]">{inspectingVehicle.registrationExpiryDate ? new Date(inspectingVehicle.registrationExpiryDate).toLocaleDateString() : 'Not recorded'}</span>
                </div>
              </div>

              <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-base">🛡️</span>
                    <span className="text-xs font-bold text-[var(--text-main)]">Insurance Policy</span>
                  </div>
                  {inspectingVehicle.insuranceExpiryDate && (
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${
                      new Date(inspectingVehicle.insuranceExpiryDate) < new Date() ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    }`}>
                      {new Date(inspectingVehicle.insuranceExpiryDate) < new Date() ? 'Expired' : 'Valid'}
                    </span>
                  )}
                </div>
                <div className="text-xs text-[var(--text-muted)]">
                  Expiry Date: <span className="font-semibold text-[var(--text-main)]">{inspectingVehicle.insuranceExpiryDate ? new Date(inspectingVehicle.insuranceExpiryDate).toLocaleDateString() : 'Not recorded'}</span>
                </div>
              </div>
            </div>
          )}

          {drawerTab === 'json' && (
            <div className="p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface-hover)] font-mono text-[11px] text-[var(--text-muted)] overflow-x-auto">
              <pre>{JSON.stringify(inspectingVehicle, null, 2)}</pre>
            </div>
          )}
        </SlideOverDrawer>
      )}

      {/* Add / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl">
            {/* Modal Header */}
            <div className="px-6 py-5 border-b border-[var(--border-subtle)] flex items-center justify-between flex-shrink-0">
              <div>
                <h2 className="text-lg font-semibold text-[var(--text-main)]">{editing ? `Edit Vehicle — ${editing.vehicleCode || editing.make}` : 'Add New Vehicle'}</h2>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">Fill in the vehicle details across sections</p>
              </div>
              <button onClick={() => setShowModal(false)} className="text-[var(--text-muted)] hover:text-[var(--text-main)] text-2xl leading-none">×</button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-[var(--border-subtle)] flex-shrink-0">
              {(['basic', 'fleet', 'documents'] as const).map(t => (
                <button key={t} onClick={() => setTab(t)}
                  className={`px-6 py-3 text-xs font-semibold transition-colors border-b-2 ${tab === t ? 'border-orange-500 text-orange-500' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-main)]'}`}>
                  {t === 'basic' ? '📋 Basic Details' : t === 'fleet' ? '🚗 Fleet Assignment' : '📄 Documents & Dates'}
                </button>
              ))}
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {error && <div className="bg-rose-500/10 border border-rose-500/30 text-rose-400 px-4 py-3 rounded-xl text-xs">{error}</div>}

              {/* TAB: Basic Details */}
              {tab === 'basic' && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-xs font-bold text-orange-500 uppercase tracking-wider mb-4">Vehicle Identification</h3>
                    {detectedInfo && !detectedDismissed && (
                      <div className="mb-4 bg-gradient-to-r from-blue-600/15 to-cyan-600/15 border border-blue-500/30 rounded-xl p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-blue-400 text-base">🤖</span>
                              <span className="text-xs font-bold text-blue-300">Smart Detection — Vehicle Identified</span>
                            </div>
                            <div className="grid grid-cols-4 gap-3 mt-3">
                              <div className="bg-[var(--bg-surface)] rounded-lg px-3 py-2 border border-[var(--border-subtle)]">
                                <div className="text-[10px] text-[var(--text-muted)] mb-0.5">Segment</div>
                                <div className="text-xs font-bold text-[var(--text-main)]">
                                  {VEHICLE_SEGMENTS.find(s => s.value === detectedInfo.segment)?.label ?? detectedInfo.segment}
                                </div>
                              </div>
                              <div className="bg-[var(--bg-surface)] rounded-lg px-3 py-2 border border-[var(--border-subtle)]">
                                <div className="text-[10px] text-[var(--text-muted)] mb-0.5">Group</div>
                                <div className="text-xs font-bold text-[var(--text-main)]">{detectedInfo.group.replace(/_/g, ' ')}</div>
                              </div>
                              <div className="bg-[var(--bg-surface)] rounded-lg px-3 py-2 border border-[var(--border-subtle)]">
                                <div className="text-[10px] text-[var(--text-muted)] mb-0.5">Class</div>
                                <div className="text-xs font-bold text-[var(--text-main)]">{detectedInfo.vehicleClass.replace(/_/g, ' ')}</div>
                              </div>
                              <div className="bg-[var(--bg-surface)] rounded-lg px-3 py-2 border border-[var(--border-subtle)]">
                                <div className="text-[10px] text-[var(--text-muted)] mb-0.5">Suggested Type</div>
                                <div className="text-xs font-bold text-[var(--text-main)]">{detectedInfo.suggestedType}</div>
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-col gap-2">
                            <button type="button" onClick={applyDetection}
                              className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shadow-sm">
                              ✓ Apply
                            </button>
                            <button type="button" onClick={() => setDetectedDismissed(true)}
                              className="px-3.5 py-1.5 bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-main)] text-xs rounded-lg transition-colors whitespace-nowrap">
                              Dismiss
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Vehicle Code</label>
                        <input value={form.vehicleCode ?? ''} onChange={e => f('vehicleCode', e.target.value.toUpperCase())}
                          placeholder="Auto-generated"
                          className="w-full bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-[var(--text-main)] text-xs font-mono focus:outline-none focus:border-orange-500/50" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Make <span className="text-rose-400">*</span></label>
                        <input
                          list="makes-list"
                          value={form.make ?? ''}
                          onChange={e => f('make', e.target.value)}
                          placeholder="e.g. Toyota"
                          className="w-full bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-[var(--text-main)] text-xs focus:outline-none focus:border-orange-500/50" />
                        <datalist id="makes-list">
                          {KNOWN_MAKES.map(m => <option key={m} value={m} />)}
                        </datalist>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Model <span className="text-rose-400">*</span></label>
                        <input
                          list="models-list"
                          value={form.model ?? ''}
                          onChange={e => f('model', e.target.value)}
                          placeholder="e.g. Camry"
                          className="w-full bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-[var(--text-main)] text-xs focus:outline-none focus:border-orange-500/50" />
                        <datalist id="models-list">
                          {getModelsForMake(form.make ?? '').map(m => <option key={m} value={m} />)}
                        </datalist>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-xs font-bold text-orange-500 uppercase tracking-wider mb-4">Registration & Number Plate</h3>
                    <div className="grid grid-cols-4 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Emirate</label>
                        <select value={form.emirate ?? 'DUBAI'} onChange={e => f('emirate', e.target.value)}
                          className="w-full bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-[var(--text-main)] text-xs focus:outline-none focus:border-orange-500/50">
                          {EMIRATES.map(em => <option key={em} value={em}>{em.replace(/_/g, ' ')}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Plate Code</label>
                        <input value={form.plateCode ?? ''} onChange={e => f('plateCode', e.target.value.toUpperCase())}
                          placeholder="e.g. A, B, 1"
                          className="w-full bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-[var(--text-main)] text-xs font-mono uppercase focus:outline-none focus:border-orange-500/50" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Plate Number</label>
                        <input value={form.plateNumber ?? form.licensePlate ?? ''} onChange={e => { f('plateNumber', e.target.value); f('licensePlate', e.target.value); }}
                          placeholder="e.g. 12345"
                          className="w-full bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-[var(--text-main)] text-xs font-mono focus:outline-none focus:border-orange-500/50" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Plate Category</label>
                        <select value={form.plateCategory ?? 'PRIVATE'} onChange={e => f('plateCategory', e.target.value)}
                          className="w-full bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-[var(--text-main)] text-xs focus:outline-none focus:border-orange-500/50">
                          {PLATE_CATS.map(pc => <option key={pc} value={pc}>{pc}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-xs font-bold text-orange-500 uppercase tracking-wider mb-4">Classification & Commercial Status</h3>
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Vehicle Segment</label>
                        <select value={form.category ?? ''} onChange={e => f('category', e.target.value)}
                          className="w-full bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-[var(--text-main)] text-xs focus:outline-none focus:border-orange-500/50">
                          <option value="">— Select Segment —</option>
                          {VEHICLE_SEGMENTS.map(s => <option key={s.value} value={s.value}>{s.label} ({s.desc})</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Color</label>
                        <input value={form.color ?? ''} onChange={e => f('color', e.target.value)} placeholder="e.g. White"
                          className="w-full bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-[var(--text-main)] text-xs focus:outline-none focus:border-orange-500/50" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Status</label>
                        <select value={form.status ?? 'AVAILABLE'} onChange={e => f('status', e.target.value)}
                          className="w-full bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-[var(--text-main)] text-xs focus:outline-none focus:border-orange-500/50">
                          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB: Fleet Assignment */}
              {tab === 'fleet' && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-xs font-bold text-orange-500 uppercase tracking-wider mb-4">Fleet Configuration</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Vehicle Type</label>
                        <select value={form.vehicleTypeId ?? ''} onChange={e => f('vehicleTypeId', e.target.value)}
                          className="w-full bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-[var(--text-main)] text-xs focus:outline-none focus:border-orange-500/50">
                          <option value="">— Select Type —</option>
                          {vehicleTypes.map(vt => <option key={vt.id} value={vt.id}>{vt.name} ({vt.code})</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Vehicle Usage</label>
                        <select value={form.vehicleUsage ?? 'RENTAL'} onChange={e => f('vehicleUsage', e.target.value)}
                          className="w-full bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-[var(--text-main)] text-xs focus:outline-none focus:border-orange-500/50">
                          {USAGES.map(u => <option key={u} value={u}>{u.replace(/_/g, ' ')}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Lifecycle Stage</label>
                        <select value={form.lifecycleStage ?? 'ACTIVE'} onChange={e => f('lifecycleStage', e.target.value)}
                          className="w-full bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-[var(--text-main)] text-xs focus:outline-none focus:border-orange-500/50">
                          {LIFECYCLE_STAGES.map(l => <option key={l} value={l}>{l.replace(/_/g, ' ')}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Branch / Location</label>
                        <input value={form.branchName ?? ''} onChange={e => f('branchName', e.target.value)}
                          placeholder="e.g. Dubai Airport"
                          className="w-full bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-[var(--text-main)] text-xs focus:outline-none focus:border-orange-500/50" />
                      </div>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-xs font-bold text-orange-500 uppercase tracking-wider mb-4">Telematics & Hardware</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Device ID / IMEI</label>
                        <input value={form.deviceId ?? ''} onChange={e => f('deviceId', e.target.value)}
                          placeholder="GPS/telematics device ID"
                          className="w-full bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-[var(--text-main)] text-xs font-mono focus:outline-none focus:border-orange-500/50" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">SIM Card No.</label>
                        <input value={form.simCardNo ?? ''} onChange={e => f('simCardNo', e.target.value)}
                          placeholder="SIM number"
                          className="w-full bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-[var(--text-main)] text-xs font-mono focus:outline-none focus:border-orange-500/50" />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB: Documents */}
              {tab === 'documents' && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-xs font-bold text-orange-500 uppercase tracking-wider mb-4">Document Expiry Dates</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-[var(--bg-surface-hover)]/50 border border-[var(--border-subtle)] rounded-xl p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <span className="text-base">📋</span>
                          <h4 className="text-xs font-bold text-[var(--text-main)]">Vehicle Registration (Mulkiya)</h4>
                        </div>
                        <label className="block text-xs text-[var(--text-muted)] mb-1.5">Expiry Date</label>
                        <input type="date" value={form.registrationExpiryDate ? form.registrationExpiryDate.slice(0, 10) : ''}
                          onChange={e => f('registrationExpiryDate', e.target.value)}
                          className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-[var(--text-main)] text-xs focus:outline-none focus:border-orange-500/50" />
                      </div>
                      <div className="bg-[var(--bg-surface-hover)]/50 border border-[var(--border-subtle)] rounded-xl p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <span className="text-base">🛡️</span>
                          <h4 className="text-xs font-bold text-[var(--text-main)]">Insurance Policy</h4>
                        </div>
                        <label className="block text-xs text-[var(--text-muted)] mb-1.5">Expiry Date</label>
                        <input type="date" value={form.insuranceExpiryDate ? form.insuranceExpiryDate.slice(0, 10) : ''}
                          onChange={e => f('insuranceExpiryDate', e.target.value)}
                          className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-[var(--text-main)] text-xs focus:outline-none focus:border-orange-500/50" />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-[var(--border-subtle)] flex items-center justify-between flex-shrink-0 bg-[var(--bg-surface)]">
              <div className="flex gap-2">
                {(['basic', 'fleet', 'documents'] as const).filter(t => t !== tab).map(t => (
                  <button key={t} onClick={() => setTab(t)} className="px-3.5 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-main)] bg-[var(--bg-surface-hover)] rounded-lg transition-colors">
                    {t === 'basic' ? '← Basic Details' : t === 'fleet' ? '→ Fleet Assignment' : '→ Documents'}
                  </button>
                ))}
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowModal(false)} className="px-4 py-2 text-xs text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors">Cancel</button>
                <button onClick={handleSave} disabled={saving}
                  className="px-5 py-2 bg-gradient-to-r from-orange-500 to-amber-500 text-white rounded-xl font-semibold text-xs hover:opacity-90 disabled:opacity-50 transition-opacity shadow-sm">
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
