'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  Clock,
  Gavel,
  HandCoins,
  Link2,
  Loader2,
  RefreshCcw,
  Search,
  Send,
  ShieldCheck,
  Truck,
  Users,
} from 'lucide-react';
import { KpiCard, KpiGrid, PageHeader, Panel, StatusPill } from '@/components/ui/page-theme';
import {
  ShipmentValidationSummary,
  combineMasterOptions,
  LogisticsMessage,
  masterLabel,
  masterValue,
  readLogisticsApiError,
  useLogisticsMasterData,
  useLogisticsPolling,
  useShipmentValidation,
  validateShipmentPayload,
  type LogisticsApiError,
  type LogisticsComplianceBlocker,
  type LogisticsMasterDataItem,
} from '@/components/logistics/master-data-fields';

type SessionMe = {
  userId: string;
  tenantId: string;
  tenantName?: string;
  role?: string;
};

type CustomerMarketplacePolicy = {
  tenantId: string;
  customerId: string | null;
  customerName: string | null;
  rfqEnabled: boolean;
  bidSubmissionEnabled: boolean;
  directAssignmentEnabled: boolean;
  defaultProcurementMode: 'DIRECT_ONLY' | 'RFQ_NO_BIDS' | 'RFQ_BIDDING' | string;
  requireRfqBeforeAward: boolean;
  configured: boolean;
  notes?: string | null;
};

type Shipment = {
  id: string;
  shipmentNo: string;
  cargoOwnerCustomerId: string | null;
  cargoOwnerName: string | null;
  shipmentType: string | null;
  bookingMode: string | null;
  marketplaceStatus: string | null;
  status: string;
  priority: string | null;
  originName: string | null;
  originAddress: string | null;
  destinationName: string | null;
  destinationAddress: string | null;
  pickupWindowFrom: string | null;
  pickupWindowTo: string | null;
  deliveryWindowFrom: string | null;
  deliveryWindowTo: string | null;
  requestedVehicleType: string | null;
  totalWeightKg: number | null;
  customerRateAmount: number | null;
  carrierCostAmount: number | null;
  currency: string | null;
  createdAt: string | null;
  customerMarketplacePolicy?: CustomerMarketplacePolicy | null;
};

type Carrier = {
  id: string;
  carrierCode: string | null;
  carrierType: string | null;
  name: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  status: string;
  onboardingStatus: string | null;
  complianceStatus: string | null;
};

type CarrierVehicle = {
  id: string;
  carrierId: string;
  plateNo: string;
  vehicleType: string;
  make: string | null;
  model: string | null;
  ownerDriverId: string | null;
  availabilityStatus: string;
  complianceStatus: string;
  status: string;
};

type CarrierInvite = {
  id: string;
  carrierId: string;
  status: string;
  expiresAt: string | null;
  lastAccessedAt: string | null;
  carrier?: {
    name: string | null;
    complianceStatus: string | null;
  };
};

type Rfq = {
  id: string;
  tenantId: string;
  shipmentOrderId: string;
  rfqNo: string | null;
  status: string;
  inviteScope: string | null;
  bidDeadlineAt: string | null;
  negotiationRound: number | null;
  awardedBidId: string | null;
  metadata: Record<string, unknown>;
  bidCount: number;
  createdAt: string | null;
  updatedAt: string | null;
  customerMarketplacePolicy?: CustomerMarketplacePolicy | null;
};

type Bid = {
  id: string;
  tenantId: string;
  shipmentOrderId: string;
  rfqId: string | null;
  carrierId: string;
  carrierName: string | null;
  bidNo: string | null;
  amount: number;
  currency: string | null;
  transitTimeHours: number | null;
  validityUntil: string | null;
  status: string;
  notes: string | null;
  createdAt: string | null;
};

type Assignment = {
  id: string;
  carrierId: string | null;
  carrierName: string | null;
  driverId: string | null;
  vehicleId: string | null;
  assignmentType: string | null;
  status: string;
  costAmount: number | null;
  currency: string | null;
  createdAt: string | null;
};

type ShipmentTimeline = {
  events: Array<{
    id: string;
    type: string;
    status: string | null;
    source: string;
    occurredAt: string | null;
    notes: string | null;
  }>;
  pods: Array<{ id: string; status: string; deliveredAt: string | null; recipientName: string | null }>;
  finance: {
    customerCharges: Array<{ id: string; totalAmount: number; currency: string; status: string }>;
    carrierPayables: Array<{ id: string; totalAmount: number; currency: string; status: string }>;
    postings?: Array<{
      id: string;
      postingType: string;
      financeInvoiceId: string | null;
      financeJournalEntryId: string | null;
      amount: number;
      currency: string;
      status: string;
    }>;
  };
};

const emptyCreateForm = {
  shipmentOrderId: '',
  inviteScope: 'SELECTED_CARRIERS',
  bidDeadlineAt: '',
  invitedCarrierIds: [] as string[],
};

const emptyBidForm = {
  carrierId: '',
  amount: '',
  transitTimeHours: '',
  validityUntil: '',
  notes: '',
};

const emptyShipmentForm = {
  cargoOwnerName: '',
  cargoOwnerEmail: '',
  cargoOwnerPhone: '',
  shipmentType: '',
  originName: '',
  destinationName: '',
  requestedVehicleType: '',
  pickupWindowFrom: '',
  pickupWindowTo: '',
  deliveryWindowFrom: '',
  deliveryWindowTo: '',
  totalWeightKg: '',
  customerRateAmount: '',
};

const DEFAULT_VEHICLE_TYPE_OPTIONS: LogisticsMasterDataItem[] = [
  'Light Truck',
  'Heavy Truck',
  'Flatbed',
  'Reefer Truck',
  'Tanker',
  'Box Truck',
  'Trailer',
].map((label, index) => ({
  id: `vehicle-type-${index}`,
  type: 'VEHICLE_TYPE',
  code: label.toUpperCase().replace(/[^A-Z0-9]+/g, '_'),
  label,
  status: 'ACTIVE',
}));

const emptyAwardDraft = {
  vehicleId: '',
  driverId: '',
  overrideCompliance: false,
  overrideReason: '',
};

function money(value?: number | null, currency = 'AED') {
  if (value == null || Number.isNaN(Number(value))) return '-';
  return `${currency} ${Number(value).toLocaleString('en-AE', { maximumFractionDigits: 2 })}`;
}

