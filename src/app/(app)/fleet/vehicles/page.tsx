'use client';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
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
  Trash2,
  Upload,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Plus,
  FileCheck,
  Eye,
  Sparkles,
  Smartphone,
  Play,
  Square,
  Copy,
  ExternalLink,
  Radio,
  RefreshCw,
  Pin,
  Layers,
  MoreVertical,
} from 'lucide-react';


export interface VehicleLifecycleEvent {
  id: string;
  vehicleId: string;
  eventType: string;
  eventDate: string;
  description: string;
  referenceNo?: string | null;
  performedBy?: string | null;
  fromStage?: string | null;
  toStage?: string | null;
  cost?: number | string | null;
  metadata?: Record<string, unknown> | null;
  notes?: string | null;
  createdAt?: string;
}

export interface VehiclePermitDocument {
  id: string;
  name: string;
  documentType: string;
  documentNumber: string;
  issuingAuthority?: string;
  issueDate?: string;
  expiryDate: string;
  fileName?: string;
  fileData?: string;
  confidence?: number;
  autofilled?: boolean;
}

interface Vehicle {
  id: string;
  vehicleCode: string;
  make: string;
  model: string;
  year: number;
  licensePlate: string;
  status: string;
  chassisNo: string;
  vin?: string;
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
  regionId?: string;
  regionName?: string;
  departmentId?: string;
  departmentName?: string;
  unitId?: string;
  unitName?: string;
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
  assignedDriverName?: string;
  assignedDriverPhone?: string;
  registrationExpiryDate: string;
  insuranceExpiryDate: string;
  registrationExpiry?: string;
  insuranceExpiry?: string;
  mulkiyaCopyUrl?: string;
  mulkiyaFileName?: string;
  documents?: VehiclePermitDocument[];
  notes: string;
  category: string;
  lastPing?: {
    latitude: number;
    longitude: number;
    speedKmh: number;
    headingDeg: number;
    accuracyM?: number;
    occurredAt: string;
    source?: string;
  } | null;
}

interface VehicleType { id: string; code: string; name: string; }
interface ZonePlace { id: string; name: string; }

const DEFAULT_DOCUMENTS: VehiclePermitDocument[] = [
  { id: 'mulkiya-doc', name: 'Vehicle Registration (Mulkiya)', documentType: 'REGISTRATION', documentNumber: '', issuingAuthority: 'RTA / Police Licensing', expiryDate: '' },
  { id: 'insurance-doc', name: 'Comprehensive Insurance Policy', documentType: 'INSURANCE', documentNumber: '', issuingAuthority: '', expiryDate: '' },
];

const EMPTY_VEHICLE: Partial<Vehicle> = {
  vehicleCode: '', make: '', model: '', year: new Date().getFullYear(),
  licensePlate: '', status: 'AVAILABLE',
  chassisNo: '', color: '', yearOfManufacture: new Date().getFullYear(),
  registrationNo: '', plateNumber: '', plateCode: '', plateCategory: 'PRIVATE',
  emirate: 'DUBAI', vehicleTypeId: '', vehicleUsage: 'RENTAL',
  hierarchyName: '', branchName: '',
  regionId: '', regionName: '', departmentId: '', departmentName: '', unitId: '', unitName: '',
  deviceId: '', simCardNo: '', lifecycleStage: 'ACTIVE',
  purchaseDate: '', purchasePrice: 0, odometerReading: 0, fuelLevel: 100,
  acquisitionType: 'PURCHASE', assignedDriverId: '',
  registrationExpiryDate: '', insuranceExpiryDate: '',
  notes: '', category: '',
  documents: DEFAULT_DOCUMENTS,
};

const STATUSES = ['AVAILABLE', 'RENTED', 'MAINTENANCE', 'RESERVED', 'INACTIVE', 'SOLD'];
const LIFECYCLE_STAGES = ['ACTIVE', 'ALLOCATED', 'MAINTENANCE', 'IDLE', 'SOLD', 'WRITTEN_OFF'];
const USAGES = ['RENTAL', 'STAFF', 'SCHOOL_BUS', 'LOGISTICS', 'AMBULANCE', 'POOL', 'EXECUTIVE'];
const EMIRATES = ['DUBAI', 'ABU_DHABI', 'SHARJAH', 'AJMAN', 'RAK', 'FUJAIRAH', 'UAQ'];
const PLATE_CATS = ['PRIVATE', 'EXPORT', 'DIPLOMATIC', 'COMMERCIAL', 'MOTORCYCLE'];
const ACQUISITION_TYPES = ['PURCHASE', 'LEASE', 'HIRE_PURCHASE', 'DONATED'];

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

let _cachedVehicleTypes: VehicleType[] | null = null;
let _cachedZones: ZonePlace[] | null = null;
let _cachedDrivers: Array<{ id: string; name: string }> | null = null;

