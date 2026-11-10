/**
 * /bus-ops/marketplace â€” Dedicated Bus & Limousine Operator Marketplace.
 *
 * The operator-facing half of the Fleet360 Exchange for Passenger Transport (Bus)
 * and VIP Chauffeur / Limousine operations â€” sitting alongside /logistics/marketplace.
 *
 * Capabilities:
 *  - Browse open Bus & Limousine RFQs (OutsourceRequests & MarketplaceOpportunities)
 *  - Post scheduled Bus Trips (TripSchedule) or Chauffeur/VIP Bookings (Booking)
 *    to invited partners or the Open Fleet360 B2B Exchange Network
 *  - Compare partner quotes (base + 5% UAE VAT) and execute governed awards
 *  - Auto-price and direct-award via Contracted Rate Cards (5% UAE VAT)
 *  - Track awarded partner driver/vehicle assignments, PODs, and partner invoices
 */
'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Gavel,
  RefreshCw,
  Bus,
  Car,
  Wrench,
  Clock,
  CheckCircle2,
  Trophy,
  Plus,
  Globe,
  X,
  MapPin,
  Users,
  Sparkles,
  Plane,
  ShieldCheck,
  Calculator,
  FileText,
  Search,
  Ban,
} from 'lucide-react';
import { PageHeader, Panel, StatusPill } from '@/components/ui/page-theme';

export type MarketplaceDomainFilter = 'ALL' | 'PASSENGER_TRANSPORT' | 'LIMOUSINE' | 'RECOVERY';

interface PartnerSummary {
  id: string;
  legalName: string;
  partnerCode: string;
  primaryContactPhone?: string | null;
  city?: string | null;
  capabilities?: Array<{ domain: string }>;
}

interface PartnerQuoteItem {
  id: string;
  partnerId: string;
  revisionNo: number;
  amount: number | string;
  vatAmount: number | string;
  totalAmount: number | string;
  currency: string;
  status: string;
  validUntil?: string | null;
  notes?: string | null;
  partner?: PartnerSummary | null;
}

interface OutsourceAwardItem {
  id: string;
  partnerId: string;
  awardedAmount: number | string;
  vatAmount: number | string;
  totalAwarded: number | string;
  currency: string;
  status: string;
  awardedAt: string;
  commercialSnapshot?: Record<string, any> | null;
  partner?: PartnerSummary | null;
  assignment?: {
    id: string;
    vehiclePlate?: string | null;
    driverName?: string | null;
    driverPhone?: string | null;
    status?: string | null;
    isTokenRevoked?: boolean | null;
    reachedAt?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
    pod?: {
      passengerCount?: number | null;
      signedByName?: string | null;
      completionNotes?: string | null;
    } | null;
    events?: Array<{
      id: string;
      eventType: string;
      latitude?: number | null;
      longitude?: number | null;
      occurredAt: string;
      payload?: Record<string, any> | null;
    }>;
  } | null;
  invoice?: {
    id: string;
    invoiceNumber: string;
    totalAmount: number | string;
    status: string;
    verificationStatus?: string | null;
    discrepancyNotes?: string | null;
    disputes?: Array<{
      id: string;
      disputedAmount: number | string;
      reason: string;
      status: string;
      resolution?: string | null;
    }>;
  } | null;
}

interface OutsourceRequestItem {
  id: string;
  requestNumber: string;
  domain: 'PASSENGER_TRANSPORT' | 'LIMOUSINE' | string;
  sourceReferenceType: string;
  sourceReferenceId: string;
  pricingMethod: string;
  status: string;
  serviceDate: string;
  pickupTime: string;
  pickupLocation: string;
  dropoffLocation: string;
  requiredCapacity: number;
  vehicleTypeRequired?: string | null;
  specialInstructions?: string | null;
  createdAt: string;
  invitedPartners?: Array<{ id: string; partnerId: string; partner?: PartnerSummary | null }>;
  quotes?: PartnerQuoteItem[];
  opportunity?: {
    id: string;
    status: string;
    visibility: string;
    closesAt: string;
    disclosurePayload?: Record<string, unknown> | null;
  } | null;
  award?: OutsourceAwardItem | null;
}

interface PostableBusTrip {
  id: string;
  departureTime: string;
  capacity?: number | null;
  status: string;
  notes?: string | null;
  route?: {
    id: string;
    routeName: string;
    routeCode?: string | null;
    origin?: string | null;
    destination?: string | null;
  } | null;
}

interface PostableLimoBooking {
  id: string;
  bookingRef?: string | null;
  serviceType: string;
  requestorName: string;
  startDate: string;
  vehicleCategory?: string | null;
  status?: string | null;
  notes?: string | null;
}

interface PostableBreakdownReport {
  id: string;
  reportNo?: string | null;
  breakdownType?: string | null;
  severity?: string | null;
  location?: string | null;
  reportedAt: string;
  status?: string | null;
  driverNotes?: string | null;
}

interface ContractRateLookupResult {
  found?: boolean;
  rateAmount?: number;
  baseAmount?: number;
  vatAmount?: number;
  totalAmount?: number;
  currency?: string;
  corridorTitle?: string;
}

const STATUS_FILTERS = ['ALL', 'OPEN', 'AWARDED', 'CANCELLED'] as const;

