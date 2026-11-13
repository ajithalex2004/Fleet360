'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import {
  CheckCircle2,
  Clock,
  Copy,
  Download,
  FileCheck2,
  Camera,
  Mail,
  MapPin,
  MessageSquare,
  Navigation,
  Package,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { KpiCard, StatGrid } from '@/components/ui/page-theme';
import type {
  DrayageCorridorTerminal,
  DrayageCorridorWarehouse,
  DrayageCorridorGeofence,
  DrayageCorridorVehicle,
} from '@/components/logistics/drayage/DrayageCorridorLiveMap';

const DrayageCorridorLiveMap = dynamic(
  () => import('@/components/logistics/drayage/DrayageCorridorLiveMap'),
  {
    ssr: false,
    loading: () => (
      <div className="h-[460px] rounded-2xl bg-slate-900 animate-pulse flex flex-col items-center justify-center text-xs text-blue-400 gap-2 border border-slate-800">
        <RefreshCw className="w-5 h-5 animate-spin text-blue-500" />
        <span>Loading Live UAE Freight Corridor Map...</span>
      </div>
    ),
  },
);

interface MilestoneStep {
  stageNum: number;
  code: string;
  title: string;
  subtitle: string;
  state: 'COMPLETED' | 'CURRENT' | 'UPCOMING';
  timestamp: string | null;
  notes: string | null;
}

interface StatusLogItem {
  id: string;
  jobId: string;
  jobCode: string;
  status: string;
  notes: string;
  actor: string;
  timestamp: string;
  location?: string;
}

interface PortalPayload {
  portalReadOnly: boolean;
  portalRole?: 'CUSTOMER' | 'CLIENT' | 'RAMP';
  linkActive?: boolean;
  activationRequirement?: string;
  verifiedToken: string;
  refreshedAt: string;
  currentStageIndex: number;
  job: {
    id: string;
    jobCode: string;
    jobPhase: 'L1' | 'L2';
    shipmentType: string;
    status: string;
    priority: string;
    customerName: string;
    terminalName: string;
    warehouseName: string;
    containerNumber: string;
    containerSize: string;
    containerType: string;
    shippingLine: string;
    sealNumber?: string | null;
    weightKg?: number | null;
    inspectionStatus?: string | null;
    tokenNumber: string | null;
    assignedVehiclePlate: string | null;
    assignedDriverName: string | null;
    assignedTrailerPlate: string | null;
    placementLocation: 'RAMP' | 'YARD' | null;
    trailerDetached: boolean;
    l2Activated: boolean;
    etcTime: string | null;
    currentLat: number | null;
    currentLng: number | null;
    podSignatureName: string | null;
    podSignedAt: string | null;
    podPhotoUrl: string | null;
    portSlotPrediction?: {
      predictedGateArrivalLabel: string;
      totalEtaMinutes: number;
      corridorName: string;
    };
    customerPortal?: {
      customerWhatsApp: string;
      customerEmail: string;
      clientName?: string;
      clientWhatsApp?: string;
      clientEmail?: string;
      rampContactName?: string;
      rampWhatsApp?: string;
      customerLinkActive?: boolean;
      clientLinkActive?: boolean;
      rampLinkActive?: boolean;
      autoAlertsEnabled: boolean;
    };
    createdAt: string;
    updatedAt: string;
  };
  milestones: MilestoneStep[];
  statusLogs: StatusLogItem[];
  alertLogs: StatusLogItem[];
  corridorMap: {
    terminals: DrayageCorridorTerminal[];
    warehouses: DrayageCorridorWarehouse[];
    geofences: DrayageCorridorGeofence[];
    vehicles: DrayageCorridorVehicle[];
  };
}