export default function VehiclesPage() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehicleTypes, setVehicleTypes] = useState<VehicleType[]>(_cachedVehicleTypes || []);
  const [activeActionMenuId, setActiveActionMenuId] = useState<string | null>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-vehicle-actions]')) {
        setActiveActionMenuId(null);
      }
    };
    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, []);

  // Organizational Hierarchy state (Region -> Department -> Unit)
  const [hierarchyRegions, setHierarchyRegions] = useState<Array<{ id: string; name: string; code?: string }>>([]);
  const [vehicleDepts, setVehicleDepts] = useState<Array<{ id: string; name: string; code?: string }>>([]);
  const [vehicleUnits, setVehicleUnits] = useState<Array<{ id: string; name: string; code?: string }>>([]);

  const loadVehicleHierarchyRegions = useCallback(async () => {
    try {
      const res = await fetch('/api/customer-hierarchy?level=REGION');
      if (res.ok) {
        const json = await res.json();
        setHierarchyRegions(Array.isArray(json) ? json : []);
      }
    } catch (err) {
      console.error('Failed to load regions:', err);
    }
  }, []);

  const loadVehicleDepts = useCallback(async (rId: string) => {
    if (!rId) { setVehicleDepts([]); setVehicleUnits([]); return; }
    try {
      const res = await fetch(`/api/customer-hierarchy?level=DEPARTMENT&parentId=${encodeURIComponent(rId)}`);
      if (res.ok) {
        const json = await res.json();
        setVehicleDepts(Array.isArray(json) ? json : []);
      }
    } catch (err) {
      console.error('Failed to load departments:', err);
    }
  }, []);

  const loadVehicleUnits = useCallback(async (dId: string) => {
    if (!dId) { setVehicleUnits([]); return; }
    try {
      const res = await fetch(`/api/customer-hierarchy?level=UNIT&parentId=${encodeURIComponent(dId)}`);
      if (res.ok) {
        const json = await res.json();
        setVehicleUnits(Array.isArray(json) ? json : []);
      }
    } catch (err) {
      console.error('Failed to load units:', err);
    }
  }, []);

  const handleVehicleRegionChange = (rId: string) => {
    const sel = hierarchyRegions.find(r => r.id === rId);
    setForm(prev => ({
      ...prev,
      regionId: rId,
      regionName: sel ? sel.name : '',
      departmentId: '',
      departmentName: '',
      unitId: '',
      unitName: '',
      hierarchyName: sel ? sel.name : '',
    }));
    loadVehicleDepts(rId);
  };

  const handleVehicleDeptChange = (dId: string) => {
    const sel = vehicleDepts.find(d => d.id === dId);
    setForm(prev => {
      const path = [prev.regionName, sel ? sel.name : ''].filter(Boolean).join(' > ');
      return {
        ...prev,
        departmentId: dId,
        departmentName: sel ? sel.name : '',
        unitId: '',
        unitName: '',
        hierarchyName: path,
      };
    });
    loadVehicleUnits(dId);
  };

  const handleVehicleUnitChange = (uId: string) => {
    const sel = vehicleUnits.find(u => u.id === uId);
    setForm(prev => {
      const path = [prev.regionName, prev.departmentName, sel ? sel.name : ''].filter(Boolean).join(' > ');
      return {
        ...prev,
        unitId: uId,
        unitName: sel ? sel.name : '',
        hierarchyName: path,
      };
    });
  };

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

  // Mulkiya AI Autofill state
  const [mulkiyaScanning, setMulkiyaScanning] = useState(false);
  const [mulkiyaScanSuccess, setMulkiyaScanSuccess] = useState<string | null>(null);
  const [mulkiyaScanError, setMulkiyaScanError] = useState<string | null>(null);
  const mulkiyaInputRef = useRef<HTMLInputElement>(null);

  // Document attachments AI scanning state
  const [scanningDocId, setScanningDocId] = useState<string | null>(null);

  // Quick Odometer Update state
  const [odometerModalVehicle, setOdometerModalVehicle] = useState<Vehicle | null>(null);
  const [newOdometerValue, setNewOdometerValue] = useState<string>('');
  const [updatingOdometer, setUpdatingOdometer] = useState(false);

  // Driver Hub list state
  const [driverList, setDriverList] = useState<Array<{ id: string; name: string }>>([]);

  // Mobile GPS Tracking Modal & Streaming state
  const [mobileTrackingModalVehicle, setMobileTrackingModalVehicle] = useState<Vehicle | null>(null);
  const [isTrackingInBrowser, setIsTrackingInBrowser] = useState(false);
  const [browserTrackingSpeed, setBrowserTrackingSpeed] = useState<number>(0);
  const [copiedVehicleId, setCopiedVehicleId] = useState<string | null>(null);
  const browserWatchRef = useRef<number | null>(null);
  const browserLastPingRef = useRef<number>(0);

  // Hardware Device Pairing Modal state
  const [pairModalVehicle, setPairModalVehicle] = useState<Vehicle | null>(null);
  const [pairImei, setPairImei] = useState('');
  const [pairSim, setPairSim] = useState('');
  const [savingPairing, setSavingPairing] = useState(false);
  const [pairingError, setPairingError] = useState<string | null>(null);

  // Vehicle Lifecycle History state
  const [vehicleLifecycleEvents, setVehicleLifecycleEvents] = useState<VehicleLifecycleEvent[]>([]);
  const [loadingLifecycleEvents, setLoadingLifecycleEvents] = useState(false);
  const [showAddLifecycleModal, setShowAddLifecycleModal] = useState(false);
  const [addingLifecycleEvent, setAddingLifecycleEvent] = useState(false);
  const [lifecycleForm, setLifecycleForm] = useState({
    eventType: 'STAGE_TRANSITION',
    toStage: 'OPERATIONAL',
    description: '',
    performedBy: '',
    cost: '',
    notes: '',
  });

  const fetchVehicleLifecycle = useCallback(async (vId: string) => {
    setLoadingLifecycleEvents(true);
    try {
      const res = await fetch(`/api/fleet/lifecycle?vehicleId=${encodeURIComponent(vId)}&limit=50`);
      if (res.ok) {
        const json = await res.json();
        setVehicleLifecycleEvents(json.data || []);
      }
    } catch (e) {
      console.error('Failed to fetch lifecycle events:', e);
    } finally {
      setLoadingLifecycleEvents(false);
    }
  }, []);


  const fetchData = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: String(limit), page: String(page) });
    if (search) params.set('search', search);
    if (statusFilter) params.set('status', statusFilter);
    if (usageFilter) params.set('vehicleUsage', usageFilter);
    if (categoryFilter) params.set('category', categoryFilter);
    if (zoneFilter) params.set('zoneId', zoneFilter);
    try {
      const needVehicleTypes = !_cachedVehicleTypes || _cachedVehicleTypes.length === 0;
      const [vRes, vtRes] = await Promise.all([
        fetch('/api/fleet/vehicles?' + params),
        needVehicleTypes ? fetch('/api/fleet/vehicle-types?limit=200') : Promise.resolve(null),
      ]);
      const vData = await vRes.json();
      if (vtRes) {
        const vtData = await vtRes.json();
        const vtArr = Array.isArray(vtData.data) ? vtData.data : Array.isArray(vtData) ? vtData : [];
        _cachedVehicleTypes = vtArr;
        setVehicleTypes(vtArr);
      } else if (_cachedVehicleTypes) {
        setVehicleTypes(_cachedVehicleTypes);
      }
      const vArr = Array.isArray(vData.data) ? vData.data : Array.isArray(vData) ? vData : [];
      
      // Parse documents from notes if stored as JSON
      const parsedVehicles = vArr.map((v: Vehicle) => {
        let docs = DEFAULT_DOCUMENTS;
        if (v.notes && v.notes.startsWith('{')) {
          try {
            const parsed = JSON.parse(v.notes);
            if (Array.isArray(parsed.documents)) {
              docs = parsed.documents;
            }
          } catch {
            // ignore non-json notes
          }
        }
        return {
          ...v,
          registrationExpiryDate: v.registrationExpiryDate || v.registrationExpiry || '',
          insuranceExpiryDate: v.insuranceExpiryDate || v.insuranceExpiry || '',
          documents: docs,
        };
      });

      setVehicles(parsedVehicles);
      setTotal(typeof vData.total === 'number' ? vData.total : vArr.length);
    } catch { setError('Failed to load data'); }
    finally { setLoading(false); }
  }, [search, statusFilter, usageFilter, categoryFilter, zoneFilter, page]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (_cachedZones) {
      setZones(_cachedZones);
    } else {
      fetch('/api/places?type=OPERATIONAL_ZONE')
        .then(r => r.json())
        .then(d => {
          const list = Array.isArray(d) ? d : [];
          _cachedZones = list;
          setZones(list);
        })
        .catch(() => setZones([]));
    }

    if (_cachedDrivers) {
      setDriverList(_cachedDrivers);
    } else {
      fetch('/api/drivers')
        .then(r => r.json())
        .then(d => {
          const list = Array.isArray(d.data) ? d.data : Array.isArray(d) ? d : [];
          const drivers = list.map((dr: { id: string; name?: string; firstName?: string; lastName?: string }) => ({
            id: dr.id,
            name: dr.name || [dr.firstName, dr.lastName].filter(Boolean).join(' ') || 'Driver',
          }));
          _cachedDrivers = drivers;
          setDriverList(drivers);
        })
        .catch(() => {});
    }
  }, []);

  // Open Inspector drawer with instant preview and background refresh
  const openInspect = (v: Vehicle) => {
    setInspectingVehicle(v);
    fetchVehicleLifecycle(v.id);
    setDrawerTab('overview');
    fetch(`/api/fleet/vehicles/${v.id}`)
      .then(r => r.json())
      .then(updated => {
        if (updated && !updated.error) {
          setInspectingVehicle(prev => prev && prev.id === v.id ? { ...prev, ...updated } : prev);
        }
      })
      .catch(() => {});
  };

  // Turn On Mobile Tracking actions
  const handleTurnOnMobileTracking = (v: Vehicle) => {
    setMobileTrackingModalVehicle(v);
  };

  // Hardware Device Pairing actions
  const openPairModal = (v: Vehicle) => {
    setPairModalVehicle(v);
    setPairImei(v.deviceId || '');
    setPairSim(v.simCardNo || '');
    setPairingError(null);
  };

  const handleSavePairing = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!pairModalVehicle) return;

    if (!pairImei.trim()) {
      setPairingError('Please enter a valid Device Hardware IMEI / Tracker ID.');
      return;
    }

    setSavingPairing(true);
    setPairingError(null);
    try {
      const res = await fetch('/api/telematics/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicleId: pairModalVehicle.id,
          deviceId: pairImei.trim(),
          simCardNo: pairSim.trim() || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update device pairing');
      }

      setVehicles(prev => prev.map(v => v.id === pairModalVehicle.id ? { ...v, deviceId: data.deviceId, simCardNo: data.simCardNo } : v));
      setInspectingVehicle(prev => prev && prev.id === pairModalVehicle.id ? { ...prev, deviceId: data.deviceId, simCardNo: data.simCardNo } : prev);
      setPairModalVehicle(null);
    } catch (err) {
      setPairingError(err instanceof Error ? err.message : 'Error updating pairing');
    } finally {
      setSavingPairing(false);
    }
  };

  const handleUnpairDevice = async (v: Vehicle) => {
    if (!confirm(`Are you sure you want to unpair hardware tracker (${v.deviceId}) from ${v.make} ${v.model} (${v.plateNumber || v.licensePlate})? Mobile tracking will become available.`)) {
      return;
    }

    setSavingPairing(true);
    try {
      const res = await fetch('/api/telematics/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicleId: v.id,
          deviceId: null,
          simCardNo: null,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to unpair device');
      }

      setVehicles(prev => prev.map(item => item.id === v.id ? { ...item, deviceId: '', simCardNo: '' } : item));
      setInspectingVehicle(prev => prev && prev.id === v.id ? { ...prev, deviceId: '', simCardNo: '' } : prev);
      setPairModalVehicle(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error unpairing device');
    } finally {
      setSavingPairing(false);
    }
  };

  const startBrowserTracking = (v: Vehicle) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      alert('Geolocation is not supported in this browser.');
      return;
    }
    setIsTrackingInBrowser(true);
    const wid = navigator.geolocation.watchPosition(
      async (pos) => {
        const speedKmh = pos.coords.speed != null && pos.coords.speed > 0
          ? Math.round(pos.coords.speed * 3.6 * 10) / 10
          : 0;
        setBrowserTrackingSpeed(speedKmh);

        const now = Date.now();
        if (now - browserLastPingRef.current >= 4000) {
          browserLastPingRef.current = now;
          fetch('/api/driver-app/telematics/live-location', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              vehicleId: v.id,
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              speedKmh,
              heading: pos.coords.heading || 0,
              accuracy: Math.round(pos.coords.accuracy || 0),
            }),
          }).catch(() => {});
        }
      },
      (err) => {
        alert(`GPS Error: ${err.message}`);
        setIsTrackingInBrowser(false);
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
    );
    browserWatchRef.current = wid;
  };

  const stopBrowserTracking = () => {
    if (browserWatchRef.current !== null && typeof navigator !== 'undefined') {
      navigator.geolocation.clearWatch(browserWatchRef.current);
      browserWatchRef.current = null;
    }
    setIsTrackingInBrowser(false);
  };

  const copyDriverTrackingLink = (v: Vehicle) => {
    const identifier = v.licensePlate || v.plateNumber || v.vehicleCode;
    const link = `${window.location.origin}/driver-app?vehicle=${encodeURIComponent(identifier)}`;
    navigator.clipboard.writeText(link);
    setCopiedVehicleId(v.id);
    setTimeout(() => setCopiedVehicleId(null), 3000);
  };

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
    setForm({
      ...EMPTY_VEHICLE,
      documents: DEFAULT_DOCUMENTS.map(d => ({ ...d })),
    });
    setTab('basic');
    setDetectedInfo(null);
    setDetectedDismissed(false);
    setMulkiyaScanSuccess(null);
    setMulkiyaScanError(null);
    setShowModal(true);
  };

    const openEdit = (v: Vehicle) => {
    setEditing(v);
    let docs = v.documents?.length ? v.documents : DEFAULT_DOCUMENTS;
    // Clean out legacy empty document widgets if they had no data
    docs = docs.filter(d => {
      if (['passing-doc', 'cd-doc', 'commercial-doc', 'gps-doc'].includes(d.id)) {
        return Boolean(d.documentNumber || d.expiryDate || d.fileName || d.fileData);
      }
      return true;
    });
    // Ensure Mulkiya & Insurance are present
    const hasReg = docs.some(d => d.id === 'mulkiya-doc' || d.documentType === 'REGISTRATION');
    const hasIns = docs.some(d => d.id === 'insurance-doc' || d.documentType === 'INSURANCE');
    if (!hasReg) docs = [DEFAULT_DOCUMENTS[0], ...docs];
    if (!hasIns) docs = [docs[0], DEFAULT_DOCUMENTS[1], ...docs.slice(1)];
    setForm({ ...v, documents: docs });
    setDetectedInfo(null);
    setDetectedDismissed(true);
    setTab('basic');
    setShowModal(true);
    if (v.regionId) loadVehicleDepts(v.regionId);
    if (v.departmentId) loadVehicleUnits(v.departmentId);
  };

  const f = (k: keyof Vehicle, v: Vehicle[keyof Vehicle]) => setForm(p => ({ ...p, [k]: v }));
  const vtName = (id: string) => vehicleTypes.find(vt => vt.id === id)?.name ?? '—';

  // Handle Mulkiya / Registration Card file upload & AI extraction
  const handleMulkiyaUpload = async (file: File) => {
    if (!file) return;
    setMulkiyaScanning(true);
    setMulkiyaScanSuccess(null);
    setMulkiyaScanError(null);

    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const dataUrl = e.target?.result as string;
        const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;

        const res = await fetch('/api/fleet/vehicles/autofill-mulkia', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            base64,
            mimeType: file.type || 'image/jpeg',
            fileName: file.name,
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to analyze Mulkiya');
        }

        const data = await res.json();
        if (data.status === 'unavailable') {
          setMulkiyaScanError(data.message || 'AI document reader unavailable');
          return;
        }
        if (data.status === 'error') {
          setMulkiyaScanError(data.message || 'Failed to extract details from Mulkiya card');
          return;
        }

        // Calculate autofilled fields
        const fieldsPopulated: string[] = [];
        if (data.plateNumber) fieldsPopulated.push(`Plate: ${data.plateNumber}`);
        if (data.plateCode) fieldsPopulated.push(`Code: ${data.plateCode}`);
        if (data.emirate) fieldsPopulated.push(`Emirate: ${data.emirate}`);
        if (data.chassisNo) fieldsPopulated.push(`VIN: ${data.chassisNo}`);
        if (data.make) fieldsPopulated.push(`Make: ${data.make}`);
        if (data.model) fieldsPopulated.push(`Model: ${data.model}`);
        if (data.year) fieldsPopulated.push(`Year: ${data.year}`);
        if (data.color) fieldsPopulated.push(`Color: ${data.color}`);
        if (data.registrationNo) fieldsPopulated.push(`Traffic No: ${data.registrationNo}`);
        if (data.registrationExpiryDate) fieldsPopulated.push(`Expiry: ${data.registrationExpiryDate}`);
        if (data.insuranceExpiryDate) fieldsPopulated.push(`Insurance: ${data.insuranceExpiryDate}`);

        if (fieldsPopulated.length === 0) {
          setMulkiyaScanError('No vehicle details detected from this document. Please check the file or enter details manually.');
          return;
        }

        // Autofill form fields
        setForm(prev => {
          const updated = { ...prev };
          if (data.plateNumber) { updated.plateNumber = data.plateNumber; updated.licensePlate = data.plateNumber; }
          if (data.plateCode) { updated.plateCode = data.plateCode; }
          if (data.emirate) { updated.emirate = data.emirate; }
          if (data.plateCategory) { updated.plateCategory = data.plateCategory; }
          if (data.chassisNo) { updated.chassisNo = data.chassisNo; updated.vin = data.chassisNo; }
          if (data.make) { updated.make = data.make; }
          if (data.model) { updated.model = data.model; }
          if (data.year) { updated.year = data.year; updated.yearOfManufacture = data.year; }
          if (data.color) { updated.color = data.color; }
          if (data.registrationNo) { updated.registrationNo = data.registrationNo; }
          if (data.registrationExpiryDate) { updated.registrationExpiryDate = data.registrationExpiryDate; }
          if (data.insuranceExpiryDate) { updated.insuranceExpiryDate = data.insuranceExpiryDate; }
          updated.mulkiyaFileName = file.name;
          updated.mulkiyaCopyUrl = dataUrl;

          // Sync into documents array
          const docs = [...(prev.documents || DEFAULT_DOCUMENTS)];
          const mulkiyaDocIndex = docs.findIndex(d => d.documentType === 'REGISTRATION');
          if (mulkiyaDocIndex >= 0) {
            docs[mulkiyaDocIndex] = {
              ...docs[mulkiyaDocIndex],
              documentNumber: data.registrationNo || data.plateNumber || docs[mulkiyaDocIndex].documentNumber,
              expiryDate: data.registrationExpiryDate || docs[mulkiyaDocIndex].expiryDate,
              issuingAuthority: data.emirate === 'ABU_DHABI' ? 'Abu Dhabi Police' : data.emirate === 'DUBAI' ? 'RTA' : docs[mulkiyaDocIndex].issuingAuthority || 'Police Licensing',
              fileName: file.name,
              fileData: dataUrl,
              confidence: data.confidence,
              autofilled: true,
            };
          }
          if (data.insuranceExpiryDate) {
            const insDocIndex = docs.findIndex(d => d.documentType === 'INSURANCE');
            if (insDocIndex >= 0 && !docs[insDocIndex].expiryDate) {
              docs[insDocIndex] = {
                ...docs[insDocIndex],
                expiryDate: data.insuranceExpiryDate,
                issuingAuthority: docs[insDocIndex].issuingAuthority || 'Insurance Authority',
                autofilled: true,
              };
            }
          }
          updated.documents = docs;

          return updated;
        });

        const confPct = Math.round((data.confidence || 0.95) * 100);
        const summaryDetail = [data.plateNumber ? `Plate: ${data.plateNumber}` : null, data.make, data.model].filter(Boolean).join(' ');
        setMulkiyaScanSuccess(`✓ Mulkiya scanned successfully: ${fieldsPopulated.length} fields autofilled (${confPct}% confidence)${summaryDetail ? ` — ${summaryDetail}` : ''}`);
      };

      reader.readAsDataURL(file);
    } catch (err) {
      setMulkiyaScanError(err instanceof Error ? err.message : 'Error scanning Mulkiya card');
    } finally {
      setMulkiyaScanning(false);
    }
  };

  // Handle individual permit document upload & AI extraction
  const handleDocumentFileUpload = async (docId: string, file: File) => {
    if (!file) return;
    setScanningDocId(docId);

    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const dataUrl = e.target?.result as string;
        const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;

        const currentDoc = (form.documents || []).find(d => d.id === docId);

        const res = await fetch('/api/fleet/vehicles/autofill-document', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            base64,
            mimeType: file.type || 'image/jpeg',
            fileName: file.name,
            documentType: currentDoc?.documentType || 'OTHER',
          }),
        });

        const data = await res.json();
        
        setForm(prev => {
          const docs = [...(prev.documents || [])];
          const idx = docs.findIndex(d => d.id === docId);
          if (idx >= 0) {
            const docNum = data.documentNumber || docs[idx].documentNumber;
            const issAuth = data.issuingAuthority || docs[idx].issuingAuthority;
            const expDate = data.expiryDate || docs[idx].expiryDate;
            const issDate = data.issueDate || docs[idx].issueDate;
            docs[idx] = {
              ...docs[idx],
              documentNumber: docNum,
              issuingAuthority: issAuth,
              expiryDate: expDate,
              issueDate: issDate,
              fileName: file.name,
              fileData: dataUrl,
              confidence: data.confidence,
              autofilled: Boolean(data.documentNumber || data.expiryDate || data.issuingAuthority),
            };

            // Sync with main vehicle form if Mulkiya or Insurance
            const updated = { ...prev, documents: docs };
            if (docs[idx].documentType === 'REGISTRATION' && expDate) {
              updated.registrationExpiryDate = expDate;
            }
            if (docs[idx].documentType === 'INSURANCE' && expDate) {
              updated.insuranceExpiryDate = expDate;
            }
            return updated;
          }
          return prev;
        });
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error('Document OCR failed:', err);
    } finally {
      setScanningDocId(null);
    }
  };

  const addCustomDocument = () => {
    const newDoc: VehiclePermitDocument = {
      id: `doc-${Date.now()}`,
      name: '',
      documentType: 'OTHER',
      documentNumber: '',
      issuingAuthority: '',
      expiryDate: '',
    };
    setForm(prev => ({
      ...prev,
      documents: [...(prev.documents || []), newDoc],
    }));
  };

  const removeDocument = (id: string) => {
    setForm(prev => ({
      ...prev,
      documents: (prev.documents || []).filter(d => d.id !== id),
    }));
  };

  const updateDocField = (id: string, field: keyof VehiclePermitDocument, val: string) => {
    setForm(prev => {
      const docs = (prev.documents || []).map(d => d.id === id ? { ...d, [field]: val } : d);
      const updated = { ...prev, documents: docs };
      const matched = docs.find(d => d.id === id);
      if (matched?.documentType === 'REGISTRATION' && field === 'expiryDate') {
        updated.registrationExpiryDate = val;
      }
      if (matched?.documentType === 'INSURANCE' && field === 'expiryDate') {
        updated.insuranceExpiryDate = val;
      }
      return updated;
    });
  };

  const handleSave = async () => {
    if (!form.make || !form.model) { setError('Make and Model are required'); return; }
    setSaving(true); setError('');
    try {
      const url = editing ? `/api/fleet/vehicles/${editing.id}` : '/api/fleet/vehicles';
      const method = editing ? 'PUT' : 'POST';

      // Persist documents in structured JSON notes (strip heavy base64 to ensure instant saving)
      let payloadNotes = '';
      try {
        let existingNotesObj: Record<string, unknown> = {};
        if (form.notes && form.notes.startsWith('{')) {
          existingNotesObj = JSON.parse(form.notes);
        } else if (form.notes && form.notes.trim()) {
          existingNotesObj = { text: form.notes };
        }
        
        // Strip heavy base64 file data so payload stays lightweight (< 2KB)
        const cleanDocs = (form.documents || []).map(d => {
          const { fileData, ...rest } = d;
          return rest;
        });

        existingNotesObj.documents = cleanDocs;
        if (form.mulkiyaFileName) existingNotesObj.mulkiyaFileName = form.mulkiyaFileName;
        payloadNotes = JSON.stringify(existingNotesObj);
      } catch {
        payloadNotes = form.notes || '';
      }

      // Strip large raw data urls before transmitting
      const { mulkiyaCopyUrl, ...cleanForm } = form;
      const payload = {
        ...cleanForm,
        notes: payloadNotes,
      };

      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
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

  // Quick Odometer reading update action
  const openOdometerModal = (v: Vehicle) => {
    setOdometerModalVehicle(v);
    setNewOdometerValue(String(v.odometerReading ?? 0));
  };

  const handleQuickOdometerSave = async () => {
    if (!odometerModalVehicle) return;
    const reading = parseInt(newOdometerValue, 10);
    if (isNaN(reading) || reading < 0) {
      alert('Please enter a valid odometer reading in km');
      return;
    }
    setUpdatingOdometer(true);
    try {
      const res = await fetch(`/api/fleet/vehicles/${odometerModalVehicle.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ odometerReading: reading }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to update odometer');
      }
      setVehicles(prev => prev.map(v => v.id === odometerModalVehicle.id ? { ...v, odometerReading: reading } : v));
      if (inspectingVehicle?.id === odometerModalVehicle.id) {
        setInspectingVehicle(prev => prev ? { ...prev, odometerReading: reading } : null);
      }
      setOdometerModalVehicle(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error updating odometer');
    } finally {
      setUpdatingOdometer(false);
    }
  };

  const DRAWER_TABS: DrawerTab[] = [
    { id: 'overview', label: 'Overview', icon: <Car className="w-3.5 h-3.5" /> },
    { id: 'telematics', label: 'Telematics & Driver', icon: <Cpu className="w-3.5 h-3.5" /> },
    { id: 'documents', label: 'Documents & Permits', icon: <FileText className="w-3.5 h-3.5" /> },
    { id: 'lifecycle', label: 'Lifecycle Events', icon: <RefreshCw className="w-3.5 h-3.5" /> },
  ];

  const getDrawerActions = (v: Vehicle): DrawerAction[] => {
    const actions: DrawerAction[] = [];

    // Hardware Telematics Pairing action
    if (!v.deviceId || v.deviceId.trim() === '') {
      actions.push({
        label: 'Pair Device',
        icon: <Cpu className="w-3.5 h-3.5 text-cyan-400" />,
        variant: 'secondary',
        onClick: () => openPairModal(v),
      });
      // If hardware deviceId is blank, provide direct Turn On Mobile Tracking action
      actions.push({
        label: 'Turn On Mobile Tracking',
        icon: <Smartphone className="w-3.5 h-3.5 text-white" />,
        variant: 'primary',
        onClick: () => handleTurnOnMobileTracking(v),
      });
    } else {
      actions.push({
        label: 'Edit Pairing',
        icon: <Cpu className="w-3.5 h-3.5 text-cyan-400" />,
        variant: 'secondary',
        onClick: () => openPairModal(v),
      });
    }

    actions.push(
      {
        label: 'Update Odometer',
        icon: <Gauge className="w-3.5 h-3.5" />,
        variant: 'secondary',
        onClick: () => openOdometerModal(v),
      },
      {
        label: 'Edit Vehicle',
        icon: <Edit2 className="w-3.5 h-3.5" />,
        variant: 'secondary',
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
    );
    return actions;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-main)]">Vehicle Master</h1>
          <p className="text-[var(--text-muted)] text-xs mt-0.5">Manage fleet vehicles, Mulkiya OCR extraction, and lifecycle tracking</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/fleet/allocations"
            className="px-3.5 py-2.5 bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] rounded-xl font-semibold text-xs hover:border-cyan-500/40 hover:text-cyan-400 transition flex items-center gap-2 shadow-sm"
          >
            <Pin className="w-3.5 h-3.5 text-cyan-400" />
            <span>Fleet Allocations</span>
          </Link>
          <button onClick={openNew} className="px-4 py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 text-white rounded-xl font-semibold text-xs hover:opacity-90 transition-opacity flex items-center gap-2 shadow-sm">
            <span>+</span> Add Vehicle
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2.5 flex-wrap">
        <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search vehicle code, plate, make, model, VIN…"
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
                {[
                  'Vehicle Code',
                  'Make / Model',
                  'Segment',
                  'Plate No.',
                  'VIN / Chassis No.',
                  'Type',
                  'Usage',
                  'Lifecycle',
                  'Status',
                  'Assigned Driver',
                  'Odometer',
                  'Fuel',
                  'Actions'
                ].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider whitespace-nowrap">
                    {h === 'Odometer' ? (
                      <span className="flex items-center gap-1"><Gauge className="w-3 h-3" />{h}</span>
                    ) : h === 'Fuel' ? (
                      <span className="flex items-center gap-1"><Fuel className="w-3 h-3" />{h}</span>
                    ) : h === 'Assigned Driver' ? (
                      <span className="flex items-center gap-1"><UserCheck className="w-3 h-3" />{h}</span>
                    ) : h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {loading ? (
                <tr><td colSpan={13} className="px-4 py-12 text-center text-[var(--text-muted)] text-sm">Loading fleet inventory…</td></tr>
              ) : vehicles.length === 0 ? (
                <tr><td colSpan={13} className="px-4 py-12 text-center text-[var(--text-muted)] text-sm">No vehicles found. Click &quot;Add Vehicle&quot; to get started.</td></tr>
              ) : vehicles.map(v => (
                <tr 
                  key={v.id} 
                  onClick={() => openInspect(v)}
                  className="hover:bg-[var(--bg-surface-hover)] transition-colors cursor-pointer group"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-orange-500 font-semibold text-xs bg-orange-500/10 border border-orange-500/20 px-2 py-0.5 rounded">{v.vehicleCode || '—'}</span>
                      {v.deviceId ? (
                        <span title={`Paired Hardware GPS: ${v.deviceId}`} className="p-1 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
                          <Cpu className="w-3 h-3" />
                        </span>
                      ) : null}
                    </div>
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
                  <td className="px-4 py-3 font-mono text-[var(--text-main)] text-xs font-bold">{v.plateNumber || v.licensePlate || '—'}</td>
                  
                  {/* VIN / Chassis No Column */}
                  <td className="px-4 py-3 font-mono text-xs text-[var(--text-muted)]">
                    <span className="font-medium text-[var(--text-main)]">{v.chassisNo || v.vin || '—'}</span>
                  </td>

                  <td className="px-4 py-3 text-[var(--text-muted)] text-xs">{v.vehicleTypeId ? vtName(v.vehicleTypeId) : '—'}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-[var(--text-muted)]">{(v.vehicleUsage ?? '').replace(/_/g, ' ')}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-muted)]">{v.lifecycleStage || '—'}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border inline-flex items-center gap-1 ${statusColor[v.status] ?? 'bg-[var(--bg-surface-hover)] text-[var(--text-muted)]'}`}>
                      {v.status === 'MAINTENANCE' && <Wrench className="w-3 h-3" />}
                      {v.status}
                    </span>
                  </td>

                  {/* Assigned Driver Column */}
                  <td className="px-4 py-3">
                    {v.assignedDriverName ? (
                      <div className="flex items-center gap-1.5" title={v.assignedDriverName}>
                        <UserCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span className="text-xs font-semibold text-[var(--text-main)] truncate max-w-[130px]">
                          {v.assignedDriverName}
                        </span>
                      </div>
                    ) : v.assignedDriverId ? (
                      <span className="text-xs text-[var(--text-muted)] font-mono text-[11px]" title={v.assignedDriverId}>
                        Driver ({v.assignedDriverId.slice(0, 8)}…)
                      </span>
                    ) : (
                      <span className="text-xs text-[var(--text-muted)] italic">Unassigned</span>
                    )}
                  </td>

                  {/* Odometer Column with Quick Click-to-Update */}
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => openOdometerModal(v)}
                      className="group/odo inline-flex items-center gap-1.5 font-mono text-xs font-bold text-[var(--text-main)] hover:text-orange-400 transition"
                      title="Click to update odometer"
                    >
                      <span>{v.odometerReading?.toLocaleString() ?? 0} km</span>
                      <Gauge className="w-3.5 h-3.5 text-orange-400/70 group-hover/odo:text-orange-400 opacity-60 group-hover/odo:opacity-100" />
                    </button>
                  </td>

                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-14 h-1.5 bg-[var(--border-subtle)] rounded-full overflow-hidden">
                        <div className="h-full bg-orange-500 rounded-full" style={{ width: `${v.fuelLevel ?? 0}%` }} />
                      </div>
                      <span className="text-[11px] text-[var(--text-muted)] font-mono">{v.fuelLevel ?? 0}%</span>
                    </div>
                  </td>

                  {/* 3-Dot Action Menu Column */}
                  <td className="px-4 py-3 text-center whitespace-nowrap relative" onClick={e => e.stopPropagation()} data-vehicle-actions>
                    <div className="inline-block text-left relative">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveActionMenuId(prev => prev === v.id ? null : v.id);
                        }}
                        className={`p-2 rounded-xl border transition flex items-center justify-center ${
                          activeActionMenuId === v.id
                            ? 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border-cyan-500/50 shadow-md ring-2 ring-cyan-500/20'
                            : 'bg-[var(--bg-canvas)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-muted)] hover:text-[var(--text-main)] border-[var(--border-subtle)]'
                        }`}
                        title="Vehicle Actions"
                        aria-label="Vehicle Actions"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>

                      {activeActionMenuId === v.id && (
                        <div
                          className="absolute right-0 mt-2 w-64 rounded-2xl bg-white dark:bg-slate-900 border-2 border-slate-300 dark:border-slate-700 shadow-2xl shadow-slate-900/25 z-50 py-1.5 text-left divide-y divide-slate-200 dark:divide-slate-800 animate-in fade-in zoom-in-95 duration-100"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="px-4 py-2.5 bg-slate-100 dark:bg-slate-800/80">
                            <div className="text-[11px] uppercase font-black tracking-wider text-cyan-700 dark:text-cyan-400">
                              {v.vehicleCode || v.plateNumber}
                            </div>
                            <div className="text-xs font-bold text-slate-950 dark:text-slate-200 truncate mt-0.5">
                              {v.make} {v.model} {v.plateNumber ? `(${v.plateNumber})` : ''}
                            </div>
                          </div>

                          <div className="py-1">
                            <button
                              onClick={() => {
                                openInspect(v);
                                setActiveActionMenuId(null);
                              }}
                              className="w-full px-4 py-2.5 text-xs font-bold text-slate-950 dark:text-white hover:bg-cyan-50 dark:hover:bg-slate-800 flex items-center gap-3 transition"
                            >
                              <span className="p-1.5 rounded-lg bg-cyan-100 dark:bg-cyan-950/80 text-cyan-700 dark:text-cyan-400">
                                <Eye className="w-4 h-4 shrink-0" />
                              </span>
                              <span>Inspect Vehicle Drawer</span>
                            </button>

                            <button
                              onClick={() => {
                                openOdometerModal(v);
                                setActiveActionMenuId(null);
                              }}
                              className="w-full px-4 py-2.5 text-xs font-bold text-slate-950 dark:text-white hover:bg-orange-50 dark:hover:bg-slate-800 flex items-center gap-3 transition"
                            >
                              <span className="p-1.5 rounded-lg bg-orange-100 dark:bg-orange-950/80 text-orange-700 dark:text-orange-400">
                                <Gauge className="w-4 h-4 shrink-0" />
                              </span>
                              <span>Update Odometer Reading</span>
                            </button>
                          </div>

                          <div className="py-1">
                            <button
                              onClick={() => {
                                openPairModal(v);
                                setActiveActionMenuId(null);
                              }}
                              className="w-full px-4 py-2.5 text-xs font-bold text-slate-950 dark:text-white hover:bg-cyan-50 dark:hover:bg-slate-800 flex items-center gap-3 transition"
                            >
                              <span className="p-1.5 rounded-lg bg-cyan-100 dark:bg-cyan-950/80 text-cyan-700 dark:text-cyan-400">
                                <Cpu className="w-4 h-4 shrink-0" />
                              </span>
                              <span>{v.deviceId ? 'Edit Hardware GPS (IMEI)' : 'Pair Hardware GPS Tracker'}</span>
                            </button>

                            {(!v.deviceId || v.deviceId.trim() === '') && (
                              <button
                                onClick={() => {
                                  handleTurnOnMobileTracking(v);
                                  setActiveActionMenuId(null);
                                }}
                                className="w-full px-4 py-2.5 text-xs font-bold text-emerald-800 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-slate-800 flex items-center gap-3 transition"
                              >
                                <span className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-400">
                                  <Smartphone className="w-4 h-4 shrink-0" />
                                </span>
                                <span>Turn On Mobile Tracking</span>
                              </button>
                            )}

                            <Link
                              href={`/fleet/telematics?search=${encodeURIComponent(v.plateNumber || v.vehicleCode || '')}`}
                              className="w-full px-4 py-2.5 text-xs font-bold text-slate-950 dark:text-white hover:bg-cyan-50 dark:hover:bg-slate-800 flex items-center gap-3 transition"
                              onClick={() => setActiveActionMenuId(null)}
                            >
                              <span className="p-1.5 rounded-lg bg-cyan-100 dark:bg-cyan-950/80 text-cyan-700 dark:text-cyan-400">
                                <Radio className="w-4 h-4 shrink-0" />
                              </span>
                              <span>View on Live Map</span>
                            </Link>
                          </div>

                          <div className="py-1">
                            <button
                              onClick={() => {
                                openEdit(v);
                                setActiveActionMenuId(null);
                              }}
                              className="w-full px-4 py-2.5 text-xs font-bold text-slate-950 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-3 transition"
                            >
                              <span className="p-1.5 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                                <Edit2 className="w-4 h-4 shrink-0" />
                              </span>
                              <span>Edit Vehicle Details</span>
                            </button>

                            <button
                              onClick={() => {
                                setActiveActionMenuId(null);
                                handleDelete(v.id);
                              }}
                              className="w-full px-4 py-2.5 text-xs font-bold text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-slate-800 flex items-center gap-3 transition"
                            >
                              <span className="p-1.5 rounded-lg bg-rose-100 dark:bg-rose-950/80 text-rose-700 dark:text-rose-400">
                                <Trash2 className="w-4 h-4 shrink-0" />
                              </span>
                              <span>Delete Vehicle</span>
                            </button>
                          </div>
                        </div>
                      )}
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

      {/* Quick Odometer Update Modal */}
      {odometerModalVehicle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <div className="flex items-center gap-2">
                <Gauge className="w-5 h-5 text-orange-500" />
                <h3 className="text-sm font-bold text-[var(--text-main)]">Update Vehicle Odometer</h3>
              </div>
              <button onClick={() => setOdometerModalVehicle(null)} className="text-[var(--text-muted)] hover:text-[var(--text-main)] text-xl leading-none">×</button>
            </div>
            
            <div className="bg-[var(--bg-surface-hover)] p-3 rounded-xl border border-[var(--border-subtle)] text-xs space-y-1">
              <div className="font-semibold text-[var(--text-main)]">
                {odometerModalVehicle.make} {odometerModalVehicle.model} ({odometerModalVehicle.vehicleCode || 'No Code'})
              </div>
              <div className="text-[var(--text-muted)] font-mono">
                Plate: {odometerModalVehicle.plateNumber || odometerModalVehicle.licensePlate || 'N/A'} • Current: {odometerModalVehicle.odometerReading?.toLocaleString() ?? 0} km
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1.5">New Odometer Reading (km)</label>
              <div className="relative">
                <input
                  type="number"
                  min={0}
                  value={newOdometerValue}
                  onChange={e => setNewOdometerValue(e.target.value)}
                  className="w-full bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl pl-4 pr-12 py-2.5 text-sm font-mono font-bold text-[var(--text-main)] focus:outline-none focus:border-orange-500"
                  placeholder="Enter current km..."
                  autoFocus
                />
                <span className="absolute right-3.5 top-3 text-xs font-semibold text-[var(--text-muted)] font-mono">KM</span>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setOdometerModalVehicle(null)}
                className="px-4 py-2 text-xs text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleQuickOdometerSave}
                disabled={updatingOdometer}
                className="px-5 py-2 bg-gradient-to-r from-orange-500 to-amber-500 text-white rounded-xl font-semibold text-xs hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center gap-2 shadow-sm"
              >
                {updatingOdometer ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                {updatingOdometer ? 'Saving…' : 'Save Odometer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hardware Device Pairing Modal */}
      {pairModalVehicle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-cyan-500/20 text-cyan-400 flex items-center justify-center">
                  <Cpu className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[var(--text-main)]">
                    {pairModalVehicle.deviceId ? 'Edit Hardware Pairing' : 'Pair Hardware Telematics Device'}
                  </h3>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    Bind GPS Tracker IMEI &amp; SIM card to this vehicle
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setPairModalVehicle(null)} 
                className="text-[var(--text-muted)] hover:text-[var(--text-main)] text-xl leading-none"
              >
                ×
              </button>
            </div>

            {/* Vehicle preview */}
            <div className="bg-[var(--bg-surface-hover)] p-3 rounded-xl border border-[var(--border-subtle)] flex items-center justify-between text-xs">
              <div>
                <span className="font-bold text-[var(--text-main)] block">
                  {pairModalVehicle.make} {pairModalVehicle.model} ({pairModalVehicle.yearOfManufacture || pairModalVehicle.year || '—'})
                </span>
                <span className="text-[var(--text-muted)] font-mono">
                  Plate: {pairModalVehicle.plateNumber || pairModalVehicle.licensePlate || 'N/A'} • Code: {pairModalVehicle.vehicleCode || '—'}
                </span>
              </div>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                pairModalVehicle.deviceId 
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' 
                  : 'bg-[var(--bg-surface)] text-[var(--text-muted)] border border-[var(--border-subtle)]'
              }`}>
                {pairModalVehicle.deviceId ? 'CURRENTLY PAIRED' : 'UNPAIRED'}
              </span>
            </div>

            {pairingError && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs">
                {pairingError}
              </div>
            )}

            <form onSubmit={handleSavePairing} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1">
                  Device Hardware IMEI / Tracker ID <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. 864201047281920"
                  value={pairImei}
                  onChange={e => setPairImei(e.target.value)}
                  className="w-full bg-[var(--bg-canvas)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-sm font-mono text-[var(--text-main)] focus:outline-none focus:border-cyan-500"
                  autoFocus
                />
                <p className="text-[10px] text-[var(--text-faint)] mt-1">
                  15-digit IMEI found on the physical GPS device sticker or packaging.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--text-muted)] mb-1">
                  SIM Card Phone Number / ICCID <span className="text-[var(--text-faint)] font-normal">(Optional)</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. +971501234567"
                  value={pairSim}
                  onChange={e => setPairSim(e.target.value)}
                  className="w-full bg-[var(--bg-canvas)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-sm font-mono text-[var(--text-main)] focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="flex items-center justify-between pt-2">
                <div>
                  {pairModalVehicle.deviceId && (
                    <button
                      type="button"
                      onClick={() => handleUnpairDevice(pairModalVehicle)}
                      disabled={savingPairing}
                      className="px-3 py-2 text-xs font-semibold text-rose-400 hover:text-rose-300 transition"
                    >
                      Unpair Device
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPairModalVehicle(null)}
                    disabled={savingPairing}
                    className="px-3.5 py-2 text-xs text-[var(--text-muted)] hover:text-[var(--text-main)] transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingPairing}
                    className="px-5 py-2 bg-gradient-to-r from-cyan-500 to-teal-500 text-slate-950 font-bold text-xs rounded-xl shadow hover:opacity-90 transition disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {savingPairing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                    {savingPairing ? 'Saving…' : 'Save Pairing'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Mobile Tracking Provision Modal */}
      {mobileTrackingModalVehicle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                  <Smartphone className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[var(--text-main)]">Driver Mobile GPS Tracking</h3>
                  <p className="text-[11px] text-[var(--text-muted)]">Track vehicle location &amp; ground speed in absence of hardware GPS</p>
                </div>
              </div>
              <button
                onClick={() => {
                  stopBrowserTracking();
                  setMobileTrackingModalVehicle(null);
                }}
                className="text-[var(--text-muted)] hover:text-[var(--text-main)] text-xl leading-none"
              >
                ×
              </button>
            </div>

            {/* Vehicle Card */}
            <div className="bg-[var(--bg-surface-hover)] p-3.5 rounded-xl border border-[var(--border-subtle)] flex items-center justify-between">
              <div>
                <div className="font-bold text-[var(--text-main)] text-sm">
                  {mobileTrackingModalVehicle.make} {mobileTrackingModalVehicle.model}
                </div>
                <div className="text-xs text-[var(--text-muted)] font-mono mt-0.5">
                  Plate: {mobileTrackingModalVehicle.plateNumber || mobileTrackingModalVehicle.licensePlate || 'N/A'} • Code: {mobileTrackingModalVehicle.vehicleCode || 'No Code'}
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                NO HARDWARE DEVICE
              </span>
            </div>

            {/* Tracking Provision Options */}
            <div className="space-y-3">
              {/* Option 1: Live Browser GPS Streaming */}
              <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-950/15 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                      <Radio className="w-3.5 h-3.5 text-cyan-400" />
                      Stream Live GPS from this Device
                    </h4>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Transmit live GPS &amp; ground speed directly to Fleet Telematics.
                    </p>
                  </div>
                  {isTrackingInBrowser && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 animate-pulse">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      TRANSMITTING
                    </span>
                  )}
                </div>

                {isTrackingInBrowser && (
                  <div className="p-3 rounded-lg bg-slate-900/80 border border-white/5 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] text-slate-400 block font-sans">Ground Speed</span>
                      <span className="font-mono text-2xl font-black text-cyan-400">
                        {browserTrackingSpeed.toFixed(1)} <span className="text-xs font-normal text-slate-400">km/h</span>
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] text-slate-400 block font-sans">Interval</span>
                      <span className="text-xs font-mono text-emerald-400">Every 4s</span>
                    </div>
                  </div>
                )}

                {!isTrackingInBrowser ? (
                  <button
                    type="button"
                    onClick={() => startBrowserTracking(mobileTrackingModalVehicle)}
                    className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 transition active:scale-[0.98]"
                  >
                    <Play className="w-3.5 h-3.5 fill-white" />
                    Turn On Mobile Tracking Now
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={stopBrowserTracking}
                    className="w-full py-2.5 px-4 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-lg shadow-rose-600/20 transition active:scale-[0.98]"
                  >
                    <Square className="w-3.5 h-3.5 fill-white" />
                    Stop Mobile Tracking
                  </button>
                )}
              </div>

              {/* Option 2: Driver Mobile App Link */}
              <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface-hover)] space-y-2.5">
                <div>
                  <h4 className="text-xs font-bold text-[var(--text-main)] flex items-center gap-1.5">
                    <Smartphone className="w-3.5 h-3.5 text-violet-400" />
                    Send to Driver Smartphone
                  </h4>
                  <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                    Driver can log in using Plate Number <strong>{mobileTrackingModalVehicle.plateNumber || mobileTrackingModalVehicle.licensePlate}</strong> or tap the direct link.
                  </p>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <a
                    href={`/driver-app?vehicle=${encodeURIComponent(mobileTrackingModalVehicle.plateNumber || mobileTrackingModalVehicle.licensePlate || mobileTrackingModalVehicle.vehicleCode || '')}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 py-2 px-3 bg-violet-600 hover:bg-violet-500 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition shadow-sm"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Open Driver App
                  </a>
                  <button
                    type="button"
                    onClick={() => copyDriverTrackingLink(mobileTrackingModalVehicle)}
                    className="py-2 px-3 bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-main)] border border-[var(--border-subtle)] rounded-xl text-xs font-medium flex items-center gap-1.5 transition"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    {copiedVehicleId === mobileTrackingModalVehicle.id ? 'Copied Link!' : 'Copy Link'}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => {
                  stopBrowserTracking();
                  setMobileTrackingModalVehicle(null);
                }}
                className="px-4 py-2 text-xs text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

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
                  <div className="text-[11px] text-[var(--text-muted)] uppercase font-semibold flex items-center gap-1"><Gauge className="w-3 h-3" />Odometer</div>
                  <div className="text-sm font-bold text-[var(--text-main)] mt-0.5">
                    {inspectingVehicle.odometerReading?.toLocaleString() ?? 0} km
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-[var(--text-muted)] uppercase font-semibold flex items-center gap-1"><Fuel className="w-3 h-3" />Fuel Level</div>
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
                    <div className="text-xs font-mono font-bold text-[var(--text-main)] mt-1">{inspectingVehicle.chassisNo || inspectingVehicle.vin || 'Not specified'}</div>
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

                  <div className="col-span-2 p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                    <div className="text-[11px] text-[var(--text-muted)] uppercase font-semibold mb-1.5">
                      Assigned Hierarchy (Region → Department → Unit)
                    </div>
                    {inspectingVehicle.regionName || inspectingVehicle.departmentName || inspectingVehicle.unitName ? (
                      <div className="flex items-center gap-1.5 flex-wrap text-xs">
                        {inspectingVehicle.regionName && (
                          <span className="px-2 py-0.5 rounded-md bg-blue-500/15 text-blue-400 border border-blue-500/30 font-semibold text-[11px]">
                            {inspectingVehicle.regionName}
                          </span>
                        )}
                        {inspectingVehicle.regionName && inspectingVehicle.departmentName && (
                          <span className="text-[var(--text-muted)]">→</span>
                        )}
                        {inspectingVehicle.departmentName && (
                          <span className="px-2 py-0.5 rounded-md bg-purple-500/15 text-purple-400 border border-purple-500/30 font-semibold text-[11px]">
                            {inspectingVehicle.departmentName}
                          </span>
                        )}
                        {inspectingVehicle.unitName && (
                          <span className="text-[var(--text-muted)]">→</span>
                        )}
                        {inspectingVehicle.unitName && (
                          <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-semibold text-[11px]">
                            {inspectingVehicle.unitName}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-[var(--text-muted)]">
                        {inspectingVehicle.hierarchyName || 'Not assigned to organizational hierarchy'}
                      </span>
                    )}
                  </div>

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
            </div>
          )}

          {drawerTab === 'telematics' && (() => {
            const isDeviceBlank = !inspectingVehicle.deviceId || inspectingVehicle.deviceId.trim() === '';
            const hasRecentMobilePing = Boolean(
              inspectingVehicle.lastPing &&
              inspectingVehicle.lastPing.source === 'DRIVER_APP' &&
              Date.now() - new Date(inspectingVehicle.lastPing.occurredAt).getTime() < 2 * 60 * 60 * 1000
            );

            return (
              <div className="space-y-4">
                {/* Hardware Telematics Banner */}
                <div className="p-4 rounded-2xl border border-cyan-500/30 bg-gradient-to-r from-cyan-950/20 to-[var(--bg-surface-hover)] space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[11px] text-cyan-400 uppercase font-bold tracking-wider flex items-center gap-1.5">
                        <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                        Hardware Telematics (GPS Tracker)
                      </div>
                      <div className="text-sm font-mono font-bold text-[var(--text-main)] mt-0.5">
                        {inspectingVehicle.deviceId ? (
                          <span className="text-cyan-300 bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-500/30">
                            IMEI: {inspectingVehicle.deviceId}
                          </span>
                        ) : (
                          <span className="text-[var(--text-muted)] italic">No Hardware Device Linked</span>
                        )}
                      </div>
                      {inspectingVehicle.simCardNo && (
                        <div className="text-xs text-[var(--text-muted)] font-mono mt-1">
                          SIM Phone / ICCID: {inspectingVehicle.simCardNo}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {inspectingVehicle.deviceId ? (
                        <>
                          <button
                            type="button"
                            onClick={() => openPairModal(inspectingVehicle)}
                            className="px-3 py-1.5 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 text-xs font-semibold border border-cyan-500/30 transition flex items-center gap-1.5 shadow-sm"
                          >
                            <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                            Edit Pairing
                          </button>
                          <button
                            type="button"
                            onClick={() => handleUnpairDevice(inspectingVehicle)}
                            className="px-2.5 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs font-semibold border border-rose-500/20 transition"
                            title="Unpair hardware tracker"
                          >
                            Unpair
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openPairModal(inspectingVehicle)}
                          className="px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-teal-500 hover:opacity-90 text-slate-950 text-xs font-bold transition flex items-center gap-1.5 shadow-md shadow-cyan-500/20 active:scale-95"
                        >
                          <Cpu className="w-3.5 h-3.5" />
                          Pair Device
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* ── DRIVER MOBILE GPS TRACKING PROVISION ── */}
                {isDeviceBlank && (
                  <div className="p-4 rounded-2xl border border-emerald-500/30 bg-emerald-950/20 space-y-3 shadow-md">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                          <Smartphone className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="text-xs font-bold text-white flex items-center gap-2">
                            Driver Mobile Tracking
                            {hasRecentMobilePing ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 animate-pulse">
                                ONLINE
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                READY
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            Device ID is blank. Mobile smartphone location &amp; speed tracking is available.
                          </p>
                        </div>
                      </div>
                    </div>

                    {hasRecentMobilePing && inspectingVehicle.lastPing && (
                      <div className="grid grid-cols-2 gap-2 text-xs font-mono bg-slate-900/60 p-2.5 rounded-xl border border-white/5">
                        <div>
                          <span className="text-[10px] text-slate-400 font-sans block">Current Speed</span>
                          <span className="font-bold text-cyan-400 text-sm">
                            {(inspectingVehicle.lastPing.speedKmh ?? 0).toFixed(1)} km/h
                          </span>
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 font-sans block">Last Mobile GPS Ping</span>
                          <span className="text-slate-300 text-xs">
                            {new Date(inspectingVehicle.lastPing.occurredAt).toLocaleTimeString()}
                          </span>
                        </div>
                      </div>
                    )}

                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => handleTurnOnMobileTracking(inspectingVehicle)}
                        className="flex-1 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 transition active:scale-[0.98]"
                      >
                        <Play className="w-3.5 h-3.5 fill-white" />
                        Turn On Mobile Tracking
                      </button>
                      <button
                        type="button"
                        onClick={() => copyDriverTrackingLink(inspectingVehicle)}
                        className="px-3.5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/10 rounded-xl text-xs font-medium flex items-center gap-1.5 transition"
                        title="Copy direct tracking link to send to driver via WhatsApp/SMS"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        {copiedVehicleId === inspectingVehicle.id ? 'Copied Link!' : 'Share Link'}
                      </button>
                    </div>
                  </div>
                )}

                <Link
                  href={`/fleet/telematics?history=${encodeURIComponent(inspectingVehicle.id)}`}
                  className="w-full px-4 py-2.5 bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-sm transition"
                >
                  <Navigation className="w-3.5 h-3.5" />
                  View History Tracking & Route Playback 📍
                </Link>

                <div className="space-y-3">
                  <div className="p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] flex justify-between items-center">
                    <span className="text-xs text-[var(--text-muted)]">SIM Card No.</span>
                    <span className="text-xs font-mono font-semibold text-[var(--text-main)]">{inspectingVehicle.simCardNo || '—'}</span>
                  </div>
                  <div className="p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] flex justify-between items-center">
                    <span className="text-xs text-[var(--text-muted)] flex items-center gap-1.5"><UserCheck className="w-3.5 h-3.5 text-emerald-400" />Assigned Driver</span>
                    <div className="text-right">
                      <span className="text-xs font-semibold text-[var(--text-main)] block">
                        {inspectingVehicle.assignedDriverName || (inspectingVehicle.assignedDriverId ? `Driver (${inspectingVehicle.assignedDriverId.slice(0, 8)}…)` : 'Unassigned / Customer Rented')}
                      </span>
                      {inspectingVehicle.assignedDriverPhone && (
                        <span className="text-[11px] text-[var(--text-muted)] font-mono">{inspectingVehicle.assignedDriverPhone}</span>
                      )}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] flex justify-between items-center">
                    <span className="text-xs text-[var(--text-muted)] flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" />Operational Zone</span>
                    <span className="text-xs font-semibold text-[var(--text-main)]">{inspectingVehicle.zoneName || 'All UAE Zones'}</span>
                  </div>
                </div>
              </div>
            );
          })()}

          {drawerTab === 'documents' && (() => {
            // Collect ONLY uploaded documents or documents with recorded files / numbers / expiry
            const activeDocs: Array<{
              id: string;
              name: string;
              documentType: string;
              documentNumber?: string;
              issuingAuthority?: string;
              expiryDate?: string;
              fileName?: string;
              isRegistration?: boolean;
              isInsurance?: boolean;
            }> = [];

            // 1. Registration (Mulkiya)
            const mulkiyaDoc = (inspectingVehicle.documents || []).find(d => d.documentType === 'REGISTRATION');
            const hasRegistration = inspectingVehicle.registrationExpiryDate || inspectingVehicle.mulkiyaFileName || (mulkiyaDoc && (mulkiyaDoc.fileName || mulkiyaDoc.expiryDate || mulkiyaDoc.documentNumber));
            if (hasRegistration) {
              activeDocs.push({
                id: mulkiyaDoc?.id || 'mulkiya-doc',
                name: mulkiyaDoc?.name || 'Registration (Mulkiya)',
                documentType: 'REGISTRATION',
                documentNumber: mulkiyaDoc?.documentNumber || inspectingVehicle.registrationNo || inspectingVehicle.plateNumber || undefined,
                issuingAuthority: mulkiyaDoc?.issuingAuthority || (inspectingVehicle.emirate === 'ABU_DHABI' ? 'Abu Dhabi Police' : inspectingVehicle.emirate === 'DUBAI' ? 'RTA' : undefined),
                expiryDate: inspectingVehicle.registrationExpiryDate || mulkiyaDoc?.expiryDate || undefined,
                fileName: inspectingVehicle.mulkiyaFileName || mulkiyaDoc?.fileName,
                isRegistration: true,
              });
            }

            // 2. Insurance Policy
            const insDoc = (inspectingVehicle.documents || []).find(d => d.documentType === 'INSURANCE');
            const hasInsurance = inspectingVehicle.insuranceExpiryDate || (insDoc && (insDoc.fileName || insDoc.expiryDate || insDoc.documentNumber));
            if (hasInsurance) {
              activeDocs.push({
                id: insDoc?.id || 'insurance-doc',
                name: insDoc?.name || 'Insurance Policy',
                documentType: 'INSURANCE',
                documentNumber: insDoc?.documentNumber || undefined,
                issuingAuthority: insDoc?.issuingAuthority || 'Insurance Authority',
                expiryDate: inspectingVehicle.insuranceExpiryDate || insDoc?.expiryDate || undefined,
                fileName: insDoc?.fileName,
                isInsurance: true,
              });
            }

            // 3. Other uploaded permits & certificates
            const otherDocs = (inspectingVehicle.documents || []).filter(d => 
              !['REGISTRATION', 'INSURANCE'].includes(d.documentType) && 
              (Boolean(d.fileName) || Boolean(d.expiryDate) || Boolean(d.documentNumber))
            );
            for (const d of otherDocs) {
              activeDocs.push({
                id: d.id,
                name: d.name,
                documentType: d.documentType,
                documentNumber: d.documentNumber || undefined,
                issuingAuthority: d.issuingAuthority || undefined,
                expiryDate: d.expiryDate || undefined,
                fileName: d.fileName,
              });
            }

            if (activeDocs.length === 0) {
              return (
                <div className="p-8 rounded-2xl border border-dashed border-[var(--border-subtle)] text-center space-y-3 bg-[var(--bg-surface)]">
                  <div className="w-12 h-12 rounded-full bg-orange-500/10 text-orange-400 flex items-center justify-center mx-auto text-xl">
                    📁
                  </div>
                  <div className="text-xs font-semibold text-[var(--text-main)]">No Documents or Permits Uploaded</div>
                  <p className="text-[11px] text-[var(--text-muted)] max-w-sm mx-auto">
                    This vehicle does not have any attached permits, Mulkiya copy, or insurance certificates yet.
                  </p>
                  <button
                    onClick={() => {
                      const v = inspectingVehicle;
                      setInspectingVehicle(null);
                      openEdit(v);
                      setTab('documents');
                    }}
                    className="px-3.5 py-1.5 bg-gradient-to-r from-orange-500 to-amber-500 text-white rounded-xl text-xs font-semibold hover:opacity-90 shadow-sm transition-opacity inline-flex items-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" /> Upload Document
                  </button>
                </div>
              );
            }

            return (
              <div className="space-y-3">
                {activeDocs.map(doc => {
                  const isExpired = doc.expiryDate ? new Date(doc.expiryDate) < new Date() : false;
                  return (
                    <div key={doc.id} className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] space-y-2.5 shadow-sm">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {doc.isRegistration ? (
                            <span className="text-base">📋</span>
                          ) : doc.isInsurance ? (
                            <Shield className="w-4 h-4 text-blue-400" />
                          ) : (
                            <FileCheck className="w-4 h-4 text-emerald-400" />
                          )}
                          <span className="text-xs font-bold text-[var(--text-main)]">{doc.name}</span>
                        </div>
                        {doc.expiryDate ? (
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            isExpired ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          }`}>
                            {isExpired ? 'Expired' : 'Valid'}
                          </span>
                        ) : (
                          <span className="text-[10px] font-medium text-[var(--text-muted)] bg-[var(--bg-surface-hover)] px-2 py-0.5 rounded">
                            No Expiry Date
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1 border-t border-[var(--border-subtle)]/60 text-xs">
                        {doc.fileName && (
                          <div className="col-span-2 sm:col-span-3 flex items-center gap-1.5 text-[11px] text-orange-400 font-mono bg-orange-500/10 px-2 py-1 rounded-lg border border-orange-500/20">
                            <FileText className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate">{doc.fileName}</span>
                          </div>
                        )}
                        {doc.documentNumber && (
                          <div>
                            <span className="text-[11px] text-[var(--text-muted)] block">Doc / Ref No.</span>
                            <span className="font-mono font-semibold text-[var(--text-main)] text-xs">{doc.documentNumber}</span>
                          </div>
                        )}
                        {doc.issuingAuthority && (
                          <div>
                            <span className="text-[11px] text-[var(--text-muted)] block">Authority</span>
                            <span className="font-medium text-[var(--text-main)] text-xs">{doc.issuingAuthority}</span>
                          </div>
                        )}
                        <div>
                          <span className="text-[11px] text-[var(--text-muted)] block">Expiry Date</span>
                          <span className={`font-semibold text-xs ${isExpired ? 'text-rose-400' : 'text-[var(--text-main)]'}`}>
                            {doc.expiryDate ? new Date(doc.expiryDate).toLocaleDateString() : '—'}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        
          {drawerTab === 'lifecycle' && inspectingVehicle && (() => {
            return (
              <div className="space-y-4">
                {/* Header card with summary & action */}
                <div className="flex items-center justify-between p-3.5 rounded-xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)]">
                  <div>
                    <div className="text-xs font-bold text-[var(--text-main)] flex items-center gap-1.5">
                      <RefreshCw className="w-4 h-4 text-orange-500" />
                      Vehicle Lifecycle History
                    </div>
                    <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                      Auto-captured milestones, stage changes, pairings, and odometer logs
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setLifecycleForm({
                        eventType: 'STAGE_TRANSITION',
                        toStage: inspectingVehicle.lifecycleStage || 'OPERATIONAL',
                        description: '',
                        performedBy: '',
                        cost: '',
                        notes: '',
                      });
                      setShowAddLifecycleModal(true);
                    }}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 border border-orange-500/30 flex items-center gap-1.5 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Log Event
                  </button>
                </div>

                {/* Loading state */}
                {loadingLifecycleEvents ? (
                  <div className="py-12 flex flex-col items-center justify-center text-[var(--text-muted)] gap-2">
                    <Loader2 className="w-6 h-6 animate-spin text-orange-400" />
                    <span className="text-xs">Loading lifecycle history...</span>
                  </div>
                ) : vehicleLifecycleEvents.length === 0 ? (
                  <div className="py-12 text-center rounded-xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6">
                    <RefreshCw className="w-8 h-8 mx-auto text-[var(--text-muted)]/50 mb-2" />
                    <p className="text-xs font-medium text-[var(--text-muted)]">No lifecycle events recorded yet</p>
                    <p className="text-[11px] text-[var(--text-muted)]/70 mt-1">
                      Events are automatically logged as the vehicle progresses through fleet operations.
                    </p>
                  </div>
                ) : (
                  /* Visual timeline */
                  <div className="relative pl-6 space-y-4 before:content-[''] before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-[2px] before:bg-gradient-to-b before:from-orange-500 before:via-orange-500/40 before:to-transparent">
                    {vehicleLifecycleEvents.map((evt) => {
                      const getEventBadge = (type: string) => {
                        switch (type) {
                          case 'ACTIVATION':
                            return { label: 'Vehicle Activation', color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' };
                          case 'STATUS_CHANGE':
                            return { label: 'Status Change', color: 'bg-blue-500/15 text-blue-400 border-blue-500/30' };
                          case 'STAGE_TRANSITION':
                            return { label: 'Stage Transition', color: 'bg-purple-500/15 text-purple-400 border-purple-500/30' };
                          case 'DRIVER_ALLOCATION':
                            return { label: 'Driver Allocation', color: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30' };
                          case 'DEVICE_PAIRING':
                            return { label: 'Device Paired', color: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30' };
                          case 'DEVICE_UNPAIRED':
                            return { label: 'Device Unpaired', color: 'bg-amber-500/15 text-amber-400 border-amber-500/30' };
                          case 'ODOMETER_UPDATE':
                            return { label: 'Odometer Log', color: 'bg-teal-500/15 text-teal-400 border-teal-500/30' };
                          case 'MAINTENANCE':
                          case 'WORK_ORDER':
                            return { label: 'Maintenance', color: 'bg-amber-500/15 text-amber-400 border-amber-500/30' };
                          case 'INSPECTION':
                            return { label: 'Inspection', color: 'bg-sky-500/15 text-sky-400 border-sky-500/30' };
                          case 'DECOMMISSIONED':
                            return { label: 'Decommissioned', color: 'bg-rose-500/15 text-rose-400 border-rose-500/30' };
                          default:
                            return { label: type.replace(/_/g, ' '), color: 'bg-slate-500/15 text-[var(--text-muted)] border-slate-500/30' };
                        }
                      };
                      const badge = getEventBadge(evt.eventType);

                      return (
                        <div key={evt.id} className="relative group">
                          {/* Timeline node marker */}
                          <div className="absolute -left-[30px] top-1.5 w-4 h-4 rounded-full bg-[var(--bg-card)] border-2 border-orange-500 ring-4 ring-[var(--bg-surface)] flex items-center justify-center">
                            <div className="w-1.5 h-1.5 rounded-full bg-orange-400" />
                          </div>

                          <div className="p-3.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-orange-500/40 transition-colors space-y-2 shadow-sm">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${badge.color}`}>
                                {badge.label}
                              </span>
                              <span className="text-[10px] text-[var(--text-muted)] font-mono">
                                {evt.eventDate ? new Date(evt.eventDate).toLocaleString(undefined, {
                                  year: 'numeric',
                                  month: 'short',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                }) : '—'}
                              </span>
                            </div>

                            <p className="text-xs font-semibold text-[var(--text-main)] leading-relaxed">
                              {evt.description}
                            </p>

                            {(evt.fromStage || evt.toStage) && (
                              <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] pt-0.5">
                                <span className="font-medium text-[var(--text-muted)]">Stage:</span>
                                {evt.fromStage && (
                                  <span className="px-1.5 py-0.5 rounded bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[10px]">
                                    {evt.fromStage}
                                  </span>
                                )}
                                {evt.fromStage && <span className="text-orange-400 font-bold">→</span>}
                                {evt.toStage && (
                                  <span className="px-1.5 py-0.5 rounded bg-orange-500/10 border border-orange-500/30 text-orange-400 text-[10px] font-semibold">
                                    {evt.toStage}
                                  </span>
                                )}
                              </div>
                            )}

                            {evt.notes && (
                              <p className="text-[11px] text-[var(--text-muted)] bg-[var(--bg-surface-hover)] p-2 rounded-lg border border-[var(--border-subtle)]/50 italic">
                                {evt.notes}
                              </p>
                            )}

                            <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)] pt-1 border-t border-[var(--border-subtle)]/40">
                              <span className="flex items-center gap-1">
                                <span>Recorded by:</span>
                                <strong className="text-[var(--text-main)]">{evt.performedBy || 'System Automated'}</strong>
                              </span>
                              {evt.cost != null && Number(evt.cost) > 0 && (
                                <span className="font-semibold text-amber-400 font-mono">
                                  AED {Number(evt.cost).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

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
                <p className="text-xs text-[var(--text-muted)] mt-0.5">Fill in vehicle identity, Mulkiya copy, and regulatory permits</p>
              </div>
              <button onClick={() => setShowModal(false)} className="text-[var(--text-muted)] hover:text-[var(--text-main)] text-2xl leading-none">×</button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-[var(--border-subtle)] flex-shrink-0">
              {(['basic', 'fleet', 'documents'] as const).map(t => (
                <button key={t} onClick={() => setTab(t)}
                  className={`px-6 py-3 text-xs font-semibold transition-colors border-b-2 ${tab === t ? 'border-orange-500 text-orange-500' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-main)]'}`}>
                  {t === 'basic' ? '📋 Basic Details' : t === 'fleet' ? '🚗 Fleet Assignment' : '📄 Documents & Permits'}
                </button>
              ))}
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {error && <div className="bg-rose-500/10 border border-rose-500/30 text-rose-400 px-4 py-3 rounded-xl text-xs">{error}</div>}

              {/* TAB: Basic Details */}
              {tab === 'basic' && (
                <div className="space-y-6">
                  {/* Top Header with Mulkiya Upload on the Right Corner */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
                    <div className="md:col-span-2 space-y-4">
                      <div>
                        <h3 className="text-xs font-bold text-orange-500 uppercase tracking-wider mb-2">Vehicle Identification</h3>
                        <p className="text-xs text-[var(--text-muted)]">
                          Enter vehicle identifiers manually or upload a Mulkiya / Registration card on the right for instant AI autofill.
                        </p>
                      </div>

                      {/* Detected Info Notification */}
                      {detectedInfo && !detectedDismissed && (
                        <div className="bg-gradient-to-r from-blue-600/15 to-cyan-600/15 border border-blue-500/30 rounded-xl p-3.5">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1.5">
                                <span className="text-blue-400 text-base">🤖</span>
                                <span className="text-xs font-bold text-blue-300">Smart Vehicle Identification</span>
                              </div>
                              <div className="grid grid-cols-3 gap-2 mt-2">
                                <div className="bg-[var(--bg-surface)] rounded-lg px-2.5 py-1.5 border border-[var(--border-subtle)]">
                                  <div className="text-[10px] text-[var(--text-muted)]">Segment</div>
                                  <div className="text-xs font-bold text-[var(--text-main)]">
                                    {VEHICLE_SEGMENTS.find(s => s.value === detectedInfo.segment)?.label ?? detectedInfo.segment}
                                  </div>
                                </div>
                                <div className="bg-[var(--bg-surface)] rounded-lg px-2.5 py-1.5 border border-[var(--border-subtle)]">
                                  <div className="text-[10px] text-[var(--text-muted)]">Class</div>
                                  <div className="text-xs font-bold text-[var(--text-main)]">{detectedInfo.vehicleClass.replace(/_/g, ' ')}</div>
                                </div>
                                <div className="bg-[var(--bg-surface)] rounded-lg px-2.5 py-1.5 border border-[var(--border-subtle)]">
                                  <div className="text-[10px] text-[var(--text-muted)]">Suggested Type</div>
                                  <div className="text-xs font-bold text-[var(--text-main)]">{detectedInfo.suggestedType}</div>
                                </div>
                              </div>
                            </div>
                            <div className="flex flex-col gap-1.5">
                              <button type="button" onClick={applyDetection}
                                className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shadow-sm">
                                ✓ Apply
                              </button>
                              <button type="button" onClick={() => setDetectedDismissed(true)}
                                className="px-3 py-1 bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-main)] text-xs rounded-lg transition-colors whitespace-nowrap">
                                Dismiss
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Vehicle Code</label>
                          <input 
                            value={form.vehicleCode ?? ''} 
                            onChange={e => f('vehicleCode', e.target.value.toUpperCase())}
                            placeholder="e.g. FLEET-101 or DXB-042"
                            className="w-full bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-[var(--text-main)] text-xs font-mono focus:outline-none focus:border-orange-500/50" 
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">VIN / Chassis No. <span className="text-rose-400">*</span></label>
                          <input 
                            value={form.chassisNo ?? form.vin ?? ''} 
                            onChange={e => { f('chassisNo', e.target.value.toUpperCase()); f('vin', e.target.value.toUpperCase()); }}
                            placeholder="17-character VIN"
                            className="w-full bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-[var(--text-main)] text-xs font-mono uppercase focus:outline-none focus:border-orange-500/50" 
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-4">
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
                        <div>
                          <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Model Year</label>
                          <input
                            type="number"
                            min={1970}
                            max={new Date().getFullYear() + 2}
                            value={form.yearOfManufacture || form.year || ''}
                            onChange={e => {
                              const y = parseInt(e.target.value, 10);
                              f('year', y);
                              f('yearOfManufacture', y);
                            }}
                            placeholder="e.g. 2024"
                            className="w-full bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-[var(--text-main)] text-xs font-mono focus:outline-none focus:border-orange-500/50" />
                        </div>
                      </div>
                    </div>

                    {/* Right Corner: Mulkiya / Registration Copy Attachment Card */}
                    <div className="bg-gradient-to-br from-orange-500/10 via-amber-500/5 to-[var(--bg-surface-hover)] border-2 border-dashed border-orange-500/30 hover:border-orange-500/60 transition-all rounded-2xl p-4 flex flex-col justify-between h-full">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-orange-400 uppercase tracking-wider flex items-center gap-1.5">
                            <Sparkles className="w-3.5 h-3.5" /> Attach Mulkiya
                          </span>
                          <span className="text-[10px] font-semibold bg-orange-500/20 text-orange-300 px-2 py-0.5 rounded-full border border-orange-500/30">
                            AI Autofill
                          </span>
                        </div>
                        <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                          Upload UAE Registration card (Mulkiya) copy. AI will automatically scan and autofill plate, chassis, make, model & dates.
                        </p>
                      </div>

                      {mulkiyaScanSuccess && (
                        <div className="my-2 p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                          <span className="leading-tight">{mulkiyaScanSuccess}</span>
                        </div>
                      )}

                      {mulkiyaScanError && (
                        <div className="my-2 p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                          <span className="leading-tight">{mulkiyaScanError}</span>
                        </div>
                      )}

                      <div className="mt-3">
                        <input
                          ref={mulkiyaInputRef}
                          type="file"
                          accept="image/*,application/pdf"
                          className="hidden"
                          onChange={e => {
                            const file = e.target.files?.[0];
                            if (file) handleMulkiyaUpload(file);
                          }}
                        />

                        {form.mulkiyaFileName ? (
                          <div className="p-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 overflow-hidden">
                              <FileText className="w-4 h-4 text-orange-400 shrink-0" />
                              <span className="text-xs font-medium text-[var(--text-main)] truncate font-mono">
                                {form.mulkiyaFileName}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => mulkiyaInputRef.current?.click()}
                              disabled={mulkiyaScanning}
                              className="text-[11px] font-semibold text-orange-400 hover:text-orange-300 shrink-0"
                            >
                              Replace
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => mulkiyaInputRef.current?.click()}
                            disabled={mulkiyaScanning}
                            className="w-full py-3 bg-orange-500/15 hover:bg-orange-500/25 border border-orange-500/30 text-orange-400 rounded-xl font-semibold text-xs transition-colors flex items-center justify-center gap-2"
                          >
                            {mulkiyaScanning ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin text-orange-400" />
                                <span>Reading Mulkiya with AI…</span>
                              </>
                            ) : (
                              <>
                                <Upload className="w-4 h-4" />
                                <span>Upload Mulkiya / Registration</span>
                              </>
                            )}
                          </button>
                        )}
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

                  <div>
                    <h3 className="text-xs font-bold text-orange-500 uppercase tracking-wider mb-4">Acquisition & Initial Odometer</h3>
                    <div className="grid grid-cols-4 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Acquisition Type</label>
                        <select value={form.acquisitionType ?? 'PURCHASE'} onChange={e => f('acquisitionType', e.target.value)}
                          className="w-full bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-[var(--text-main)] text-xs focus:outline-none focus:border-orange-500/50">
                          {ACQUISITION_TYPES.map(a => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5 flex items-center gap-1"><Calendar className="w-3 h-3" />Purchase Date</label>
                        <input type="date" value={form.purchaseDate ? form.purchaseDate.slice(0, 10) : ''}
                          onChange={e => f('purchaseDate', e.target.value)}
                          className="w-full bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-[var(--text-main)] text-xs focus:outline-none focus:border-orange-500/50" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Purchase Price (AED)</label>
                        <input type="number" min={0} value={form.purchasePrice ?? 0}
                          onChange={e => f('purchasePrice', Number(e.target.value))}
                          className="w-full bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-[var(--text-main)] text-xs font-mono focus:outline-none focus:border-orange-500/50" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5 flex items-center gap-1"><Gauge className="w-3 h-3" />Odometer (km)</label>
                        <input type="number" min={0} value={form.odometerReading ?? 0}
                          onChange={e => f('odometerReading', Number(e.target.value))}
                          className="w-full bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-[var(--text-main)] text-xs font-mono focus:outline-none focus:border-orange-500/50" />
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
                    <h3 className="text-xs font-bold text-orange-500 uppercase tracking-wider mb-4 flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5" /> Organizational Hierarchy (Region → Department → Unit)
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Region</label>
                        <select
                          value={form.regionId ?? ''}
                          onChange={e => handleVehicleRegionChange(e.target.value)}
                          className="w-full bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-[var(--text-main)] text-xs focus:outline-none focus:border-orange-500/50"
                        >
                          <option value="">— Select Region —</option>
                          {hierarchyRegions.map(r => (
                            <option key={r.id} value={r.id}>{r.name} {r.code ? `(${r.code})` : ''}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Department</label>
                        <select
                          value={form.departmentId ?? ''}
                          onChange={e => handleVehicleDeptChange(e.target.value)}
                          disabled={!form.regionId}
                          className="w-full bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-[var(--text-main)] text-xs focus:outline-none focus:border-orange-500/50 disabled:opacity-50"
                        >
                          <option value="">{!form.regionId ? 'Select Region First' : '— Select Department —'}</option>
                          {vehicleDepts.map(d => (
                            <option key={d.id} value={d.id}>{d.name} {d.code ? `(${d.code})` : ''}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Unit / Section</label>
                        <select
                          value={form.unitId ?? ''}
                          onChange={e => handleVehicleUnitChange(e.target.value)}
                          disabled={!form.departmentId}
                          className="w-full bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-[var(--text-main)] text-xs focus:outline-none focus:border-orange-500/50 disabled:opacity-50"
                        >
                          <option value="">{!form.departmentId ? 'Select Department First' : '— Select Unit / Section —'}</option>
                          {vehicleUnits.map(u => (
                            <option key={u.id} value={u.id}>{u.name} {u.code ? `(${u.code})` : ''}</option>
                          ))}
                        </select>
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

                  <div>
                    <h3 className="text-xs font-bold text-orange-500 uppercase tracking-wider mb-4 flex items-center gap-1.5">
                      <UserCheck className="w-3.5 h-3.5" /> Driver & Operational Zone
                    </h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Assigned Driver</label>
                        <select
                          value={form.assignedDriverId ?? ''}
                          onChange={e => f('assignedDriverId', e.target.value)}
                          className="w-full bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-[var(--text-main)] text-xs focus:outline-none focus:border-orange-500/50"
                        >
                          <option value="">— Unassigned / Customer Rented —</option>
                          {driverList.map(dr => (
                            <option key={dr.id} value={dr.id}>{dr.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">Operational Zone</label>
                        <select
                          value={form.zoneId ?? ''}
                          onChange={e => f('zoneId', e.target.value)}
                          className="w-full bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl px-3.5 py-2 text-[var(--text-main)] text-xs focus:outline-none focus:border-orange-500/50"
                        >
                          <option value="">All UAE Zones</option>
                          {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB: Documents & Permits */}
              {tab === 'documents' && (() => {
                const coreDocs = (form.documents || []).filter(d => d.id === 'mulkiya-doc' || d.id === 'insurance-doc' || d.documentType === 'REGISTRATION' || d.documentType === 'INSURANCE');
                const additionalDocs = (form.documents || []).filter(d => d.id !== 'mulkiya-doc' && d.id !== 'insurance-doc' && d.documentType !== 'REGISTRATION' && d.documentType !== 'INSURANCE');

                return (
                  <div className="space-y-6">
                    {/* Primary Section: Vehicle Registration & Insurance */}
                    <div className="space-y-3">
                      <div>
                        <h3 className="text-xs font-bold text-orange-500 uppercase tracking-wider">Vehicle Registration & Insurance</h3>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5">
                          Primary mandatory registration (Mulkiya) and comprehensive insurance policy documentation.
                        </p>
                      </div>

                      <div className="space-y-3">
                        {coreDocs.map((doc) => {
                          const isScanning = scanningDocId === doc.id;
                          return (
                            <div 
                              key={doc.id}
                              className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface-hover)]/40 space-y-3"
                            >
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-2.5">
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                  <FileCheck className="w-4 h-4 text-orange-400 shrink-0" />
                                  <span className="font-bold text-xs sm:text-sm text-[var(--text-main)] tracking-tight">
                                    {doc.name}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  {doc.autofilled && (
                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                                      <Sparkles className="w-3 h-3" /> AI Autofilled ({Math.round((doc.confidence || 0.85) * 100)}%)
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
                                <div>
                                  <label className="block text-[11px] font-semibold text-[var(--text-muted)] mb-1">Document / Certificate No.</label>
                                  <input
                                    type="text"
                                    value={doc.documentNumber}
                                    onChange={e => updateDocField(doc.id, 'documentNumber', e.target.value)}
                                    placeholder={doc.documentType === 'REGISTRATION' ? "e.g. 12345678" : "e.g. POL-98234"}
                                    className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-3 py-1.5 text-xs font-mono text-[var(--text-main)] focus:outline-none focus:border-orange-500/50"
                                  />
                                </div>

                                <div>
                                  <label className="block text-[11px] font-semibold text-[var(--text-muted)] mb-1">Issuing Authority</label>
                                  <input
                                    type="text"
                                    value={doc.issuingAuthority ?? ''}
                                    onChange={e => updateDocField(doc.id, 'issuingAuthority', e.target.value)}
                                    placeholder="e.g. RTA, Abu Dhabi Police, Oman ROP"
                                    className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-3 py-1.5 text-xs text-[var(--text-main)] focus:outline-none focus:border-orange-500/50"
                                  />
                                </div>

                                <div>
                                  <label className="block text-[11px] font-semibold text-[var(--text-muted)] mb-1">Expiry Date</label>
                                  <input
                                    type="date"
                                    value={doc.expiryDate ? doc.expiryDate.slice(0, 10) : ''}
                                    onChange={e => updateDocField(doc.id, 'expiryDate', e.target.value)}
                                    className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-3 py-1.5 text-xs text-[var(--text-main)] focus:outline-none focus:border-orange-500/50"
                                  />
                                </div>

                                <div>
                                  <label className="block text-[11px] font-semibold text-[var(--text-muted)] mb-1">Attachment File</label>
                                  <div className="flex items-center gap-2">
                                    <label className="flex-1 cursor-pointer">
                                      <input
                                        type="file"
                                        accept="image/*,application/pdf"
                                        className="hidden"
                                        onChange={e => {
                                          const file = e.target.files?.[0];
                                          if (file) handleDocumentFileUpload(doc.id, file);
                                        }}
                                      />
                                      <div className="w-full px-3 py-1.5 bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl text-xs flex items-center justify-between text-[var(--text-main)] transition-colors">
                                        <span className="truncate max-w-[140px] font-mono text-[11px]">
                                          {doc.fileName || 'Attach File (AI Read)'}
                                        </span>
                                        {isScanning ? (
                                          <Loader2 className="w-3.5 h-3.5 animate-spin text-orange-400 shrink-0" />
                                        ) : (
                                          <Upload className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                                        )}
                                      </div>
                                    </label>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Additional Section: Additional Documents and Permits */}
                    <div className="space-y-3 pt-5 border-t border-[var(--border-subtle)]">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-xs font-bold text-orange-500 uppercase tracking-wider">Additional Documents and Permits</h3>
                          <p className="text-xs text-[var(--text-muted)] mt-0.5">
                            Attach custom authority permits, civil defense certificates, commercial transport permits, or GPS certifications.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={addCustomDocument}
                          className="px-3 py-1.5 bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 border border-orange-500/30 rounded-xl text-xs font-semibold transition-colors flex items-center gap-1.5"
                        >
                          <Plus className="w-3.5 h-3.5" /> Add Document
                        </button>
                      </div>

                      {additionalDocs.length === 0 ? (
                        <div className="p-6 rounded-xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-surface)] text-center space-y-2">
                          <p className="text-xs text-[var(--text-muted)]">No additional documents or permits added.</p>
                          <button
                            type="button"
                            onClick={addCustomDocument}
                            className="inline-flex items-center gap-1.5 text-xs text-orange-400 hover:text-orange-300 font-semibold"
                          >
                            <Plus className="w-3.5 h-3.5" /> Add Document / Permit
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {additionalDocs.map((doc) => {
                            const isScanning = scanningDocId === doc.id;
                            return (
                              <div 
                                key={doc.id}
                                className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface-hover)]/40 space-y-3"
                              >
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-2.5">
                                  <div className="flex items-center gap-2 flex-1 min-w-0">
                                    <FileCheck className="w-4 h-4 text-orange-400 shrink-0" />
                                    <input
                                      type="text"
                                      value={doc.name}
                                      onChange={e => updateDocField(doc.id, 'name', e.target.value)}
                                      placeholder="Document / Permit Name (e.g. Authority Permit, Civil Defense, GPS Certificate)"
                                      className="w-full max-w-md bg-[var(--bg-surface)] font-bold text-xs sm:text-sm text-[var(--text-main)] px-2.5 py-1 rounded-lg border border-[var(--border-subtle)] focus:outline-none focus:border-orange-500"
                                    />
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    {doc.autofilled && (
                                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                                        <Sparkles className="w-3 h-3" /> AI Autofilled ({Math.round((doc.confidence || 0.85) * 100)}%)
                                      </span>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => removeDocument(doc.id)}
                                      className="text-[11px] font-semibold text-rose-400 hover:text-rose-300 px-2 py-0.5 rounded hover:bg-rose-500/10 transition-colors"
                                    >
                                      Remove
                                    </button>
                                  </div>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
                                  <div>
                                    <label className="block text-[11px] font-semibold text-[var(--text-muted)] mb-1">Document / Certificate No.</label>
                                    <input
                                      type="text"
                                      value={doc.documentNumber}
                                      onChange={e => updateDocField(doc.id, 'documentNumber', e.target.value)}
                                      placeholder="e.g. POL-98234 or CR-2024"
                                      className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-3 py-1.5 text-xs font-mono text-[var(--text-main)] focus:outline-none focus:border-orange-500/50"
                                    />
                                  </div>

                                  <div>
                                    <label className="block text-[11px] font-semibold text-[var(--text-muted)] mb-1">Issuing Authority</label>
                                    <input
                                      type="text"
                                      value={doc.issuingAuthority ?? ''}
                                      onChange={e => updateDocField(doc.id, 'issuingAuthority', e.target.value)}
                                      placeholder="e.g. Civil Defense, Municipality, SIRA"
                                      className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-3 py-1.5 text-xs text-[var(--text-main)] focus:outline-none focus:border-orange-500/50"
                                    />
                                  </div>

                                  <div>
                                    <label className="block text-[11px] font-semibold text-[var(--text-muted)] mb-1">Expiry Date</label>
                                    <input
                                      type="date"
                                      value={doc.expiryDate ? doc.expiryDate.slice(0, 10) : ''}
                                      onChange={e => updateDocField(doc.id, 'expiryDate', e.target.value)}
                                      className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-3 py-1.5 text-xs text-[var(--text-main)] focus:outline-none focus:border-orange-500/50"
                                    />
                                  </div>

                                  <div>
                                    <label className="block text-[11px] font-semibold text-[var(--text-muted)] mb-1">Attachment File</label>
                                    <div className="flex items-center gap-2">
                                      <label className="flex-1 cursor-pointer">
                                        <input
                                          type="file"
                                          accept="image/*,application/pdf"
                                          className="hidden"
                                          onChange={e => {
                                            const file = e.target.files?.[0];
                                            if (file) handleDocumentFileUpload(doc.id, file);
                                          }}
                                        />
                                        <div className="w-full px-3 py-1.5 bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] rounded-xl text-xs flex items-center justify-between text-[var(--text-main)] transition-colors">
                                          <span className="truncate max-w-[140px] font-mono text-[11px]">
                                            {doc.fileName || 'Attach File (AI Read)'}
                                          </span>
                                          {isScanning ? (
                                            <Loader2 className="w-3.5 h-3.5 animate-spin text-orange-400 shrink-0" />
                                          ) : (
                                            <Upload className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                                          )}
                                        </div>
                                      </label>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-[var(--border-subtle)] flex items-center justify-between flex-shrink-0 bg-[var(--bg-surface)]">
              <div className="flex gap-2">
                {(['basic', 'fleet', 'documents'] as const).filter(t => t !== tab).map(t => (
                  <button key={t} onClick={() => setTab(t)} className="px-3.5 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-main)] bg-[var(--bg-surface-hover)] rounded-lg transition-colors">
                    {t === 'basic' ? '← Basic Details' : t === 'fleet' ? '→ Fleet Assignment' : '→ Documents & Permits'}
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