function money(amount: number | string | null | undefined, currency = 'AED') {
  const num = Number(amount ?? 0);
  if (!Number.isFinite(num)) return `${currency} 0.00`;
  return `${currency} ${num.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return 'â€”';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'â€”';
  return d.toLocaleDateString('en-AE', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function BusLimoMarketplaceView({
  defaultDomain = 'ALL',
}: {
  defaultDomain?: MarketplaceDomainFilter;
}) {
  const [domainFilter, setDomainFilter] = useState<MarketplaceDomainFilter>(defaultDomain);
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const [requests, setRequests] = useState<OutsourceRequestItem[]>([]);
  const [partners, setPartners] = useState<PartnerSummary[]>([]);
  const [busTrips, setBusTrips] = useState<PostableBusTrip[]>([]);
  const [limoBookings, setLimoBookings] = useState<PostableLimoBooking[]>([]);
  const [breakdowns, setBreakdowns] = useState<PostableBreakdownReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmQuoteId, setConfirmQuoteId] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [liveSyncEnabled, setLiveSyncEnabled] = useState(true);
  const [lastLiveSyncAt, setLastLiveSyncAt] = useState<string | null>(null);

  // Contract Rate Lookup & Direct Award state
  const [showRateCard, setShowRateCard] = useState(false);
  const [ratePartnerId, setRatePartnerId] = useState('');
  const [rateResult, setRateResult] = useState<ContractRateLookupResult | null>(null);
  const [customDirectPrice, setCustomDirectPrice] = useState('');
  const [lookingUpRate, setLookingUpRate] = useState(false);

  // Post Trip / VIP Booking / Recovery Modal state
  const [showPostModal, setShowPostModal] = useState(false);
  const [postDomain, setPostDomain] = useState<'PASSENGER_TRANSPORT' | 'LIMOUSINE' | 'RECOVERY'>(
    defaultDomain === 'LIMOUSINE'
      ? 'LIMOUSINE'
      : defaultDomain === 'RECOVERY'
        ? 'RECOVERY'
        : 'PASSENGER_TRANSPORT',
  );
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const [pickupLocation, setPickupLocation] = useState('');
  const [dropoffLocation, setDropoffLocation] = useState('');
  const [serviceDate, setServiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [pickupTime, setPickupTime] = useState('08:00');
  const [requiredCapacity, setRequiredCapacity] = useState('50');
  const [vehicleTypeRequired, setVehicleTypeRequired] = useState('50-Seat Luxury Coach');
  const [specialInstructions, setSpecialInstructions] = useState('');
  // Limousine specific fields
  const [limoServiceType, setLimoServiceType] = useState<'AIRPORT_TRANSFER' | 'POINT_TO_POINT' | 'HOURLY_CHAUFFEUR'>('AIRPORT_TRANSFER');
  const [flightNumber, setFlightNumber] = useState('');
  const [luggageCount, setLuggageCount] = useState('2');
  const [meetAndGreet, setMeetAndGreet] = useState(true);
  const [waterAndWifi, setWaterAndWifi] = useState(true);
  // Recovery specific fields
  const [recoveryCondition, setRecoveryCondition] = useState<'ROLLING' | 'STEERING_LOCKED' | 'SEVERELY_DAMAGED' | 'BASEMENT_PARKING'>('ROLLING');
  const [recoveryUrgency, setRecoveryUrgency] = useState<'STANDARD' | 'URGENT' | 'EMERGENCY_HIGHWAY'>('URGENT');
  const [disabledVehiclePlate, setDisabledVehiclePlate] = useState('');
  // Sourcing & Visibility
  const [publishToMarketplace, setPublishToMarketplace] = useState(true);
  const [invitedPartnerIds, setInvitedPartnerIds] = useState<Set<string>>(new Set());
  const [closesAt, setClosesAt] = useState('');
  const [posting, setPosting] = useState(false);

  const loadMarketplace = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/bus-ops/outsource?mode=marketplace', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(data.error || `Failed to load marketplace (HTTP ${res.status})`);
        setRequests([]);
      } else {
        const list: OutsourceRequestItem[] = Array.isArray(data.requests) ? data.requests : [];
        setRequests(list);
        setPartners(Array.isArray(data.approvedPartners) ? data.approvedPartners : []);
        setBusTrips(Array.isArray(data.postableBusTrips) ? data.postableBusTrips : []);
        setLimoBookings(Array.isArray(data.postableLimoBookings) ? data.postableLimoBookings : []);
        setBreakdowns(Array.isArray(data.postableBreakdowns) ? data.postableBreakdowns : []);
        setSelectedId((prev) => (prev && list.some((r) => r.id === prev) ? prev : list[0]?.id ?? null));
      }
    } catch {
      setErrorMsg('Network error loading Bus, Limousine & Recovery Marketplace.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMarketplace();
  }, [loadMarketplace]);

  // ARCH-5: Real-Time Push & Cross-Tab Event Stream (BroadcastChannel + 10s Live Telemetry & Bid Stream)
  useEffect(() => {
    if (!liveSyncEnabled) return;
    let bc: BroadcastChannel | null = null;
    try {
      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        bc = new BroadcastChannel('fleet360-exchange-live');
        bc.onmessage = () => {
          setLastLiveSyncAt(new Date().toLocaleTimeString('en-AE'));
          void loadMarketplace();
        };
      }
    } catch {
      // Fallback if BroadcastChannel is restricted
    }

    const timer = setInterval(() => {
      setLastLiveSyncAt(new Date().toLocaleTimeString('en-AE'));
      void loadMarketplace();
    }, 10_000);

    return () => {
      clearInterval(timer);
      if (bc) bc.close();
    };
  }, [liveSyncEnabled, loadMarketplace]);

  const filteredRequests = useMemo(() => {
    return requests.filter((r) => {
      if (domainFilter !== 'ALL' && r.domain !== domainFilter) return false;
      if (statusFilter === 'OPEN' && !['PUBLISHED', 'QUOTED', 'OPEN'].includes(r.status)) return false;
      if (statusFilter === 'AWARDED' && r.status !== 'AWARDED') return false;
      if (statusFilter === 'CANCELLED' && r.status !== 'CANCELLED') return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const hay = [
          r.requestNumber,
          r.pickupLocation,
          r.dropoffLocation,
          r.vehicleTypeRequired,
          r.specialInstructions,
          r.award?.partner?.legalName,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [requests, domainFilter, statusFilter, searchQuery]);

  const selected = useMemo(
    () => filteredRequests.find((r) => r.id === selectedId) ?? requests.find((r) => r.id === selectedId) ?? null,
    [filteredRequests, requests, selectedId],
  );

  // KPI metrics
  const kpis = useMemo(() => {
    const openCount = requests.filter((r) => ['PUBLISHED', 'QUOTED', 'OPEN'].includes(r.status)).length;
    const busCount = requests.filter((r) => r.domain === 'PASSENGER_TRANSPORT').length;
    const limoCount = requests.filter((r) => r.domain === 'LIMOUSINE').length;
    const recoveryCount = requests.filter((r) => r.domain === 'RECOVERY').length;
    const totalQuotes = requests.reduce((acc, r) => acc + (r.quotes?.length ?? 0), 0);
    const awardedSpend = requests
      .filter((r) => r.status === 'AWARDED' && r.award)
      .reduce((acc, r) => acc + Number(r.award?.totalAwarded ?? 0), 0);
    return { openCount, busCount, limoCount, recoveryCount, totalQuotes, awardedSpend };
  }, [requests]);

  const domainPartners = useMemo(() => {
    const activeDomain = postDomain;
    return partners.filter(
      (p) => !p.capabilities || p.capabilities.length === 0 || p.capabilities.some((c) => c.domain === activeDomain),
    );
  }, [partners, postDomain]);

  const handleSourceSelect = (id: string) => {
    setSelectedSourceId(id);
    if (!id) return;
    if (postDomain === 'PASSENGER_TRANSPORT') {
      const trip = busTrips.find((t) => t.id === id);
      if (trip) {
        setPickupLocation(trip.route?.origin || 'Dubai Staff Hub');
        setDropoffLocation(trip.route?.destination || 'Industrial Zone Site');
        if (trip.departureTime) {
          const dt = new Date(trip.departureTime);
          if (!Number.isNaN(dt.getTime())) {
            setServiceDate(dt.toISOString().slice(0, 10));
            setPickupTime(dt.toTimeString().slice(0, 5));
          }
        }
        setRequiredCapacity(String(trip.capacity || 50));
        setVehicleTypeRequired((trip.capacity || 50) >= 45 ? '50-Seat Luxury Coach' : '30-Seat Coaster');
        if (trip.notes) setSpecialInstructions(trip.notes);
      }
    } else if (postDomain === 'RECOVERY') {
      const bd = breakdowns.find((b) => b.id === id);
      if (bd) {
        setPickupLocation(bd.location || 'Sheikh Mohammed Bin Zayed Road (E311)');
        setDropoffLocation('Al Quoz Central Workshop');
        const dt = new Date(bd.reportedAt);
        if (!Number.isNaN(dt.getTime())) {
          setServiceDate(dt.toISOString().slice(0, 10));
          setPickupTime(dt.toTimeString().slice(0, 5));
        }
        setRequiredCapacity('1');
        setVehicleTypeRequired('FLATBED');
        setRecoveryUrgency(bd.severity === 'CRITICAL' ? 'EMERGENCY_HIGHWAY' : 'URGENT');
        setSpecialInstructions(
          bd.driverNotes || `Breakdown ${bd.reportNo || bd.id.slice(0, 8)} (${bd.breakdownType || 'MECHANICAL'})`,
        );
      }
    } else {
      const bk = limoBookings.find((b) => b.id === id);
      if (bk) {
        let meta: Record<string, unknown> = {};
        if (bk.notes) {
          try {
            meta = JSON.parse(bk.notes);
          } catch {
            meta = { rawNotes: bk.notes };
          }
        }
        setPickupLocation(String(meta.pickupLocation ?? meta.origin ?? 'Dubai International Airport (DXB) VIP Terminal'));
        setDropoffLocation(String(meta.dropoffLocation ?? meta.destination ?? 'DIFC / Downtown Dubai'));
        const dt = new Date(bk.startDate);
        if (!Number.isNaN(dt.getTime())) {
          setServiceDate(dt.toISOString().slice(0, 10));
          setPickupTime(typeof meta.pickupTime === 'string' ? meta.pickupTime : dt.toTimeString().slice(0, 5));
        }
        setRequiredCapacity(String(meta.passengers ?? meta.passengerCount ?? 2));
        setVehicleTypeRequired(bk.vehicleCategory || 'LUXURY_SEDAN');
        if (typeof meta.flightNumber === 'string') setFlightNumber(meta.flightNumber);
        if (typeof meta.specialInstructions === 'string') {
          setSpecialInstructions(meta.specialInstructions);
        } else {
          setSpecialInstructions(`VIP Chauffeur Booking ${bk.bookingRef || bk.id} â€” Guest: ${bk.requestorName}`);
        }
      }
    }
  };

  const handlePostRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pickupLocation.trim() || !dropoffLocation.trim()) {
      setErrorMsg('Pickup and Dropoff locations are required.');
      return;
    }
    setPosting(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const requirementsPayload =
        postDomain === 'LIMOUSINE'
          ? {
              luxuryClass: vehicleTypeRequired,
              passengerCount: Number(requiredCapacity) || 2,
              luggageCount: Number(luggageCount) || 2,
              serviceType: limoServiceType,
              flightNumber: flightNumber.trim() || undefined,
              meetAndGreet,
              waterAndWifiRequired: waterAndWifi,
            }
          : postDomain === 'RECOVERY'
            ? {
                recoveryType: vehicleTypeRequired,
                vehicleCondition: recoveryCondition,
                urgency: recoveryUrgency,
                disabledVehiclePlate: disabledVehiclePlate.trim() || undefined,
                destinationWorkshop: dropoffLocation.trim(),
              }
            : {
                passengerSeats: Number(requiredCapacity) || 50,
                busClass: vehicleTypeRequired,
                luggageAllowed: true,
              };

      const res = await fetch('/api/bus-ops/outsource', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'CREATE_REQUEST',
          domain: postDomain,
          sourceReferenceId: selectedSourceId || undefined,
          serviceDate,
          pickupTime,
          pickupLocation: pickupLocation.trim(),
          dropoffLocation: dropoffLocation.trim(),
          requiredCapacity:
            Number(requiredCapacity) ||
            (postDomain === 'RECOVERY' ? 1 : postDomain === 'LIMOUSINE' ? 3 : 50),
          vehicleTypeRequired,
          specialInstructions:
            postDomain === 'LIMOUSINE' && flightNumber.trim()
              ? `[Flight ${flightNumber.trim()}${meetAndGreet ? ' â€¢ Meet & Greet' : ''}${waterAndWifi ? ' â€¢ Wi-Fi/Refreshments' : ''}] ${specialInstructions}`.trim()
              : postDomain === 'RECOVERY'
                ? `[${recoveryUrgency} â€¢ ${recoveryCondition}${disabledVehiclePlate.trim() ? ` â€¢ Plate: ${disabledVehiclePlate.trim()}` : ''}] ${specialInstructions}`.trim()
                : specialInstructions.trim() || undefined,
          invitedPartnerIds: [...invitedPartnerIds],
          publishToMarketplace,
          closesAt: closesAt ? new Date(closesAt).toISOString() : undefined,
          requirementsPayload,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(data.error || 'Failed to post RFQ to marketplace.');
        return;
      }
      setShowPostModal(false);
      setSuccessMsg(
        `Posted ${data.request?.requestNumber ?? 'RFQ'} (${
          postDomain === 'LIMOUSINE'
            ? 'Limousine / Chauffeur'
            : postDomain === 'RECOVERY'
              ? 'Roadside Recovery & Towing'
              : 'Bus Transport'
        }) to marketplace.`,
      );
      await loadMarketplace();
      if (data.request?.id) setSelectedId(data.request.id);
    } finally {
      setPosting(false);
    }
  };

  const handlePublishToExchange = async () => {
    if (!selected) return;
    setActing(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await fetch('/api/bus-ops/outsource', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'PUBLISH_TO_MARKETPLACE',
          requestId: selected.id,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(data.error || 'Could not publish to Exchange Network.');
        return;
      }
      setSuccessMsg(`Published ${selected.requestNumber} to the Open Fleet360 Exchange Network.`);
      await loadMarketplace();
    } finally {
      setActing(false);
    }
  };

  const handleAwardQuote = async (quoteId: string) => {
    if (!selected) return;
    setActing(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await fetch('/api/bus-ops/outsource', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'AWARD_QUOTE',
          requestId: selected.id,
          quoteId,
          tripId: selected.sourceReferenceId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(data.error || 'Failed to award quote.');
        return;
      }
      setConfirmQuoteId(null);
      setSuccessMsg(`Awarded ${selected.requestNumber} to partner quote.`);
      await loadMarketplace();
    } finally {
      setActing(false);
    }
  };

  const handleLookupRate = async () => {
    if (!selected || !ratePartnerId) return;
    setLookingUpRate(true);
    setRateResult(null);
    try {
      const res = await fetch('/api/bus-ops/outsource', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'LOOKUP_CONTRACT_RATE',
          partnerId: ratePartnerId,
          originLocation: selected.pickupLocation,
          destinationLocation: selected.dropoffLocation,
          vehicleType: selected.vehicleTypeRequired,
          requiredCapacity: selected.requiredCapacity,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.rate) {
        setRateResult(data.rate);
        if (data.rate.baseAmount || data.rate.rateAmount) {
          setCustomDirectPrice(String(data.rate.baseAmount ?? data.rate.rateAmount));
        }
      }
    } finally {
      setLookingUpRate(false);
    }
  };

  const handleDirectContractAward = async () => {
    if (!selected || !ratePartnerId || !customDirectPrice) return;
    setActing(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/bus-ops/outsource', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'CONTRACT_DIRECT_AWARD',
          domain: selected.domain,
          sourceReferenceId: selected.sourceReferenceId,
          partnerId: ratePartnerId,
          serviceDate: selected.serviceDate,
          pickupTime: selected.pickupTime,
          pickupLocation: selected.pickupLocation,
          dropoffLocation: selected.dropoffLocation,
          requiredCapacity: selected.requiredCapacity,
          agreedPrice: Number(customDirectPrice),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(data.error || 'Contract direct award failed.');
        return;
      }
      setShowRateCard(false);
      setSuccessMsg(`Direct contract award completed for ${selected.requestNumber}.`);
      await loadMarketplace();
    } finally {
      setActing(false);
    }
  };

  const handleCancelRequest = async () => {
    if (!selected) return;
    setActing(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/bus-ops/outsource', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'CANCEL_REQUEST',
          requestId: selected.id,
        }),
      });
      if (res.ok) {
        setSuccessMsg(`Cancelled ${selected.requestNumber}.`);
        await loadMarketplace();
      }
    } finally {
      setActing(false);
    }
  };

  const handleExtendOrRebroadcastRfq = async (hours = 24) => {
    if (!selected) return;
    setActing(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await fetch('/api/bus-ops/outsource', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'EXTEND_OR_REBROADCAST_RFQ',
          requestId: selected.id,
          extensionHours: hours,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(data.error || 'Failed to extend or re-broadcast RFQ.');
        return;
      }
      setSuccessMsg(
        `Re-Broadcasted ${selected.requestNumber} to the Exchange Network (+${hours}h window until ${fmtDate(
          data.closesAt,
        )}).`,
      );
      await loadMarketplace();
    } finally {
      setActing(false);
    }
  };

  const handleTriggerFailover = async () => {
    if (!selected) return;
    setActing(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/exchange/scorecard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'TRIGGER_FAILOVER',
          awardId: selected.award?.id || selected.id,
          requestId: selected.id,
          reasonCode: 'SLA_NO_SHOW',
          severity: 'CRITICAL',
          description: `Operator triggered governed failover re-sourcing for ${selected.requestNumber}.`,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(data.error || 'Failover re-sourcing failed.');
        return;
      }
      const outcome = data.failover?.outcome;
      const penalty = data.failover?.defaultingPartnerPenaltyAmount ?? data.failover?.cancellationPenaltyAmount ?? 0;
      setSuccessMsg(
        outcome === 'PROMOTED_STANDBY_RUNNER_UP' || outcome === 'PROMOTED_STANDBY_QUOTE'
          ? `Failover complete: Promoted compliant standby quote & revoked old driver token (SLA Penalty: AED ${Number(penalty).toFixed(2)}).`
          : `Failover complete: Revoked old driver token & re-opened emergency 15-min broadcast (SLA Penalty: AED ${Number(penalty).toFixed(2)}).`,
      );
      await loadMarketplace();
    } finally {
      setActing(false);
    }
  };

  const handleApproveInvoice = async (invoiceId: string, amount: number | string) => {
    setActing(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/bus-ops/outsource', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'APPROVE_INVOICE',
          invoiceId,
          approvedAmount: Number(amount),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(data.error || 'Failed to approve partner invoice.');
        return;
      }
      setSuccessMsg('Partner invoice approved and posted to Accounts Payable.');
      await loadMarketplace();
    } finally {
      setActing(false);
    }
  };

  // Phase 7: Buyer 3-Way Match, Dispute Resolution & Settlement Statements state
  const [showSettlementsModal, setShowSettlementsModal] = useState(false);
  const [statements, setStatements] = useState<any[]>([]);
  const [stmtPartnerId, setStmtPartnerId] = useState('');
  const [stmtPeriodStart, setStmtPeriodStart] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [stmtPeriodEnd, setStmtPeriodEnd] = useState(() => new Date().toISOString().slice(0, 10));

  const loadStatements = useCallback(async () => {
    try {
      const res = await fetch('/api/bus-ops/outsource/settlements', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (Array.isArray(data.statements)) {
        setStatements(data.statements);
      }
    } catch {
      // Fallback
    }
  }, []);

  const handleRunThreeWayMatch = async (invoiceId: string) => {
    setActing(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/bus-ops/outsource/settlements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'RECONCILE_INVOICE',
          invoiceId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(data.error || '3-way match failed.');
        return;
      }
      const status = data.reconciliation?.verificationStatus || 'MATCHED';
      const discrepancies: string[] = Array.isArray(data.reconciliation?.discrepancies)
        ? data.reconciliation.discrepancies
        : [];
      setSuccessMsg(
        status === 'MATCHED'
          ? '3-Way Match Verified: Contracted RateSnapshot, ePOD evidence, and Partner Invoice match.'
          : `3-Way Match placed on DISCREPANCY HOLD: ${discrepancies.join('; ') || 'Variance detected'}`,
      );
      await loadMarketplace();
    } finally {
      setActing(false);
    }
  };

  const handleResolveDispute = async (
    disputeId: string,
    resolution: 'APPROVED_CREDIT' | 'REJECTED_DEDUCTION',
    resolvedAmount?: number,
  ) => {
    setActing(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/bus-ops/outsource/disputes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'RESOLVE_DISPUTE',
          disputeId,
          resolution,
          resolvedAmount,
          resolutionNotes: `Buyer ${resolution === 'APPROVED_CREDIT' ? 'approved partner credit' : 'upheld SLA deduction'} via Exchange Console`,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(data.error || 'Failed to resolve dispute.');
        return;
      }
      setSuccessMsg(`Dispute resolved (${resolution}).`);
      await loadMarketplace();
    } finally {
      setActing(false);
    }
  };

  const handleGenerateStatement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stmtPartnerId) return;
    setActing(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/bus-ops/outsource/settlements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'GENERATE_STATEMENT',
          partnerId: stmtPartnerId,
          periodStart: stmtPeriodStart,
          periodEnd: stmtPeriodEnd,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(data.error || 'Failed to generate settlement statement.');
        return;
      }
      setSuccessMsg(
        `Generated Settlement Statement ${data.statement?.statementNumber ?? ''} (Held Disputed Invoices: ${
          data.heldDisputedInvoiceCount ?? 0
        }).`,
      );
      await loadStatements();
    } finally {
      setActing(false);
    }
  };

  const handleApproveStatement = async (statementId: string) => {
    setActing(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/bus-ops/outsource/settlements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'APPROVE_STATEMENT',
          statementId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(data.error || 'Failed to approve settlement statement.');
        return;
      }
      setSuccessMsg('Settlement statement approved and posted to Finance AP Ledger.');
      await loadStatements();
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bus, Limousine & Recovery Marketplace"
        subtitle="Post overflow Staff Transport Bus routes, VIP Chauffeur / Limousine bookings, and Roadside Recovery & Towing dispatches to vetted partner fleets"
        icon={Gavel}
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setLiveSyncEnabled((v) => !v)}
              title={
                liveSyncEnabled
                  ? `Live Telemetry & Bid Stream Active${lastLiveSyncAt ? ` (Last sync: ${lastLiveSyncAt})` : ''}`
                  : 'Click to resume Live Telemetry & Bid Stream'
              }
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${
                liveSyncEnabled
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-muted)]'
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  liveSyncEnabled ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
                }`}
              />
              <span>{liveSyncEnabled ? 'LIVE 10s' : 'PAUSED'}</span>
            </button>
            <button
              onClick={() => {
                void loadStatements();
                setShowSettlementsModal(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/20"
            >
              <FileText className="h-3.5 w-3.5" /> Settlements & 3-Way Audit
            </button>
            <button
              onClick={() => {
                const nextDomain =
                  domainFilter === 'LIMOUSINE'
                    ? 'LIMOUSINE'
                    : domainFilter === 'RECOVERY'
                      ? 'RECOVERY'
                      : 'PASSENGER_TRANSPORT';
                setPostDomain(nextDomain);
                setVehicleTypeRequired(
                  nextDomain === 'LIMOUSINE'
                    ? 'LUXURY_SEDAN'
                    : nextDomain === 'RECOVERY'
                      ? 'FLATBED'
                      : '50-Seat Luxury Coach',
                );
                setRequiredCapacity(nextDomain === 'LIMOUSINE' ? '2' : nextDomain === 'RECOVERY' ? '1' : '50');
                setShowPostModal(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-primary)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
            >
              <Plus className="h-3.5 w-3.5" /> Post Bus / Limo / Recovery RFQ
            </button>
            <button
              onClick={() => void loadMarketplace()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)]"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>
        }
      />

      {/* Alerts */}
      {errorMsg && (
        <div className="flex items-center justify-between rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-300">
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="text-rose-400 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {successMsg && (
        <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-300">
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4" /> {successMsg}
          </span>
          <button onClick={() => setSuccessMsg(null)} className="text-emerald-400 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
          <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
            <span>Open RFQs (Bus, Limo & Recovery)</span>
            <Gavel className="h-4 w-4 text-cyan-400" />
          </div>
          <div className="mt-1.5 text-2xl font-bold text-[var(--text-main)]">{kpis.openCount}</div>
          <div className="mt-1 text-[11px] text-[var(--text-faint)]">
            {kpis.busCount} Bus Â· {kpis.limoCount} Limousine Â· {kpis.recoveryCount} Recovery
          </div>
        </div>
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
          <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
            <span>Partner Quotes Received</span>
            <Trophy className="h-4 w-4 text-amber-400" />
          </div>
          <div className="mt-1.5 text-2xl font-bold text-[var(--text-main)]">{kpis.totalQuotes}</div>
          <div className="mt-1 text-[11px] text-[var(--text-faint)]">Blind competitive & contract quotes</div>
        </div>
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
          <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
            <span>Awarded Outsource Spend</span>
            <Calculator className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="mt-1.5 text-2xl font-bold text-[var(--text-main)]">{money(kpis.awardedSpend)}</div>
          <div className="mt-1 text-[11px] text-[var(--text-faint)]">Inclusive of 5% UAE VAT</div>
        </div>
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
          <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
            <span>Active Vetted Partners</span>
            <ShieldCheck className="h-4 w-4 text-indigo-400" />
          </div>
          <div className="mt-1.5 text-2xl font-bold text-[var(--text-main)]">{partners.length}</div>
          <div className="mt-1 text-[11px] text-[var(--text-faint)]">RTA & compliance verified</div>
        </div>
      </div>

      {/* Domain Tabs & Status Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {[
            { id: 'ALL' as const, label: 'All Verticals', icon: Globe },
            { id: 'PASSENGER_TRANSPORT' as const, label: 'Bus & Staff Transport', icon: Bus },
            { id: 'LIMOUSINE' as const, label: 'Limousine & VIP Chauffeur', icon: Car },
            { id: 'RECOVERY' as const, label: 'Roadside Recovery & Towing', icon: Wrench },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = domainFilter === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setDomainFilter(tab.id)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
                  active
                    ? 'bg-[var(--accent-primary)] text-white shadow-sm'
                    : 'border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-main)]'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            );
          })}

          <div className="mx-1 h-4 w-px bg-[var(--border-subtle)]" />

          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                statusFilter === s
                  ? 'bg-cyan-500/20 text-cyan-300 ring-1 ring-cyan-500/40'
                  : 'border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-main)]'
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-faint)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search RFQ, route, luxury class..."
            className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] pl-8 pr-3 py-1.5 text-xs text-[var(--text-main)] placeholder:text-[var(--text-faint)]"
          />
        </div>
      </div>

      {/* Main Master-Detail Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Left Column: RFQs List */}
        <Panel title={`Marketplace RFQs (${filteredRequests.length})`} className="lg:col-span-2">
          {loading ? (
            <p className="py-8 text-center text-sm text-[var(--text-muted)]">Loading Exchange RFQsâ€¦</p>
          ) : filteredRequests.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm text-[var(--text-muted)]">No Bus, Limousine, or Recovery RFQs match this filter.</p>
              <button
                onClick={() => setShowPostModal(true)}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-primary)] px-3 py-1.5 text-xs font-medium text-white"
              >
                <Plus className="h-3.5 w-3.5" /> Post First Bus / Limo / Recovery RFQ
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {filteredRequests.map((r) => {
                const active = r.id === selected?.id;
                const isLimo = r.domain === 'LIMOUSINE';
                const isRecovery = r.domain === 'RECOVERY';
                const quoteCount = r.quotes?.length ?? 0;
                const lowestQuote =
                  r.quotes && r.quotes.length > 0
                    ? Math.min(...r.quotes.map((q) => Number(q.totalAmount || q.amount || 0)))
                    : null;

                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(r.id);
                        setConfirmQuoteId(null);
                        setShowRateCard(false);
                        setRateResult(null);
                      }}
                      className={`w-full text-left px-3 py-3.5 transition ${
                        active ? 'bg-[var(--bg-surface-hover)]' : 'hover:bg-[var(--bg-surface-hover)]/60'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                              isLimo
                                ? 'bg-purple-500/15 text-purple-300 ring-1 ring-purple-500/30'
                                : isRecovery
                                  ? 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30'
                                  : 'bg-cyan-500/15 text-cyan-300 ring-1 ring-cyan-500/30'
                            }`}
                          >
                            {isLimo ? (
                              <Car className="h-3 w-3" />
                            ) : isRecovery ? (
                              <Wrench className="h-3 w-3" />
                            ) : (
                              <Bus className="h-3 w-3" />
                            )}
                            {isLimo ? 'LIMO' : isRecovery ? 'RECOVERY' : 'BUS'}
                          </span>
                          <span className="font-mono text-xs font-semibold text-[var(--text-main)]">
                            {r.requestNumber}
                          </span>
                          {r.opportunity && (
                            <span
                              title="Published on Open Exchange Marketplace"
                              className="inline-flex items-center gap-0.5 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300"
                            >
                              <Globe className="h-2.5 w-2.5" /> Network
                            </span>
                          )}
                        </div>
                        <StatusPill status={r.status} />
                      </div>

                      <div className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-[var(--text-main)]">
                        <MapPin className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
                        <span className="truncate">
                          {r.pickupLocation} â†’ {r.dropoffLocation}
                        </span>
                      </div>

                      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--text-muted)]">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" /> {fmtDate(r.serviceDate)} Â· {r.pickupTime}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Users className="h-3 w-3" />{' '}
                          {isRecovery ? `${r.requiredCapacity} unit` : `${r.requiredCapacity} pax`} Â·{' '}
                          {r.vehicleTypeRequired ||
                            (isLimo ? 'Luxury Sedan' : isRecovery ? 'FLATBED' : '50-Seat Coach')}
                        </span>
                      </div>

                      <div className="mt-1.5 flex items-center justify-between text-[11px]">
                        <span className="text-[var(--text-faint)]">
                          {quoteCount} {quoteCount === 1 ? 'quote' : 'quotes'}
                          {lowestQuote ? ` Â· Best: ${money(lowestQuote)}` : ''}
                        </span>
                        {r.award && (
                          <span className="font-medium text-emerald-400">
                            Awarded: {money(r.award.totalAwarded)}
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        {/* Right Column: Selected RFQ Detail & Bids */}
        <Panel
          title={
            selected
              ? `${
                  selected.domain === 'LIMOUSINE'
                    ? 'VIP Limousine RFQ'
                    : selected.domain === 'RECOVERY'
                      ? 'Roadside Recovery RFQ'
                      : 'Bus Transport RFQ'
                } Â· ${selected.requestNumber}`
              : 'Select an RFQ'
          }
          className="lg:col-span-3"
        >
          {!selected ? (
            <p className="py-12 text-center text-sm text-[var(--text-muted)]">
              Select a Bus, Limousine, or Roadside Recovery RFQ on the left to review specifications, compare partner quotes, or execute a contract rate award.
            </p>
          ) : (
            <div className="space-y-5">
              {/* Specification Summary Box */}
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4 text-xs space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold ${
                        selected.domain === 'LIMOUSINE'
                          ? 'bg-purple-500/20 text-purple-300'
                          : selected.domain === 'RECOVERY'
                            ? 'bg-amber-500/20 text-amber-300'
                            : 'bg-cyan-500/20 text-cyan-300'
                      }`}
                    >
                      {selected.domain === 'LIMOUSINE' ? (
                        <>
                          <Sparkles className="h-3 w-3" /> Limousine & VIP Chauffeur
                        </>
                      ) : selected.domain === 'RECOVERY' ? (
                        <>
                          <Wrench className="h-3 w-3" /> Roadside Recovery & Towing
                        </>
                      ) : (
                        <>
                          <Bus className="h-3 w-3" /> Bus & Staff Transport
                        </>
                      )}
                    </span>
                    <span className="text-[var(--text-muted)]">
                      Source: <strong className="text-[var(--text-main)]">{selected.sourceReferenceType}</strong>
                    </span>
                  </div>
                  <StatusPill status={selected.status} />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
                      {selected.domain === 'RECOVERY' ? 'Breakdown / Incident Scene' : 'Pickup Location'}
                    </div>
                    <div className="mt-0.5 font-medium text-[var(--text-main)]">{selected.pickupLocation}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
                      {selected.domain === 'RECOVERY' ? 'Destination Workshop' : 'Dropoff Location'}
                    </div>
                    <div className="mt-0.5 font-medium text-[var(--text-main)]">{selected.dropoffLocation}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">Service Date & Time</div>
                    <div className="mt-0.5 font-medium text-[var(--text-main)]">
                      {fmtDate(selected.serviceDate)} at {selected.pickupTime}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
                      {selected.domain === 'RECOVERY' ? 'Recovery Equipment & Units' : 'Vehicle Class & Capacity'}
                    </div>
                    <div className="mt-0.5 font-medium text-[var(--text-main)]">
                      {selected.vehicleTypeRequired ||
                        (selected.domain === 'LIMOUSINE'
                          ? 'LUXURY_SEDAN'
                          : selected.domain === 'RECOVERY'
                            ? 'FLATBED'
                            : '50-Seat Coach')}{' '}
                      Â· {selected.domain === 'RECOVERY' ? `${selected.requiredCapacity} unit(s)` : `${selected.requiredCapacity} seats`}
                    </div>
                  </div>
                </div>

                {selected.specialInstructions && (
                  <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-[var(--text-muted)]">
                    <span className="font-semibold text-[var(--text-main)]">Instructions / VIP Protocol: </span>
                    {selected.specialInstructions}
                  </div>
                )}

                {/* Operator Action Bar for Open or Expired/Cancelled RFQs */}
                {selected.status !== 'AWARDED' && (
                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[var(--border-subtle)]">
                    {!selected.opportunity ? (
                      <button
                        type="button"
                        disabled={acting}
                        onClick={() => void handlePublishToExchange()}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
                      >
                        <Globe className="h-3.5 w-3.5" /> Publish to Open Exchange Network
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
                        <Globe className="h-3.5 w-3.5" /> Live on Open Exchange (closes {fmtDate(selected.opportunity.closesAt)})
                      </span>
                    )}

                    <button
                      type="button"
                      disabled={acting}
                      onClick={() => void handleExtendOrRebroadcastRfq(24)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-1.5 text-xs font-semibold text-indigo-300 hover:bg-indigo-500/20 disabled:opacity-50"
                    >
                      <Clock className="h-3.5 w-3.5" /> Re-Broadcast / Extend (+24h)
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowRateCard((v) => !v)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)]"
                    >
                      <Calculator className="h-3.5 w-3.5 text-amber-400" /> Contract Rate Direct Award
                    </button>

                    {selected.status !== 'CANCELLED' && (
                      <button
                        type="button"
                        disabled={acting}
                        onClick={() => void handleCancelRequest()}
                        className="ml-auto inline-flex items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
                      >
                        <Ban className="h-3.5 w-3.5" /> Cancel RFQ
                      </button>
                    )}
                  </div>
                )}

                {/* Contract Rate Lookup & Direct Award Drawer */}
                {showRateCard && ['PUBLISHED', 'QUOTED', 'OPEN'].includes(selected.status) && (
                  <div className="mt-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3.5 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-amber-300 flex items-center gap-1.5">
                        <Calculator className="h-3.5 w-3.5" /> Contracted Rate Card Auto-Pricing & Direct Award
                      </span>
                      <button onClick={() => setShowRateCard(false)} className="text-[var(--text-muted)]">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <select
                        value={ratePartnerId}
                        onChange={(e) => setRatePartnerId(e.target.value)}
                        className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs text-[var(--text-main)]"
                      >
                        <option value="">Select partnerâ€¦</option>
                        {partners.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.legalName} ({p.partnerCode})
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={!ratePartnerId || lookingUpRate}
                        onClick={() => void handleLookupRate()}
                        className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)] disabled:opacity-50"
                      >
                        {lookingUpRate ? 'Checking Rate Cardâ€¦' : 'Lookup Corridor Rate'}
                      </button>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          placeholder="Agreed AED (excl. VAT)"
                          value={customDirectPrice}
                          onChange={(e) => setCustomDirectPrice(e.target.value)}
                          className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs text-[var(--text-main)]"
                        />
                        <button
                          type="button"
                          disabled={!ratePartnerId || !customDirectPrice || acting}
                          onClick={() => void handleDirectContractAward()}
                          className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                        >
                          Award
                        </button>
                      </div>
                    </div>
                    {rateResult && (
                      <div className="text-[11px] text-[var(--text-muted)]">
                        {rateResult.found ? (
                          <span className="text-emerald-300">
                            âœ“ Matched Contract Rate: Base {money(rateResult.baseAmount ?? rateResult.rateAmount)} + 5% VAT (
                            {money(rateResult.vatAmount)}) = <strong>{money(rateResult.totalAmount)}</strong>
                          </span>
                        ) : (
                          <span>No pre-negotiated corridor matrix entry found â€” enter agreed contract rate manually above.</span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Awarded Summary Panel (if awarded) */}
              {selected.award && (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold text-emerald-300 flex items-center gap-1.5">
                      <Trophy className="h-4 w-4" /> Awarded Partner Execution
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      {selected.award.commercialSnapshot && (
                        <span className="rounded bg-indigo-500/20 border border-indigo-500/30 px-2 py-0.5 text-[10px] font-mono text-indigo-200">
                          {String(selected.award.commercialSnapshot.commercialModel || 'AGENCY')}
                          {selected.award.commercialSnapshot.platformFeePct != null
                            ? ` (${selected.award.commercialSnapshot.platformFeePct}% Fee)`
                            : ''}
                          {selected.award.commercialSnapshot.rateCardSnapshot?.snapshotHash
                            ? ` Â· Hash #${String(selected.award.commercialSnapshot.rateCardSnapshot.snapshotHash).slice(0, 8)}`
                            : ''}
                        </span>
                      )}
                      <span className="font-mono font-bold text-emerald-200">
                        Total: {money(selected.award.totalAwarded, selected.award.currency)} (incl. 5% VAT)
                      </span>
                      {selected.award.assignment?.id && (
                        <a
                          href={`/api/exchange/pod/${selected.award.assignment.id}/pdf`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-2.5 py-1 text-[11px] font-semibold text-cyan-300 hover:bg-cyan-500/25"
                        >
                          ðŸ“„ ePOD PDF
                        </a>
                      )}
                      <button
                        type="button"
                        disabled={acting}
                        onClick={() => void handleTriggerFailover()}
                        className="rounded-lg border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold text-amber-300 hover:bg-amber-500/25 disabled:opacity-50"
                        title="Revoke defaulting partner token, apply SLA penalty from frozen RateCardSnapshot, and promote standby quote or re-broadcast"
                      >
                        âš¡ Failover Re-Source
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 text-[var(--text-main)]">
                    <div>
                      <span className="text-[var(--text-muted)]">Partner: </span>
                      <strong>{selected.award.partner?.legalName ?? selected.award.partnerId}</strong>
                    </div>
                    <div>
                      <span className="text-[var(--text-muted)]">Assigned Resource: </span>
                      {selected.award.assignment?.vehiclePlate ? (
                        <strong>
                          {selected.award.assignment.vehiclePlate} Â· {selected.award.assignment.driverName} (
                          {selected.award.assignment.driverPhone})
                        </strong>
                      ) : (
                        <span className="text-amber-300">Awaiting partner vehicle & driver assignment</span>
                      )}
                    </div>
                  </div>

                  {/* Phase 10: Live Partner Driver Milestone & GPS Telemetry Strip */}
                  {selected.award.assignment && (
                    <div className="rounded-lg border border-cyan-500/25 bg-[var(--bg-base)]/80 p-3 space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[11px] font-bold text-cyan-300 flex items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5 text-cyan-400" />
                          <span>Live Partner Driver Execution & GPS Telemetry</span>
                        </span>
                        <span
                          className={`rounded px-2 py-0.5 text-[10px] font-bold font-mono ${
                            selected.award.assignment.isTokenRevoked
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                              : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          }`}
                        >
                          {selected.award.assignment.isTokenRevoked ? 'TOKEN REVOKED (STAGE-3 GATE)' : 'DRIVER TOKEN ACTIVE'}
                        </span>
                      </div>

                      {/* 4-Step Milestone Progress */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                        {[
                          { label: '1. Assigned', done: Boolean(selected.award.assignment.vehiclePlate), ts: null },
                          {
                            label: '2. Reached Pickup',
                            done: Boolean(selected.award.assignment.reachedAt),
                            ts: selected.award.assignment.reachedAt,
                          },
                          {
                            label: '3. In Transit',
                            done: Boolean(selected.award.assignment.startedAt),
                            ts: selected.award.assignment.startedAt,
                          },
                          {
                            label: '4. Completed & ePOD',
                            done: Boolean(selected.award.assignment.completedAt),
                            ts: selected.award.assignment.completedAt,
                          },
                        ].map((step) => (
                          <div
                            key={step.label}
                            className={`rounded-lg border px-2.5 py-1.5 ${
                              step.done
                                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
                                : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-faint)]'
                            }`}
                          >
                            <div className="font-semibold flex items-center justify-between">
                              <span>{step.label}</span>
                              {step.done && <CheckCircle2 className="h-3 w-3 text-emerald-400" />}
                            </div>
                            {step.ts && (
                              <div className="text-[10px] font-mono opacity-80 mt-0.5">
                                {new Date(step.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>

                      {/* Latest GPS Telemetry & Breadcrumbs */}
                      {selected.award.assignment.events && selected.award.assignment.events.length > 0 ? (
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-[var(--text-muted)]">
                          {(() => {
                            const latestGps = selected.award!.assignment!.events!.find(
                              (ev) => ev.eventType === 'GPS_PING' && ev.latitude != null && ev.longitude != null,
                            );
                            const latestEvent = selected.award!.assignment!.events![0];
                            return (
                              <>
                                <span>
                                  {latestGps ? (
                                    <>
                                      Latest GPS Ping:{' '}
                                      <strong className="font-mono text-cyan-300">
                                        {Number(latestGps.latitude).toFixed(4)}, {Number(latestGps.longitude).toFixed(4)}
                                      </strong>
                                      {latestGps.payload?.speed != null
                                        ? ` (${Number(latestGps.payload.speed).toFixed(0)} km/h)`
                                        : ''}
                                    </>
                                  ) : (
                                    <>
                                      Latest Milestone Event:{' '}
                                      <strong className="font-mono text-cyan-300">{latestEvent.eventType}</strong>
                                    </>
                                  )}
                                </span>
                                <span className="font-mono text-[10px] text-[var(--text-faint)]">
                                  {selected.award!.assignment!.events!.length} telemetry/milestone event(s) recorded
                                </span>
                              </>
                            );
                          })()}
                        </div>
                      ) : (
                        <div className="text-[11px] text-[var(--text-faint)]">
                          Awaiting first GPS ping or milestone tap from external driver mobile link.
                        </div>
                      )}
                    </div>
                  )}
                  {selected.award.invoice && (
                    <div className="space-y-2 pt-2 border-t border-emerald-500/20">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span>
                            <FileText className="inline h-3.5 w-3.5 mr-1" />
                            Partner Invoice <strong>{selected.award.invoice.invoiceNumber}</strong>:{' '}
                            {money(selected.award.invoice.totalAmount)} ({selected.award.invoice.status})
                          </span>
                          <span
                            className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                              selected.award.invoice.verificationStatus === 'DISCREPANCY_HOLD'
                                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            }`}
                          >
                            {selected.award.invoice.verificationStatus === 'DISCREPANCY_HOLD'
                              ? 'âš  DISCREPANCY HOLD'
                              : 'âœ“ 3-WAY MATCHED'}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={acting}
                            onClick={() => void handleRunThreeWayMatch(selected.award!.invoice!.id)}
                            className="rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-2.5 py-1 text-[11px] font-semibold text-cyan-300 hover:bg-cyan-500/25 disabled:opacity-50"
                          >
                            Run 3-Way Match
                          </button>
                          {selected.award.invoice.status !== 'APPROVED' && (
                            <button
                              type="button"
                              disabled={acting}
                              onClick={() =>
                                void handleApproveInvoice(
                                  selected.award!.invoice!.id,
                                  selected.award!.invoice!.totalAmount,
                                )
                              }
                              className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-500"
                            >
                              Approve Invoice â†’ AP
                            </button>
                          )}
                        </div>
                      </div>

                      {selected.award.invoice.discrepancyNotes && (
                        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-[11px] text-rose-200">
                          <strong>3-Way Discrepancy Details:</strong> {selected.award.invoice.discrepancyNotes}
                        </div>
                      )}

                      {selected.award.invoice.disputes && selected.award.invoice.disputes.length > 0 && (
                        <div className="space-y-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5">
                          <div className="text-[11px] font-bold text-amber-300">
                            Partner Commercial Disputes ({selected.award.invoice.disputes.length})
                          </div>
                          {selected.award.invoice.disputes.map((d) => (
                            <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                              <span>
                                <strong>{money(d.disputedAmount)}</strong> â€” {d.reason}{' '}
                                <span className="font-mono text-amber-200">[{d.status}]</span>
                              </span>
                              {d.status === 'OPEN' && (
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    disabled={acting}
                                    onClick={() =>
                                      void handleResolveDispute(d.id, 'APPROVED_CREDIT', Number(d.disputedAmount))
                                    }
                                    className="rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-emerald-500"
                                  >
                                    Approve Credit
                                  </button>
                                  <button
                                    type="button"
                                    disabled={acting}
                                    onClick={() => void handleResolveDispute(d.id, 'REJECTED_DEDUCTION')}
                                    className="rounded bg-rose-600 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-rose-500"
                                  >
                                    Reject Claim
                                  </button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Partner Bids / Quotes Comparison Table */}
              <div>
                <h4 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Partner Quotes ({selected.quotes?.length ?? 0})
                </h4>
                {!selected.quotes || selected.quotes.length === 0 ? (
                  <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] py-8 text-center text-xs text-[var(--text-muted)]">
                    No partner quotes submitted yet. Invited partners ({selected.invitedPartners?.length ?? 0}) and Exchange Network carriers can submit blind quotes until the RFQ closes.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)]">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-[var(--border-subtle)] bg-[var(--bg-base)] text-[var(--text-muted)]">
                        <tr>
                          <th className="py-2.5 px-3">Partner</th>
                          <th className="py-2.5 px-3">Base (AED)</th>
                          <th className="py-2.5 px-3">5% VAT</th>
                          <th className="py-2.5 px-3">Total (AED)</th>
                          <th className="py-2.5 px-3">Rev</th>
                          <th className="py-2.5 px-3">Status</th>
                          <th className="py-2.5 px-3 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border-subtle)]">
                        {selected.quotes.map((q) => {
                          const canAward =
                            ['PUBLISHED', 'QUOTED', 'OPEN'].includes(selected.status) &&
                            q.status === 'SUBMITTED';
                          return (
                            <tr key={q.id}>
                              <td className="py-2.5 px-3">
                                <div className="font-medium text-[var(--text-main)]">
                                  {q.partner?.legalName || q.partnerId}
                                </div>
                                {q.notes && (
                                  <div className="text-[11px] text-[var(--text-muted)] truncate max-w-xs">
                                    {q.notes}
                                  </div>
                                )}
                              </td>
                              <td className="py-2.5 px-3 font-mono">{money(q.amount, q.currency)}</td>
                              <td className="py-2.5 px-3 font-mono text-[var(--text-muted)]">
                                {money(q.vatAmount, q.currency)}
                              </td>
                              <td className="py-2.5 px-3 font-mono font-bold text-[var(--text-main)]">
                                {money(q.totalAmount, q.currency)}
                              </td>
                              <td className="py-2.5 px-3 text-[var(--text-muted)]">v{q.revisionNo}</td>
                              <td className="py-2.5 px-3">
                                <StatusPill status={q.status} />
                              </td>
                              <td className="py-2.5 px-3 text-right">
                                {q.status === 'AWARDED' && (
                                  <span className="inline-flex items-center gap-1 text-emerald-400 font-semibold">
                                    <Trophy className="h-3.5 w-3.5" /> Winner
                                  </span>
                                )}
                                {canAward && confirmQuoteId !== q.id && (
                                  <button
                                    type="button"
                                    onClick={() => setConfirmQuoteId(q.id)}
                                    className="rounded-lg bg-[var(--accent-primary)] px-2.5 py-1 text-xs font-medium text-white hover:opacity-90"
                                  >
                                    Award
                                  </button>
                                )}
                                {canAward && confirmQuoteId === q.id && (
                                  <span className="inline-flex items-center gap-1">
                                    <button
                                      type="button"
                                      disabled={acting}
                                      onClick={() => void handleAwardQuote(q.id)}
                                      className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                                    >
                                      {acting ? 'Awardingâ€¦' : 'Confirm'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setConfirmQuoteId(null)}
                                      className="rounded-lg border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-muted)]"
                                    >
                                      Cancel
                                    </button>
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </Panel>
      </div>

      {/* Post Bus / Limo / Recovery RFQ Modal */}
      {showPostModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-[var(--text-main)]">
                  Post Bus, Limousine, or Recovery RFQ to Marketplace
                </h3>
                <p className="text-xs text-[var(--text-muted)]">
                  Publish an overflow Bus route, VIP Chauffeur / Limousine booking, or Roadside Recovery & Towing dispatch for partner bidding
                </p>
              </div>
              <button onClick={() => setShowPostModal(false)} className="text-[var(--text-muted)] hover:text-[var(--text-main)]">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handlePostRequest} className="space-y-4 text-xs">
              {/* Domain Selector */}
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setPostDomain('PASSENGER_TRANSPORT');
                    setSelectedSourceId('');
                    setVehicleTypeRequired('50-Seat Luxury Coach');
                    setRequiredCapacity('50');
                  }}
                  className={`flex items-center justify-center gap-2 rounded-xl border p-3 font-semibold transition ${
                    postDomain === 'PASSENGER_TRANSPORT'
                      ? 'border-cyan-500 bg-cyan-500/15 text-cyan-300'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-base)] text-[var(--text-muted)]'
                  }`}
                >
                  <Bus className="h-4 w-4" /> Bus & Staff Transport
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPostDomain('LIMOUSINE');
                    setSelectedSourceId('');
                    setVehicleTypeRequired('LUXURY_SEDAN');
                    setRequiredCapacity('2');
                  }}
                  className={`flex items-center justify-center gap-2 rounded-xl border p-3 font-semibold transition ${
                    postDomain === 'LIMOUSINE'
                      ? 'border-purple-500 bg-purple-500/15 text-purple-300'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-base)] text-[var(--text-muted)]'
                  }`}
                >
                  <Car className="h-4 w-4" /> Limousine & VIP Chauffeur
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPostDomain('RECOVERY');
                    setSelectedSourceId('');
                    setVehicleTypeRequired('FLATBED');
                    setRequiredCapacity('1');
                  }}
                  className={`flex items-center justify-center gap-2 rounded-xl border p-3 font-semibold transition ${
                    postDomain === 'RECOVERY'
                      ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-base)] text-[var(--text-muted)]'
                  }`}
                >
                  <Wrench className="h-4 w-4" /> Roadside Recovery
                </button>
              </div>

              {/* Optional Link to Scheduled Bus Trip, Confirmed Booking, or Breakdown Report */}
              <div>
                <label className="block mb-1 font-medium text-[var(--text-muted)]">
                  {postDomain === 'PASSENGER_TRANSPORT'
                    ? 'Link Scheduled Bus Trip (optional â€” auto-fills route & time)'
                    : postDomain === 'RECOVERY'
                      ? 'Link Roadside Breakdown Report (optional â€” auto-fills scene & workshop)'
                      : 'Link Chauffeur / VIP Booking (optional â€” auto-fills guest & trip details)'}
                </label>
                <select
                  value={selectedSourceId}
                  onChange={(e) => handleSourceSelect(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2 text-[var(--text-main)]"
                >
                  <option value="">â€” Enter custom / ad-hoc dispatch details â€”</option>
                  {postDomain === 'PASSENGER_TRANSPORT'
                    ? busTrips.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.route?.routeName || 'Bus Route'} ({t.route?.origin || 'Origin'} â†’{' '}
                          {t.route?.destination || 'Destination'}) Â· {fmtDate(t.departureTime)}
                        </option>
                      ))
                    : postDomain === 'RECOVERY'
                      ? breakdowns.map((bd) => (
                          <option key={bd.id} value={bd.id}>
                            {bd.reportNo || bd.id.slice(0, 8)} Â· {bd.breakdownType || 'Breakdown'} ({bd.location || 'Roadside'}) Â·{' '}
                            {fmtDate(bd.reportedAt)}
                          </option>
                        ))
                      : limoBookings.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.bookingRef || b.id.slice(0, 8)} Â· {b.requestorName} ({b.serviceType}) Â· {fmtDate(b.startDate)}
                          </option>
                        ))}
                </select>
              </div>

              {/* Corridor & Schedule */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block mb-1 font-medium text-[var(--text-muted)]">
                    {postDomain === 'RECOVERY' ? 'Breakdown Scene Location *' : 'Pickup Location *'}
                  </label>
                  <input
                    type="text"
                    required
                    value={pickupLocation}
                    onChange={(e) => setPickupLocation(e.target.value)}
                    placeholder={
                      postDomain === 'LIMOUSINE'
                        ? 'e.g. DXB Airport Terminal 3 VIP Arrivals'
                        : postDomain === 'RECOVERY'
                          ? 'e.g. Sheikh Mohammed Bin Zayed Rd (E311) Near Exit 38'
                          : 'e.g. Al Quoz Staff Accommodation Camp 4'
                    }
                    className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2 text-[var(--text-main)]"
                  />
                </div>
                <div>
                  <label className="block mb-1 font-medium text-[var(--text-muted)]">
                    {postDomain === 'RECOVERY' ? 'Destination Workshop *' : 'Dropoff Location *'}
                  </label>
                  <input
                    type="text"
                    required
                    value={dropoffLocation}
                    onChange={(e) => setDropoffLocation(e.target.value)}
                    placeholder={
                      postDomain === 'LIMOUSINE'
                        ? 'e.g. Burj Al Arab / DIFC Gate Village'
                        : postDomain === 'RECOVERY'
                          ? 'e.g. Al Quoz Central Fleet Workshop Bay 4'
                          : 'e.g. JAFZA South Logistics Park'
                    }
                    className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2 text-[var(--text-main)]"
                  />
                </div>
                <div>
                  <label className="block mb-1 font-medium text-[var(--text-muted)]">Service Date *</label>
                  <input
                    type="date"
                    required
                    value={serviceDate}
                    onChange={(e) => setServiceDate(e.target.value)}
                    className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2 text-[var(--text-main)]"
                  />
                </div>
                <div>
                  <label className="block mb-1 font-medium text-[var(--text-muted)]">Pickup Time *</label>
                  <input
                    type="time"
                    required
                    value={pickupTime}
                    onChange={(e) => setPickupTime(e.target.value)}
                    className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2 text-[var(--text-main)]"
                  />
                </div>
                <div>
                  <label className="block mb-1 font-medium text-[var(--text-muted)]">
                    {postDomain === 'LIMOUSINE'
                      ? 'Luxury Vehicle Class *'
                      : postDomain === 'RECOVERY'
                        ? 'Recovery Equipment Type *'
                        : 'Bus Vehicle Type *'}
                  </label>
                  {postDomain === 'LIMOUSINE' ? (
                    <select
                      value={vehicleTypeRequired}
                      onChange={(e) => setVehicleTypeRequired(e.target.value)}
                      className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2 text-[var(--text-main)]"
                    >
                      <option value="LUXURY_SEDAN">Luxury Sedan (Mercedes S-Class / BMW 7-Series)</option>
                      <option value="EXECUTIVE_SEDAN">Executive Sedan (Lexus ES / Mercedes E-Class)</option>
                      <option value="PREMIUM_SUV">Premium SUV (Cadillac Escalade / GMC Yukon Denali)</option>
                      <option value="LUXURY_VAN">VIP Luxury Van (Mercedes V-Class / VIP Sprinter)</option>
                    </select>
                  ) : postDomain === 'RECOVERY' ? (
                    <select
                      value={vehicleTypeRequired}
                      onChange={(e) => setVehicleTypeRequired(e.target.value)}
                      className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2 text-[var(--text-main)]"
                    >
                      <option value="FLATBED">Hydraulic Flatbed Recovery Truck</option>
                      <option value="WHEEL_LIFT">Wheel-Lift / Basement Low-Clearance Tow</option>
                      <option value="HEAVY_CRANE">Heavy Commercial Crane & Rotator</option>
                      <option value="WINCH_OFFROAD">4x4 Off-Road Desert Winch Recovery</option>
                    </select>
                  ) : (
                    <select
                      value={vehicleTypeRequired}
                      onChange={(e) => setVehicleTypeRequired(e.target.value)}
                      className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2 text-[var(--text-main)]"
                    >
                      <option value="50-Seat Luxury Coach">50-Seat Luxury Coach</option>
                      <option value="30-Seat Coaster">30-Seat Toyota Coaster</option>
                      <option value="14-Seat Hiace">14-Seat Commuter Van</option>
                      <option value="66-Seat Staff Bus">66-Seat Labour / Staff Bus</option>
                    </select>
                  )}
                </div>
                <div>
                  <label className="block mb-1 font-medium text-[var(--text-muted)]">
                    {postDomain === 'RECOVERY' ? 'Recovery Units Required *' : 'Passenger Count / Seats *'}
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={200}
                    required
                    value={requiredCapacity}
                    onChange={(e) => setRequiredCapacity(e.target.value)}
                    className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2 text-[var(--text-main)]"
                  />
                </div>
              </div>

              {/* Limousine VIP Protocol Options */}
              {postDomain === 'LIMOUSINE' && (
                <div className="rounded-xl border border-purple-500/30 bg-purple-500/5 p-3.5 space-y-3">
                  <div className="font-semibold text-purple-300 flex items-center gap-1.5">
                    <Plane className="h-3.5 w-3.5" /> VIP Chauffeur & Airport Protocol
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <label className="block mb-1 text-[var(--text-muted)]">Service Mode</label>
                      <select
                        value={limoServiceType}
                        onChange={(e) =>
                          setLimoServiceType(
                            e.target.value as 'AIRPORT_TRANSFER' | 'POINT_TO_POINT' | 'HOURLY_CHAUFFEUR',
                          )
                        }
                        className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2.5 py-1.5 text-[var(--text-main)]"
                      >
                        <option value="AIRPORT_TRANSFER">Airport Transfer</option>
                        <option value="POINT_TO_POINT">Point-to-Point VIP</option>
                        <option value="HOURLY_CHAUFFEUR">Hourly Chauffeur As-Directed</option>
                      </select>
                    </div>
                    <div>
                      <label className="block mb-1 text-[var(--text-muted)]">Flight Number</label>
                      <input
                        type="text"
                        value={flightNumber}
                        onChange={(e) => setFlightNumber(e.target.value)}
                        placeholder="e.g. EK 008"
                        className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2.5 py-1.5 text-[var(--text-main)]"
                      />
                    </div>
                    <div>
                      <label className="block mb-1 text-[var(--text-muted)]">Luggage Pieces</label>
                      <input
                        type="number"
                        min={0}
                        value={luggageCount}
                        onChange={(e) => setLuggageCount(e.target.value)}
                        className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2.5 py-1.5 text-[var(--text-main)]"
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-4 pt-1">
                    <label className="inline-flex items-center gap-1.5 text-[var(--text-main)]">
                      <input
                        type="checkbox"
                        checked={meetAndGreet}
                        onChange={(e) => setMeetAndGreet(e.target.checked)}
                      />
                      Airport Meet & Greet (Name Board)
                    </label>
                    <label className="inline-flex items-center gap-1.5 text-[var(--text-main)]">
                      <input
                        type="checkbox"
                        checked={waterAndWifi}
                        onChange={(e) => setWaterAndWifi(e.target.checked)}
                      />
                      Complimentary Wi-Fi & Chilled Water
                    </label>
                  </div>
                </div>
              )}

              {/* Roadside Recovery Protocol Options */}
              {postDomain === 'RECOVERY' && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3.5 space-y-3">
                  <div className="font-semibold text-amber-300 flex items-center gap-1.5">
                    <Wrench className="h-3.5 w-3.5" /> Roadside Recovery & Casualty Vehicle Assessment
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <label className="block mb-1 text-[var(--text-muted)]">Casualty Vehicle Condition</label>
                      <select
                        value={recoveryCondition}
                        onChange={(e) =>
                          setRecoveryCondition(
                            e.target.value as 'ROLLING' | 'STEERING_LOCKED' | 'SEVERELY_DAMAGED' | 'BASEMENT_PARKING',
                          )
                        }
                        className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2.5 py-1.5 text-[var(--text-main)]"
                      >
                        <option value="ROLLING">Rolling / Neutral Gear</option>
                        <option value="STEERING_LOCKED">Steering / Transmission Locked (Skates Needed)</option>
                        <option value="SEVERELY_DAMAGED">Collision / Severely Damaged</option>
                        <option value="BASEMENT_PARKING">Basement / Low-Height Parking</option>
                      </select>
                    </div>
                    <div>
                      <label className="block mb-1 text-[var(--text-muted)]">Dispatch Urgency</label>
                      <select
                        value={recoveryUrgency}
                        onChange={(e) =>
                          setRecoveryUrgency(e.target.value as 'STANDARD' | 'URGENT' | 'EMERGENCY_HIGHWAY')
                        }
                        className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2.5 py-1.5 text-[var(--text-main)]"
                      >
                        <option value="EMERGENCY_HIGHWAY">Emergency Highway (Immediate)</option>
                        <option value="URGENT">Urgent (&lt; 45 mins)</option>
                        <option value="STANDARD">Standard Scheduled Tow</option>
                      </select>
                    </div>
                    <div>
                      <label className="block mb-1 text-[var(--text-muted)]">Disabled Vehicle Plate</label>
                      <input
                        type="text"
                        value={disabledVehiclePlate}
                        onChange={(e) => setDisabledVehiclePlate(e.target.value)}
                        placeholder="e.g. Dubai K 44102"
                        className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2.5 py-1.5 text-[var(--text-main)]"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Special Instructions */}
              <div>
                <label className="block mb-1 font-medium text-[var(--text-muted)]">
                  Special Instructions / Dress Code / Route Notes
                </label>
                <input
                  type="text"
                  value={specialInstructions}
                  onChange={(e) => setSpecialInstructions(e.target.value)}
                  placeholder="e.g. Chauffeur dark suit required, VIP delegation protocol"
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2 text-[var(--text-main)]"
                />
              </div>

              {/* Marketplace Visibility & Partner Invitations */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="inline-flex items-center gap-2 font-medium text-[var(--text-main)]">
                    <input
                      type="checkbox"
                      checked={publishToMarketplace}
                      onChange={(e) => setPublishToMarketplace(e.target.checked)}
                    />
                    Publish to Open Fleet360 Exchange Network
                  </label>
                  <p className="mt-0.5 text-[11px] text-[var(--text-faint)]">
                    Uses staged disclosure so exact guest/site identities remain masked until award.
                  </p>
                </div>
                <div>
                  <label className="block mb-1 font-medium text-[var(--text-muted)]">Bid Deadline (optional)</label>
                  <input
                    type="datetime-local"
                    value={closesAt}
                    onChange={(e) => setClosesAt(e.target.value)}
                    className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-1.5 text-[var(--text-main)]"
                  />
                </div>
              </div>

              {domainPartners.length > 0 && (
                <div>
                  <label className="block mb-1 font-medium text-[var(--text-muted)]">
                    Direct Partner Invitations ({invitedPartnerIds.size} selected)
                  </label>
                  <div className="max-h-32 overflow-y-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-2 space-y-1">
                    {domainPartners.map((p) => (
                      <label key={p.id} className="flex items-center gap-2 px-1 py-0.5 text-[var(--text-main)]">
                        <input
                          type="checkbox"
                          checked={invitedPartnerIds.has(p.id)}
                          onChange={() =>
                            setInvitedPartnerIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(p.id)) next.delete(p.id);
                              else next.add(p.id);
                              return next;
                            })
                          }
                        />
                        <span>
                          {p.legalName} <span className="text-[var(--text-faint)]">({p.partnerCode})</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
                <button
                  type="button"
                  onClick={() => setShowPostModal(false)}
                  className="rounded-lg border border-[var(--border-subtle)] px-3 py-1.5 text-xs text-[var(--text-muted)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={posting}
                  className="rounded-lg bg-[var(--accent-primary)] px-4 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {posting ? 'Posting RFQâ€¦' : 'Post to Marketplace'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Phase 7: Buyer Settlements, 3-Way Audit & UAE FTA Tax Invoice Modal */}
      {showSettlementsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-4xl rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 shadow-xl space-y-5 max-h-[90vh] overflow-y-auto text-xs">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <div>
                <h3 className="text-base font-bold text-[var(--text-main)]">
                  Partner Settlement Statements & UAE FTA Tax Invoices
                </h3>
                <p className="text-xs text-[var(--text-muted)]">
                  Consolidate 3-way matched invoices into periodic statements (automatically isolating disputed invoices) and export FTA-compliant Tax Invoice PDFs.
                </p>
              </div>
              <button
                onClick={() => setShowSettlementsModal(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text-main)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Generate Consolidated Statement Form */}
            <form
              onSubmit={handleGenerateStatement}
              className="grid grid-cols-1 gap-3 sm:grid-cols-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3.5"
            >
              <div>
                <label className="block text-[11px] font-semibold text-[var(--text-muted)] mb-1">
                  Transport Partner
                </label>
                <select
                  required
                  value={stmtPartnerId}
                  onChange={(e) => setStmtPartnerId(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs text-[var(--text-main)]"
                >
                  <option value="">Select partnerâ€¦</option>
                  {partners.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.legalName} ({p.partnerCode})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[var(--text-muted)] mb-1">
                  Period Start
                </label>
                <input
                  type="date"
                  required
                  value={stmtPeriodStart}
                  onChange={(e) => setStmtPeriodStart(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs text-[var(--text-main)]"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[var(--text-muted)] mb-1">
                  Period End
                </label>
                <input
                  type="date"
                  required
                  value={stmtPeriodEnd}
                  onChange={(e) => setStmtPeriodEnd(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs text-[var(--text-main)]"
                />
              </div>
              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={!stmtPartnerId || acting}
                  className="w-full rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
                >
                  Generate Statement
                </button>
              </div>
            </form>

            {/* Statements Table */}
            <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)]">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[var(--border-subtle)] bg-[var(--bg-base)] text-[var(--text-muted)]">
                  <tr>
                    <th className="py-2.5 px-3">Statement #</th>
                    <th className="py-2.5 px-3">Partner</th>
                    <th className="py-2.5 px-3">Period</th>
                    <th className="py-2.5 px-3">Gross + 5% VAT</th>
                    <th className="py-2.5 px-3">Deductions</th>
                    <th className="py-2.5 px-3">Net Payable</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3 text-right">Actions & Tax PDF</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {statements.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-[var(--text-muted)]">
                        No consolidated settlement statements generated yet.
                      </td>
                    </tr>
                  ) : (
                    statements.map((st) => (
                      <tr key={st.id}>
                        <td className="py-2.5 px-3 font-mono font-bold text-[var(--text-main)]">
                          {st.statementNumber}
                        </td>
                        <td className="py-2.5 px-3">{st.partner?.legalName || st.partnerId}</td>
                        <td className="py-2.5 px-3 text-[var(--text-muted)]">
                          {fmtDate(st.periodStart)} â€“ {fmtDate(st.periodEnd)}
                        </td>
                        <td className="py-2.5 px-3 font-mono">
                          {money(Number(st.grossAmount || 0) + Number(st.vatAmount || 0))}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-rose-400">
                          {Number(st.totalDeductions || 0) > 0 ? `-${money(st.totalDeductions)}` : 'AED 0.00'}
                        </td>
                        <td className="py-2.5 px-3 font-mono font-bold text-emerald-400">
                          {money(st.netPayable)}
                        </td>
                        <td className="py-2.5 px-3">
                          <StatusPill status={st.status} />
                        </td>
                        <td className="py-2.5 px-3 text-right space-x-1.5">
                          {st.status !== 'APPROVED' && (
                            <button
                              type="button"
                              disabled={acting}
                              onClick={() => void handleApproveStatement(st.id)}
                              className="rounded bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-500"
                            >
                              Approve â†’ AP
                            </button>
                          )}
                          <a
                            href={`/api/exchange/statements/${st.id}/pdf`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-block rounded border border-cyan-500/40 bg-cyan-500/15 px-2.5 py-1 text-[11px] font-semibold text-cyan-300 hover:bg-cyan-500/25"
                          >
                            UAE FTA Tax PDF
                          </a>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
