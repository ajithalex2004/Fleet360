'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LogisticsMessage,
  readLogisticsApiError,
  type LogisticsApiError,
} from '@/components/logistics/master-data-fields';
import {
  BadgeCheck,
  Building2,
  FileCheck2,
  FileClock,
  FileUp,
  Loader2,
  RefreshCcw,
  Search,
  ShieldCheck,
  Truck,
  Upload,
} from 'lucide-react';
import { KpiCard, KpiGrid, PageHeader, Panel, StatusPill } from '@/components/ui/page-theme';

type SessionMe = {
  userId: string;
  tenantId: string;
  role?: string;
};

type Carrier = {
  id: string;
  carrierCode: string | null;
  carrierType: string | null;
  name: string;
  tradeLicense: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  status: string;
  onboardingStatus: string | null;
  complianceStatus: string | null;
  serviceRegions: unknown;
  capacityProfile: unknown;
  commissionModel: string | null;
  commissionRate: number | null;
  metadata: {
    documentSummary?: {
      total?: number;
      pending?: number;
      verified?: number;
      expired?: number;
      expiringSoon?: number;
    };
    fleetSummary?: {
      total?: number;
      active?: number;
      available?: number;
      assigned?: number;
      blocked?: number;
      verified?: number;
      expired?: number;
      expiringSoon?: number;
    };
  };
  createdAt: string | null;
  updatedAt: string | null;
};

type CarrierDocument = {
  id: string;
  carrierId: string;
  documentType: string;
  documentName: string;
  documentUrl: string;
  fileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
  status: string;
  issueDate: string | null;
  expiryDate: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  createdAt: string | null;
};

type CarrierVehicle = {
  id: string;
  carrierId: string;
  ownerDriverId: string | null;
  vehicleCode: string | null;
  plateNo: string;
  registrationNo: string | null;
  vehicleType: string;
  make: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  capacityTons: number | null;
  volumeCbm: number | null;
  palletCapacity: number | null;
  axleCount: number | null;
  gpsEnabled: boolean;
  gpsProvider: string | null;
  homeRegion: string | null;
  currentRegion: string | null;
  availabilityStatus: string;
  complianceStatus: string;
  status: string;
  registrationExpiry: string | null;
  insuranceExpiry: string | null;
  permitExpiry: string | null;
  inspectionExpiry: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  createdAt: string | null;
};

const emptyCarrierForm = {
  name: '',
  carrierCode: '',
  carrierType: 'TRANSPORT_COMPANY',
  tradeLicense: '',
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  commissionModel: 'COMMISSION',
  commissionRate: '8',
};

const emptyComplianceForm = {
  status: 'ACTIVE',
  onboardingStatus: 'DRAFT',
  complianceStatus: 'PENDING',
  serviceRegions: '["Dubai","Abu Dhabi"]',
  capacityProfile: '{"truckTypes":["3T","7T","40FT"],"availableTrucks":0}',
  commissionModel: 'COMMISSION',
  commissionRate: '8',
  notes: '',
};

const emptyDocumentForm = {
  documentType: 'TRADE_LICENSE',
  documentName: '',
  issueDate: '',
  expiryDate: '',
  documentUrl: '',
};

const emptyVehicleForm = {
  ownerDriverId: '',
  vehicleCode: '',
  plateNo: '',
  registrationNo: '',
  vehicleType: '40FT_TRAILER',
  make: '',
  model: '',
  year: String(new Date().getFullYear()),
  capacityTons: '24',
  volumeCbm: '',
  palletCapacity: '',
  axleCount: '',
  homeRegion: 'Dubai',
  currentRegion: 'Dubai',
  gpsEnabled: false,
  gpsProvider: '',
  registrationExpiry: '',
  insuranceExpiry: '',
  permitExpiry: '',
  inspectionExpiry: '',
};

const DOCUMENT_TYPES = [
  'TRADE_LICENSE',
  'INSURANCE',
  'VEHICLE_REGISTRATION',
  'DRIVER_LICENSE',
  'VAT_CERTIFICATE',
  'BANK_DETAILS',
  'SAFETY_CERTIFICATE',
  'CONTRACT',
];

const CARRIER_VEHICLE_TYPES = [
  'PICKUP',
  '3T_TRUCK',
  '7T_TRUCK',
  '10T_TRUCK',
  '40FT_TRAILER',
  'FLATBED',
  'CURTAIN_SIDE',
  'REEFER',
  'LOWBED',
  'TANKER',
];

function useTenantQuery(tenantId: string | null) {
  return useCallback((path: string, extra?: Record<string, string | number | null | undefined>) => {
    const params = new URLSearchParams();
    if (tenantId) params.set('tenantId', tenantId);
    Object.entries(extra ?? {}).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== '') params.set(key, String(value));
    });
    const query = params.toString();
    return `${path}${query ? `?${query}` : ''}`;
  }, [tenantId]);
}

