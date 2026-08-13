'use client';
/**
 * /logistics/control-tower — the freight Control Tower.
 *
 * A live shipment-tracking board (Shipment ID · Mode · Origin · Destination ·
 * Must-arrive-by · Latest comment · SLA status) with segment views (On time /
 * At risk / Breached / Unassigned / Delivered), backed by getShipmentControlTower.
 * Clicking a row opens a slide-over drill-in with Status / Details / Comments /
 * Documents tabs — a route map, the shipment-progress timeline, and PODs.
 *
 * Modelled on the Uber-Freight-style control tower, in the app's dark theme.
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  X, MapPin, ArrowRight, Star, Clock, Package, Truck, Building2,
  AlertTriangle, FileText, MessageSquare, Activity, RefreshCw, CheckCircle2,
} from 'lucide-react';
import LogisticsDataGrid, { type DataGridColumn } from '@/components/logistics/LogisticsDataGrid';
import GoogleRouteMap from '@/components/logistics/GoogleRouteMap';
import CargoClassificationPanel, { type CargoClassificationMeta } from '@/components/logistics/CargoClassificationPanel';

type Sla = 'ON_TRACK' | 'AT_RISK' | 'BREACHED';

interface TowerRow {
  id: string;
  shipmentNo: string | null;
  customerName: string | null;
  status: string;
  shipmentType: string | null;
  priority: string | null;
  originName: string | null;
  destinationName: string | null;
  requestedVehicleType: string | null;
  carrierId: string | null;
  carrierName: string | null;
  deliveryWindowTo: string | null;
  pickupWindowFrom: string | null;
  latestEtaAt: string | null;
  openExceptions: number;
  highExceptions: number;
  slaStatus: Sla;
  latestComment: { text: string | null; at: string | null; type: string } | null;
}
interface Summary {
  totalShipments: number; activeShipments: number; breached: number; atRisk: number;
  openExceptions: number; trackedShipments: number;
}

interface DetailShipment {
  id: string; shipmentNo: string | null; status: string; shipmentType: string | null;
  priority: string | null; customerName: string | null; carrierName: string | null;
  requestedVehicleType: string | null;
  originName: string | null; originAddress: string | null;
  destinationName: string | null; destinationAddress: string | null;
  pickupWindowFrom: string | null; pickupWindowTo: string | null;
  deliveryWindowFrom: string | null; deliveryWindowTo: string | null;
  totalWeightKg: number | null; totalVolumeCbm: number | null;
  customerRateAmount: number | null; currency: string | null; notes: string | null;
  // Shipper-declared cargo classification. Null on legacy orders.
  metadata: CargoClassificationMeta | null;
}
interface DetailStop {
  id: string; sequenceNo: number; stopType: string; locationName: string | null; address: string | null;
  contactName: string | null; contactPhone: string | null;
  plannedArrivalAt: string | null; plannedDepartAt: string | null;
  actualArrivalAt: string | null; actualDepartAt: string | null; status: string; instructions: string | null;
}
interface DetailEvent { id: string; type: string; status: string | null; source: string | null; at: string | null; notes: string | null; }
interface DetailPod { id: string; deliveredAt: string | null; recipientName: string | null; status: string; signatureUrl: string | null; photoUrls: string[]; documentUrls: string[]; createdAt: string | null; }
interface Detail { shipment: DetailShipment; stops: DetailStop[]; events: DetailEvent[]; pods: DetailPod[]; }

const TERMINAL = new Set(['DELIVERED', 'POD_SUBMITTED', 'CLOSED', 'CANCELLED', 'REJECTED']);
const isActive = (s: TowerRow) => !TERMINAL.has((s.status ?? '').toUpperCase());

const VIEWS = [
  { key: 'ON_TIME',    label: 'Tracking on time' },
  { key: 'AT_RISK',    label: 'At risk' },
  { key: 'BREACHED',   label: 'Breached / past due' },
  { key: 'UNASSIGNED', label: 'Unassigned' },
  { key: 'DELIVERED',  label: 'Delivered' },
  { key: 'ALL',        label: 'All shipments' },
] as const;
type ViewKey = typeof VIEWS[number]['key'];

function matchView(s: TowerRow, view: ViewKey): boolean {
  switch (view) {
    case 'ON_TIME':    return isActive(s) && s.slaStatus === 'ON_TRACK';
    case 'AT_RISK':    return s.slaStatus === 'AT_RISK';
    case 'BREACHED':   return s.slaStatus === 'BREACHED';
    case 'UNASSIGNED': return isActive(s) && !s.carrierId;
    case 'DELIVERED':  return TERMINAL.has((s.status ?? '').toUpperCase());
    case 'ALL':        return true;
  }
}

const slaPill = (s: Sla): string =>
  s === 'BREACHED' ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
    : s === 'AT_RISK' ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
      : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
const slaLabel = (s: Sla): string => s === 'ON_TRACK' ? 'On time' : s === 'AT_RISK' ? 'At risk' : 'Breached';

function relTime(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h > 1 ? 's' : ''} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d > 1 ? 's' : ''} ago`;
}
function dt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('en-AE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
}

export default function ControlTowerPage() {
  const [rows, setRows] = useState<TowerRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewKey>('ON_TIME');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/logistics/control-tower?limit=500', { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (res.ok) { setRows(body.shipments ?? []); setSummary(body.summary ?? null); setLastUpdated(new Date()); }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const counts = useMemo(() => {
    const c: Record<ViewKey, number> = { ON_TIME: 0, AT_RISK: 0, BREACHED: 0, UNASSIGNED: 0, DELIVERED: 0, ALL: rows.length };
    for (const s of rows) for (const v of VIEWS) if (v.key !== 'ALL' && matchView(s, v.key)) c[v.key]++;
    return c;
  }, [rows]);

  const viewRows = useMemo(() => rows.filter(s => matchView(s, view)), [rows, view]);

  const columns = useMemo<DataGridColumn<TowerRow>[]>(() => [
    {
      key: 'shipmentNo', header: 'Shipment ID', accessor: r => r.shipmentNo ?? '', width: '150px',
      render: r => (
        <span className="inline-flex items-center gap-1.5">
          <span className="font-mono text-xs text-sky-300">{r.shipmentNo ?? r.id.slice(0, 8)}</span>
          {r.highExceptions > 0 && <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />}
        </span>
      ),
    },
    { key: 'mode', header: 'Mode', accessor: r => r.shipmentType ?? r.requestedVehicleType ?? '', filter: 'select' },
    { key: 'origin', header: 'Origin', accessor: r => r.originName ?? '' },
    { key: 'destination', header: 'Destination', accessor: r => r.destinationName ?? '' },
    {
      key: 'mustArriveBy', header: 'Must arrive by', accessor: r => r.deliveryWindowTo ?? '', filter: false,
      render: r => <span className="text-slate-400 text-xs whitespace-nowrap">{dt(r.deliveryWindowTo)}</span>,
    },
    {
      key: 'comment', header: 'Latest comment', accessor: r => r.latestComment?.text ?? '', sortable: false,
      render: r => r.latestComment?.text
        ? <span className="text-xs"><span className="text-slate-500">{relTime(r.latestComment.at)}</span> <span className="text-slate-300">{r.latestComment.text}</span></span>
        : <span className="text-slate-600 text-xs">—</span>,
    },
    {
      key: 'status', header: 'Status', accessor: r => slaLabel(r.slaStatus), filter: 'select',
      render: r => <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${slaPill(r.slaStatus)}`}>{slaLabel(r.slaStatus)}</span>,
    },
  ], []);

  const activeLabel = VIEWS.find(v => v.key === view)?.label ?? '';

  return (
    <div className={`space-y-4 transition-[padding] duration-200 ${selectedId ? 'lg:pr-[33rem]' : ''}`}>
      {/* Breadcrumb + heading */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs text-slate-500 flex items-center gap-1.5">
            <span className="text-slate-300 font-medium">Control Tower</span>
            <ArrowRight className="w-3 h-3" /> <span>{activeLabel}</span>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight mt-0.5">
            {activeLabel} <span className="text-slate-500 font-semibold">({viewRows.length})</span>
          </h1>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-slate-300 hover:bg-white/5">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
          {lastUpdated && <span>Last updated {relTime(lastUpdated.toISOString())}</span>}
        </div>
      </div>

      {/* Segment tabs */}
      <div className="flex items-center gap-1 flex-wrap border-b border-white/10 pb-px">
        {VIEWS.map(v => (
          <button key={v.key} type="button" onClick={() => setView(v.key)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              view === v.key ? 'border-emerald-400 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}>
            {v.label}
            <span className={`ml-1.5 text-xs ${v.key === 'BREACHED' && counts[v.key] > 0 ? 'text-rose-400' : 'text-slate-500'}`}>{counts[v.key]}</span>
          </button>
        ))}
      </div>

      {/* Board — sortable headers, inline filter row, smart toolbar */}
      <LogisticsDataGrid
        rows={viewRows}
        columns={columns}
        getRowId={r => r.id}
        onRowClick={r => setSelectedId(r.id)}
        selectedId={selectedId}
        loading={loading}
        emptyMessage={`No shipments in “${activeLabel}”`}
        initialSort={{ key: 'mustArriveBy', dir: 'asc' }}
        toolbar={{ exportName: 'control-tower' }}
      />

      {selectedId && <DetailDrawer id={selectedId} seed={rows.find(r => r.id === selectedId) ?? null} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

/* ── Slide-over drill-in ──────────────────────────────────────────────────── */
function DetailDrawer({ id, seed, onClose }: { id: string; seed: TowerRow | null; onClose: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'status' | 'details' | 'comments' | 'documents'>('status');

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/logistics/control-tower/${id}`, { cache: 'no-store' });
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) throw new Error(body.error || 'Failed to load shipment');
        setDetail(body.data as Detail);
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load'); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Seed the panel from the row the operator just clicked so the header, route
  // map and key fields render instantly — the fetch only fills in the timeline,
  // comments and documents. No more blank "Loading shipment…" wait.
  const seedShipment: DetailShipment | null = seed
    ? {
      id: seed.id,
      shipmentNo: seed.shipmentNo,
      status: seed.status,
      shipmentType: seed.shipmentType,
      priority: seed.priority,
      customerName: seed.customerName,
      carrierName: seed.carrierName,
      requestedVehicleType: seed.requestedVehicleType,
      originName: seed.originName,
      originAddress: null,
      destinationName: seed.destinationName,
      destinationAddress: null,
      pickupWindowFrom: seed.pickupWindowFrom,
      pickupWindowTo: null,
      deliveryWindowFrom: null,
      deliveryWindowTo: seed.deliveryWindowTo,
      totalWeightKg: null,
      totalVolumeCbm: null,
      customerRateAmount: null,
      currency: null,
      notes: null,
      // Seed row (TowerRow) doesn't carry metadata; the real value arrives
      // when the fetch fills `detail`.
      metadata: null,
    }
    : null;
  const s = detail?.shipment ?? seedShipment;

  return (
    <aside className="fixed top-0 right-0 z-[60] h-full w-full max-w-lg bg-slate-950 border-l border-white/10 shadow-2xl shadow-black/60 overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-slate-950/95 backdrop-blur border-b border-white/10 px-5 pt-4 pb-0 z-10">
          <div className="flex items-start justify-between">
            <div className="min-w-0">
              {s && <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-sky-500/15 text-sky-300 border border-sky-500/30">{(s.status ?? '').replace(/_/g, ' ')}</span>}
              <h2 className="text-lg font-bold text-white mt-1 flex items-center gap-2">
                {s?.shipmentNo ?? '…'} <Star className="w-4 h-4 text-slate-600" />
              </h2>
            </div>
            <button type="button" onClick={onClose} aria-label="Close"
              className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1.5 text-xs text-slate-300 hover:bg-white/10 hover:text-white">
              <X className="w-4 h-4" /> Close
            </button>
          </div>
          <div className="flex items-center gap-4 mt-3 text-sm">
            {(['status', 'details', 'comments', 'documents'] as const).map(t => (
              <button key={t} type="button" onClick={() => setTab(t)}
                className={`pb-2.5 border-b-2 -mb-px capitalize transition-colors ${tab === t ? 'border-emerald-400 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="p-5 space-y-5">
          {!s && loading && <div className="text-center text-slate-500 py-8 animate-pulse">Loading shipment…</div>}
          {error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-rose-200 text-sm">{error}</div>}

          {!error && s && (
            <>
              {tab === 'status' && (
                <>
                  <div className="rounded-xl overflow-hidden border border-white/10">
                    <GoogleRouteMap
                      origin={s.originAddress || s.originName}
                      destination={s.destinationAddress || s.destinationName}
                      className="h-52"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <Field icon={MapPin} label="Origin" value={s.originName ?? s.originAddress} />
                    <Field icon={MapPin} label="Destination" value={s.destinationName ?? s.destinationAddress} />
                    <Field icon={Activity} label="Status" value={(s.status ?? '').replace(/_/g, ' ')} />
                    <Field icon={Clock} label="Deliver by" value={dt(s.deliveryWindowTo)} />
                  </div>

                  <div>
                    <h3 className="text-xs uppercase tracking-wider text-slate-500 font-medium mb-2">Shipment progress</h3>
                    {!detail ? (
                      <p className="text-sm text-slate-500 animate-pulse">Loading timeline…</p>
                    ) : detail.stops.length === 0 ? (
                      <p className="text-sm text-slate-500">No stops recorded.</p>
                    ) : (
                      <ol className="space-y-3">
                        {detail.stops.map(st => {
                          const onTime = st.actualArrivalAt && st.plannedArrivalAt
                            ? new Date(st.actualArrivalAt).getTime() <= new Date(st.plannedArrivalAt).getTime()
                            : null;
                          return (
                            <li key={st.id} className="relative pl-6">
                              <span className={`absolute left-0 top-1 w-3 h-3 rounded-full border-2 ${st.actualArrivalAt ? 'bg-emerald-400 border-emerald-400' : 'bg-slate-800 border-slate-600'}`} />
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{st.stopType}</span>
                                <span className="text-sm text-white font-medium">{st.locationName ?? st.address ?? `Stop ${st.sequenceNo}`}</span>
                              </div>
                              <div className="text-xs text-slate-500 mt-0.5">Planned {dt(st.plannedArrivalAt)}{st.plannedDepartAt ? ` – ${dt(st.plannedDepartAt)}` : ''}</div>
                              {st.actualArrivalAt && (
                                <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-1.5">
                                  Arrived {dt(st.actualArrivalAt)}
                                  {onTime != null && (
                                    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] border ${onTime ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-rose-500/15 text-rose-300 border-rose-500/30'}`}>
                                      <CheckCircle2 className="w-3 h-3" /> {onTime ? 'On time' : 'Late'}
                                    </span>
                                  )}
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ol>
                    )}
                  </div>
                </>
              )}

              {tab === 'details' && (
                <div className="space-y-3">
                  {/* Cargo classification (haulage / customs / hazmat) sits above
                      the plain field grid: it's the compliance-relevant context
                      an operator needs to see first when opening Details. */}
                  <CargoClassificationPanel metadata={s.metadata} />
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <Field icon={Building2} label="Customer" value={s.customerName} />
                  <Field icon={Truck} label="Carrier" value={s.carrierName} />
                  <Field icon={Package} label="Mode" value={s.shipmentType ?? s.requestedVehicleType} />
                  <Field icon={Package} label="Weight" value={s.totalWeightKg != null ? `${s.totalWeightKg} kg` : null} />
                  <Field icon={Clock} label="Pickup" value={dt(s.pickupWindowFrom)} />
                  <Field icon={Clock} label="Deliver by" value={dt(s.deliveryWindowTo)} />
                  <Field icon={MapPin} label="Origin address" value={s.originAddress} />
                  <Field icon={MapPin} label="Destination address" value={s.destinationAddress} />
                  <Field icon={FileText} label="Customer rate" value={s.customerRateAmount != null ? `${s.currency ?? 'AED'} ${s.customerRateAmount.toLocaleString()}` : null} />
                  <Field icon={Activity} label="Priority" value={s.priority} />
                  {s.notes && <div className="col-span-2"><Field icon={FileText} label="Notes" value={s.notes} /></div>}
                  {!detail && loading && <div className="col-span-2 text-xs text-slate-500 animate-pulse">Loading full details…</div>}
                </div>
                </div>
              )}

              {tab === 'comments' && (
                <div className="space-y-3">
                  {!detail ? (
                    <p className="text-sm text-slate-500 animate-pulse">Loading comments…</p>
                  ) : detail.events.filter(e => e.notes).length === 0 ? (
                    <p className="text-sm text-slate-500">No comments yet.</p>
                  ) : detail.events.filter(e => e.notes).map(e => (
                    <div key={e.id} className="rounded-xl border border-white/10 bg-slate-900/50 px-4 py-3">
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span className="inline-flex items-center gap-1.5"><MessageSquare className="w-3.5 h-3.5" /> {e.type.replace(/_/g, ' ')}</span>
                        <span>{relTime(e.at)}</span>
                      </div>
                      <p className="text-sm text-slate-200 mt-1">{e.notes}</p>
                    </div>
                  ))}
                </div>
              )}

              {tab === 'documents' && (
                <div className="space-y-3">
                  {!detail ? (
                    <p className="text-sm text-slate-500 animate-pulse">Loading documents…</p>
                  ) : detail.pods.length === 0 ? (
                    <p className="text-sm text-slate-500">No proof-of-delivery documents yet.</p>
                  ) : detail.pods.map(p => (
                    <div key={p.id} className="rounded-xl border border-white/10 bg-slate-900/50 px-4 py-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-white font-medium">{p.status.replace(/_/g, ' ')}</span>
                        <span className="text-xs text-slate-500">{dt(p.deliveredAt ?? p.createdAt)}</span>
                      </div>
                      {p.recipientName && <div className="text-xs text-slate-400">Received by {p.recipientName}</div>}
                      <div className="flex flex-wrap gap-2">
                        {p.signatureUrl && <DocLink href={p.signatureUrl} label="Signature" />}
                        {p.photoUrls.map((u, i) => <DocLink key={`ph${i}`} href={u} label={`Photo ${i + 1}`} />)}
                        {p.documentUrls.map((u, i) => <DocLink key={`dc${i}`} href={u} label={`Document ${i + 1}`} />)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
    </aside>
  );
}

function Field({ icon: Icon, label, value }: { icon: typeof MapPin; label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 flex items-center gap-1"><Icon className="w-3 h-3" /> {label}</div>
      <div className="text-slate-200 mt-0.5 break-words">{value || '—'}</div>
    </div>
  );
}
function DocLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-slate-800/60 px-2.5 py-1 text-xs text-sky-300 hover:bg-slate-800">
      <FileText className="w-3 h-3" /> {label}
    </a>
  );
}