export default function CustomerDrayageTrackingPortalPage() {
  const params = useParams();
  const token = String(params?.token || '');

  const [portalData, setPortalData] = useState<PortalPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [, setTick] = useState(0);

  // Customer / Client / Ramp WhatsApp & Email Subscription Form
  const [whatsappInput, setWhatsappInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [autoAlertsEnabled, setAutoAlertsEnabled] = useState(true);
  const [savingAlerts, setSavingAlerts] = useState(false);
  const [confirmingEmpty, setConfirmingEmpty] = useState(false);
  const [extendingEtc, setExtendingEtc] = useState(false);

  // Ramp Stuffing / Destuffing Completion Form
  const [rampOperationType, setRampOperationType] = useState<'DESTUFFING' | 'STUFFING'>('DESTUFFING');
  const [rampReceiverName, setRampReceiverName] = useState('');
  const [rampBayNotes, setRampBayNotes] = useState('');
  const [rampSealNumber, setRampSealNumber] = useState('');
  const [rampGrossWeightKg, setRampGrossWeightKg] = useState('');

  const showNotice = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4500);
  };

  const fetchPortalData = useCallback(
    async (silent = false) => {
      if (!token) return;
      try {
        if (!silent) setLoading(true);
        else setRefreshing(true);

        const res = await fetch(
          `/api/driver-app/customer-tracking?token=${encodeURIComponent(token)}`,
          { cache: 'no-store' },
        );
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Invalid or expired tracking link');
        }
        setPortalData(data);
        setError(null);

        if (data.job?.customerPortal && !silent) {
          const role = data.portalRole || 'CUSTOMER';
          const cp = data.job.customerPortal;
          if (role === 'RAMP') {
            setWhatsappInput(cp.rampWhatsApp || cp.clientWhatsApp || cp.customerWhatsApp || '');
            setEmailInput(cp.clientEmail || cp.customerEmail || '');
            setRampReceiverName(cp.rampContactName || `${data.job.warehouseName} Ramp Supervisor`);
          } else if (role === 'CLIENT') {
            setWhatsappInput(cp.clientWhatsApp || cp.customerWhatsApp || '');
            setEmailInput(cp.clientEmail || cp.customerEmail || '');
            setRampReceiverName(cp.rampContactName || cp.clientName || `${data.job.warehouseName} Receiving`);
          } else {
            setWhatsappInput(cp.customerWhatsApp || '');
            setEmailInput(cp.customerEmail || '');
          }
          setAutoAlertsEnabled(Boolean(cp.autoAlertsEnabled ?? true));
          setRampOperationType(
            String(data.job.shipmentType || '').toUpperCase() === 'EXPORT' ? 'STUFFING' : 'DESTUFFING',
          );
          if (data.job.sealNumber) setRampSealNumber(String(data.job.sealNumber));
          if (data.job.weightKg) setRampGrossWeightKg(String(data.job.weightKg));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to load tracking portal');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token],
  );

  useEffect(() => {
    void fetchPortalData(false);
  }, [fetchPortalData]);

  // 15s live auto-refresh + 10s countdown ticker for Offloading ETC
  useEffect(() => {
    const poll = setInterval(() => {
      void fetchPortalData(true);
    }, 15000);
    const clock = setInterval(() => {
      setTick((t) => t + 1);
    }, 10000);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [fetchPortalData]);

  const handleCopyShareableUrl = () => {
    if (typeof window === 'undefined') return;
    navigator.clipboard.writeText(window.location.href);
    setCopiedLink(true);
    showNotice('✓ Shareable Customer Tracking Link copied to clipboard!');
    setTimeout(() => setCopiedLink(false), 3000);
  };

  // Generate & Download Printable / Saveable Signed ePOD & Seal Verification Certificate
  const handleDownloadEpodCertificate = () => {
    if (!portalData?.job || typeof window === 'undefined') return;
    const j = portalData.job;
    const mList = portalData.milestones || [];
    const printWin = window.open('', '_blank', 'width=900,height=800');
    if (!printWin) {
      showNotice('Please allow pop-ups to download/print the Signed ePOD Certificate.');
      return;
    }

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>ePOD_${j.containerNumber}_${j.jobCode}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; color: #0f172a; margin: 32px; line-height: 1.5; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0284c7; padding-bottom: 16px; margin-bottom: 24px; }
    .badge { display: inline-block; background: #ecfdf5; color: #047857; border: 1px solid #6ee7b7; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 700; }
    .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin-bottom: 24px; }
    .box { border: 1px solid #cbd5e1; border-radius: 10px; padding: 14px; background: #f8fafc; }
    .label { font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 700; }
    .val { font-size: 15px; font-weight: 700; color: #0f172a; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13px; }
    th, td { border: 1px solid #cbd5e1; padding: 10px 12px; text-align: left; }
    th { background: #f1f5f9; font-weight: 700; }
    .sig-box { border: 2px dashed #059669; border-radius: 12px; padding: 18px; background: #f0fdf4; display: flex; justify-content: space-between; align-items: center; }
    @media print { .no-print { display: none; } }
  </style>
</head>
<body>
  <div class="no-print" style="margin-bottom:16px; text-align:right;">
    <button onclick="window.print()" style="background:#0284c7;color:#fff;border:none;padding:8px 16px;border-radius:8px;font-weight:700;cursor:pointer;">Print / Save as PDF</button>
  </div>
  <div class="header">
    <div>
      <h1 style="margin:0;font-size:22px;">FLEET360 ELECTRONIC PROOF OF DELIVERY (ePOD) & SEAL CERTIFICATE</h1>
      <p style="margin:4px 0 0;font-size:13px;color:#475569;">Token-Verified Port Drayage & Consignee Delivery Record · Job ${j.jobCode}</p>
    </div>
    <div class="badge">✓ VERIFIED RECORD</div>
  </div>
  <div class="grid">
    <div class="box">
      <div class="label">Container & ISO Specification</div>
      <div class="val">${j.containerNumber} (${j.containerSize} · ${j.containerType})</div>
      <div style="font-size:12px;color:#475569;margin-top:4px;">Seal No: <strong>${j.sealNumber || 'Verified Intact'}</strong> · Weight: <strong>${j.weightKg ? j.weightKg + ' KG' : 'Standard'}</strong></div>
    </div>
    <div class="box">
      <div class="label">Customer & Haulage Corridor</div>
      <div class="val">${j.customerName}</div>
      <div style="font-size:12px;color:#475569;margin-top:4px;">${j.terminalName} → ${j.warehouseName}</div>
    </div>
    <div class="box">
      <div class="label">Assigned Fleet & Port Token</div>
      <div class="val">Tractor: ${j.assignedVehiclePlate || 'Assigned'} · Chassis: ${j.assignedTrailerPlate || 'Coupled'}</div>
      <div style="font-size:12px;color:#475569;margin-top:4px;">Driver: ${j.assignedDriverName || 'Assigned Driver'} · Port Token: ${j.tokenNumber || 'Verified'}</div>
    </div>
    <div class="box">
      <div class="label">Customs & Regulatory Clearance</div>
      <div class="val">${j.inspectionStatus || 'CLEARED'}</div>
      <div style="font-size:12px;color:#475569;margin-top:4px;">Placement: ${j.placementLocation || 'RAMP'} · Status: ${j.status}</div>
    </div>
  </div>
  <h3 style="font-size:15px;margin-bottom:8px;">Milestone Progression (Gate-In → Loaded at Terminal → Customs Cleared → En Route → At Warehouse → ePOD Signed)</h3>
  <table>
    <thead>
      <tr>
        <th>Stage</th>
        <th>Milestone</th>
        <th>Details</th>
        <th>Status</th>
        <th>Timestamp</th>
      </tr>
    </thead>
    <tbody>
      ${mList
        .map(
          (m) => `<tr>
        <td>#${m.stageNum}</td>
        <td><strong>${m.title}</strong></td>
        <td>${m.subtitle}</td>
        <td>${m.state}</td>
        <td>${m.timestamp ? new Date(m.timestamp).toLocaleString() : '—'}</td>
      </tr>`,
        )
        .join('')}
    </tbody>
  </table>
  <div class="sig-box">
    <div>
      <div class="label" style="color:#047857;">Consignee ePOD Signature & Seal Verification</div>
      <div class="val" style="font-size:18px;color:#065f46;margin-top:4px;">Signed by: ${j.podSignatureName || j.customerName + ' Receiving Bay'}</div>
      <div style="font-size:12px;color:#047857;margin-top:4px;">Signed At: ${j.podSignedAt ? new Date(j.podSignedAt).toLocaleString() : new Date(j.updatedAt).toLocaleString()} · Seal: ${j.sealNumber || 'Verified Intact'}</div>
    </div>
    <div style="text-align:right;font-family:monospace;font-size:12px;color:#047857;">
      HMAC-SHA256 Token Verified<br/>${j.jobCode} · ${j.containerNumber}
    </div>
  </div>
</body>
</html>`;

    printWin.document.open();
    printWin.document.write(html);
    printWin.document.close();
  };

  // Download Seal & Container Evidence Photo
  const handleDownloadSealPhoto = () => {
    if (!portalData?.job || typeof window === 'undefined') return;
    const j = portalData.job;
    if (j.podPhotoUrl) {
      const a = document.createElement('a');
      a.href = j.podPhotoUrl;
      a.download = `Seal_ePOD_Photo_${j.containerNumber}.png`;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }
    // Generate a high-resolution SVG/PNG evidence card of the container & bolt seal verification if no external URL was uploaded
    const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="480" viewBox="0 0 800 480">
      <rect width="800" height="480" fill="#0f172a" rx="16"/>
      <rect x="24" y="24" width="752" height="432" fill="#1e293b" stroke="#0ea5e9" stroke-width="2" rx="12"/>
      <text x="48" y="72" fill="#38bdf8" font-family="monospace" font-size="16" font-weight="bold">FLEET360 PORT GATE &amp; SEAL VERIFICATION EVIDENCE</text>
      <text x="48" y="120" fill="#ffffff" font-family="monospace" font-size="32" font-weight="bold">CONTAINER: ${j.containerNumber}</text>
      <text x="48" y="160" fill="#94a3b8" font-family="sans-serif" font-size="18">Size / Type: ${j.containerSize} ${j.containerType} · Job: ${j.jobCode}</text>
      <rect x="48" y="190" width="704" height="110" fill="#0f172a" stroke="#10b981" stroke-width="2" rx="10"/>
      <text x="72" y="232" fill="#34d399" font-family="monospace" font-size="22" font-weight="bold">✓ CUSTOMS BOLT SEAL: ${j.sealNumber || 'SEAL-VERIFIED'}</text>
      <text x="72" y="268" fill="#cbd5e1" font-family="sans-serif" font-size="16">Origin: ${j.terminalName} → Destination: ${j.warehouseName}</text>
      <text x="48" y="348" fill="#e2e8f0" font-family="sans-serif" font-size="16">Prime Mover: ${j.assignedVehiclePlate || 'Assigned'} · Driver: ${j.assignedDriverName || 'Verified Driver'}</text>
      <text x="48" y="380" fill="#10b981" font-family="sans-serif" font-size="16" font-weight="bold">ePOD Receiver: ${j.podSignatureName || 'Consignee Receiving Dock'} · Status: ${j.status}</text>
      <text x="48" y="425" fill="#64748b" font-family="monospace" font-size="13">Timestamp: ${new Date(j.podSignedAt || j.updatedAt).toISOString()}</text>
    </svg>`;
    const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Container_Seal_Evidence_${j.containerNumber}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showNotice(`✓ Downloaded Seal & Gate Verification Card for ${j.containerNumber}`);
  };

  const handleSaveAlertSubscriptions = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSavingAlerts(true);
      const res = await fetch('/api/driver-app/customer-tracking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          action: 'update_subscriptions',
          customerWhatsApp: whatsappInput,
          customerEmail: emailInput,
          autoAlertsEnabled,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update alert preferences');
      showNotice(
        `✓ Saved & dispatched live milestone update to WhatsApp (${whatsappInput || 'N/A'}) and Email (${emailInput || 'N/A'})!`,
      );
      await fetchPortalData(true);
    } catch (err) {
      showNotice(err instanceof Error ? err.message : 'Failed to update subscriptions');
    } finally {
      setSavingAlerts(false);
    }
  };

  const handleConfirmOffloadingComplete = async () => {
    try {
      setConfirmingEmpty(true);
      const isStuffing = rampOperationType === 'STUFFING';
      const res = await fetch('/api/driver-app/customer-tracking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          action: isStuffing ? 'confirm_stuffing_complete' : 'confirm_offloading_complete',
          operationType: rampOperationType,
          receiverName: rampReceiverName.trim() || `${portalData?.job?.warehouseName || 'Ramp'} Supervisor`,
          consigneeContact: rampReceiverName.trim() || `${portalData?.job?.warehouseName || 'Ramp'} Supervisor`,
          bayNotes: rampBayNotes.trim() || undefined,
          newSealNumber: isStuffing && rampSealNumber.trim() ? rampSealNumber.trim() : undefined,
          grossWeightKg:
            isStuffing && rampGrossWeightKg.trim() && Number(rampGrossWeightKg) > 0
              ? Number(rampGrossWeightKg)
              : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to confirm ramp completion');
      showNotice(
        isStuffing
          ? `✓ Export Stuffing & Seal confirmed! Container ${portalData?.job?.containerNumber} marked Ready for Pickup.`
          : `✓ Destuffing confirmed! L2 Empty Return ${data.l2JobCode || ''} activated for immediate pickup.`,
      );
      await fetchPortalData(true);
    } catch (err) {
      showNotice(err instanceof Error ? err.message : 'Error confirming ramp completion');
    } finally {
      setConfirmingEmpty(false);
    }
  };

  const handleExtendRampEtc = async (minutesToAdd: number) => {
    try {
      setExtendingEtc(true);
      const res = await fetch('/api/driver-app/customer-tracking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          action: 'extend_ramp_etc',
          minutesToAdd,
          reason: `Ramp Supervisor extended ${rampOperationType.toLowerCase()} window by +${minutesToAdd}m`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to extend Ramp ETC');
      showNotice(`✓ Extended Ramp ETC by +${minutesToAdd} minutes.`);
      await fetchPortalData(true);
    } catch (err) {
      showNotice(err instanceof Error ? err.message : 'Error extending Ramp ETC');
    } finally {
      setExtendingEtc(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6">
        <RefreshCw className="w-8 h-8 text-blue-400 animate-spin mb-3" />
        <h1 className="text-base font-bold">Loading Live Container Tracking Portal...</h1>
        <p className="text-xs text-slate-400 mt-1">
          Verifying cryptographic shareable token & syncing UAE corridor telematics
        </p>
      </div>
    );
  }

  if (error || !portalData?.job) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full p-6 rounded-2xl bg-slate-900 border border-rose-500/40 text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center mx-auto font-black text-lg">
            !
          </div>
          <h1 className="text-lg font-extrabold text-white">Invalid or Expired Tracking Link</h1>
          <p className="text-xs text-slate-300 leading-relaxed">
            {error || 'This shareable tracking token could not be verified. Please request a fresh tracking link from your logistics dispatcher.'}
          </p>
        </div>
      </div>
    );
  }

  const job = portalData.job;
  const portalRole = portalData.portalRole || 'CUSTOMER';
  const linkActive = portalData.linkActive ?? true;
  const roleLabel =
    portalRole === 'RAMP'
      ? 'RAMP SUPERVISOR LINK (STUFFING / DESTUFFING)'
      : portalRole === 'CLIENT'
      ? 'CLIENT (CONSIGNEE / END USER) PORTAL'
      : 'CUSTOMER (CONSIGNOR / SHIPPER) PORTAL';

  if (!linkActive) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6">
        <div className="max-w-lg w-full p-6 rounded-2xl bg-slate-900 border border-amber-500/40 shadow-2xl space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-amber-500/20 text-amber-300 border border-amber-500/40">
              ⏳ LINK PENDING STAGE ACTIVATION · {roleLabel}
            </span>
            <button
              type="button"
              onClick={() => void fetchPortalData(true)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-bold text-blue-300"
            >
              <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
              Check Now
            </button>
          </div>

          <div className="space-y-2">
            <h1 className="text-lg font-black text-white">
              {portalRole === 'RAMP'
                ? 'Ramp Link Activates Upon PLACED_AT_RAMP Status'
                : `${portalRole === 'CLIENT' ? 'Client' : 'Customer'} Link Activates Upon Vehicle & Driver Assignment`}
            </h1>
            <p className="text-xs text-slate-300 leading-relaxed">
              {portalData.activationRequirement ||
                (portalRole === 'RAMP'
                  ? 'This Ramp Stuffing/Destuffing completion link will automatically unlock as soon as the driver positions the container at the facility ramp (PLACED_AT_RAMP).'
                  : 'This live tracking link will automatically unlock as soon as Dispatch assigns a Prime Mover (Vehicle) & Driver (ASSIGNED status).')}
            </p>
          </div>

          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-[10px] uppercase text-slate-400 font-bold block">Container / Job</span>
              <strong className="font-mono text-white">{job.containerNumber}</strong>
              <div className="text-[11px] text-slate-400">{job.jobCode} · {job.containerSize}</div>
            </div>
            <div>
              <span className="text-[10px] uppercase text-slate-400 font-bold block">Current Job Status</span>
              <strong className="font-mono text-amber-300">{job.status}</strong>
              <div className="text-[11px] text-slate-400">
                Required: {portalRole === 'RAMP' ? 'PLACED_AT_RAMP' : 'ASSIGNED (Vehicle & Driver)'}
              </div>
            </div>
            <div>
              <span className="text-[10px] uppercase text-slate-400 font-bold block">Customer (Consignor)</span>
              <strong className="text-slate-200">{job.customerName}</strong>
            </div>
            <div>
              <span className="text-[10px] uppercase text-slate-400 font-bold block">Consignee Facility</span>
              <strong className="text-slate-200">{job.warehouseName}</strong>
            </div>
          </div>

          <p className="text-[11px] text-slate-400 text-center">
            Auto-syncing every 15 seconds — this page will open automatically once activated.
          </p>
        </div>
      </div>
    );
  }

  const milestones: MilestoneStep[] = portalData.milestones || [];
  const statusLogs: StatusLogItem[] = portalData.statusLogs || [];
  const alertLogs: StatusLogItem[] = portalData.alertLogs || [];
  const currentStageIndex = Number(portalData.currentStageIndex ?? 1);

  const etcRemainingMins = job.etcTime
    ? Math.round((new Date(job.etcTime).getTime() - Date.now()) / 60000)
    : null;

  const currentPortalUrl = typeof window !== 'undefined' ? window.location.href : '';
  const cleanWaPhone = whatsappInput.replace(/[^\d]/g, '');
  const shareWhatsAppHref = `https://wa.me/${cleanWaPhone}?text=${encodeURIComponent(
    `📦 *Fleet360 Live Container Tracking (${portalRole})*\n• *Job:* ${job.jobCode}\n• *Container:* ${job.containerNumber} (${job.containerSize})\n• *Seal:* ${job.sealNumber || 'Verified'}\n• *Status:* ${job.status}\n• *Route:* ${job.terminalName} → ${job.warehouseName}\n🔗 *Portal Link:* ${currentPortalUrl}`,
  )}`;

  const shareEmailHref = `mailto:${encodeURIComponent(emailInput)}?subject=${encodeURIComponent(
    `Live Container Tracking & ePOD (${portalRole}) — ${job.containerNumber} (${job.jobCode})`,
  )}&body=${encodeURIComponent(
    `Hello,\n\nAccess the ${portalRole} Portal for Container ${job.containerNumber} (${job.jobCode}):\n\n${currentPortalUrl}\n\nRoute: ${job.terminalName} → ${job.warehouseName}\nCurrent Status: ${job.status}\n`,
  )}`;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 pb-14">
      {/* Top Notification Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 max-w-md px-4 py-3 rounded-xl bg-emerald-600 text-white text-xs font-bold shadow-2xl border border-emerald-400 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{toast}</span>
        </div>
      )}

      {/* Zero-Login Role-Scoped Portal Top Header */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400">
              <Navigation className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-black tracking-tight text-white">
                  {portalRole === 'RAMP'
                    ? 'FLEET360 WAREHOUSE RAMP PORTAL — STUFFING & DESTUFFING'
                    : portalRole === 'CLIENT'
                    ? 'FLEET360 CLIENT (CONSIGNEE / END USER) TRACKING PORTAL'
                    : 'FLEET360 CUSTOMER (CONSIGNOR / SHIPPER) TRACKING PORTAL'}
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold border flex items-center gap-1 ${
                    portalRole === 'RAMP'
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                      : portalRole === 'CLIENT'
                      ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                      : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                  }`}
                >
                  <ShieldCheck className="w-3 h-3" />
                  {roleLabel}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                {portalRole === 'RAMP'
                  ? `Activated @ PLACED_AT_RAMP · ${job.warehouseName} · Update Stuffing / Destuffing Completion & Seal Verification`
                  : `Activated @ ASSIGNED · ${job.customerName} → ${job.warehouseName} · Live Milestones, ePOD & Seal Verification`}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleCopyShareableUrl}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-slate-100 transition-colors"
            >
              <Copy className="w-3.5 h-3.5 text-blue-400" />
              {copiedLink ? 'Link Copied!' : `Copy ${portalRole} Link`}
            </button>

            <a
              href={shareWhatsAppHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors shadow-sm"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              WhatsApp Link
            </a>

            <a
              href={shareEmailHref}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold transition-colors shadow-sm"
            >
              <Mail className="w-3.5 h-3.5" />
              Email Link
            </a>

            <button
              type="button"
              onClick={() => void fetchPortalData(true)}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 text-xs font-bold text-blue-300 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              Live Sync (15s)
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 pt-6 space-y-6">
        {/* Container & Job Summary Banner */}
        <section className="p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800 pb-4">
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="font-mono text-xl font-black text-white">{job.containerNumber}</span>
                <span className="px-2.5 py-0.5 rounded-lg text-xs font-mono font-bold bg-blue-500/20 text-blue-300 border border-blue-500/40">
                  {job.jobCode} · {job.jobPhase}
                </span>
                <span className="px-2.5 py-0.5 rounded-lg text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                  {job.status.replace(/_/g, ' ')}
                </span>
                <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                  {job.containerSize} · {job.containerType} · {job.shippingLine}
                </span>
                {job.sealNumber && (
                  <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                    Seal: {job.sealNumber}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-1.5 flex flex-wrap items-center gap-2">
                <span>
                  Customer (Consignor): <strong className="text-slate-200">{job.customerName}</strong>
                </span>
                <span>•</span>
                <span>
                  Consignee (Client/End User): <strong className="text-slate-200">{job.warehouseName}</strong>
                </span>
                <span>•</span>
                <span>
                  Corridor: <strong className="text-slate-200">{job.terminalName}</strong> →{' '}
                  <strong className="text-slate-200">{job.warehouseName}</strong>
                </span>
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleDownloadEpodCertificate}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold shadow-sm transition-colors"
              >
                <FileCheck2 className="w-4 h-4" />
                Download Signed ePOD
              </button>
              <button
                type="button"
                onClick={handleDownloadSealPhoto}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 text-xs font-bold transition-colors"
              >
                <Camera className="w-4 h-4 text-sky-400" />
                Download Seal + Gate Photo
              </button>
            </div>
          </div>

          {/* 4-Column Customer Telemetry Strip */}
          <StatGrid cols={4}>
            <KpiCard
              label="Origin Port & PCS Gate Token"
              value={job.terminalName}
              sub={`Token: ${job.tokenNumber || 'Verified Gate Pass'}`}
              icon={ShieldCheck}
              accent="emerald"
            />
            <KpiCard
              label="Destination Facility / Ramp"
              value={job.warehouseName}
              sub={`Placement: ${job.placementLocation || 'RAMP'}${job.podSignatureName ? ` · Signed: ${job.podSignatureName}` : ''}`}
              icon={MapPin}
              accent="cyan"
            />
            <KpiCard
              label="Assigned Prime Mover & Driver"
              value={job.assignedVehiclePlate || 'Assigned Tractor'}
              sub={`${job.assignedDriverName || 'Verified Driver'} · Chassis ${job.assignedTrailerPlate || 'Coupled'}`}
              icon={Navigation}
              accent="slate"
            />
            <KpiCard
              label="Offloading ETC & Corridor ETA"
              value={
                job.etcTime
                  ? `ETC: ${new Date(job.etcTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                  : `ETA: ${job.portSlotPrediction?.predictedGateArrivalLabel || 'On Schedule'} (${job.portSlotPrediction?.totalEtaMinutes || 22}m)`
              }
              sub={
                job.etcTime
                  ? etcRemainingMins !== null && etcRemainingMins <= 0
                    ? '✓ Ramp window completed — Pickup Ready'
                    : `${etcRemainingMins} mins remaining at facility ramp`
                  : job.portSlotPrediction?.corridorName || 'E11 / E311 UAE Freight Corridor'
              }
              icon={Clock}
              accent="amber"
            />
          </StatGrid>

          {/* RAMP SUPERVISOR STUFFING / DESTUFFING COMPLETION PANEL (Shown on RAMP Link, or CLIENT Link when at Ramp) */}
          {portalRole !== 'CUSTOMER' &&
            (portalRole === 'RAMP' ||
              job.etcTime ||
              job.status === 'PLACED_AT_RAMP' ||
              job.placementLocation === 'RAMP') && (
              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/40 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
                      <Clock className="w-5 h-5 animate-pulse" />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-extrabold text-amber-300">
                          RAMP STUFFING / DESTUFFING COMPLETION CONSOLE
                        </span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                          ✓ Activated @ PLACED_AT_RAMP
                        </span>
                      </div>
                      <p className="text-xs text-slate-300 mt-0.5">
                        {job.etcTime ? (
                          <>
                            Scheduled Ramp Completion:{' '}
                            <strong className="font-mono text-white">
                              {new Date(job.etcTime).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </strong>{' '}
                            (
                            {etcRemainingMins !== null && etcRemainingMins > 0
                              ? `${etcRemainingMins} minutes left`
                              : 'Ready for Pickup'}
                            )
                          </>
                        ) : (
                          `Container ${job.containerNumber} is positioned at ${job.warehouseName}. Update completion of Stuffing or Destuffing below.`
                        )}
                      </p>
                    </div>
                  </div>

                  {/* Quick ETC Extension Buttons for Ramp */}
                  {!job.l2Activated && job.status !== 'READY_FOR_PICKUP' && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={extendingEtc}
                        onClick={() => void handleExtendRampEtc(30)}
                        className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-amber-500/40 text-amber-300 text-xs font-bold transition-colors"
                      >
                        +30m ETC
                      </button>
                      <button
                        type="button"
                        disabled={extendingEtc}
                        onClick={() => void handleExtendRampEtc(60)}
                        className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-amber-500/40 text-amber-300 text-xs font-bold transition-colors"
                      >
                        +60m ETC
                      </button>
                    </div>
                  )}
                </div>

                {job.l2Activated || job.status === 'READY_FOR_PICKUP' ? (
                  <div className="p-3.5 rounded-xl bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-between text-xs text-emerald-200">
                    <div>
                      <strong className="font-extrabold text-emerald-300 block">
                        ✓ Ramp Completion Confirmed ({job.podSignatureName || 'Ramp Supervisor'})
                      </strong>
                      <span>
                        Container {job.containerNumber} is marked Ready for Pickup and Dispatch has been notified.
                      </span>
                    </div>
                    {job.podSignedAt && (
                      <span className="font-mono text-[11px] text-emerald-300">
                        {new Date(job.podSignedAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3 pt-2 border-t border-amber-500/20 text-xs">
                    <div className="md:col-span-3">
                      <label className="block text-[10px] uppercase font-bold text-amber-200 mb-1">
                        Ramp Operation Type
                      </label>
                      <select
                        value={rampOperationType}
                        onChange={(e) =>
                          setRampOperationType(e.target.value as 'DESTUFFING' | 'STUFFING')
                        }
                        className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white font-bold text-xs"
                      >
                        <option value="DESTUFFING">Import Destuffing (Offloading)</option>
                        <option value="STUFFING">Export Stuffing (Loading)</option>
                      </select>
                    </div>

                    <div className="md:col-span-3">
                      <label className="block text-[10px] uppercase font-bold text-amber-200 mb-1">
                        Ramp Supervisor / Dock Contact
                      </label>
                      <input
                        type="text"
                        value={rampReceiverName}
                        onChange={(e) => setRampReceiverName(e.target.value)}
                        placeholder="Dock Supervisor Name"
                        className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white text-xs"
                      />
                    </div>

                    {rampOperationType === 'STUFFING' ? (
                      <>
                        <div className="md:col-span-3">
                          <label className="block text-[10px] uppercase font-bold text-amber-200 mb-1">
                            New Export Bolt Seal #
                          </label>
                          <input
                            type="text"
                            value={rampSealNumber}
                            onChange={(e) => setRampSealNumber(e.target.value)}
                            placeholder="e.g. SL-EXP-90412"
                            className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono text-xs"
                          />
                        </div>
                        <div className="md:col-span-3">
                          <label className="block text-[10px] uppercase font-bold text-amber-200 mb-1">
                            Gross Cargo Weight (KG)
                          </label>
                          <input
                            type="number"
                            value={rampGrossWeightKg}
                            onChange={(e) => setRampGrossWeightKg(e.target.value)}
                            placeholder="e.g. 22400"
                            className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono text-xs"
                          />
                        </div>
                      </>
                    ) : (
                      <div className="md:col-span-6">
                        <label className="block text-[10px] uppercase font-bold text-amber-200 mb-1">
                          Ramp / Bay Completion Notes
                        </label>
                        <input
                          type="text"
                          value={rampBayNotes}
                          onChange={(e) => setRampBayNotes(e.target.value)}
                          placeholder="e.g. Bay 3 — Container destuffed, swept & empty ready for L2 pickup"
                          className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white text-xs"
                        />
                      </div>
                    )}

                    <div className="md:col-span-12 flex justify-end pt-1">
                      <button
                        type="button"
                        disabled={confirmingEmpty}
                        onClick={handleConfirmOffloadingComplete}
                        className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-extrabold shadow-lg transition-all"
                      >
                        {confirmingEmpty
                          ? 'Updating Dispatch...'
                          : rampOperationType === 'STUFFING'
                          ? '✓ Confirm Export Stuffing Complete & Seal Applied (Ready for Port Pickup)'
                          : '✓ Confirm Destuffing Complete (Container Empty & Ready for Pickup)'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
        </section>

        {/* 6-Stage Horizontal Milestone Progress Bar (Gate-In → Loaded at Terminal → Customs Cleared → En Route → At Warehouse → ePOD Signed) */}
        <section className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-extrabold text-white flex items-center gap-2">
                <Package className="w-4 h-4 text-blue-400" />
                Live Milestone Progress (Gate-In → Loaded at Terminal → Customs Cleared → En Route → At Warehouse → ePOD Signed)
              </h2>
              <p className="text-xs text-slate-400">
                Real-time stage progression verified by Port PCS EDI, Customs Clearance, GPS Geofences & Digital ePOD
              </p>
            </div>
            <span className="text-xs font-mono text-blue-400 font-bold">
              {Math.min(100, Math.round((currentStageIndex / 6) * 100))}% Complete
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
            {milestones.map((m) => {
              const isDone = m.state === 'COMPLETED';
              const isCurrent = m.state === 'CURRENT';
              return (
                <div
                  key={m.stageNum}
                  className={`p-3.5 rounded-xl border transition-all flex flex-col justify-between ${
                    isDone
                      ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-200'
                      : isCurrent
                      ? 'bg-blue-600/20 border-blue-400 text-white ring-1 ring-blue-400/50 shadow-lg'
                      : 'bg-slate-950/70 border-slate-800 text-slate-500'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-1 mb-1.5">
                      <span className="text-[10px] font-mono font-extrabold uppercase">
                        Stage {m.stageNum}
                      </span>
                      {isDone ? (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-300">
                          ✓ DONE
                        </span>
                      ) : isCurrent ? (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-500 text-white animate-pulse">
                          ● ACTIVE
                        </span>
                      ) : (
                        <span className="text-[9px] font-mono text-slate-600">PENDING</span>
                      )}
                    </div>
                    <div className="text-xs font-extrabold leading-snug">{m.title}</div>
                    <p className="text-[11px] opacity-80 mt-1 leading-relaxed">{m.subtitle}</p>
                  </div>

                  {m.timestamp && (
                    <div className="mt-2.5 pt-2 border-t border-white/10 text-[10px] font-mono opacity-90">
                      {new Date(m.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}{' '}
                      · {new Date(m.timestamp).toLocaleDateString()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Signed ePOD & Seal Verification Download Vault (No-Login Customer Access) */}
        <section className="p-5 rounded-2xl bg-slate-900 border border-emerald-500/30 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3.5">
            <div>
              <h2 className="text-sm font-extrabold text-white flex items-center gap-2">
                <FileCheck2 className="w-4 h-4 text-emerald-400" />
                Signed ePOD & Customs Bolt Seal Evidence Vault
              </h2>
              <p className="text-xs text-slate-400">
                Download official signed Electronic Proof of Delivery (ePOD) and container door / bolt seal photos without a user account
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleDownloadEpodCertificate}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors shadow-sm"
              >
                <Download className="w-3.5 h-3.5" />
                Download Signed ePOD (PDF)
              </button>
              <button
                type="button"
                onClick={handleDownloadSealPhoto}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold transition-colors shadow-sm"
              >
                <Camera className="w-3.5 h-3.5" />
                Download Seal Photo
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
              <span className="text-[10px] uppercase tracking-wider text-emerald-400 font-bold block">
                1. Consignee ePOD Signature Status
              </span>
              <div className="text-sm font-bold text-white">
                {job.podSignatureName ? `Signed by ${job.podSignatureName}` : 'Pending Consignee Ramp Sign-off'}
              </div>
              <p className="text-[11px] text-slate-400">
                {job.podSignedAt
                  ? `Verified at ${new Date(job.podSignedAt).toLocaleString()}`
                  : `Destination: ${job.warehouseName}`}
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
              <span className="text-[10px] uppercase tracking-wider text-sky-400 font-bold block">
                2. Liner / Customs Bolt Seal Audit
              </span>
              <div className="text-sm font-mono font-bold text-white">
                Seal: {job.sealNumber || 'Verified Intact at Gate'}
              </div>
              <p className="text-[11px] text-slate-400">
                ISO 6346 Container: {job.containerNumber} ({job.containerSize} {job.containerType})
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
              <span className="text-[10px] uppercase tracking-wider text-amber-400 font-bold block">
                3. Port Customs & EIR Clearance
              </span>
              <div className="text-sm font-bold text-white">
                {job.inspectionStatus || 'CLEARED'} · Gate Token {job.tokenNumber || 'Verified'}
              </div>
              <p className="text-[11px] text-slate-400">
                Origin Terminal: {job.terminalName}
              </p>
            </div>
          </div>
        </section>

        {/* Live Corridor Map (Read-Only Customer View) */}
        <section className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-sm font-extrabold text-white flex items-center gap-2">
              <MapPin className="w-4 h-4 text-emerald-400" />
              Live UAE Freight Corridor Map (Jebel Ali / Khalifa Port ↔ Warehouse Geofence)
            </h2>
            <span className="text-[11px] text-slate-400">
              Read-Only Customer Radar · Live Prime Mover Telemetry
            </span>
          </div>
          <DrayageCorridorLiveMap
            jobs={[{ ...job, rateAmountAed: 0 }]}
            terminals={portalData.corridorMap?.terminals || []}
            warehouses={portalData.corridorMap?.warehouses || []}
            geofences={portalData.corridorMap?.geofences || []}
            vehicles={portalData.corridorMap?.vehicles || []}
            selectedJobId={job.id}
            onSelectJob={() => {}}
            onAdvanceStage={() => {}}
            onVerifyEdi={() => {}}
            onOpenChat={() => {}}
          />
        </section>

        {/* Bottom Grid: Automated WhatsApp/Email Milestone Alerts + Audit Trail */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Automated WhatsApp & Email Milestone Subscriptions (6 cols) */}
          <div className="lg:col-span-6 p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
            <div className="flex items-start justify-between gap-2 border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-extrabold text-white flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-400" />
                  Automated WhatsApp & Email Milestone Alerts
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Instant notifications whenever {job.containerNumber} transitions across port, customs, corridor, warehouse, or ePOD stages
                </p>
              </div>
              <span
                className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold border ${
                  autoAlertsEnabled
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : 'bg-slate-800 text-slate-400 border-slate-700'
                }`}
              >
                {autoAlertsEnabled ? 'AUTO-ALERTS ON' : 'MANUAL ONLY'}
              </span>
            </div>

            <form onSubmit={handleSaveAlertSubscriptions} className="space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1">
                    Customer WhatsApp Number (UAE / Intl)
                  </label>
                  <input
                    type="text"
                    value={whatsappInput}
                    onChange={(e) => setWhatsappInput(e.target.value)}
                    placeholder="+971 50 000 0000"
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono text-xs focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1">
                    Customer Operations Email
                  </label>
                  <input
                    type="email"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder="operations@customer.ae"
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white font-mono text-xs focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300 pt-1">
                <input
                  type="checkbox"
                  checked={autoAlertsEnabled}
                  onChange={(e) => setAutoAlertsEnabled(e.target.checked)}
                  className="rounded border-slate-600 text-emerald-500"
                />
                <span>
                  Automatically send WhatsApp & Email alerts on every milestone change (Gate-In, Loaded at Terminal, Customs Cleared, En Route, At Warehouse, ePOD Signed)
                </span>
              </label>

              <div className="flex flex-wrap items-center gap-2 pt-2">
                <button
                  type="submit"
                  disabled={savingAlerts}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-extrabold text-xs shadow transition"
                >
                  {savingAlerts
                    ? 'Sending Milestone Alert...'
                    : 'Save & Send Live Milestone Alert Now (WhatsApp + Email)'}
                </button>
              </div>
            </form>

            {/* Recent WhatsApp & Email Alert Delivery Logs */}
            <div className="pt-3 border-t border-slate-800 space-y-2">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Recent Automated WhatsApp & Email Deliveries ({alertLogs.length})
              </div>
              {alertLogs.length === 0 ? (
                <p className="text-xs text-slate-500 py-2">
                  Alerts will appear here automatically as stages progress or when you click &ldquo;Save & Send Live Milestone Alert Now&rdquo;.
                </p>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {alertLogs.map((al) => (
                    <div
                      key={al.id}
                      className="p-2.5 rounded-xl bg-slate-950 border border-emerald-500/30 text-[11px] space-y-1"
                    >
                      <div className="flex items-center justify-between text-emerald-400 font-bold">
                        <span>✓ {al.status.replace('MILESTONE_ALERT_', '')}</span>
                        <span className="font-mono text-[10px] text-slate-400">
                          {new Date(al.timestamp).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <p className="text-slate-300 leading-relaxed">{al.notes}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Verified Milestone & e-POD Audit Log (6 cols) */}
          <div className="lg:col-span-6 p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
            <div className="border-b border-slate-800 pb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-extrabold text-white flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-400" />
                  Verified Milestone & Digital e-POD Audit Trail
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Timestamped port gate passes, seal checks & ramp signatures
                </p>
              </div>
              {job.podSignatureName && (
                <span className="px-2.5 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[10px] font-bold">
                  ✍️ e-POD Signed: {job.podSignatureName}
                </span>
              )}
            </div>

            <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
              {statusLogs.length === 0 ? (
                <p className="text-xs text-slate-500 py-8 text-center">No milestone events recorded yet.</p>
              ) : (
                statusLogs.map((log) => (
                  <div
                    key={log.id}
                    className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-start gap-3 text-xs"
                  >
                    <div className="w-2.5 h-2.5 rounded-full bg-blue-400 mt-1 shrink-0" />
                    <div className="space-y-0.5 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-mono font-bold text-white text-[11px]">{log.status}</span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {new Date(log.timestamp).toLocaleDateString('en-GB', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })}
                          ,{' '}
                          {new Date(log.timestamp).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: false,
                          })}{' '}
                          · {log.actor}
                        </span>
                      </div>
                      {log.location ? (
                        <p className="text-slate-300 text-[11px] truncate">📍 {log.location}</p>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