function formatBytes(value?: number | null) {
  if (!value) return '-';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function dateLabel(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('en-AE');
}

function parseJsonField(value: string, fallback: unknown) {
  try {
    return value.trim() ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

export default function LogisticsCarrierOnboardingPage() {
  const [me, setMe] = useState<SessionMe | null>(null);
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [documents, setDocuments] = useState<CarrierDocument[]>([]);
  const [vehicles, setVehicles] = useState<CarrierVehicle[]>([]);
  const [selectedCarrierId, setSelectedCarrierId] = useState('');
  const [carrierForm, setCarrierForm] = useState(emptyCarrierForm);
  const [complianceForm, setComplianceForm] = useState(emptyComplianceForm);
  const [documentForm, setDocumentForm] = useState(emptyDocumentForm);
  const [vehicleForm, setVehicleForm] = useState(emptyVehicleForm);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [vehiclesLoading, setVehiclesLoading] = useState(false);
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const [apiError, setApiError] = useState<LogisticsApiError | null>(null);
  const [notice, setNotice] = useState('');

  const tenantId = me?.tenantId ?? null;
  const url = useTenantQuery(tenantId);
  const selectedCarrier = carriers.find(carrier => carrier.id === selectedCarrierId) ?? carriers[0] ?? null;

  const filteredCarriers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return carriers.filter(carrier => !q || [
      carrier.name,
      carrier.carrierCode,
      carrier.tradeLicense,
      carrier.contactEmail,
      carrier.contactPhone,
    ].some(value => value?.toLowerCase().includes(q)));
  }, [carriers, search]);

  const kpis = useMemo(() => {
    const active = carriers.filter(carrier => carrier.status === 'ACTIVE').length;
    const compliant = carriers.filter(carrier => carrier.complianceStatus === 'COMPLIANT').length;
    const review = carriers.filter(carrier => ['PENDING', 'REVIEW_REQUIRED'].includes(carrier.complianceStatus ?? '')).length;
    const expired = carriers.filter(carrier => carrier.complianceStatus === 'EXPIRED').length;
    return { active, compliant, review, expired };
  }, [carriers]);

  const docSummary = selectedCarrier?.metadata?.documentSummary ?? {};
  const fleetSummary = selectedCarrier?.metadata?.fleetSummary ?? {};

  const loadSession = useCallback(async () => {
    const res = await fetch('/api/auth/me', { cache: 'no-store' });
    if (!res.ok) throw new Error('Please sign in before opening carrier onboarding.');
    setMe(await res.json());
  }, []);

  const loadCarriers = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(url('/api/logistics/carriers', { limit: 300 }), { cache: 'no-store' });
      if (!res.ok) throw new Error((await readLogisticsApiError(res)).message);
      const data = await res.json();
      const nextCarriers = Array.isArray(data.carriers) ? data.carriers : [];
      setCarriers(nextCarriers);
      setSelectedCarrierId(current => current || nextCarriers[0]?.id || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load carriers');
    } finally {
      setLoading(false);
    }
  }, [tenantId, url]);

  const loadDocuments = useCallback(async (carrierId: string | null) => {
    if (!tenantId || !carrierId) {
      setDocuments([]);
      return;
    }
    setDocumentsLoading(true);
    try {
      const res = await fetch(url(`/api/logistics/carriers/${carrierId}/documents`), { cache: 'no-store' });
      if (!res.ok) throw new Error((await readLogisticsApiError(res)).message);
      const data = await res.json();
      setDocuments(Array.isArray(data.documents) ? data.documents : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load carrier documents');
    } finally {
      setDocumentsLoading(false);
    }
  }, [tenantId, url]);

  const loadVehicles = useCallback(async (carrierId: string | null) => {
    if (!tenantId || !carrierId) {
      setVehicles([]);
      return;
    }
    setVehiclesLoading(true);
    try {
      const res = await fetch(url(`/api/logistics/carriers/${carrierId}/vehicles`), { cache: 'no-store' });
      if (!res.ok) throw new Error((await readLogisticsApiError(res)).message);
      const data = await res.json();
      setVehicles(Array.isArray(data.vehicles) ? data.vehicles : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load carrier fleet');
    } finally {
      setVehiclesLoading(false);
    }
  }, [tenantId, url]);

  useEffect(() => {
    loadSession().catch(err => {
      setError(err instanceof Error ? err.message : 'Failed to load session');
      setLoading(false);
    });
  }, [loadSession]);

  useEffect(() => {
    loadCarriers();
  }, [loadCarriers]);

  useEffect(() => {
    if (!selectedCarrier) return;
    setComplianceForm({
      status: selectedCarrier.status ?? 'ACTIVE',
      onboardingStatus: selectedCarrier.onboardingStatus ?? 'DRAFT',
      complianceStatus: selectedCarrier.complianceStatus ?? 'PENDING',
      serviceRegions: JSON.stringify(selectedCarrier.serviceRegions ?? [], null, 2),
      capacityProfile: JSON.stringify(selectedCarrier.capacityProfile ?? {}, null, 2),
      commissionModel: selectedCarrier.commissionModel ?? 'COMMISSION',
      commissionRate: String(selectedCarrier.commissionRate ?? 8),
      notes: '',
    });
    loadDocuments(selectedCarrier.id);
    loadVehicles(selectedCarrier.id);
  }, [loadDocuments, loadVehicles, selectedCarrier]);

  const refreshAll = async () => {
    await loadCarriers();
    await loadDocuments(selectedCarrier?.id ?? null);
    await loadVehicles(selectedCarrier?.id ?? null);
  };

  const createCarrier = async () => {
    if (!tenantId || !carrierForm.name.trim()) return;
    setSaving('carrier');
    setError('');
    setApiError(null);
    setNotice('');
    try {
      const res = await fetch(url('/api/logistics/carriers'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: carrierForm.name.trim(),
          carrierCode: carrierForm.carrierCode.trim() || null,
          carrierType: carrierForm.carrierType,
          tradeLicense: carrierForm.tradeLicense.trim() || null,
          contactName: carrierForm.contactName.trim() || null,
          contactEmail: carrierForm.contactEmail.trim() || null,
          contactPhone: carrierForm.contactPhone.trim() || null,
          status: 'ACTIVE',
          onboardingStatus: 'DRAFT',
          complianceStatus: 'PENDING',
          commissionModel: carrierForm.commissionModel,
          commissionRate: Number(carrierForm.commissionRate || 0),
          metadata: { source: 'carrier-onboarding-ui' },
        }),
      });
      if (!res.ok) {
        const parsed = await readLogisticsApiError(res);
        setApiError(parsed);
        throw new Error(parsed.message);
      }
      const data = await res.json();
      setSelectedCarrierId(data.carrier?.id ?? '');
      setCarrierForm(emptyCarrierForm);
      setNotice('Carrier profile created.');
      await loadCarriers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create carrier');
    } finally {
      setSaving('');
    }
  };

  const saveCompliance = async () => {
    if (!selectedCarrier) return;
    setSaving('compliance');
    setError('');
    setApiError(null);
    setNotice('');
    try {
      const res = await fetch(url(`/api/logistics/carriers/${selectedCarrier.id}/compliance`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: complianceForm.status,
          onboardingStatus: complianceForm.onboardingStatus,
          complianceStatus: complianceForm.complianceStatus,
          serviceRegions: parseJsonField(complianceForm.serviceRegions, []),
          capacityProfile: parseJsonField(complianceForm.capacityProfile, {}),
          commissionModel: complianceForm.commissionModel,
          commissionRate: Number(complianceForm.commissionRate || 0),
          notes: complianceForm.notes || null,
        }),
      });
      if (!res.ok) {
        const parsed = await readLogisticsApiError(res);
        setApiError(parsed);
        throw new Error(parsed.message);
      }
      setNotice('Carrier compliance profile saved.');
      await loadCarriers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save compliance profile');
    } finally {
      setSaving('');
    }
  };

  const uploadDocument = async () => {
    if (!selectedCarrier || !documentForm.documentType || (!selectedFile && !documentForm.documentUrl.trim())) return;
    setSaving('document');
    setError('');
    setApiError(null);
    setNotice('');
    try {
      let res: Response;
      if (selectedFile) {
        const form = new FormData();
        form.set('documentType', documentForm.documentType);
        form.set('documentName', documentForm.documentName || selectedFile.name);
        form.set('issueDate', documentForm.issueDate);
        form.set('expiryDate', documentForm.expiryDate);
        form.set('file', selectedFile);
        res = await fetch(url(`/api/logistics/carriers/${selectedCarrier.id}/documents`), {
          method: 'POST',
          body: form,
        });
      } else {
        res = await fetch(url(`/api/logistics/carriers/${selectedCarrier.id}/documents`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            documentType: documentForm.documentType,
            documentName: documentForm.documentName || documentForm.documentType,
            documentUrl: documentForm.documentUrl,
            issueDate: documentForm.issueDate || null,
            expiryDate: documentForm.expiryDate || null,
          }),
        });
      }
      if (!res.ok) {
        const parsed = await readLogisticsApiError(res);
        setApiError(parsed);
        throw new Error(parsed.message);
      }
      setDocumentForm(emptyDocumentForm);
      setSelectedFile(null);
      setNotice('Compliance document added to the vault.');
      await loadDocuments(selectedCarrier.id);
      await loadCarriers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add compliance document');
    } finally {
      setSaving('');
    }
  };

  const reviewDocument = async (documentId: string, status: string) => {
    if (!selectedCarrier) return;
    setSaving(`doc:${documentId}:${status}`);
    setError('');
    setApiError(null);
    setNotice('');
    try {
      const res = await fetch(url(`/api/logistics/carriers/${selectedCarrier.id}/documents/${documentId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const parsed = await readLogisticsApiError(res);
        setApiError(parsed);
        throw new Error(parsed.message);
      }
      setNotice(`Document marked ${status.toLowerCase().replace(/_/g, ' ')}.`);
      await loadDocuments(selectedCarrier.id);
      await loadCarriers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to review document');
    } finally {
      setSaving('');
    }
  };

  const archiveDocument = async (documentId: string) => {
    if (!selectedCarrier) return;
    setSaving(`archive:${documentId}`);
    setError('');
    setApiError(null);
    setNotice('');
    try {
      const res = await fetch(url(`/api/logistics/carriers/${selectedCarrier.id}/documents/${documentId}`), {
        method: 'DELETE',
      });
      if (!res.ok) {
        const parsed = await readLogisticsApiError(res);
        setApiError(parsed);
        throw new Error(parsed.message);
      }
      setNotice('Document archived.');
      await loadDocuments(selectedCarrier.id);
      await loadCarriers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to archive document');
    } finally {
      setSaving('');
    }
  };

  const saveVehicle = async () => {
    if (!selectedCarrier || !vehicleForm.plateNo.trim() || !vehicleForm.vehicleType.trim()) return;
    setSaving('vehicle');
    setError('');
    setNotice('');
    try {
      const res = await fetch(url(`/api/logistics/carriers/${selectedCarrier.id}/vehicles`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerDriverId: vehicleForm.ownerDriverId.trim() || null,
          vehicleCode: vehicleForm.vehicleCode.trim() || null,
          plateNo: vehicleForm.plateNo.trim(),
          registrationNo: vehicleForm.registrationNo.trim() || null,
          vehicleType: vehicleForm.vehicleType,
          make: vehicleForm.make.trim() || null,
          model: vehicleForm.model.trim() || null,
          year: Number(vehicleForm.year || 0) || null,
          capacityTons: Number(vehicleForm.capacityTons || 0) || null,
          volumeCbm: Number(vehicleForm.volumeCbm || 0) || null,
          palletCapacity: Number(vehicleForm.palletCapacity || 0) || null,
          axleCount: Number(vehicleForm.axleCount || 0) || null,
          homeRegion: vehicleForm.homeRegion.trim() || null,
          currentRegion: vehicleForm.currentRegion.trim() || null,
          gpsEnabled: vehicleForm.gpsEnabled,
          gpsProvider: vehicleForm.gpsProvider.trim() || null,
          registrationExpiry: vehicleForm.registrationExpiry || null,
          insuranceExpiry: vehicleForm.insuranceExpiry || null,
          permitExpiry: vehicleForm.permitExpiry || null,
          inspectionExpiry: vehicleForm.inspectionExpiry || null,
          metadata: { ownerModel: selectedCarrier.carrierType === 'TRUCK_OWNER' ? 'OWNER_OPERATOR' : 'CARRIER_FLEET' },
        }),
      });
      if (!res.ok) throw new Error((await readLogisticsApiError(res)).message);
      setVehicleForm(emptyVehicleForm);
      setNotice('Carrier truck saved and linked to compliance.');
      await loadVehicles(selectedCarrier.id);
      await loadCarriers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save carrier truck');
    } finally {
      setSaving('');
    }
  };

  const updateVehicleStatus = async (
    vehicleId: string,
    patch: Partial<Pick<CarrierVehicle, 'availabilityStatus' | 'complianceStatus' | 'status'>>,
  ) => {
    if (!selectedCarrier) return;
    setSaving(`vehicle:${vehicleId}:${patch.complianceStatus ?? patch.availabilityStatus ?? patch.status}`);
    setError('');
    setNotice('');
    try {
      const res = await fetch(url(`/api/logistics/carriers/${selectedCarrier.id}/vehicles/${vehicleId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error((await readLogisticsApiError(res)).message);
      setNotice('Carrier truck status updated.');
      await loadVehicles(selectedCarrier.id);
      await loadCarriers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update carrier truck');
    } finally {
      setSaving('');
    }
  };

  const archiveVehicle = async (vehicleId: string) => {
    if (!selectedCarrier) return;
    setSaving(`vehicle-archive:${vehicleId}`);
    setError('');
    setNotice('');
    try {
      const res = await fetch(url(`/api/logistics/carriers/${selectedCarrier.id}/vehicles/${vehicleId}`), {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error((await readLogisticsApiError(res)).message);
      setNotice('Carrier truck archived.');
      await loadVehicles(selectedCarrier.id);
      await loadCarriers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to archive carrier truck');
    } finally {
      setSaving('');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Carrier Onboarding"
        subtitle="Onboard transport companies, manage compliance readiness, and maintain a tenant-scoped document vault."
        icon={Truck}
        accent="amber"
        actions={(
          <button
            onClick={refreshAll}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/15"
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
        )}
      />

      {apiError ? (
        <LogisticsMessage
          type="error"
          title="Carrier compliance action failed"
          message={apiError.message}
          issues={apiError.issues}
          warnings={apiError.warnings}
        />
      ) : error ? (
        <LogisticsMessage type="error" title="Carrier compliance action failed" message={error} />
      ) : null}
      {notice && <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-100">{notice}</div>}

      <KpiGrid>
        <KpiCard label="Active" value={kpis.active} sub={`${carriers.length} carriers`} icon={Building2} accent="blue" />
        <KpiCard label="Compliant" value={kpis.compliant} sub="Ready to award" icon={ShieldCheck} accent="emerald" />
        <KpiCard label="Review" value={kpis.review} sub="Needs attention" icon={FileClock} accent="amber" />
        <KpiCard label="Expired" value={kpis.expired} sub="Blocked" icon={FileCheck2} accent="rose" />
      </KpiGrid>

      <div className="grid gap-6 xl:grid-cols-[430px_minmax(0,1fr)]">
        <div className="space-y-6">
          <Panel
            title="Carrier Directory"
            subtitle="Search and select a carrier profile."
            icon={Search}
            accent="amber"
            actions={<StatusPill status={loading ? 'pending' : 'active'} label={loading ? 'Loading' : `${filteredCarriers.length} carriers`} />}
          >
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Search carrier, code, license, email..."
              className="mb-4 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
            />
            <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {loading ? (
                <div className="space-y-2">{[...Array(5)].map((_, index) => <div key={index} className="h-20 animate-pulse rounded-2xl bg-white/5" />)}</div>
              ) : filteredCarriers.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-sm text-slate-400">No carriers found.</div>
              ) : (
                filteredCarriers.map(carrier => {
                  const active = selectedCarrier?.id === carrier.id;
                  return (
                    <button
                      key={carrier.id}
                      onClick={() => setSelectedCarrierId(carrier.id)}
                      className={`w-full rounded-2xl border p-4 text-left transition-all ${
                        active
                          ? 'border-amber-400/50 bg-amber-400/10 shadow-lg shadow-amber-950/20'
                          : 'border-white/10 bg-white/[0.04] hover:border-white/20 hover:bg-white/[0.07]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-white">{carrier.name}</p>
                          <p className="mt-1 text-xs text-slate-400">{carrier.carrierCode ?? 'No code'} · {carrier.carrierType ?? 'Carrier'}</p>
                        </div>
                        <StatusPill status={carrier.complianceStatus ?? 'pending'} />
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-400">
                        <span>{carrier.contactName ?? 'No contact'}</span>
                        <span className="text-right">{carrier.contactPhone ?? carrier.contactEmail ?? '-'}</span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </Panel>

          <Panel title="New Carrier" subtitle="Create a carrier profile before inviting it to bid." icon={Building2} accent="blue">
            <div className="space-y-3">
              <input className="field" placeholder="Carrier name" value={carrierForm.name} onChange={event => setCarrierForm({ ...carrierForm, name: event.target.value })} />
              <div className="grid grid-cols-2 gap-3">
                <input className="field" placeholder="Carrier code" value={carrierForm.carrierCode} onChange={event => setCarrierForm({ ...carrierForm, carrierCode: event.target.value })} />
                <select className="field" value={carrierForm.carrierType} onChange={event => setCarrierForm({ ...carrierForm, carrierType: event.target.value })}>
                  <option value="TRANSPORT_COMPANY">Transport company</option>
                  <option value="TRUCK_OWNER">Truck owner</option>
                  <option value="BROKER">Broker</option>
                </select>
              </div>
              <input className="field" placeholder="Trade license" value={carrierForm.tradeLicense} onChange={event => setCarrierForm({ ...carrierForm, tradeLicense: event.target.value })} />
              <input className="field" placeholder="Contact name" value={carrierForm.contactName} onChange={event => setCarrierForm({ ...carrierForm, contactName: event.target.value })} />
              <div className="grid grid-cols-2 gap-3">
                <input className="field" placeholder="Email" value={carrierForm.contactEmail} onChange={event => setCarrierForm({ ...carrierForm, contactEmail: event.target.value })} />
                <input className="field" placeholder="Phone" value={carrierForm.contactPhone} onChange={event => setCarrierForm({ ...carrierForm, contactPhone: event.target.value })} />
              </div>
              <button
                onClick={createCarrier}
                disabled={saving === 'carrier' || !carrierForm.name.trim()}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-400 px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving === 'carrier' ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}
                Create carrier
              </button>
            </div>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel
            title={selectedCarrier ? selectedCarrier.name : 'Compliance Workspace'}
            subtitle={selectedCarrier ? `${selectedCarrier.carrierCode ?? 'Carrier'} · ${selectedCarrier.tradeLicense ?? 'No trade license'}` : 'Select a carrier to manage compliance.'}
            icon={ShieldCheck}
            accent="emerald"
            actions={selectedCarrier && <StatusPill status={selectedCarrier.complianceStatus ?? 'pending'} />}
          >
            {!selectedCarrier ? (
              <div className="rounded-2xl border border-dashed border-white/15 p-12 text-center text-slate-400">Select a carrier to begin onboarding.</div>
            ) : (
              <div className="space-y-6">
                <div className="grid gap-4 md:grid-cols-4">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Documents</p>
                    <p className="mt-2 text-2xl font-bold text-white">{docSummary.total ?? documents.length}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Verified</p>
                    <p className="mt-2 text-2xl font-bold text-emerald-300">{docSummary.verified ?? documents.filter(doc => doc.status === 'VERIFIED').length}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Pending</p>
                    <p className="mt-2 text-2xl font-bold text-amber-300">{docSummary.pending ?? documents.filter(doc => doc.status === 'PENDING_REVIEW').length}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Expired</p>
                    <p className="mt-2 text-2xl font-bold text-rose-300">{docSummary.expired ?? 0}</p>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-3">
                  <select className="field" value={complianceForm.status} onChange={event => setComplianceForm({ ...complianceForm, status: event.target.value })}>
                    <option value="ACTIVE">Active</option>
                    <option value="INACTIVE">Inactive</option>
                    <option value="SUSPENDED">Suspended</option>
                  </select>
                  <select className="field" value={complianceForm.onboardingStatus} onChange={event => setComplianceForm({ ...complianceForm, onboardingStatus: event.target.value })}>
                    <option value="DRAFT">Draft</option>
                    <option value="INVITED">Invited</option>
                    <option value="IN_REVIEW">In review</option>
                    <option value="APPROVED">Approved</option>
                  </select>
                  <select className="field" value={complianceForm.complianceStatus} onChange={event => setComplianceForm({ ...complianceForm, complianceStatus: event.target.value })}>
                    <option value="PENDING">Pending</option>
                    <option value="REVIEW_REQUIRED">Review required</option>
                    <option value="COMPLIANT">Compliant</option>
                    <option value="EXPIRED">Expired</option>
                    <option value="BLOCKED">Blocked</option>
                  </select>
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <textarea className="field min-h-28 font-mono text-xs" value={complianceForm.serviceRegions} onChange={event => setComplianceForm({ ...complianceForm, serviceRegions: event.target.value })} />
                  <textarea className="field min-h-28 font-mono text-xs" value={complianceForm.capacityProfile} onChange={event => setComplianceForm({ ...complianceForm, capacityProfile: event.target.value })} />
                </div>
                <div className="grid gap-4 lg:grid-cols-[1fr_140px_1.4fr]">
                  <select className="field" value={complianceForm.commissionModel} onChange={event => setComplianceForm({ ...complianceForm, commissionModel: event.target.value })}>
                    <option value="COMMISSION">Commission</option>
                    <option value="MARKUP">Markup</option>
                    <option value="FIXED_FEE">Fixed fee</option>
                  </select>
                  <input className="field" type="number" value={complianceForm.commissionRate} onChange={event => setComplianceForm({ ...complianceForm, commissionRate: event.target.value })} />
                  <input className="field" placeholder="Review notes" value={complianceForm.notes} onChange={event => setComplianceForm({ ...complianceForm, notes: event.target.value })} />
                </div>
                <button
                  onClick={saveCompliance}
                  disabled={saving === 'compliance'}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-300 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving === 'compliance' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  Save compliance
                </button>
              </div>
            )}
          </Panel>

          {selectedCarrier && (
            <Panel title="Carrier Fleet / Truck Onboarding" subtitle="Register third-party trucks and link owner-driver, capacity, availability, and compliance readiness." icon={Truck} accent="amber">
              <div className="grid gap-4 md:grid-cols-4">
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Fleet</p>
                  <p className="mt-2 text-2xl font-bold text-white">{fleetSummary.total ?? vehicles.length}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Available</p>
                  <p className="mt-2 text-2xl font-bold text-emerald-300">{fleetSummary.available ?? vehicles.filter(vehicle => vehicle.availabilityStatus === 'AVAILABLE').length}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Verified</p>
                  <p className="mt-2 text-2xl font-bold text-cyan-300">{fleetSummary.verified ?? vehicles.filter(vehicle => vehicle.complianceStatus === 'VERIFIED').length}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Blocked</p>
                  <p className="mt-2 text-2xl font-bold text-rose-300">{fleetSummary.blocked ?? vehicles.filter(vehicle => vehicle.availabilityStatus === 'BLOCKED' || vehicle.status === 'BLOCKED').length}</p>
                </div>
              </div>

              <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-white">Add / Update Truck</p>
                    <p className="text-xs text-slate-400">Use the same plate to update an existing carrier truck.</p>
                  </div>
                  <StatusPill status={selectedCarrier.complianceStatus ?? 'pending'} label="Carrier compliance" />
                </div>
                <div className="grid gap-3 lg:grid-cols-4">
                  <input className="field" placeholder="Plate no *" value={vehicleForm.plateNo} onChange={event => setVehicleForm({ ...vehicleForm, plateNo: event.target.value })} />
                  <select className="field" value={vehicleForm.vehicleType} onChange={event => setVehicleForm({ ...vehicleForm, vehicleType: event.target.value })}>
                    {CARRIER_VEHICLE_TYPES.map(type => <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>)}
                  </select>
                  <input className="field" placeholder="Owner driver ID / code" value={vehicleForm.ownerDriverId} onChange={event => setVehicleForm({ ...vehicleForm, ownerDriverId: event.target.value })} />
                  <input className="field" placeholder="Vehicle code" value={vehicleForm.vehicleCode} onChange={event => setVehicleForm({ ...vehicleForm, vehicleCode: event.target.value })} />
                  <input className="field" placeholder="Registration no" value={vehicleForm.registrationNo} onChange={event => setVehicleForm({ ...vehicleForm, registrationNo: event.target.value })} />
                  <input className="field" placeholder="Make" value={vehicleForm.make} onChange={event => setVehicleForm({ ...vehicleForm, make: event.target.value })} />
                  <input className="field" placeholder="Model" value={vehicleForm.model} onChange={event => setVehicleForm({ ...vehicleForm, model: event.target.value })} />
                  <input className="field" type="number" placeholder="Year" value={vehicleForm.year} onChange={event => setVehicleForm({ ...vehicleForm, year: event.target.value })} />
                  <input className="field" type="number" placeholder="Capacity tons" value={vehicleForm.capacityTons} onChange={event => setVehicleForm({ ...vehicleForm, capacityTons: event.target.value })} />
                  <input className="field" type="number" placeholder="Volume CBM" value={vehicleForm.volumeCbm} onChange={event => setVehicleForm({ ...vehicleForm, volumeCbm: event.target.value })} />
                  <input className="field" type="number" placeholder="Pallet capacity" value={vehicleForm.palletCapacity} onChange={event => setVehicleForm({ ...vehicleForm, palletCapacity: event.target.value })} />
                  <input className="field" type="number" placeholder="Axles" value={vehicleForm.axleCount} onChange={event => setVehicleForm({ ...vehicleForm, axleCount: event.target.value })} />
                  <input className="field" placeholder="Home region" value={vehicleForm.homeRegion} onChange={event => setVehicleForm({ ...vehicleForm, homeRegion: event.target.value })} />
                  <input className="field" placeholder="Current region" value={vehicleForm.currentRegion} onChange={event => setVehicleForm({ ...vehicleForm, currentRegion: event.target.value })} />
                  <input className="field" placeholder="GPS provider" value={vehicleForm.gpsProvider} onChange={event => setVehicleForm({ ...vehicleForm, gpsProvider: event.target.value })} />
                  <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm font-semibold text-white">
                    <input
                      type="checkbox"
                      checked={vehicleForm.gpsEnabled}
                      onChange={event => setVehicleForm({ ...vehicleForm, gpsEnabled: event.target.checked })}
                    />
                    GPS enabled
                  </label>
                </div>
                <div className="mt-3 grid gap-3 lg:grid-cols-4">
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Registration expiry
                    <input className="field mt-1" type="date" value={vehicleForm.registrationExpiry} onChange={event => setVehicleForm({ ...vehicleForm, registrationExpiry: event.target.value })} />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Insurance expiry
                    <input className="field mt-1" type="date" value={vehicleForm.insuranceExpiry} onChange={event => setVehicleForm({ ...vehicleForm, insuranceExpiry: event.target.value })} />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Permit expiry
                    <input className="field mt-1" type="date" value={vehicleForm.permitExpiry} onChange={event => setVehicleForm({ ...vehicleForm, permitExpiry: event.target.value })} />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Inspection expiry
                    <input className="field mt-1" type="date" value={vehicleForm.inspectionExpiry} onChange={event => setVehicleForm({ ...vehicleForm, inspectionExpiry: event.target.value })} />
                  </label>
                </div>
                <button
                  onClick={saveVehicle}
                  disabled={saving === 'vehicle' || !vehicleForm.plateNo.trim()}
                  className="mt-4 inline-flex items-center gap-2 rounded-xl bg-amber-300 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving === 'vehicle' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}
                  Save truck
                </button>
              </div>

              <div className="mt-5 overflow-hidden rounded-2xl border border-white/10">
                <table className="w-full min-w-[980px] text-left text-sm">
                  <thead className="bg-white/[0.04] text-xs uppercase tracking-wider text-slate-400">
                    <tr>
                      <th className="px-4 py-3">Truck</th>
                      <th className="px-4 py-3">Capacity</th>
                      <th className="px-4 py-3">Region</th>
                      <th className="px-4 py-3">Expiry</th>
                      <th className="px-4 py-3">Availability</th>
                      <th className="px-4 py-3">Compliance</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/8">
                    {vehiclesLoading ? (
                      <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">Loading carrier fleet...</td></tr>
                    ) : vehicles.length === 0 ? (
                      <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">No third-party trucks onboarded for this carrier yet.</td></tr>
                    ) : vehicles.map(vehicle => (
                      <tr key={vehicle.id} className="bg-white/[0.02] text-slate-200">
                        <td className="px-4 py-3">
                          <p className="font-bold text-white">{vehicle.plateNo}</p>
                          <p className="mt-1 text-xs text-slate-400">{vehicle.vehicleType.replace(/_/g, ' ')} · {vehicle.make ?? '-'} {vehicle.model ?? ''}</p>
                          {vehicle.ownerDriverId && <p className="mt-1 text-xs text-slate-500">Driver: {vehicle.ownerDriverId}</p>}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-300">
                          <p>{vehicle.capacityTons ?? '-'} tons</p>
                          <p>{vehicle.volumeCbm ?? '-'} CBM · {vehicle.palletCapacity ?? '-'} pallets</p>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-300">
                          <p>{vehicle.currentRegion ?? '-'}</p>
                          <p className="text-slate-500">Home: {vehicle.homeRegion ?? '-'}</p>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-300">
                          <p>Reg: {dateLabel(vehicle.registrationExpiry)}</p>
                          <p>Ins: {dateLabel(vehicle.insuranceExpiry)}</p>
                        </td>
                        <td className="px-4 py-3"><StatusPill status={vehicle.availabilityStatus} /></td>
                        <td className="px-4 py-3"><StatusPill status={vehicle.complianceStatus} /></td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap justify-end gap-2">
                            <button
                              onClick={() => updateVehicleStatus(vehicle.id, { complianceStatus: 'VERIFIED', availabilityStatus: 'AVAILABLE', status: 'ACTIVE' })}
                              disabled={saving.startsWith(`vehicle:${vehicle.id}`)}
                              className="rounded-lg bg-emerald-100 px-3 py-1.5 text-xs font-bold text-emerald-900 hover:bg-emerald-200"
                            >
                              Verify
                            </button>
                            <button
                              onClick={() => updateVehicleStatus(vehicle.id, { availabilityStatus: 'BLOCKED', status: 'BLOCKED', complianceStatus: 'REVIEW_REQUIRED' })}
                              disabled={saving.startsWith(`vehicle:${vehicle.id}`)}
                              className="rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-bold text-amber-900 hover:bg-amber-200"
                            >
                              Block
                            </button>
                            <button
                              onClick={() => archiveVehicle(vehicle.id)}
                              disabled={saving === `vehicle-archive:${vehicle.id}`}
                              className="rounded-lg bg-rose-100 px-3 py-1.5 text-xs font-bold text-rose-900 hover:bg-rose-200"
                            >
                              Archive
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}

          {selectedCarrier && (
            <Panel title="Compliance Document Vault" subtitle="Upload, verify, replace, or archive carrier compliance evidence." icon={FileUp} accent="cyan">
              <div className="grid gap-4 lg:grid-cols-[1fr_1fr_1fr]">
                <select className="field" value={documentForm.documentType} onChange={event => setDocumentForm({ ...documentForm, documentType: event.target.value })}>
                  {DOCUMENT_TYPES.map(type => <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>)}
                </select>
                <input className="field" placeholder="Document name" value={documentForm.documentName} onChange={event => setDocumentForm({ ...documentForm, documentName: event.target.value })} />
                <input className="field" placeholder="Document URL fallback" value={documentForm.documentUrl} onChange={event => setDocumentForm({ ...documentForm, documentUrl: event.target.value })} />
                <input className="field" type="date" value={documentForm.issueDate} onChange={event => setDocumentForm({ ...documentForm, issueDate: event.target.value })} />
                <input className="field" type="date" value={documentForm.expiryDate} onChange={event => setDocumentForm({ ...documentForm, expiryDate: event.target.value })} />
                <input className="field file:mr-3 file:rounded-lg file:border-0 file:bg-cyan-100 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-cyan-900" type="file" onChange={event => setSelectedFile(event.target.files?.[0] ?? null)} />
              </div>
              <button
                onClick={uploadDocument}
                disabled={saving === 'document' || (!selectedFile && !documentForm.documentUrl.trim())}
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-cyan-200 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving === 'document' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Add document
              </button>

              <div className="mt-5 overflow-hidden rounded-2xl border border-white/10">
                <table className="w-full min-w-[850px] text-left text-sm">
                  <thead className="bg-white/[0.04] text-xs uppercase tracking-wider text-slate-400">
                    <tr>
                      <th className="px-4 py-3">Document</th>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3">Validity</th>
                      <th className="px-4 py-3">File</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/8">
                    {documentsLoading ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Loading documents...</td></tr>
                    ) : documents.length === 0 ? (
                      <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">No compliance documents uploaded yet.</td></tr>
                    ) : documents.map(document => (
                      <tr key={document.id} className="bg-white/[0.02] text-slate-200">
                        <td className="px-4 py-3">
                          <a href={document.documentUrl} target="_blank" rel="noreferrer" className="font-semibold text-cyan-200 hover:text-cyan-100">
                            {document.documentName}
                          </a>
                          <p className="mt-1 text-xs text-slate-500">{document.id.slice(0, 8)}</p>
                        </td>
                        <td className="px-4 py-3 text-xs font-semibold text-slate-300">{document.documentType.replace(/_/g, ' ')}</td>
                        <td className="px-4 py-3 text-xs text-slate-300">
                          {dateLabel(document.issueDate)} to {dateLabel(document.expiryDate)}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-400">
                          {document.fileName ?? 'External link'} · {formatBytes(document.fileSize)}
                        </td>
                        <td className="px-4 py-3"><StatusPill status={document.status} /></td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => reviewDocument(document.id, 'VERIFIED')}
                              disabled={saving.startsWith(`doc:${document.id}`)}
                              className="rounded-lg bg-emerald-100 px-3 py-1.5 text-xs font-bold text-emerald-900 hover:bg-emerald-200"
                            >
                              Verify
                            </button>
                            <button
                              onClick={() => reviewDocument(document.id, 'NEEDS_UPDATE')}
                              disabled={saving.startsWith(`doc:${document.id}`)}
                              className="rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-bold text-amber-900 hover:bg-amber-200"
                            >
                              Rework
                            </button>
                            <button
                              onClick={() => archiveDocument(document.id)}
                              disabled={saving === `archive:${document.id}`}
                              className="rounded-lg bg-rose-100 px-3 py-1.5 text-xs font-bold text-rose-900 hover:bg-rose-200"
                            >
                              Archive
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
        </div>
      </div>

      <style jsx>{`
        .field {
          width: 100%;
          border-radius: 0.75rem;
          border: 1px solid rgba(255,255,255,0.10);
          background: rgba(2,6,23,0.68);
          padding: 0.65rem 0.8rem;
          color: white;
          font-size: 0.875rem;
          outline: none;
        }
        .field::placeholder {
          color: rgb(100 116 139);
        }
        .field:focus {
          border-color: rgba(251,191,36,0.70);
          box-shadow: 0 0 0 3px rgba(251,191,36,0.10);
        }
      `}</style>
    </div>
  );
}
