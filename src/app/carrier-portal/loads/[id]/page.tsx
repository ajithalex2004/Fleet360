'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AlertTriangle, ArrowLeft, Camera, CheckCircle2, Clock, FileText, MapPin, Navigation, PenLine, RefreshCw, Truck } from 'lucide-react';

interface StopRow {
  id: string;
  sequenceNo: number;
  stopType: string;
  locationName: string | null;
  address: string | null;
  contactName: string | null;
  contactPhone: string | null;
  plannedArrivalAt: string | null;
  actualArrivalAt: string | null;
  status: string;
  instructions: string | null;
}

interface CargoLine {
  id: string;
  description: string;
  quantity: number | null;
  packageType: string | null;
  weightKg: number | null;
  isHazmat: boolean;
}

interface DocumentRow {
  id: string;
  docType: string;
  docName: string;
  fileUrl: string | null;
  mimeType: string | null;
}

interface TimelineEvent {
  id: string;
  type: string;
  status: string | null;
  occurredAt: string | null;
  notes: string | null;
  source: string;
}

interface PodRow {
  id: string;
  deliveredAt: string | null;
  recipientName: string | null;
  status: string;
}

interface LoadDetail {
  shipment: {
    id: string;
    shipmentNo: string | null;
    status: string;
    cargoOwnerName: string | null;
    originName: string | null;
    originAddress: string | null;
    destinationName: string | null;
    destinationAddress: string | null;
    pickupWindowFrom: string | null;
    deliveryWindowTo: string | null;
    requestedVehicleType: string | null;
    totalWeightKg: number | null;
    carrierCostAmount: number | null;
    currency: string | null;
  };
  stops: StopRow[];
  cargoLines: CargoLine[];
  documents: DocumentRow[];
  timeline: { events: TimelineEvent[]; pods: PodRow[]; finance?: { carrierPayables?: Array<{ totalAmount: number; currency: string; status: string; settlementId: string | null }> } };
  settlement: {
    carrierPayable: number;
    settlementNo: string | null;
    settlementStatus: string | null;
    settlementNetAmount: number | null;
    settlementGrossAmount: number | null;
    deductionsAmount: number | null;
    commissionAmount: number | null;
    paymentId: string | null;
    currency: string | null;
    payableStatus: string;
    charges: Array<{ id: string; type: string; description: string | null; totalAmount: number; currency: string; status: string; settlementId: string | null }>;
    postings: Array<{ id: string; type: string; financeInvoiceId: string | null; financeJournalEntryId: string | null; amount: number; currency: string; status: string; createdAt: string | null }>;
    payouts: Array<{ id: string; payoutNo: string; netPayableAmount: number; currency: string; status: string; paymentId: string | null }>;
  } | null;
}

const ACTIONS = [
  { eventType: 'PICKUP_CONFIRMED', label: 'Pickup confirmed', icon: Truck },
  { eventType: 'ETA_UPDATED', label: 'Update ETA', icon: Clock },
  { eventType: 'PHOTO_ATTACHED', label: 'Attach photo', icon: Camera },
  { eventType: 'EXCEPTION_REPORTED', label: 'Report exception', icon: AlertTriangle },
  { eventType: 'DELIVERY_CONFIRMED', label: 'Delivered / POD', icon: CheckCircle2 },
] as const;

function dt(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString('en-AE') : '-';
}