function dateTime(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('en-AE', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function toIsoOrNull(value: string) {
  return value ? new Date(value).toISOString() : null;
}

function findMasterByLabel(items: LogisticsMasterDataItem[], value: string) {
  return items.find(item => masterValue(item) === value || item.code === value || item.label === value) ?? null;
}

function hoursLabel(hours?: number | null) {
  if (hours == null) return '-';
  if (hours < 24) return `${hours} hr`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? `${days}d ${rest}h` : `${days} days`;
}

function routeLabel(shipment?: Shipment | null) {
  if (!shipment) return '-';
  const origin = shipment.originName ?? shipment.originAddress ?? 'Origin';
  const destination = shipment.destinationName ?? shipment.destinationAddress ?? 'Destination';
  return `${origin} -> ${destination}`;
}

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

export default function LogisticsMarketplacePage() {
  const [me, setMe] = useState<SessionMe | null>(null);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [rfqs, setRfqs] = useState<Rfq[]>([]);
  const [bids, setBids] = useState<Bid[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [timeline, setTimeline] = useState<ShipmentTimeline | null>(null);
  const [carrierVehicles, setCarrierVehicles] = useState<Record<string, CarrierVehicle[]>>({});
  const [carrierInvites, setCarrierInvites] = useState<CarrierInvite[]>([]);
  const [awardDrafts, setAwardDrafts] = useState<Record<string, typeof emptyAwardDraft>>({});
  const [awardBlockers, setAwardBlockers] = useState<Record<string, LogisticsComplianceBlocker[]>>({});
  const [selectedRfqId, setSelectedRfqId] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [apiError, setApiError] = useState<LogisticsApiError | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showShipmentCreate, setShowShipmentCreate] = useState(false);
  const [showBidPanel, setShowBidPanel] = useState(false);
  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [shipmentForm, setShipmentForm] = useState(emptyShipmentForm);
  const [bidForm, setBidForm] = useState(emptyBidForm);
  const [inviteLinks, setInviteLinks] = useState<Record<string, string>>({});

  const tenantId = me?.tenantId ?? null;
  const url = useTenantQuery(tenantId);
  const masterData = useLogisticsMasterData(['CUSTOMER', 'SHIPPER', 'PICKUP_LOCATION', 'AIRPORT', 'COUNTRY', 'SERVICE_TYPE', 'VEHICLE_TYPE']);
  const customerOptions = useMemo(
    () => combineMasterOptions(masterData.optionsFor('CUSTOMER'), masterData.optionsFor('SHIPPER')),
    [masterData],
  );
  const locationOptions = useMemo(
    () => combineMasterOptions(masterData.optionsFor('PICKUP_LOCATION'), masterData.optionsFor('AIRPORT'), masterData.optionsFor('COUNTRY')),
    [masterData],
  );
  const serviceTypeOptions = masterData.optionsFor('SERVICE_TYPE');
  const vehicleTypeOptions = masterData.optionsFor('VEHICLE_TYPE').length
    ? masterData.optionsFor('VEHICLE_TYPE')
    : DEFAULT_VEHICLE_TYPE_OPTIONS;
  const marketplaceShipmentPayload = useMemo(() => ({
    cargoOwnerName: shipmentForm.cargoOwnerName,
    shipmentType: shipmentForm.shipmentType,
    originName: shipmentForm.originName,
    destinationName: shipmentForm.destinationName,
    pickupWindowFrom: toIsoOrNull(shipmentForm.pickupWindowFrom),
    pickupWindowTo: toIsoOrNull(shipmentForm.pickupWindowTo),
    deliveryWindowFrom: toIsoOrNull(shipmentForm.deliveryWindowFrom),
    deliveryWindowTo: toIsoOrNull(shipmentForm.deliveryWindowTo),
    stops: [
      {
        stopType: 'PICKUP',
        sequenceNo: 1,
        locationName: shipmentForm.originName,
        plannedArrivalAt: toIsoOrNull(shipmentForm.pickupWindowFrom),
        plannedDepartAt: toIsoOrNull(shipmentForm.pickupWindowTo),
      },
      {
        stopType: 'DELIVERY',
        sequenceNo: 2,
        locationName: shipmentForm.destinationName,
        plannedArrivalAt: toIsoOrNull(shipmentForm.deliveryWindowFrom),
        plannedDepartAt: toIsoOrNull(shipmentForm.deliveryWindowTo),
      },
    ],
  }), [shipmentForm]);
  const marketplaceShipmentValidation = useShipmentValidation(marketplaceShipmentPayload, masterData.tenantId ?? tenantId);
  const selectedRfq = rfqs.find(rfq => rfq.id === selectedRfqId) ?? rfqs[0] ?? null;
  const selectedShipment = selectedRfq
    ? shipments.find(shipment => shipment.id === selectedRfq.shipmentOrderId) ?? null
    : null;
  const selectedShipmentValidationPayload = useMemo(() => selectedShipment ? {
    cargoOwnerName: selectedShipment.cargoOwnerName,
    shipmentType: selectedShipment.shipmentType,
    originName: selectedShipment.originName,
    destinationName: selectedShipment.destinationName,
    pickupWindowFrom: selectedShipment.pickupWindowFrom,
    pickupWindowTo: selectedShipment.pickupWindowTo,
    deliveryWindowFrom: selectedShipment.deliveryWindowFrom,
    deliveryWindowTo: selectedShipment.deliveryWindowTo,
  } : null, [selectedShipment]);
  const createShipment = shipments.find(shipment => shipment.id === createForm.shipmentOrderId) ?? null;
  const selectedCustomerPolicy = selectedRfq?.customerMarketplacePolicy
    ?? selectedShipment?.customerMarketplacePolicy
    ?? null;
  const createCustomerPolicy = createShipment?.customerMarketplacePolicy ?? null;
  const canCreateRfqForCustomer = !createCustomerPolicy
    || (createCustomerPolicy.rfqEnabled && createCustomerPolicy.defaultProcurementMode !== 'DIRECT_ONLY');
  const canSubmitBidForCustomer = !selectedCustomerPolicy
    || (
      selectedCustomerPolicy.rfqEnabled
      && selectedCustomerPolicy.bidSubmissionEnabled
      && selectedCustomerPolicy.defaultProcurementMode !== 'DIRECT_ONLY'
      && selectedCustomerPolicy.defaultProcurementMode !== 'RFQ_NO_BIDS'
    );
  const selectedCarrierIds = createForm.invitedCarrierIds;

  const filteredRfqs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rfqs.filter(rfq => {
      const shipment = shipments.find(s => s.id === rfq.shipmentOrderId);
      const statusOk = statusFilter === 'ALL' || rfq.status === statusFilter;
      const searchOk = !q || [
        rfq.rfqNo,
        rfq.status,
        shipment?.shipmentNo,
        shipment?.cargoOwnerName,
        shipment?.originName,
        shipment?.destinationName,
      ].some(value => value?.toLowerCase().includes(q));
      return statusOk && searchOk;
    });
  }, [rfqs, search, shipments, statusFilter]);

  const bidSummary = useMemo(() => {
    const valid = bids.filter(bid => bid.status !== 'REJECTED');
    const best = valid[0] ?? null;
    const avg = valid.length
      ? valid.reduce((sum, bid) => sum + Number(bid.amount ?? 0), 0) / valid.length
      : 0;
    return { best, avg, count: valid.length };
  }, [bids]);

  const invitedCarriers = useMemo(() => {
    if (!selectedRfq) return [];
    const ids = Array.isArray(selectedRfq.metadata?.invitedCarrierIds)
      ? selectedRfq.metadata.invitedCarrierIds.filter((id): id is string => typeof id === 'string')
      : [];
    const source = selectedRfq.inviteScope === 'ALL_ACTIVE_CARRIERS'
      ? carriers.filter(carrier => carrier.status === 'ACTIVE')
      : carriers.filter(carrier => ids.includes(carrier.id));
    return source.length ? source : carriers.filter(carrier => carrier.status === 'ACTIVE').slice(0, 5);
  }, [carriers, selectedRfq]);

  const loadSession = useCallback(async () => {
    const res = await fetch('/api/auth/me', { cache: 'no-store' });
    if (!res.ok) throw new Error('Please sign in before opening the marketplace.');
    setMe(await res.json());
  }, []);

  const loadData = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError('');
    try {
      const [shipmentsRes, carriersRes, rfqsRes] = await Promise.all([
        fetch(url('/api/logistics/shipments', { limit: 200, autoBackfill: 'false' }), { cache: 'no-store' }),
        fetch(url('/api/logistics/carriers', { limit: 200 }), { cache: 'no-store' }),
        fetch(url('/api/logistics/rfqs', { limit: 200 }), { cache: 'no-store' }),
      ]);
      if (!shipmentsRes.ok) throw new Error(await shipmentsRes.text());
      if (!carriersRes.ok) throw new Error(await carriersRes.text());
      if (!rfqsRes.ok) throw new Error(await rfqsRes.text());

      const shipmentsJson = await shipmentsRes.json();
      const carriersJson = await carriersRes.json();
      const rfqsJson = await rfqsRes.json();
      const nextShipments = Array.isArray(shipmentsJson.shipments) ? shipmentsJson.shipments : [];
      const nextCarriers = Array.isArray(carriersJson.carriers) ? carriersJson.carriers : [];
      const nextRfqs = Array.isArray(rfqsJson.rfqs) ? rfqsJson.rfqs : [];

      setShipments(nextShipments);
      setCarriers(nextCarriers);
      setRfqs(nextRfqs);
      setSelectedRfqId(current => current || nextRfqs[0]?.id || '');
      setCreateForm(form => ({
        ...form,
        shipmentOrderId: form.shipmentOrderId || nextShipments[0]?.id || '',
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load marketplace data');
    } finally {
      setLoading(false);
    }
  }, [tenantId, url]);

  const loadCarrierVehicles = useCallback(async (carrierIds: string[]) => {
    if (!tenantId || carrierIds.length === 0) return;
    const uniqueCarrierIds = Array.from(new Set(carrierIds.filter(Boolean)));
    const entries = await Promise.all(uniqueCarrierIds.map(async carrierId => {
      const res = await fetch(url(`/api/logistics/carriers/${carrierId}/vehicles`, {
        status: 'ACTIVE',
      }), { cache: 'no-store' });
      if (!res.ok) return [carrierId, []] as const;
      const data = await res.json();
      return [carrierId, Array.isArray(data.vehicles) ? data.vehicles : []] as const;
    }));
    setCarrierVehicles(current => ({
      ...current,
      ...Object.fromEntries(entries),
    }));
  }, [tenantId, url]);

  const loadInvites = useCallback(async (rfqId: string | null) => {
    if (!tenantId || !rfqId) {
      setCarrierInvites([]);
      return;
    }
    const res = await fetch(url(`/api/logistics/rfqs/${rfqId}/invites`, { includeExpired: 'true' }), { cache: 'no-store' });
    if (!res.ok) {
      setCarrierInvites([]);
      return;
    }
    const data = await res.json();
    setCarrierInvites(Array.isArray(data.invites) ? data.invites : []);
  }, [tenantId, url]);

  const loadDetails = useCallback(async (rfqId: string | null) => {
    if (!tenantId || !rfqId) {
      setBids([]);
      setAssignments([]);
      setTimeline(null);
      setCarrierInvites([]);
      return;
    }
    setDetailLoading(true);
    try {
      const bidRes = await fetch(url(`/api/logistics/rfqs/${rfqId}/bids`, { limit: 100 }), { cache: 'no-store' });
      if (!bidRes.ok) throw new Error(await bidRes.text());
      const bidJson = await bidRes.json();
      const nextBids = Array.isArray(bidJson.bids) ? bidJson.bids : [];
      setBids(nextBids);
      setAwardDrafts(current => {
        const next = { ...current };
        nextBids.forEach((bid: Bid) => {
          if (!next[bid.id]) next[bid.id] = { ...emptyAwardDraft };
        });
        return next;
      });
      await loadCarrierVehicles(nextBids.map((bid: Bid) => bid.carrierId));
      await loadInvites(rfqId);

      const rfq = bidJson.rfq as Rfq | undefined;
      if (rfq?.id) {
        setRfqs(current => current.map(item => (item.id === rfq.id ? { ...item, ...rfq } : item)));
      }
      const shipmentId = rfq?.shipmentOrderId ?? selectedRfq?.shipmentOrderId;
      if (shipmentId) {
        const assignmentRes = await fetch(url(`/api/logistics/shipments/${shipmentId}/assignments`), { cache: 'no-store' });
        if (assignmentRes.ok) {
          const assignmentJson = await assignmentRes.json();
          setAssignments(Array.isArray(assignmentJson.assignments) ? assignmentJson.assignments : []);
        }
        const timelineRes = await fetch(url(`/api/logistics/shipments/${shipmentId}/timeline`), { cache: 'no-store' });
        if (timelineRes.ok) {
          setTimeline(await timelineRes.json());
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load RFQ detail');
    } finally {
      setDetailLoading(false);
    }
  }, [loadCarrierVehicles, loadInvites, selectedRfq?.shipmentOrderId, tenantId, url]);

  useEffect(() => {
    loadSession().catch(err => {
      setError(err instanceof Error ? err.message : 'Failed to load session');
      setLoading(false);
    });
  }, [loadSession]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    loadDetails(selectedRfq?.id ?? null);
  }, [loadDetails, selectedRfq?.id]);

  const refreshAll = useCallback(async () => {
    await loadData();
    await loadDetails(selectedRfq?.id ?? null);
  }, [loadData, loadDetails, selectedRfq?.id]);

  useLogisticsPolling(refreshAll, Boolean(tenantId), 20000);

  const createMarketplaceShipment = async () => {
    if (!tenantId) return;
    setSaving('shipment-create');
    setError('');
    setNotice('');
    try {
      const validation = await validateShipmentPayload(marketplaceShipmentPayload, masterData.tenantId ?? tenantId);
      if (!validation.ok) {
        setError(validation.issues.join(' '));
        return;
      }
      const selectedCustomer = findMasterByLabel(customerOptions, shipmentForm.cargoOwnerName);
      const selectedOrigin = findMasterByLabel(locationOptions, shipmentForm.originName);
      const selectedDestination = findMasterByLabel(locationOptions, shipmentForm.destinationName);
      const res = await fetch(url('/api/logistics/shipments'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cargoOwnerCustomerId: selectedCustomer?.id ?? null,
          cargoOwnerName: shipmentForm.cargoOwnerName,
          cargoOwnerEmail: shipmentForm.cargoOwnerEmail || null,
          cargoOwnerPhone: shipmentForm.cargoOwnerPhone || null,
          shipmentType: shipmentForm.shipmentType || null,
          bookingMode: 'RFQ',
          marketplaceStatus: 'OPEN',
          status: 'PENDING',
          priority: 'NORMAL',
          originName: shipmentForm.originName,
          originAddress: selectedOrigin?.description ?? null,
          destinationName: shipmentForm.destinationName,
          destinationAddress: selectedDestination?.description ?? null,
          pickupWindowFrom: toIsoOrNull(shipmentForm.pickupWindowFrom),
          pickupWindowTo: toIsoOrNull(shipmentForm.pickupWindowTo),
          deliveryWindowFrom: toIsoOrNull(shipmentForm.deliveryWindowFrom),
          deliveryWindowTo: toIsoOrNull(shipmentForm.deliveryWindowTo),
          requestedVehicleType: shipmentForm.requestedVehicleType || null,
          totalWeightKg: shipmentForm.totalWeightKg ? Number(shipmentForm.totalWeightKg) : null,
          customerRateAmount: shipmentForm.customerRateAmount ? Number(shipmentForm.customerRateAmount) : null,
          currency: 'AED',
          sourceChannel: 'freight-marketplace-ui',
          writeLegacyBooking: true,
          stops: marketplaceShipmentPayload.stops,
          metadata: {
            source: 'marketplace-shipment-create',
            masterDataGoverned: true,
            selectedCustomerCode: selectedCustomer?.code ?? null,
            originCode: selectedOrigin?.code ?? null,
            destinationCode: selectedDestination?.code ?? null,
          },
        }),
      });
      if (!res.ok) throw new Error((await readLogisticsApiError(res)).message);
      const data = await res.json();
      const shipmentId = data.shipment?.id ?? data.legacyBookingView?.shipmentId;
      setNotice(`Shipment ${data.shipment?.shipmentNo ?? ''} created and ready for RFQ.`);
      setCreateForm(form => ({ ...form, shipmentOrderId: shipmentId ?? form.shipmentOrderId }));
      setShipmentForm(emptyShipmentForm);
      setShowShipmentCreate(false);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create marketplace shipment');
    } finally {
      setSaving('');
    }
  };

  const createRfq = async () => {
    if (!tenantId || !createForm.shipmentOrderId) return;
    if (!canCreateRfqForCustomer) {
      const customer = createShipment?.cargoOwnerName ?? createCustomerPolicy?.customerName ?? 'this customer';
      setError(`RFQ is disabled for ${customer}. Use direct assignment for this customer.`);
      return;
    }
    setSaving('create');
    setError('');
    setNotice('');
    try {
      const res = await fetch(url('/api/logistics/rfqs'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shipmentOrderId: createForm.shipmentOrderId,
          inviteScope: createForm.inviteScope,
          bidDeadlineAt: createForm.bidDeadlineAt || null,
          invitedCarrierIds: selectedCarrierIds,
          metadata: {
            source: 'marketplace-ui',
            invitedCarrierCount: selectedCarrierIds.length,
          },
        }),
      });
      if (!res.ok) throw new Error((await readLogisticsApiError(res)).message);
      const data = await res.json();
      setNotice(`RFQ ${data.rfq?.rfqNo ?? ''} opened for carrier bidding.`);
      setSelectedRfqId(data.rfq?.id ?? '');
      setShowCreate(false);
      setCreateForm({ ...emptyCreateForm, shipmentOrderId: createForm.shipmentOrderId });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create RFQ');
    } finally {
      setSaving('');
    }
  };

  const submitBid = async () => {
    if (!selectedRfq || !bidForm.carrierId || !bidForm.amount) return;
    if (!canSubmitBidForCustomer) {
      const customer = selectedShipment?.cargoOwnerName ?? selectedCustomerPolicy?.customerName ?? 'this customer';
      setError(`Carrier bid submission is disabled for ${customer}.`);
      return;
    }
    setSaving('bid');
    setError('');
    setNotice('');
    try {
      const res = await fetch(url(`/api/logistics/rfqs/${selectedRfq.id}/bids`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          carrierId: bidForm.carrierId,
          amount: Number(bidForm.amount),
          transitTimeHours: bidForm.transitTimeHours ? Number(bidForm.transitTimeHours) : null,
          validityUntil: bidForm.validityUntil || null,
          notes: bidForm.notes || null,
          currency: selectedShipment?.currency ?? 'AED',
        }),
      });
      if (!res.ok) throw new Error((await readLogisticsApiError(res)).message);
      setNotice('Carrier bid submitted.');
      setBidForm(emptyBidForm);
      setShowBidPanel(false);
      await loadDetails(selectedRfq.id);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit bid');
    } finally {
      setSaving('');
    }
  };

  const awardBid = async (bid: Bid) => {
    if (!selectedRfq) return;
    const draft = awardDrafts[bid.id] ?? emptyAwardDraft;
    setSaving(`award:${bid.id}`);
    setError('');
    setNotice('');
    setApiError(null);
    setAwardBlockers(blockers => ({ ...blockers, [bid.id]: [] }));
    try {
      if (selectedShipmentValidationPayload) {
        const validation = await validateShipmentPayload(selectedShipmentValidationPayload, tenantId);
        if (!validation.ok) {
          setApiError({
            message: 'Fix shipment timeline before assignment.',
            issues: validation.issues,
            warnings: validation.warnings,
            blockers: [],
          });
          setError('Fix shipment timeline before assignment.');
          return;
        }
      }
      const res = await fetch(url(`/api/logistics/rfqs/${selectedRfq.id}/award`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bidId: bid.id,
          vehicleId: draft.vehicleId || null,
          driverId: draft.driverId || null,
          overrideCompliance: draft.overrideCompliance,
          overrideReason: draft.overrideReason || null,
          notes: `Awarded from Logistics Marketplace to ${bid.carrierName ?? bid.carrierId}.`,
        }),
      });
      if (!res.ok) {
        const parsed = await readLogisticsApiError(res);
        setApiError(parsed);
        if (parsed.blockers.length > 0) {
          setAwardBlockers(blockers => ({ ...blockers, [bid.id]: parsed.blockers }));
        }
        throw new Error(parsed.message);
      }
      setNotice(`Awarded ${bid.carrierName ?? 'carrier'} and assigned shipment.`);
      setApiError(null);
      await loadData();
      await loadDetails(selectedRfq.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to award bid');
    } finally {
      setSaving('');
    }
  };

  const updateAwardDraft = (bidId: string, patch: Partial<typeof emptyAwardDraft>) => {
    setAwardDrafts(current => ({
      ...current,
      [bidId]: {
        ...(current[bidId] ?? emptyAwardDraft),
        ...patch,
      },
    }));
  };

  const createInviteLink = async (carrierId: string) => {
    if (!selectedRfq) return;
    setSaving(`invite:${carrierId}`);
    setError('');
    setNotice('');
    try {
      const res = await fetch(url(`/api/logistics/rfqs/${selectedRfq.id}/invites`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ carrierId, expiresInHours: 168 }),
      });
      if (!res.ok) throw new Error((await readLogisticsApiError(res)).message);
      const data = await res.json();
      const portalUrl = data.invite?.portalUrl ?? data.invite?.portalPath ?? '';
      if (!portalUrl) throw new Error('Invite link was not returned');
      setInviteLinks(links => ({ ...links, [carrierId]: portalUrl }));
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(portalUrl).catch(() => null);
      }
      setNotice('Secure carrier portal invite generated and copied.');
      await loadData();
      await loadInvites(selectedRfq.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create carrier invite link');
    } finally {
      setSaving('');
    }
  };

  const revokeInvite = async (invite: CarrierInvite) => {
    if (!selectedRfq) return;
    setSaving(`revoke:${invite.id}`);
    setError('');
    setNotice('');
    try {
      const res = await fetch(url(`/api/logistics/rfqs/${selectedRfq.id}/invites/${invite.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Revoked from Freight Marketplace UI' }),
      });
      if (!res.ok) throw new Error((await readLogisticsApiError(res)).message);
      setNotice('Carrier portal invite revoked.');
      await loadInvites(selectedRfq.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke carrier invite');
    } finally {
      setSaving('');
    }
  };

  const postSettlementToFinance = async () => {
    if (!selectedShipment || !selectedRfq) return;
    setSaving('finance-post');
    setError('');
    setNotice('');
    try {
      const res = await fetch(url(`/api/logistics/shipments/${selectedShipment.id}/finance-posting`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceRfqId: selectedRfq.id }),
      });
      if (!res.ok) throw new Error((await readLogisticsApiError(res)).message);
      const data = await res.json();
      const count = Array.isArray(data.postings) ? data.postings.length : 0;
      setNotice(`Posted logistics settlement to Finance (${count} posting link${count === 1 ? '' : 's'}).`);
      await loadDetails(selectedRfq.id);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to post settlement to Finance');
    } finally {
      setSaving('');
    }
  };

  const reverseFinancePosting = async (postingId: string) => {
    if (!selectedShipment || !selectedRfq) return;
    setSaving(`reverse-posting:${postingId}`);
    setError('');
    setNotice('');
    try {
      const res = await fetch(url(`/api/logistics/shipments/${selectedShipment.id}/finance-posting/${postingId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reverse',
          reason: 'Reversed from Logistics Finance reconciliation UI',
        }),
      });
      if (!res.ok) throw new Error((await readLogisticsApiError(res)).message);
      setNotice('Finance posting link reversed. You can repost the settlement when ready.');
      await loadDetails(selectedRfq.id);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reverse Finance posting');
    } finally {
      setSaving('');
    }
  };

  const toggleCarrierInvite = (carrierId: string) => {
    setCreateForm(form => ({
      ...form,
      invitedCarrierIds: form.invitedCarrierIds.includes(carrierId)
        ? form.invitedCarrierIds.filter(id => id !== carrierId)
        : [...form.invitedCarrierIds, carrierId],
    }));
  };

  const openRfqs = rfqs.filter(rfq => rfq.status === 'OPEN').length;
  const awardedRfqs = rfqs.filter(rfq => rfq.status === 'AWARDED').length;
  const activeCarriers = carriers.filter(carrier => carrier.status === 'ACTIVE').length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Freight Marketplace"
        subtitle="Private RFQ console for carrier bidding, rate comparison, award, and shipment assignment."
        icon={Gavel}
        accent="amber"
        actions={
          <>
            <button
              onClick={refreshAll}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:border-amber-400/40 hover:text-amber-200"
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-slate-950 shadow-lg shadow-amber-500/20 transition hover:bg-amber-400"
            >
              <Send className="h-4 w-4" />
              Open RFQ
            </button>
            <button
              onClick={() => setShowShipmentCreate(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-100 px-4 py-2 text-sm font-bold text-emerald-950 shadow-lg shadow-emerald-500/10 transition hover:bg-emerald-200"
            >
              <Truck className="h-4 w-4" />
              New Shipment
            </button>
          </>
        }
      />

      <KpiGrid>
        <KpiCard label="Open RFQs" value={openRfqs} sub="Carrier bidding" icon={Clock} accent="amber" />
        <KpiCard label="Total Bids" value={bids.length} sub="Selected RFQ" icon={HandCoins} accent="cyan" />
        <KpiCard label="Awarded" value={awardedRfqs} sub="Assigned loads" icon={BadgeCheck} accent="emerald" />
        <KpiCard label="Carriers" value={activeCarriers} sub="Active vendors" icon={Users} accent="blue" />
      </KpiGrid>

      {apiError ? (
        <LogisticsMessage
          type={apiError.code === 'LOGISTICS_OVERRIDE_APPROVAL_REQUIRED' ? 'warning' : 'error'}
          title={apiError.code === 'LOGISTICS_OVERRIDE_APPROVAL_REQUIRED' ? 'Approval queued' : 'Action blocked'}
          message={apiError.message}
          issues={apiError.issues}
          warnings={apiError.warnings}
          blockers={apiError.blockers}
          approvalRequest={apiError.approvalRequest}
        />
      ) : error && (
        <LogisticsMessage type="error" title="Action failed" message={error} />
      )}
      {notice && (
        <LogisticsMessage type="success" message={notice} />
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[430px_minmax(0,1fr)]">
        <Panel
          title="RFQ Console"
          subtitle="Shipper-side bidding queue"
          icon={Truck}
          accent="amber"
          actions={<StatusPill status={loading ? 'pending' : 'active'} label={loading ? 'Loading' : `${filteredRfqs.length} RFQs`} />}
        >
          <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_140px]">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search RFQ, shipment, customer..."
                className="w-full rounded-xl border border-white/10 bg-slate-950/70 py-2 pl-9 pr-3 text-sm font-medium text-white placeholder-slate-500 outline-none transition focus:border-amber-400/50"
              />
            </label>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm font-semibold text-white outline-none transition focus:border-amber-400/50"
            >
              {['ALL', 'OPEN', 'AWARDED', 'CLOSED', 'CANCELLED'].map(status => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </div>

          <div className="max-h-[640px] space-y-3 overflow-y-auto pr-1">
            {loading ? (
              Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="h-28 animate-pulse rounded-2xl bg-slate-800/70" />
              ))
            ) : filteredRfqs.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-slate-400">
                No RFQs found. Open an RFQ from an eligible shipment to start bidding.
              </div>
            ) : (
              filteredRfqs.map(rfq => {
                const shipment = shipments.find(s => s.id === rfq.shipmentOrderId);
                const active = selectedRfq?.id === rfq.id;
                return (
                  <button
                    key={rfq.id}
                    onClick={() => setSelectedRfqId(rfq.id)}
                    className={`w-full rounded-2xl border p-4 text-left transition ${
                      active
                        ? 'border-amber-400/60 bg-amber-500/10 shadow-lg shadow-amber-900/20'
                        : 'border-white/10 bg-slate-950/40 hover:border-white/20 hover:bg-slate-900'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-bold text-white">{rfq.rfqNo ?? rfq.id.slice(0, 8)}</span>
                          <StatusPill status={rfq.status} />
                        </div>
                        <p className="mt-2 line-clamp-1 text-sm font-semibold text-slate-200">
                          {shipment?.shipmentNo ?? 'Shipment'} - {shipment?.cargoOwnerName ?? 'Cargo owner'}
                        </p>
                        <p className="mt-1 line-clamp-1 text-xs text-slate-400">{routeLabel(shipment)}</p>
                      </div>
                      <div className="rounded-xl bg-slate-800 px-3 py-2 text-center">
                        <p className="text-lg font-bold text-amber-200">{rfq.bidCount}</p>
                        <p className="text-[10px] font-semibold uppercase text-slate-400">Bids</p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                      <span>Deadline: {dateTime(rfq.bidDeadlineAt)}</span>
                      <span className="text-slate-600">|</span>
                      <span>Round {rfq.negotiationRound ?? 1}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </Panel>

        <div className="space-y-5">
          <Panel
            title={selectedRfq ? `Bid Comparison - ${selectedRfq.rfqNo ?? selectedRfq.id.slice(0, 8)}` : 'Bid Comparison'}
            subtitle="Compare carrier price, transit time, validity, and award safely."
            icon={HandCoins}
            accent="cyan"
            actions={
              <button
                onClick={() => setShowBidPanel(value => !value)}
                disabled={!selectedRfq || selectedRfq.status !== 'OPEN' || !canSubmitBidForCustomer}
                className="inline-flex items-center gap-2 rounded-xl bg-cyan-100 px-3 py-2 text-sm font-bold text-cyan-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
                title={!canSubmitBidForCustomer ? 'Carrier bid submission is disabled for this customer' : undefined}
              >
                <Send className="h-4 w-4" />
                Carrier Bid
              </button>
            }
          >
            {!selectedRfq ? (
              <div className="rounded-2xl border border-dashed border-white/10 p-10 text-center text-slate-400">
                Select or create an RFQ to review carrier bids.
              </div>
            ) : (
              <div className="space-y-5">
                <div className="grid gap-3 lg:grid-cols-3">
                  <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Shipment</p>
                    <p className="mt-2 font-mono text-sm font-bold text-white">{selectedShipment?.shipmentNo ?? '-'}</p>
                    <p className="mt-1 text-sm text-slate-400">{selectedShipment?.cargoOwnerName ?? 'Cargo owner'}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Route</p>
                    <p className="mt-2 text-sm font-semibold text-white">{routeLabel(selectedShipment)}</p>
                    <p className="mt-1 text-sm text-slate-400">{selectedShipment?.requestedVehicleType ?? selectedShipment?.shipmentType ?? '-'}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Best Bid</p>
                    <p className="mt-2 text-lg font-bold text-emerald-300">
                      {bidSummary.best ? money(bidSummary.best.amount, bidSummary.best.currency ?? 'AED') : '-'}
                    </p>
                    <p className="mt-1 text-sm text-slate-400">
                      Average: {bidSummary.avg ? money(bidSummary.avg, selectedShipment?.currency ?? 'AED') : '-'}
                    </p>
                  </div>
                </div>

                {selectedCustomerPolicy && (
                  <div className={`rounded-2xl border p-4 ${
                    canSubmitBidForCustomer
                      ? 'border-emerald-300/30 bg-emerald-500/10 text-slate-100'
                      : 'border-amber-300/40 bg-amber-500/10 text-slate-100'
                  }`}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold">Customer marketplace policy</p>
                        <p className="mt-1 text-xs opacity-80">
                          {selectedShipment?.cargoOwnerName ?? selectedCustomerPolicy.customerName ?? 'Customer'} uses {selectedCustomerPolicy.defaultProcurementMode.replace(/_/g, ' ').toLowerCase()}.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <StatusPill status={selectedCustomerPolicy.rfqEnabled ? 'active' : 'inactive'} label={selectedCustomerPolicy.rfqEnabled ? 'RFQ enabled' : 'RFQ disabled'} />
                        <StatusPill status={selectedCustomerPolicy.bidSubmissionEnabled ? 'active' : 'inactive'} label={selectedCustomerPolicy.bidSubmissionEnabled ? 'Bids enabled' : 'Bids disabled'} />
                      </div>
                    </div>
                    {!canSubmitBidForCustomer && (
                      <p className="mt-2 text-xs font-semibold">
                        Bid entry is blocked for this customer. Use direct assignment or adjust the customer marketplace setting.
                      </p>
                    )}
                  </div>
                )}

                <div className="rounded-2xl border border-amber-300/25 bg-amber-500/10 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold text-amber-100">Secure carrier portal invites</h3>
                      <p className="text-xs text-amber-100/70">
                        Generate scoped links so carriers can view only this RFQ and submit bids externally.
                      </p>
                    </div>
                    <StatusPill status="active" label={`${invitedCarriers.length} carriers`} />
                  </div>
                  <div className="mt-3 grid gap-2 lg:grid-cols-2">
                    {invitedCarriers.map(carrier => (
                      <div key={carrier.id} className="rounded-xl border border-white/10 bg-slate-950/45 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-white">{carrier.name}</p>
                            <p className="text-xs text-slate-400">
                              {carrier.complianceStatus ?? 'Compliance pending'} - {carrier.status}
                            </p>
                          </div>
                          <button
                            onClick={() => createInviteLink(carrier.id)}
                            disabled={saving === `invite:${carrier.id}` || selectedRfq.status !== 'OPEN'}
                            className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-amber-100 px-3 py-2 text-xs font-bold text-amber-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {saving === `invite:${carrier.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
                            Invite
                          </button>
                        </div>
                        {inviteLinks[carrier.id] && (
                          <p className="mt-2 truncate rounded-lg bg-slate-900 px-2 py-1 font-mono text-[11px] text-amber-100">
                            {inviteLinks[carrier.id]}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                  {carrierInvites.length > 0 && (
                    <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/45 p-3">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <p className="text-xs font-bold uppercase tracking-wider text-amber-100">Invite lifecycle</p>
                        <StatusPill status="active" label={`${carrierInvites.length} links`} />
                      </div>
                      <div className="grid gap-2 lg:grid-cols-2">
                        {carrierInvites.slice(0, 6).map(invite => (
                          <div key={invite.id} className="rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2">
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-xs font-bold text-white">{invite.carrier?.name ?? invite.carrierId}</p>
                                <p className="text-[11px] text-slate-400">
                                  Expires {dateTime(invite.expiresAt)} - Last opened {dateTime(invite.lastAccessedAt)}
                                </p>
                              </div>
                              <StatusPill status={invite.status} />
                            </div>
                            {invite.status === 'ACTIVE' && (
                              <button
                                onClick={() => revokeInvite(invite)}
                                disabled={saving === `revoke:${invite.id}`}
                                className="mt-2 inline-flex items-center rounded-lg border border-rose-300 bg-rose-100 px-2.5 py-1 text-[11px] font-bold text-rose-950 hover:bg-rose-200 disabled:opacity-50"
                              >
                                {saving === `revoke:${invite.id}` ? 'Revoking...' : 'Revoke'}
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {showBidPanel && (
                  <div className="rounded-2xl border border-cyan-300/30 bg-cyan-500/10 p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-bold text-cyan-100">Carrier-facing bid submission</h3>
                        <p className="text-xs text-cyan-200/70">Select an onboarded carrier and submit their rate.</p>
                      </div>
                      <button onClick={() => setShowBidPanel(false)} className="text-sm font-semibold text-cyan-100 hover:text-white">Close</button>
                    </div>
                    <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
                      <select
                        value={bidForm.carrierId}
                        onChange={e => setBidForm(form => ({ ...form, carrierId: e.target.value }))}
                        className="rounded-xl border border-cyan-200/20 bg-slate-950/70 px-3 py-2 text-sm font-semibold text-white outline-none"
                      >
                        <option value="">Select carrier</option>
                        {carriers.map(carrier => (
                          <option key={carrier.id} value={carrier.id}>{carrier.name}</option>
                        ))}
                      </select>
                      <input
                        value={bidForm.amount}
                        onChange={e => setBidForm(form => ({ ...form, amount: e.target.value }))}
                        type="number"
                        placeholder="Amount"
                        className="rounded-xl border border-cyan-200/20 bg-slate-950/70 px-3 py-2 text-sm font-semibold text-white placeholder-slate-500 outline-none"
                      />
                      <input
                        value={bidForm.transitTimeHours}
                        onChange={e => setBidForm(form => ({ ...form, transitTimeHours: e.target.value }))}
                        type="number"
                        placeholder="Transit hrs"
                        className="rounded-xl border border-cyan-200/20 bg-slate-950/70 px-3 py-2 text-sm font-semibold text-white placeholder-slate-500 outline-none"
                      />
                      <button
                        onClick={submitBid}
                        disabled={saving === 'bid' || !bidForm.carrierId || !bidForm.amount || !canSubmitBidForCustomer}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-100 px-4 py-2 text-sm font-bold text-cyan-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {saving === 'bid' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        Submit
                      </button>
                    </div>
                    <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_2fr]">
                      <input
                        value={bidForm.validityUntil}
                        onChange={e => setBidForm(form => ({ ...form, validityUntil: e.target.value }))}
                        type="datetime-local"
                        className="rounded-xl border border-cyan-200/20 bg-slate-950/70 px-3 py-2 text-sm font-semibold text-white outline-none"
                      />
                      <input
                        value={bidForm.notes}
                        onChange={e => setBidForm(form => ({ ...form, notes: e.target.value }))}
                        placeholder="Carrier notes, inclusions, conditions..."
                        className="rounded-xl border border-cyan-200/20 bg-slate-950/70 px-3 py-2 text-sm font-semibold text-white placeholder-slate-500 outline-none"
                      />
                    </div>
                  </div>
                )}

                <div className="overflow-hidden rounded-2xl border border-white/10">
                  <table className="w-full min-w-[980px] text-sm">
                    <thead className="bg-slate-950/70 text-xs uppercase tracking-wider text-slate-400">
                      <tr>
                        <th className="px-4 py-3 text-left font-semibold">Carrier</th>
                        <th className="px-4 py-3 text-left font-semibold">Bid</th>
                        <th className="px-4 py-3 text-left font-semibold">Transit</th>
                        <th className="px-4 py-3 text-left font-semibold">Validity</th>
                        <th className="px-4 py-3 text-left font-semibold">Status</th>
                        <th className="px-4 py-3 text-left font-semibold">Truck / Driver</th>
                        <th className="px-4 py-3 text-right font-semibold">Decision</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/6 bg-slate-950/30">
                      {detailLoading ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                            <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                            Loading bids...
                          </td>
                        </tr>
                      ) : bids.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                            No carrier bids yet. Use Carrier Bid to simulate or submit a vendor response.
                          </td>
                        </tr>
                      ) : (
                        bids.map((bid, index) => {
                          const isBest = index === 0 && bid.status !== 'REJECTED';
                          const isAwarded = bid.status === 'AWARDED';
                          const draft = awardDrafts[bid.id] ?? emptyAwardDraft;
                          const vehicles = carrierVehicles[bid.carrierId] ?? [];
                          const selectedVehicle = vehicles.find(vehicle => vehicle.id === draft.vehicleId);
                          const driverOptions = Array.from(new Map(
                            vehicles
                              .filter(vehicle => vehicle.ownerDriverId)
                              .map(vehicle => [vehicle.ownerDriverId as string, `${vehicle.ownerDriverId} - ${vehicle.plateNo}`]),
                          ).entries());
                          const blockers = awardBlockers[bid.id] ?? [];
                          return (
                            <tr key={bid.id} className={isBest ? 'bg-emerald-500/5' : 'hover:bg-white/[0.03]'}>
                              <td className="px-4 py-4">
                                <div className="flex items-center gap-3">
                                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-800 text-xs font-bold text-amber-200">
                                    {(bid.carrierName ?? 'C').slice(0, 2).toUpperCase()}
                                  </div>
                                  <div>
                                    <p className="font-semibold text-white">{bid.carrierName ?? bid.carrierId}</p>
                                    <p className="text-xs text-slate-500">{bid.bidNo ?? bid.id.slice(0, 8)}</p>
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-4 font-bold text-emerald-300">{money(bid.amount, bid.currency ?? 'AED')}</td>
                              <td className="px-4 py-4 text-slate-300">{hoursLabel(bid.transitTimeHours)}</td>
                              <td className="px-4 py-4 text-slate-400">{dateTime(bid.validityUntil)}</td>
                              <td className="px-4 py-4">
                                <div className="flex flex-col gap-1">
                                  <StatusPill status={bid.status} />
                                  {isBest && !isAwarded && <span className="text-[11px] font-semibold text-emerald-300">Best commercial bid</span>}
                                </div>
                              </td>
                              <td className="px-4 py-4">
                                <div className="min-w-[220px] space-y-2">
                                  <select
                                    value={draft.vehicleId}
                                    onChange={e => {
                                      const selected = vehicles.find(vehicle => vehicle.id === e.target.value);
                                      updateAwardDraft(bid.id, {
                                        vehicleId: e.target.value,
                                        driverId: selected?.ownerDriverId ?? draft.driverId,
                                      });
                                    }}
                                    disabled={selectedRfq.status !== 'OPEN'}
                                    className="w-full rounded-lg border border-white/10 bg-slate-950 px-2 py-1.5 text-xs font-semibold text-white outline-none focus:border-emerald-300"
                                  >
                                    <option value="">Select verified truck</option>
                                    {vehicles.map(vehicle => (
                                      <option key={vehicle.id} value={vehicle.id}>
                                        {vehicle.plateNo} - {vehicle.vehicleType} - {vehicle.complianceStatus}/{vehicle.availabilityStatus}
                                      </option>
                                    ))}
                                  </select>
                                  <select
                                    value={draft.driverId}
                                    onChange={e => updateAwardDraft(bid.id, { driverId: e.target.value })}
                                    disabled={selectedRfq.status !== 'OPEN'}
                                    className="w-full rounded-lg border border-white/10 bg-slate-950 px-2 py-1.5 text-xs font-semibold text-white placeholder-slate-500 outline-none focus:border-emerald-300"
                                  >
                                    <option value="">{selectedVehicle?.ownerDriverId ? 'Select linked driver' : 'No linked driver selected'}</option>
                                    {selectedVehicle?.ownerDriverId && (
                                      <option value={selectedVehicle.ownerDriverId}>
                                        {selectedVehicle.ownerDriverId} - selected truck
                                      </option>
                                    )}
                                    {driverOptions.map(([driverId, label]) => (
                                      <option key={driverId} value={driverId}>{label}</option>
                                    ))}
                                  </select>
                                  {me?.role === 'SUPER_ADMIN' && blockers.length > 0 && (
                                    <label className="flex items-center gap-2 rounded-lg border border-amber-300/30 bg-amber-500/10 px-2 py-1.5 text-[11px] font-bold text-amber-100">
                                      <input
                                        type="checkbox"
                                        checked={draft.overrideCompliance}
                                        onChange={e => updateAwardDraft(bid.id, { overrideCompliance: e.target.checked })}
                                      />
                                      Request compliance override
                                    </label>
                                  )}
                                  {draft.overrideCompliance && (
                                    <input
                                      value={draft.overrideReason}
                                      onChange={e => updateAwardDraft(bid.id, { overrideReason: e.target.value })}
                                      placeholder="Override reason"
                                      className="w-full rounded-lg border border-amber-300/30 bg-slate-950 px-2 py-1.5 text-xs font-semibold text-white placeholder-slate-500 outline-none focus:border-amber-300"
                                    />
                                  )}
                                  {blockers.length > 0 && (
                                    <div className="space-y-1 rounded-lg border border-rose-300 bg-rose-100 p-2 text-[11px] font-semibold text-rose-950">
                                      {blockers.slice(0, 3).map(blocker => (
                                        <p key={`${blocker.code}-${blocker.subjectId ?? ''}`}>- {blocker.label}</p>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-4 text-right">
                                <button
                                  onClick={() => awardBid(bid)}
                                  disabled={selectedRfq.status !== 'OPEN' || saving === `award:${bid.id}`}
                                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-100 px-3 py-2 text-xs font-bold text-emerald-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {saving === `award:${bid.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Gavel className="h-3.5 w-3.5" />}
                                  Award
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Panel>

          <Panel
            title="Award & Assignment Trace"
            subtitle="Operational outcome after a bid is awarded."
            icon={ShieldCheck}
            accent="emerald"
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Current assignment</p>
                {assignments.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-400">No marketplace assignment recorded yet.</p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {assignments.slice(0, 3).map(assignment => (
                      <div key={assignment.id} className="rounded-xl bg-slate-900 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-semibold text-white">{assignment.carrierName ?? assignment.carrierId ?? 'Internal fleet'}</p>
                          <StatusPill status={assignment.status} />
                        </div>
                        <p className="mt-1 text-xs text-slate-400">
                          {assignment.assignmentType ?? 'Assignment'} - {money(assignment.costAmount, assignment.currency ?? 'AED')}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Marketplace flow</p>
                <div className="mt-4 flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-300">
                  <span className="rounded-xl bg-slate-800 px-3 py-2">Open RFQ</span>
                  <ArrowRight className="h-4 w-4 text-slate-500" />
                  <span className="rounded-xl bg-slate-800 px-3 py-2">Carrier bids</span>
                  <ArrowRight className="h-4 w-4 text-slate-500" />
                  <span className="rounded-xl bg-slate-800 px-3 py-2">Award</span>
                  <ArrowRight className="h-4 w-4 text-slate-500" />
                  <span className="rounded-xl bg-emerald-100 px-3 py-2 text-emerald-950">Assign shipment</span>
                </div>
                <p className="mt-4 text-sm leading-6 text-slate-400">
                  Awarding a bid updates the RFQ, rejects competing bids, assigns the carrier, writes a freight charge, and leaves a shipment tracking event.
                </p>
              </div>
            </div>
            {timeline && (
              <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
                <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Execution timeline</p>
                  <div className="mt-3 space-y-2">
                    {timeline.events.slice(0, 5).map(event => (
                      <div key={event.id} className="rounded-xl bg-slate-900 px-3 py-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-bold text-white">{event.type.replace(/_/g, ' ')}</p>
                          <span className="text-[11px] font-semibold text-slate-400">{dateTime(event.occurredAt)}</span>
                        </div>
                        <p className="mt-1 text-xs text-slate-400">{event.notes ?? event.status ?? event.source}</p>
                      </div>
                    ))}
                    {timeline.events.length === 0 && (
                      <p className="text-sm text-slate-400">No execution events recorded yet.</p>
                    )}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Finance readiness</p>
                    <button
                      onClick={postSettlementToFinance}
                      disabled={!selectedShipment || selectedRfq?.status !== 'AWARDED' || saving === 'finance-post'}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-100 px-3 py-1.5 text-xs font-bold text-emerald-950 hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {saving === 'finance-post' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <HandCoins className="h-3.5 w-3.5" />}
                      Post to Finance
                    </button>
                  </div>
                  <div className="mt-3 space-y-3">
                    <div className="rounded-xl bg-slate-900 p-3">
                      <p className="text-xs font-semibold uppercase text-slate-500">Customer billing</p>
                      <p className="mt-1 text-lg font-bold text-emerald-300">
                        {money(timeline.finance.customerCharges.reduce((sum, charge) => sum + charge.totalAmount, 0), selectedShipment?.currency ?? 'AED')}
                      </p>
                    </div>
                    <div className="rounded-xl bg-slate-900 p-3">
                      <p className="text-xs font-semibold uppercase text-slate-500">Carrier payable</p>
                      <p className="mt-1 text-lg font-bold text-amber-200">
                        {money(timeline.finance.carrierPayables.reduce((sum, charge) => sum + charge.totalAmount, 0), selectedShipment?.currency ?? 'AED')}
                      </p>
                    </div>
                    <div className="rounded-xl bg-slate-900 p-3">
                      <p className="text-xs font-semibold uppercase text-slate-500">POD records</p>
                      <p className="mt-1 text-lg font-bold text-cyan-200">{timeline.pods.length}</p>
                    </div>
                    <div className="rounded-xl bg-slate-900 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs font-semibold uppercase text-slate-500">Finance postings</p>
                        <StatusPill
                          status={(timeline.finance.postings?.length ?? 0) > 0 ? 'active' : 'pending'}
                          label={`${timeline.finance.postings?.length ?? 0} posted`}
                        />
                      </div>
                      <div className="mt-2 space-y-1">
                        {(timeline.finance.postings ?? []).slice(0, 3).map(posting => (
                          <div key={posting.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-950/60 px-2 py-1.5">
                            <div className="min-w-0">
                              <p className="truncate text-xs font-semibold text-slate-200">
                                {posting.postingType.replace(/_/g, ' ')} - {money(posting.amount, posting.currency)}
                              </p>
                              <p className="text-[11px] text-slate-500">{posting.status}</p>
                            </div>
                            {posting.status !== 'REVERSED' && (
                              <button
                                onClick={() => reverseFinancePosting(posting.id)}
                                disabled={saving === `reverse-posting:${posting.id}`}
                                className="shrink-0 rounded-md border border-amber-300 bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-950 hover:bg-amber-200 disabled:opacity-50"
                              >
                                {saving === `reverse-posting:${posting.id}` ? '...' : 'Reverse'}
                              </button>
                            )}
                          </div>
                        ))}
                        {(timeline.finance.postings?.length ?? 0) === 0 && (
                          <p className="text-xs text-slate-500">Not yet posted to Finance.</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </Panel>
        </div>
      </div>

      {showShipmentCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-4xl overflow-hidden rounded-3xl border border-white/10 bg-slate-950 shadow-2xl">
            <div className="border-b border-white/10 px-6 py-5">
              <h2 className="text-lg font-bold text-white">Create Marketplace Shipment</h2>
              <p className="mt-1 text-sm text-slate-400">Use governed master data before opening RFQ, direct assignment, or bid comparison.</p>
            </div>
            <div className="max-h-[75vh] space-y-4 overflow-y-auto p-6">
              {masterData.error && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-950">
                  {masterData.error}
                </div>
              )}
              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Cargo owner / shipper</span>
                  <select
                    value={shipmentForm.cargoOwnerName}
                    onChange={e => setShipmentForm(form => ({ ...form, cargoOwnerName: e.target.value }))}
                    className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white outline-none focus:border-emerald-400"
                  >
                    <option value="">Select cargo owner / shipper</option>
                    {customerOptions.map(item => (
                      <option key={`${item.type}:${item.id}`} value={masterValue(item)}>{masterLabel(item)}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Service type</span>
                  <select
                    value={shipmentForm.shipmentType}
                    onChange={e => setShipmentForm(form => ({ ...form, shipmentType: e.target.value }))}
                    className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white outline-none focus:border-emerald-400"
                  >
                    <option value="">Select service type</option>
                    {serviceTypeOptions.map(item => (
                      <option key={item.id} value={item.code}>{masterLabel(item)}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Origin</span>
                  <select
                    value={shipmentForm.originName}
                    onChange={e => setShipmentForm(form => ({ ...form, originName: e.target.value }))}
                    className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white outline-none focus:border-emerald-400"
                  >
                    <option value="">Select origin</option>
                    {locationOptions.map(item => (
                      <option key={`${item.type}:${item.id}:origin`} value={masterValue(item)}>{masterLabel(item)}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Destination</span>
                  <select
                    value={shipmentForm.destinationName}
                    onChange={e => setShipmentForm(form => ({ ...form, destinationName: e.target.value }))}
                    className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white outline-none focus:border-emerald-400"
                  >
                    <option value="">Select destination</option>
                    {locationOptions.map(item => (
                      <option key={`${item.type}:${item.id}:destination`} value={masterValue(item)}>{masterLabel(item)}</option>
                    ))}
                  </select>
                </label>
                <input
                  value={shipmentForm.cargoOwnerEmail}
                  onChange={e => setShipmentForm(form => ({ ...form, cargoOwnerEmail: e.target.value }))}
                  placeholder="Cargo owner email"
                  className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white placeholder-slate-500 outline-none focus:border-emerald-400"
                />
                <input
                  value={shipmentForm.cargoOwnerPhone}
                  onChange={e => setShipmentForm(form => ({ ...form, cargoOwnerPhone: e.target.value }))}
                  placeholder="Cargo owner phone"
                  className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white placeholder-slate-500 outline-none focus:border-emerald-400"
                />
                <label className="space-y-1.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Requested vehicle type</span>
                  <select
                    value={shipmentForm.requestedVehicleType}
                    onChange={e => setShipmentForm(form => ({ ...form, requestedVehicleType: e.target.value }))}
                    className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white outline-none focus:border-emerald-400"
                  >
                    <option value="">Select vehicle type</option>
                    {vehicleTypeOptions.map(item => (
                      <option key={`${item.type}:${item.id}:${item.code}`} value={masterValue(item)}>{masterLabel(item)}</option>
                    ))}
                  </select>
                </label>
                <input
                  value={shipmentForm.totalWeightKg}
                  onChange={e => setShipmentForm(form => ({ ...form, totalWeightKg: e.target.value }))}
                  type="number"
                  placeholder="Total weight kg"
                  className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white placeholder-slate-500 outline-none focus:border-emerald-400"
                />
                <label className="space-y-1.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Pickup ready</span>
                  <input
                    value={shipmentForm.pickupWindowFrom}
                    onChange={e => setShipmentForm(form => ({ ...form, pickupWindowFrom: e.target.value }))}
                    type="datetime-local"
                    className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white outline-none focus:border-emerald-400"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Pickup deadline</span>
                  <input
                    value={shipmentForm.pickupWindowTo}
                    onChange={e => setShipmentForm(form => ({ ...form, pickupWindowTo: e.target.value }))}
                    type="datetime-local"
                    className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white outline-none focus:border-emerald-400"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Delivery ETA</span>
                  <input
                    value={shipmentForm.deliveryWindowFrom}
                    onChange={e => setShipmentForm(form => ({ ...form, deliveryWindowFrom: e.target.value }))}
                    type="datetime-local"
                    className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white outline-none focus:border-emerald-400"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Delivery deadline</span>
                  <input
                    value={shipmentForm.deliveryWindowTo}
                    onChange={e => setShipmentForm(form => ({ ...form, deliveryWindowTo: e.target.value }))}
                    type="datetime-local"
                    className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white outline-none focus:border-emerald-400"
                  />
                </label>
                <input
                  value={shipmentForm.customerRateAmount}
                  onChange={e => setShipmentForm(form => ({ ...form, customerRateAmount: e.target.value }))}
                  type="number"
                  placeholder="Customer rate AED"
                  className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white placeholder-slate-500 outline-none focus:border-emerald-400"
                />
              </div>

              <ShipmentValidationSummary
                result={marketplaceShipmentValidation.result}
                validating={marketplaceShipmentValidation.validating}
              />
            </div>
            <div className="flex justify-end gap-3 border-t border-white/10 px-6 py-4">
              <button
                onClick={() => setShowShipmentCreate(false)}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm font-bold text-slate-200 transition hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                onClick={createMarketplaceShipment}
                disabled={saving === 'shipment-create' || marketplaceShipmentValidation.validating || !marketplaceShipmentValidation.result.ok}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-100 px-4 py-2 text-sm font-bold text-emerald-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving === 'shipment-create' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}
                Create shipment
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-3xl overflow-hidden rounded-3xl border border-white/10 bg-slate-950 shadow-2xl">
            <div className="border-b border-white/10 px-6 py-5">
              <h2 className="text-lg font-bold text-white">Open Freight RFQ</h2>
              <p className="mt-1 text-sm text-slate-400">Invite selected carriers to bid against a shipment.</p>
            </div>
            <div className="space-y-4 p-6">
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">Shipment</label>
                <select
                  value={createForm.shipmentOrderId}
                  onChange={e => setCreateForm(form => ({ ...form, shipmentOrderId: e.target.value }))}
                  className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white outline-none focus:border-amber-400/50"
                >
                  <option value="">Select shipment</option>
                  {shipments.map(shipment => (
                    <option key={shipment.id} value={shipment.id}>
                      {shipment.shipmentNo} - {shipment.cargoOwnerName ?? 'Cargo owner'} - {routeLabel(shipment)}
                    </option>
                  ))}
                </select>
              </div>
              {createCustomerPolicy && (
                <div className={`rounded-2xl border px-4 py-3 text-sm ${
                  canCreateRfqForCustomer
                    ? 'border-emerald-300/30 bg-emerald-500/10 text-slate-100'
                    : 'border-amber-300/40 bg-amber-500/10 text-slate-100'
                }`}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-bold">Customer policy: {createCustomerPolicy.defaultProcurementMode.replace(/_/g, ' ')}</p>
                      <p className="mt-1 text-xs opacity-80">
                        RFQ {createCustomerPolicy.rfqEnabled ? 'enabled' : 'disabled'} - Carrier bids {createCustomerPolicy.bidSubmissionEnabled ? 'enabled' : 'disabled'}
                      </p>
                    </div>
                    <StatusPill status={createCustomerPolicy.configured ? 'active' : 'pending'} label={createCustomerPolicy.configured ? 'Configured' : 'Default'} />
                  </div>
                </div>
              )}
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">Invite scope</label>
                  <select
                    value={createForm.inviteScope}
                    onChange={e => setCreateForm(form => ({ ...form, inviteScope: e.target.value }))}
                    disabled={!canCreateRfqForCustomer}
                    className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white outline-none focus:border-amber-400/50"
                  >
                    <option value="SELECTED_CARRIERS">Selected carriers</option>
                    <option value="ALL_ACTIVE_CARRIERS">All active carriers</option>
                    <option value="PRIVATE_INVITE">Private invite</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-500">Bid deadline</label>
                  <input
                    value={createForm.bidDeadlineAt}
                    onChange={e => setCreateForm(form => ({ ...form, bidDeadlineAt: e.target.value }))}
                    type="datetime-local"
                    className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white outline-none focus:border-amber-400/50"
                  />
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">Carrier shortlist</label>
                  <button
                    onClick={() => setCreateForm(form => ({ ...form, invitedCarrierIds: carriers.map(carrier => carrier.id) }))}
                    disabled={!canCreateRfqForCustomer || createCustomerPolicy?.bidSubmissionEnabled === false}
                    className="text-xs font-bold text-amber-200 hover:text-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Select all
                  </button>
                </div>
                {createCustomerPolicy?.bidSubmissionEnabled === false && (
                  <p className="mb-2 rounded-xl border border-amber-300/30 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-100">
                    Carrier bid submission is disabled for this customer. This RFQ can be used as a controlled procurement record without vendor bidding.
                  </p>
                )}
                <div className="grid max-h-64 gap-2 overflow-y-auto rounded-2xl border border-white/10 bg-slate-900/50 p-3 md:grid-cols-2">
                  {carriers.length === 0 ? (
                    <p className="col-span-2 py-6 text-center text-sm text-slate-400">No carriers found. Add carriers first from the Logistics carrier API/admin flow.</p>
                  ) : (
                    carriers.map(carrier => {
                      const checked = createForm.invitedCarrierIds.includes(carrier.id);
                      return (
                        <button
                          key={carrier.id}
                          onClick={() => toggleCarrierInvite(carrier.id)}
                          disabled={!canCreateRfqForCustomer || createCustomerPolicy?.bidSubmissionEnabled === false}
                          className={`rounded-xl border p-3 text-left transition ${
                            checked
                              ? 'border-amber-400/60 bg-amber-500/10'
                              : 'border-white/10 bg-slate-950/40 hover:border-white/20'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="font-semibold text-white">{carrier.name}</p>
                            {checked && <CheckCircle2 className="h-4 w-4 text-amber-300" />}
                          </div>
                          <p className="mt-1 text-xs text-slate-500">{carrier.complianceStatus ?? 'Compliance pending'} - {carrier.status}</p>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t border-white/10 px-6 py-4">
              <button
                onClick={() => setShowCreate(false)}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm font-bold text-slate-200 transition hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                onClick={createRfq}
                disabled={saving === 'create' || !createForm.shipmentOrderId || !canCreateRfqForCustomer}
                className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving === 'create' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Open RFQ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