export default function CarrierLoadDetailPage() {
  const { id } = useParams<{ id: string }>() ?? {};
  const docFileRef = useRef<HTMLInputElement>(null);
  const podPhotoRef = useRef<HTMLInputElement>(null);
  const [token, setToken] = useState('');
  const [detail, setDetail] = useState<LoadDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [eventType, setEventType] = useState<(typeof ACTIONS)[number]['eventType']>('PICKUP_CONFIRMED');
  const [form, setForm] = useState({
    remarks: '',
    etaAt: '',
    latitude: '',
    longitude: '',
    recipientName: '',
    signatureUrl: '',
    photoUrls: '',
    documentUrls: '',
    exceptionSeverity: 'MEDIUM',
  });
  const [docForm, setDocForm] = useState({ docType: 'DELIVERY_ORDER', docName: '', fileUrl: '', notes: '' });
  const [docFile, setDocFile] = useState<{ data: string; name: string; size: number; type: string } | null>(null);
  const [docSaving, setDocSaving] = useState(false);
  const [podForm, setPodForm] = useState({
    recipientName: '',
    submittedBy: '',
    deliveryNote: '',
    signature: '',
    photos: [] as string[],
    documents: '',
  });
  const [podSaving, setPodSaving] = useState(false);
  const [signatureCleared, setSignatureCleared] = useState(0);

  useEffect(() => {
    const saved = window.localStorage.getItem('fleet360-carrier-token') ?? '';
    setToken(saved);
  }, []);

  const load = useCallback(async (nextToken = token) => {
    if (!nextToken) return;
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/carrier-portal/app/loads/${id}`, {
        headers: { 'x-carrier-app-token': nextToken },
        cache: 'no-store',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Failed to load carrier load');
      setDetail(body);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Failed to load carrier load');
    } finally {
      setLoading(false);
    }
  }, [id, token]);

  useEffect(() => {
    const saved = window.localStorage.getItem('fleet360-carrier-token') ?? '';
    if (saved) void load(saved);
  }, [load]);

  const selectedAction = useMemo(() => ACTIONS.find(action => action.eventType === eventType) ?? ACTIONS[0], [eventType]);

  const captureGps = () => {
    if (!navigator.geolocation) {
      setMessage('GPS is not available on this device.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => setForm(prev => ({ ...prev, latitude: String(pos.coords.latitude), longitude: String(pos.coords.longitude) })),
      () => setMessage('GPS permission denied or unavailable.'),
    );
  };

  const submitUpdate = async () => {
    setMessage(null);
    window.localStorage.setItem('fleet360-carrier-token', token);
    try {
      const res = await fetch(`/api/carrier-portal/app/loads/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-carrier-app-token': token },
        body: JSON.stringify({
          eventType,
          remarks: form.remarks || null,
          etaAt: form.etaAt ? new Date(form.etaAt).toISOString() : null,
          latitude: form.latitude || null,
          longitude: form.longitude || null,
          recipientName: form.recipientName || null,
          signatureUrl: form.signatureUrl || null,
          photoUrls: splitLines(form.photoUrls),
          documentUrls: splitLines(form.documentUrls),
          exceptionSeverity: form.exceptionSeverity || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Failed to submit update');
      setMessage('Update submitted.');
      setForm(prev => ({ ...prev, remarks: '', etaAt: '', recipientName: '', signatureUrl: '', photoUrls: '', documentUrls: '' }));
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Failed to submit update');
    }
  };

  const selectDocumentFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      setDocFile({ data: String(e.target?.result ?? ''), name: file.name, size: file.size, type: file.type });
      setDocForm(prev => ({ ...prev, docName: prev.docName || file.name }));
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  };

  const attachDocument = async () => {
    setMessage(null);
    setDocSaving(true);
    window.localStorage.setItem('fleet360-carrier-token', token);
    try {
      const res = await fetch(`/api/carrier-portal/app/loads/${id}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-carrier-app-token': token },
        body: JSON.stringify({
          docType: docForm.docType,
          docName: docForm.docName || docFile?.name,
          fileUrl: docForm.fileUrl || null,
          fileData: docFile?.data ?? null,
          mimeType: docFile?.type ?? null,
          fileSize: docFile?.size ?? null,
          notes: docForm.notes || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Failed to attach document');
      setMessage('Document attached.');
      setDocForm({ docType: 'DELIVERY_ORDER', docName: '', fileUrl: '', notes: '' });
      setDocFile(null);
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Failed to attach document');
    } finally {
      setDocSaving(false);
    }
  };

  const selectPodPhotos = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = e => setPodForm(prev => ({
        ...prev,
        photos: [...prev.photos, String(e.target?.result ?? '')].filter(Boolean),
      }));
      reader.readAsDataURL(file);
    });
    event.target.value = '';
  };

  const submitCarrierPod = async () => {
    setMessage(null);
    setPodSaving(true);
    window.localStorage.setItem('fleet360-carrier-token', token);
    try {
      const res = await fetch(`/api/carrier-portal/app/loads/${id}/pod`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-carrier-app-token': token },
        body: JSON.stringify({
          recipientName: podForm.recipientName,
          recipientSignature: podForm.signature,
          photos: podForm.photos,
          documents: splitLines(podForm.documents),
          gpsLat: form.latitude || null,
          gpsLng: form.longitude || null,
          deliveryNote: podForm.deliveryNote,
          submittedBy: podForm.submittedBy || 'Carrier driver',
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Failed to submit ePOD');
      setMessage('ePOD submitted.');
      setPodForm({ recipientName: '', submittedBy: '', deliveryNote: '', signature: '', photos: [], documents: '' });
      setSignatureCleared(value => value + 1);
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Failed to submit ePOD');
    } finally {
      setPodSaving(false);
    }
  };

  const shipment = detail?.shipment;

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-white">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link href="/carrier-portal/loads" className="mb-2 inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white"><ArrowLeft className="h-3.5 w-3.5" /> Back to carrier loads</Link>
            <p className="font-mono text-xs text-emerald-300">{shipment?.shipmentNo ?? id?.slice(0, 8) ?? '—'}</p>
            <h1 className="mt-1 text-2xl font-bold">{shipment?.originName ?? shipment?.originAddress ?? '-'} to {shipment?.destinationName ?? shipment?.destinationAddress ?? '-'}</h1>
            <p className="mt-1 text-sm text-slate-400">{shipment?.cargoOwnerName ?? 'Customer'} · pickup {dt(shipment?.pickupWindowFrom)} · delivery {dt(shipment?.deliveryWindowTo)}</p>
          </div>
          <div className="text-right">
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/15 px-3 py-1 text-sm text-emerald-200">{shipment?.status ?? 'LOAD'}</span>
            <p className="mt-2 text-sm text-slate-300">{shipment?.currency ?? 'AED'} {(shipment?.carrierCostAmount ?? 0).toLocaleString('en-AE')}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <input value={token} onChange={e => setToken(e.target.value)} placeholder="Carrier app device token" className="min-w-[260px] flex-1 rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/40" />
          <button type="button" onClick={() => void load()} disabled={loading || !token} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"><RefreshCw className="h-4 w-4" /> {loading ? 'Loading...' : 'Refresh'}</button>
        </div>

        {message && <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-200">{message}</div>}

        {!detail && !loading ? (
          <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-slate-500">Enter a valid carrier token to load this shipment.</div>
        ) : detail && (
          <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
            <section className="space-y-4">
              <Panel title="Stops">
                <div className="space-y-3">
                  {detail.stops.length === 0 && <p className="text-sm text-slate-500">No detailed stops published yet.</p>}
                  {detail.stops.map(stop => (
                    <div key={stop.id} className="rounded-xl border border-white/10 bg-slate-900/70 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs uppercase tracking-wide text-slate-500">Stop {stop.sequenceNo} · {stop.stopType}</p>
                          <h3 className="mt-1 font-semibold">{stop.locationName ?? stop.address ?? 'Stop'}</h3>
                          <p className="mt-1 text-sm text-slate-400">{stop.address ?? '-'}</p>
                        </div>
                        <span className="rounded-full border border-white/10 px-2 py-0.5 text-xs text-slate-300">{stop.status}</span>
                      </div>
                      {(stop.contactName || stop.contactPhone || stop.instructions) && (
                        <p className="mt-2 text-xs text-slate-500">{[stop.contactName, stop.contactPhone, stop.instructions].filter(Boolean).join(' · ')}</p>
                      )}
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel title="Cargo">
                <div className="grid gap-2">
                  {detail.cargoLines.length === 0 && <p className="text-sm text-slate-500">No cargo lines published yet.</p>}
                  {detail.cargoLines.map(line => (
                    <div key={line.id} className="rounded-xl border border-white/10 bg-slate-900/70 p-3 text-sm">
                      <span className="text-white">{line.description}</span>
                      <span className="ml-2 text-slate-500">{line.quantity ?? 1} {line.packageType ?? 'unit'} · {line.weightKg ?? 0} kg</span>
                      {line.isHazmat && <span className="ml-2 rounded-full border border-amber-500/30 px-2 py-0.5 text-xs text-amber-200">HAZMAT</span>}
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel title="Documents">
                <div className="grid gap-2">
                  {detail.documents.length === 0 && <p className="text-sm text-slate-500">No shipment documents shared yet.</p>}
                  {detail.documents.map(doc => (
                    <a key={doc.id} href={doc.fileUrl ?? '#'} target="_blank" rel="noreferrer" className="rounded-xl border border-white/10 bg-slate-900/70 p-3 text-sm hover:bg-white/5">
                      <span className="text-white">{doc.docName}</span>
                      <span className="ml-2 text-slate-500">{doc.docType}</span>
                    </a>
                  ))}
                </div>
              </Panel>
            </section>

            <aside className="space-y-4">
              <Panel title="Execution Update">
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    {ACTIONS.map(action => {
                      const Icon = action.icon;
                      return (
                        <button key={action.eventType} type="button" onClick={() => setEventType(action.eventType)} className={`rounded-xl border p-3 text-left text-sm ${eventType === action.eventType ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border-white/10 bg-slate-900/70 text-slate-300 hover:bg-white/5'}`}>
                          <Icon className="mb-2 h-4 w-4" /> {action.label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="rounded-xl border border-white/10 bg-slate-900/70 p-3">
                    <p className="mb-2 text-sm font-semibold text-white">{selectedAction.label}</p>
                    {eventType === 'ETA_UPDATED' && <Input label="ETA" type="datetime-local" value={form.etaAt} onChange={v => setForm(f => ({ ...f, etaAt: v }))} />}
                    {eventType === 'DELIVERY_CONFIRMED' && (
                      <>
                        <Input label="Recipient name" value={form.recipientName} onChange={v => setForm(f => ({ ...f, recipientName: v }))} />
                        <Input label="Signature URL or data URL" value={form.signatureUrl} onChange={v => setForm(f => ({ ...f, signatureUrl: v }))} />
                      </>
                    )}
                    {eventType === 'EXCEPTION_REPORTED' && (
                      <label className="mb-3 block">
                        <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Severity</span>
                        <select value={form.exceptionSeverity} onChange={e => setForm(f => ({ ...f, exceptionSeverity: e.target.value }))} className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white">
                          <option value="LOW">Low</option>
                          <option value="MEDIUM">Medium</option>
                          <option value="HIGH">High</option>
                          <option value="CRITICAL">Critical</option>
                        </select>
                      </label>
                    )}
                    {(eventType === 'PHOTO_ATTACHED' || eventType === 'DELIVERY_CONFIRMED') && <TextArea label="Photo URLs, one per line" value={form.photoUrls} onChange={v => setForm(f => ({ ...f, photoUrls: v }))} />}
                    <TextArea label="Remarks" value={form.remarks} onChange={v => setForm(f => ({ ...f, remarks: v }))} />
                    <div className="mt-3 grid grid-cols-[1fr_1fr_auto] gap-2">
                      <input value={form.latitude} onChange={e => setForm(f => ({ ...f, latitude: e.target.value }))} placeholder="Latitude" className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" />
                      <input value={form.longitude} onChange={e => setForm(f => ({ ...f, longitude: e.target.value }))} placeholder="Longitude" className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white" />
                      <button type="button" onClick={captureGps} className="rounded-lg border border-white/10 px-3 py-2 text-slate-300 hover:bg-white/5"><MapPin className="h-4 w-4" /></button>
                    </div>
                    <button type="button" onClick={() => void submitUpdate()} disabled={!token} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">
                      <Navigation className="h-4 w-4" /> Submit update
                    </button>
                  </div>
                </div>
              </Panel>

              <Panel title="Document Handoff">
                <div className="space-y-3">
                  <label className="block">
                    <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">Document type</span>
                    <select value={docForm.docType} onChange={e => setDocForm(prev => ({ ...prev, docType: e.target.value }))} className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white">
                      <option value="DELIVERY_ORDER">Delivery Order</option>
                      <option value="BILL_OF_LADING">Bill of Lading</option>
                      <option value="POD_PHOTO">POD Photo</option>
                      <option value="WEIGHBRIDGE">Weighbridge</option>
                      <option value="OTHER">Other</option>
                    </select>
                  </label>
                  <Input label="Document name" value={docForm.docName} onChange={v => setDocForm(prev => ({ ...prev, docName: v }))} />
                  <Input label="File URL" value={docForm.fileUrl} onChange={v => setDocForm(prev => ({ ...prev, fileUrl: v }))} />
                  <button type="button" onClick={() => docFileRef.current?.click()} className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 px-3 py-3 text-sm text-slate-300 hover:bg-white/5">
                    <FileText className="h-4 w-4" /> {docFile ? docFile.name : 'Choose inline file'}
                  </button>
                  <input ref={docFileRef} type="file" className="hidden" onChange={selectDocumentFile} />
                  <TextArea label="Notes" value={docForm.notes} onChange={v => setDocForm(prev => ({ ...prev, notes: v }))} />
                  <button type="button" onClick={() => void attachDocument()} disabled={!token || docSaving || (!docForm.fileUrl && !docFile)} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50">
                    {docSaving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} Attach document
                  </button>
                </div>
              </Panel>

              <Panel title="ePOD Handoff">
                <div className="space-y-3">
                  <Input label="Recipient name" value={podForm.recipientName} onChange={v => setPodForm(prev => ({ ...prev, recipientName: v }))} />
                  <Input label="Submitted by" value={podForm.submittedBy} onChange={v => setPodForm(prev => ({ ...prev, submittedBy: v }))} />
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[11px] uppercase tracking-wide text-slate-500">Recipient signature</span>
                      <button type="button" onClick={() => { setPodForm(prev => ({ ...prev, signature: '' })); setSignatureCleared(value => value + 1); }} className="text-xs text-slate-500 hover:text-white">Clear</button>
                    </div>
                    <SignatureCanvas onSign={value => setPodForm(prev => ({ ...prev, signature: value }))} cleared={signatureCleared} />
                    {podForm.signature && <p className="mt-1 text-xs text-emerald-300">Signature captured.</p>}
                  </div>
                  <button type="button" onClick={() => podPhotoRef.current?.click()} className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 px-3 py-3 text-sm text-slate-300 hover:bg-white/5">
                    <Camera className="h-4 w-4" /> Add delivery photos ({podForm.photos.length})
                  </button>
                  <input ref={podPhotoRef} type="file" accept="image/*" multiple className="hidden" onChange={selectPodPhotos} />
                  {podForm.photos.length > 0 && (
                    <div className="grid grid-cols-4 gap-2">
                      {podForm.photos.map((photo, index) => <img key={index} src={photo} alt={`Delivery photo ${index + 1}`} className="aspect-square rounded-lg object-cover" />)}
                    </div>
                  )}
                  <TextArea label="Document URLs, one per line" value={podForm.documents} onChange={v => setPodForm(prev => ({ ...prev, documents: v }))} />
                  <TextArea label="Delivery note" value={podForm.deliveryNote} onChange={v => setPodForm(prev => ({ ...prev, deliveryNote: v }))} />
                  <button type="button" onClick={() => void submitCarrierPod()} disabled={!token || podSaving || !podForm.recipientName || !podForm.signature} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">
                    {podSaving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />} Submit ePOD
                  </button>
                </div>
              </Panel>

              <Panel title="Settlement">
                <div className="space-y-2 text-sm">
                  <Info label="Carrier payable" value={`${detail.settlement?.currency ?? shipment?.currency ?? 'AED'} ${(detail.settlement?.carrierPayable ?? shipment?.carrierCostAmount ?? 0).toLocaleString('en-AE')}`} />
                  <Info label="Payable status" value={detail.settlement?.payableStatus ?? 'NOT_PREPARED'} />
                  <Info label="Settlement" value={detail.settlement?.settlementNo ?? 'Not prepared yet'} />
                  <Info label="Status" value={detail.settlement?.settlementStatus ?? 'Pending'} />
                  <Info label="Net payable" value={`${detail.settlement?.currency ?? shipment?.currency ?? 'AED'} ${(detail.settlement?.settlementNetAmount ?? detail.settlement?.carrierPayable ?? 0).toLocaleString('en-AE')}`} />
                  <Info label="Deductions" value={`${detail.settlement?.currency ?? shipment?.currency ?? 'AED'} ${(detail.settlement?.deductionsAmount ?? 0).toLocaleString('en-AE')}`} />
                  <Info label="Payment ref" value={detail.settlement?.paymentId ?? 'Not paid'} />
                  {detail.settlement?.charges?.length ? (
                    <div className="pt-2">
                      <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Charge lines</p>
                      <div className="space-y-1">
                        {detail.settlement.charges.map(charge => (
                          <div key={charge.id} className="rounded-lg border border-white/10 bg-slate-900/70 p-2 text-xs">
                            <div className="flex justify-between gap-2">
                              <span className="text-white">{charge.description ?? charge.type}</span>
                              <span className="text-slate-300">{charge.currency} {charge.totalAmount.toLocaleString('en-AE')}</span>
                            </div>
                            <p className="mt-1 text-slate-500">{charge.status}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {detail.settlement?.postings?.length ? (
                    <div className="pt-2">
                      <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Finance postings</p>
                      <div className="space-y-1">
                        {detail.settlement.postings.map(posting => (
                          <div key={posting.id} className="rounded-lg border border-white/10 bg-slate-900/70 p-2 text-xs">
                            <div className="flex justify-between gap-2">
                              <span className="text-white">{posting.type}</span>
                              <span className="text-slate-300">{posting.currency} {posting.amount.toLocaleString('en-AE')}</span>
                            </div>
                            <p className="mt-1 text-slate-500">{posting.status} · Invoice {posting.financeInvoiceId ?? '-'} · Journal {posting.financeJournalEntryId ?? '-'}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {detail.settlement?.payouts?.length ? (
                    <div className="pt-2">
                      <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Payouts</p>
                      <div className="space-y-1">
                        {detail.settlement.payouts.map(payout => (
                          <div key={payout.id} className="rounded-lg border border-white/10 bg-slate-900/70 p-2 text-xs">
                            <div className="flex justify-between gap-2">
                              <span className="text-white">{payout.payoutNo}</span>
                              <span className="text-slate-300">{payout.currency} {payout.netPayableAmount.toLocaleString('en-AE')}</span>
                            </div>
                            <p className="mt-1 text-slate-500">{payout.status} · Payment {payout.paymentId ?? '-'}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </Panel>

              <Panel title="Timeline">
                <div className="space-y-2">
                  {detail.timeline?.events?.slice(0, 8).map(event => (
                    <div key={event.id} className="rounded-lg border border-white/10 bg-slate-900/70 p-2 text-xs">
                      <p className="font-medium text-white">{event.type}</p>
                      <p className="text-slate-500">{dt(event.occurredAt)} · {event.source}</p>
                      {event.notes && <p className="mt-1 text-slate-400">{event.notes}</p>}
                    </div>
                  ))}
                  {detail.timeline?.events?.length === 0 && <p className="text-sm text-slate-500">No execution updates yet.</p>}
                </div>
              </Panel>
            </aside>
          </div>
        )}
      </div>
    </main>
  );
}

function splitLines(value: string) {
  return value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

function SignatureCanvas({ onSign, cleared }: { onSign: (value: string) => void; cleared: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const hasSigned = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasSigned.current = false;
  }, [cleared]);

  const point = (event: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const source = 'touches' in event ? event.touches[0] : event;
    return {
      x: (source.clientX - rect.left) * (canvas.width / rect.width),
      y: (source.clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const start = (event: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    drawing.current = true;
    const p = point(event, canvas);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    event.preventDefault();
  };

  const move = (event: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!drawing.current || !canvas || !ctx) return;
    const p = point(event, canvas);
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    hasSigned.current = true;
    event.preventDefault();
  };

  const end = () => {
    drawing.current = false;
    const canvas = canvasRef.current;
    if (canvas && hasSigned.current) onSign(canvas.toDataURL('image/png'));
  };

  return (
    <canvas
      ref={canvasRef}
      width={520}
      height={160}
      className="h-36 w-full touch-none rounded-xl border border-white/10 bg-slate-950"
      onMouseDown={start}
      onMouseMove={move}
      onMouseUp={end}
      onMouseLeave={end}
      onTouchStart={start}
      onTouchMove={move}
      onTouchEnd={end}
    />
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">{title}</h2>{children}</section>;
}

function Input({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return <label className="mb-3 block"><span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">{label}</span><input type={type} value={value} onChange={e => onChange(e.target.value)} className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/40" /></label>;
}

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="mb-3 block"><span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-500">{label}</span><textarea value={value} onChange={e => onChange(e.target.value)} className="min-h-20 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/40" /></label>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs text-slate-500">{label}</p><p className="text-white">{value}</p></div>;
}
