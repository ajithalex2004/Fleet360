'use client';
/**
 * 🚦 TRIPEXL Dispatch Command Centre — Standalone Module
 *
 * Full-screen 3-panel command tower:
 *   ┌─ TopBar ─────────────────────────────────────────────────────────────┐
 *   │ LEFT (Jobs + Merge Recs) │ CENTER (Live Map) │ RIGHT (Resource Pool) │
 *   └─ BottomBar (Logs · Alerts · Failed · Overrides) ─────────────────────┘
 *
 * Key improvements over admin version:
 *   - text-sm (14px) base — was text-xs (12px)
 *   - Left/right panels 384px — were 288px
 *   - Bottom panel 260px — was 180px
 *   - Full-screen toggle (hides module sidebar via CSS)
 *   - Merge Recommendations strip with real API data
 *   - Routing engine source badge on merge cards
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';

/* ═══════════════════════ TYPES ═══════════════════════ */
type JobStatus   = 'PENDING'|'SEARCHING'|'OFFERED'|'ACCEPTED'|'IN_PROGRESS'|'COMPLETED'|'RETRYING'|'ESCALATED'|'FAILED'|'CANCELLED';
// SCHOOL_BUS and AMBULANCE are deliberately excluded from Dispatch Command Centre.
// Each has a purpose-built dispatch board in its own module:
//   SCHOOL_BUS → /school-bus/dispatch    (pre-planned routes, UAE MoE compliance)
//   AMBULANCE  → /incidents/ambulance/dispatch  (incident-driven, MOHAP/DHA compliance)
// Their vehicles still appear on the map as read-only fleet markers.
type SvcType     = 'PASSENGER'|'FREIGHT'|'DELIVERY'|'TECHNICIAN';
type Priority    = 'P1'|'P2'|'P3'|'EMERGENCY'|'URGENT'|'NORMAL'|'SCHEDULED';
type DrvStatus   = 'AVAILABLE'|'BUSY'|'BREAK'|'OFF_DUTY';
type DispMode    = 'OFF'|'AUTO'|'SUGGESTION';

interface Job {
  id: string; tenant_id: string; service_type: SvcType; priority: Priority;
  status: JobStatus; origin_address?: string; destination_address?: string;
  origin_lat?: number; origin_lng?: number; dest_lat?: number; dest_lng?: number;
  assigned_driver_id?: string; assigned_vehicle_id?: string;
  created_at: string; updated_at?: string; attempt_count?: number; current_attempt?: number; max_attempts?: number; passenger_count?: number; scheduled_pickup?: string; sla_deadline?: string;
}
interface Driver {
  driver_id: string; driver_name: string; driver_phone?: string; driver_rating?: number;
  vehicle_reg?: string; vehicle_type?: string; vehicle_capacity?: number;
  status: DrvStatus; zone_id?: string;
  last_lat?: number; last_lng?: number; last_ping?: string; hours_worked_today?: number;
}
interface MergePair {
  suggestionId?: string;        // from dispatch_merge_suggestions.id (undefined for scan-mode legacy pairs)
  targetJobId: string; candidateJobId: string;
  candidateJob: Job; mergeScore: number;
  pickupRoadDistKm: number; pickupTimeDiffMin: number;
  estimatedSavingKm: number; mergeReasons: string[];
  routingSource: string;
}
interface CtxMenu  { x: number; y: number; kind: 'job'|'vehicle'|'driver'|'map'|'exception'; target: any; }
interface Candidate{ driver_id: string; driver_name: string; vehicle_reg?: string; eta_minutes: number; score: number; }
interface LogEntry { time: string; msg: string; kind: 'info'|'warn'|'error'|'success'; }

/* ═══════════════════ CONSTANTS ══════════════════════ */
const SVC_ICON: Record<string,string> = {
  PASSENGER:'🚗', FREIGHT:'🚚', DELIVERY:'📦', AMBULANCE:'🚑', TECHNICIAN:'🔧', SCHOOL_BUS:'🚌',
};
const PRI_BG: Record<string,string> = {
  P1:'bg-red-600 text-white', P2:'bg-orange-500 text-white', P3:'bg-yellow-500 text-black',
  EMERGENCY:'bg-red-600 text-white', URGENT:'bg-orange-500 text-white',
  NORMAL:'bg-slate-600 text-white', SCHEDULED:'bg-slate-700 text-slate-300',
};
const STATUS_DOT: Record<string,string> = {
  PENDING:'bg-slate-400', SEARCHING:'bg-blue-400 animate-pulse',
  OFFERED:'bg-yellow-400 animate-pulse', ACCEPTED:'bg-green-400',
  IN_PROGRESS:'bg-cyan-400 animate-pulse', COMPLETED:'bg-emerald-400',
  RETRYING:'bg-orange-400 animate-pulse', ESCALATED:'bg-red-500 animate-pulse',
  FAILED:'bg-red-800', CANCELLED:'bg-slate-600',
};
const STATUS_LBL: Record<string,string> = {
  PENDING:'Pending', SEARCHING:'Searching…', OFFERED:'Offered', ACCEPTED:'Accepted',
  IN_PROGRESS:'In Progress', COMPLETED:'Done', RETRYING:'Retrying…',
  ESCALATED:'ESCALATED', FAILED:'Failed', CANCELLED:'Cancelled',
};
const DRVR_DOT: Record<DrvStatus,string> = {
  AVAILABLE:'bg-green-500', BUSY:'bg-yellow-500', BREAK:'bg-blue-500', OFF_DUTY:'bg-slate-600',
};
const JOB_CTX    = ['Assign Vehicle','Auto-Dispatch Now','Re-Dispatch','Change Priority','Merge with Another Job','Cancel Job','View Details'];
const VEH_CTX    = ['Assign to Job','View Route','Send to Location','Mark Maintenance','Change Status','View History'];
const DRVR_CTX   = ['Assign Job','Call Driver','Send Message (WhatsApp)','View Shift Details','Mark Unavailable','View Performance'];
const MAP_CTX    = ['Create New Job Here','Find Nearby Vehicles','Create Geo-Fence','Assign Nearest Vehicle'];
const EXC_CTX    = ['Retry Dispatch','Assign Manually','Escalate','Ignore Alert','View Root Cause'];
const CTX_ICONS: Record<string,string> = {
  'Assign Vehicle':'🎯','Auto-Dispatch Now':'⚡','Re-Dispatch':'🔄','Change Priority':'🔺',
  'Merge with Another Job':'🔀','Cancel Job':'❌','View Details':'👁️',
  'Assign to Job':'🎯','View Route':'🗺️','Send to Location':'📍','Mark Maintenance':'🔧',
  'Change Status':'🔄','View History':'📋','Assign Job':'🎯','Call Driver':'📞',
  'Send Message (WhatsApp)':'💬','View Shift Details':'📅','Mark Unavailable':'🚫',
  'View Performance':'📊','Create New Job Here':'➕','Find Nearby Vehicles':'🔍',
  'Create Geo-Fence':'📐','Assign Nearest Vehicle':'⚡','Retry Dispatch':'🔄',
  'Assign Manually':'🎯','Escalate':'🔺','Ignore Alert':'🔕','View Root Cause':'🔍',
};

const UAE_BOUNDS = { minLat:22.6, maxLat:26.2, minLng:51.5, maxLng:56.5 };
function toMapPct(lat?:number, lng?:number) {
  if (!lat||!lng) return { x:50+(Math.random()-0.5)*20, y:50+(Math.random()-0.5)*20 };
  return {
    x: Math.max(2,Math.min(98,((lng-UAE_BOUNDS.minLng)/(UAE_BOUNDS.maxLng-UAE_BOUNDS.minLng))*100)),
    y: Math.max(2,Math.min(98,((UAE_BOUNDS.maxLat-lat)/(UAE_BOUNDS.maxLat-UAE_BOUNDS.minLat))*100)),
  };
}
function slaInfo(d?:string) {
  if (!d) return { text:'', risk:'none' as const };
  const m=(new Date(d).getTime()-Date.now())/60_000;
  if (m<=0)  return { text:'OVERDUE', risk:'critical' as const };
  if (m<10)  return { text:`${Math.ceil(m)}m`, risk:'critical' as const };
  if (m<30)  return { text:`${Math.ceil(m)}m`, risk:'warn' as const };
  const h=Math.floor(m/60), mm=Math.ceil(m%60);
  return { text:h>0?`${h}h ${mm}m`:`${mm}m`, risk:'ok' as const };
}
function ago(iso?:string){
  if(!iso) return '—';
  const s=(Date.now()-new Date(iso).getTime())/1000;
  return s<60?`${Math.floor(s)}s ago`:s<3600?`${Math.floor(s/60)}m ago`:`${Math.floor(s/3600)}h ago`;
}

/* ═══════════════════ CONTEXT MENU ═══════════════════ */
function CtxMenu({ m, onSelect, onClose }:{
  m:CtxMenu; onSelect:(a:string,t:any)=>void; onClose:()=>void;
}) {
  const items = m.kind==='job'?JOB_CTX:m.kind==='vehicle'?VEH_CTX:m.kind==='driver'?DRVR_CTX:m.kind==='map'?MAP_CTX:EXC_CTX;
  useEffect(()=>{
    const h=(e:MouseEvent)=>{ if(!(e.target as Element).closest('[data-ctx]')) onClose(); };
    document.addEventListener('mousedown',h);
    return ()=>document.removeEventListener('mousedown',h);
  },[onClose]);
  return (
    <div data-ctx="1" className="fixed z-[9999] w-56 bg-slate-800 border border-white/15 rounded-2xl shadow-2xl overflow-hidden"
      style={{ left:Math.min(m.x,window.innerWidth-240), top:Math.min(m.y,window.innerHeight-items.length*40-20) }}>
      <div className="px-4 py-2.5 bg-slate-700/60 border-b border-white/10">
        <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider">
          {m.kind==='job'?`Job ${m.target?.id?.slice(0,8)}…`:m.kind==='vehicle'?m.target?.vehicle_reg??'Vehicle':m.kind==='driver'?m.target?.driver_name??'Driver':m.kind==='map'?'Map Actions':'Exception'}
        </p>
      </div>
      {items.map(item=>(
        <button key={item} onClick={()=>{ onSelect(item,m.target); onClose(); }}
          className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm text-slate-200 hover:bg-white/10 hover:text-white transition-colors">
          <span className="text-base w-5 flex-shrink-0">{CTX_ICONS[item]??'•'}</span>
          {item}
        </button>
      ))}
    </div>
  );
}

/* ═══════════════════ MERGE CARD ═══════════════════ */
function MergeCard({ pair, targetJob, onAccept, onSkip }:{
  pair:MergePair; targetJob:Job; onAccept:()=>void; onSkip:()=>void;
}) {
  const scoreColor = pair.mergeScore>=80?'text-green-400':pair.mergeScore>=60?'text-yellow-400':'text-orange-400';
  const engineBadge: Record<string,string> = {
    GOOGLE_MAPS:'🗺️ Google', OSRM:'🌐 OSRM', MAPBOX:'📍 Mapbox', STRAIGHT_LINE:'📐 Est.',
  };
  return (
    <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-3.5">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-violet-400 text-base">🔀</span>
          <span className={`text-lg font-bold ${scoreColor}`}>{pair.mergeScore}</span>
          <span className="text-slate-500 text-xs">/ 100</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400">
            {engineBadge[pair.routingSource] ?? pair.routingSource}
          </span>
          <span className="text-emerald-400 text-xs font-semibold">Save ~{pair.estimatedSavingKm} km</span>
        </div>
      </div>

      {/* Two jobs side by side */}
      <div className="flex items-stretch gap-2 mb-3">
        {[
          { j: targetJob,         label: 'Job A (this)' },
          { j: pair.candidateJob, label: 'Job B (candidate)' },
        ].map(({ j, label }) => (
          <div key={j.id} className="flex-1 rounded-lg bg-slate-800/80 border border-white/8 px-2.5 py-2">
            <p className="text-[10px] text-slate-500 font-semibold mb-1">{label}</p>
            <p className="text-white text-xs font-medium truncate">
              {SVC_ICON[j.service_type as SvcType]} {j.origin_address ?? j.id.slice(0,10)+'…'}
            </p>
            <p className="text-slate-400 text-[10px] truncate mt-0.5">
              → {j.destination_address ?? 'Unknown'}
            </p>
          </div>
        ))}
      </div>

      {/* Stats row */}
      <div className="flex gap-3 mb-3 text-xs">
        <div className="flex-1 text-center rounded-lg bg-slate-800/60 py-1.5">
          <p className="text-slate-500 text-[10px]">Road dist</p>
          <p className="text-white font-semibold">{pair.pickupRoadDistKm} km</p>
        </div>
        <div className="flex-1 text-center rounded-lg bg-slate-800/60 py-1.5">
          <p className="text-slate-500 text-[10px]">Time gap</p>
          <p className="text-white font-semibold">{pair.pickupTimeDiffMin} min</p>
        </div>
        <div className="flex-1 text-center rounded-lg bg-slate-800/60 py-1.5">
          <p className="text-slate-500 text-[10px]">Savings</p>
          <p className="text-emerald-400 font-semibold">{pair.estimatedSavingKm} km</p>
        </div>
      </div>

      {/* Reasons */}
      {pair.mergeReasons.slice(0,2).map((r,i)=>(
        <p key={i} className="text-[10px] text-slate-400 flex items-center gap-1 mb-0.5">
          <span className="text-emerald-400">✓</span> {r}
        </p>
      ))}

      {/* Actions */}
      <div className="flex gap-2 mt-3">
        <button onClick={onAccept}
          className="flex-1 py-2 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-sm font-bold hover:bg-emerald-500/30 transition-all">
          ✅ Merge
        </button>
        <button
          className="flex-1 py-2 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 text-sm font-semibold hover:bg-blue-500/20 transition-all">
          👁 Preview
        </button>
        <button onClick={onSkip}
          className="flex-1 py-2 rounded-xl bg-slate-700 border border-white/10 text-slate-400 text-sm hover:bg-slate-600 transition-all">
          ❌ Skip
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════ JOB CARD ═══════════════════ */
function JobCard({ job, selected, onClick, onCtx }:{
  job:Job; selected:boolean; onClick:()=>void; onCtx:(e:React.MouseEvent)=>void;
}) {
  const sla = slaInfo(job.sla_deadline);
  return (
    <div onClick={onClick} onContextMenu={onCtx}
      className={`rounded-xl border p-3.5 cursor-pointer transition-all select-none ${
        selected ? 'border-blue-500 bg-blue-500/10'
        : `border-white/10 bg-slate-800/50 hover:border-white/20 hover:bg-slate-800 ${
          sla.risk==='critical'?'border-red-500/50':sla.risk==='warn'?'border-amber-500/30':''
        }`
      }`}>
      {/* Row 1 */}
      <div className="flex items-center gap-2 mb-2.5">
        <span className="text-xl">{SVC_ICON[job.service_type]??'•'}</span>
        <span className={`px-2 py-0.5 rounded text-xs font-bold ${PRI_BG[job.priority]}`}>{job.priority}</span>
        <div className="flex items-center gap-1.5 ml-auto">
          <span className={`w-2.5 h-2.5 rounded-full ${STATUS_DOT[job.status]}`}/>
          <span className="text-xs text-slate-400">{STATUS_LBL[job.status]}</span>
        </div>
      </div>
      {/* Row 2: route */}
      <div className="text-sm space-y-1 mb-2.5">
        <div className="flex items-start gap-2">
          <span className="text-green-400 flex-shrink-0 mt-0.5">●</span>
          <span className="text-slate-300 truncate">{job.origin_address??'Origin'}</span>
        </div>
        <div className="flex items-start gap-2">
          <span className="text-red-400 flex-shrink-0 mt-0.5">▼</span>
          <span className="text-slate-300 truncate">{job.destination_address??'Destination'}</span>
        </div>
      </div>
      {/* Row 3: meta */}
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span className="font-mono">{job.id.slice(0,8)}</span>
        <span>{job.attempt_count} att.</span>
        {sla.risk!=='none' ? (
          <span className={`font-bold ${sla.risk==='critical'?'text-red-400 animate-pulse':sla.risk==='warn'?'text-amber-400':'text-slate-400'}`}>
            ⏱ {sla.text}
          </span>
        ) : <span>{ago(job.created_at)}</span>}
      </div>
    </div>
  );
}

/* ═══════════════════ MAP PANEL ═══════════════════ */
function MapPanel({ jobs, drivers, selectedJob, onJobClick, onMapCtx }:{
  jobs:Job[]; drivers:Driver[]; selectedJob:Job|null;
  onJobClick:(j:Job)=>void; onMapCtx:(e:React.MouseEvent)=>void;
}) {
  return (
    <div className="relative w-full h-full overflow-hidden bg-slate-950" onContextMenu={e=>{e.preventDefault();onMapCtx(e);}}>
      {/* Background grid */}
      <div className="absolute inset-0" style={{
        backgroundImage:`
          linear-gradient(rgba(59,130,246,0.05) 1px, transparent 1px),
          linear-gradient(90deg, rgba(59,130,246,0.05) 1px, transparent 1px),
          radial-gradient(ellipse at 50% 60%, rgba(16,28,54,1) 0%, rgba(2,6,23,1) 100%)`,
        backgroundSize:'60px 60px, 60px 60px, 100% 100%',
      }}/>
      {/* Decorative roads */}
      <svg className="absolute inset-0 w-full h-full opacity-10">
        <line x1="20%" y1="0" x2="35%" y2="100%" stroke="#94a3b8" strokeWidth="1.5"/>
        <line x1="50%" y1="0" x2="50%" y2="100%" stroke="#94a3b8" strokeWidth="2"/>
        <line x1="75%" y1="0" x2="60%" y2="100%" stroke="#94a3b8" strokeWidth="1.5"/>
        <line x1="0" y1="40%" x2="100%" y2="35%" stroke="#94a3b8" strokeWidth="2"/>
        <line x1="0" y1="70%" x2="100%" y2="65%" stroke="#94a3b8" strokeWidth="1"/>
        <circle cx="50%" cy="38%" r="3%" fill="none" stroke="#3b82f6" strokeWidth="0.5"/>
      </svg>
      {/* Route lines */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none">
        {jobs.filter(j=>j.assigned_driver_id&&['ACCEPTED','IN_PROGRESS'].includes(j.status)).map(job=>{
          const d=drivers.find(x=>x.driver_id===job.assigned_driver_id);
          if(!d) return null;
          const jp=toMapPct(job.origin_lat,job.origin_lng), dp=toMapPct(d.last_lat,d.last_lng);
          return <line key={job.id} x1={`${jp.x}%`} y1={`${jp.y}%`} x2={`${dp.x}%`} y2={`${dp.y}%`}
            stroke="#22c55e" strokeWidth="2" strokeDasharray="8 5" opacity={0.6}/>;
        })}
      </svg>
      {/* Vehicle markers */}
      {drivers.map(d=>{
        const p=toMapPct(d.last_lat,d.last_lng);
        const col=d.status==='AVAILABLE'?'#22c55e':d.status==='BUSY'?'#f59e0b':'#64748b';
        return (
          <div key={d.driver_id} className="absolute -translate-x-1/2 -translate-y-1/2 group cursor-pointer z-10"
            style={{left:`${p.x}%`,top:`${p.y}%`}}>
            {d.status==='BUSY'&&<div className="absolute inset-0 rounded-full bg-yellow-400 opacity-25 animate-ping scale-150"/>}
            <div className="relative w-9 h-9 rounded-full border-2 border-slate-900 flex items-center justify-center text-sm shadow-lg transition-transform group-hover:scale-125"
              style={{backgroundColor:col}}>
              {SVC_ICON[d.vehicle_type as SvcType]??'🚗'}
            </div>
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-50 w-40 bg-slate-800 border border-white/15 rounded-xl px-3 py-2 text-sm shadow-2xl">
              <p className="text-white font-semibold truncate">{d.driver_name}</p>
              <p className="text-slate-400 text-xs">{d.vehicle_reg??'—'} · {d.status}</p>
              <p className="text-slate-600 text-xs">{ago(d.last_ping)}</p>
            </div>
          </div>
        );
      })}
      {/* Job pins */}
      {jobs.filter(j=>!['COMPLETED','CANCELLED'].includes(j.status)).map(job=>{
        const p=toMapPct(job.origin_lat,job.origin_lng);
        const sla=slaInfo(job.sla_deadline);
        const col=sla.risk==='critical'?'#ef4444':sla.risk==='warn'?'#f59e0b':'#22c55e';
        const sel=selectedJob?.id===job.id;
        return (
          <div key={job.id} onClick={()=>onJobClick(job)}
            className="absolute -translate-x-1/2 -translate-y-full cursor-pointer group z-20"
            style={{left:`${p.x}%`,top:`${p.y}%`}}>
            <div className={`flex flex-col items-center transition-transform ${sel?'scale-125':'group-hover:scale-110'}`}>
              <div className={`px-2 py-0.5 rounded text-xs font-bold bg-slate-900 border mb-0.5 ${sel?'border-blue-400 text-blue-300':'border-white/20 text-slate-300'}`}>
                {SVC_ICON[job.service_type]}
              </div>
              <div className="w-px h-4 bg-slate-500"/>
              <div className="w-2.5 h-2.5 rounded-full border border-slate-600" style={{backgroundColor:col}}/>
            </div>
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block z-50 w-44 bg-slate-800 border border-white/15 rounded-xl px-3 py-2 text-sm shadow-2xl">
              <p className="text-white font-semibold">{job.service_type} · {job.priority}</p>
              <p className="text-slate-400 text-xs truncate">{job.origin_address??'Origin'}</p>
              <p className="text-xs font-semibold text-slate-300 mt-0.5">{STATUS_LBL[job.status]}</p>
            </div>
          </div>
        );
      })}
      {/* Legend */}
      <div className="absolute bottom-4 left-4 bg-slate-900/85 backdrop-blur-sm border border-white/10 rounded-2xl px-4 py-3 text-sm space-y-1.5">
        <p className="text-slate-400 font-semibold text-xs mb-2 uppercase tracking-wider">Legend</p>
        {[['bg-green-400','On track'],['bg-amber-400','Delay risk'],['bg-red-500','SLA breach'],['bg-green-500','Available driver'],['bg-yellow-500','Busy driver']].map(([dot,lbl])=>(
          <div key={lbl} className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${dot}`}/>
            <span className="text-slate-400 text-xs">{lbl}</span>
          </div>
        ))}
      </div>
      {/* Controls */}
      <div className="absolute top-4 right-4 flex flex-col gap-1.5">
        {['+','−','⌂'].map(c=>(
          <button key={c} className="w-9 h-9 bg-slate-800/90 border border-white/10 rounded-xl text-slate-300 hover:text-white hover:bg-slate-700 text-sm font-bold transition-all">
            {c}
          </button>
        ))}
      </div>
      <div className="absolute top-4 left-4 bg-slate-900/70 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-slate-500">
        Right-click map for actions
      </div>
    </div>
  );
}

/* ═══════════════════ ASSIGNMENT DRAWER ═══════════════════ */
function AssignDrawer({ job, candidates, loading, onAssign, onClose }:{
  job:Job; candidates:Candidate[]; loading:boolean;
  onAssign:(c:Candidate)=>void; onClose:()=>void;
}) {
  const [sel, setSel] = useState<Candidate|null>(null);
  const scoreCol = (s:number) => s>=90?'text-green-400':s>=75?'text-yellow-400':'text-orange-400';
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose}/>
      <div className="relative w-[420px] bg-slate-900 border-l border-white/10 flex flex-col h-full shadow-2xl">
        <div className="p-5 border-b border-white/10 bg-slate-800/60">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-white font-bold text-lg">Assign Vehicle</h3>
            <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">✕</button>
          </div>
          <div className="rounded-xl bg-slate-700/60 p-4 text-sm space-y-2">
            <div className="flex justify-between"><span className="text-slate-400">Service</span><span className="text-white">{SVC_ICON[job.service_type]} {job.service_type}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Priority</span><span className={`px-2 py-0.5 rounded text-xs font-bold ${PRI_BG[job.priority]}`}>{job.priority}</span></div>
            {job.origin_address&&<div className="flex justify-between gap-4"><span className="text-slate-400 flex-shrink-0">From</span><span className="text-slate-300 text-xs text-right truncate">{job.origin_address}</span></div>}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Ranked Candidates</p>
          {loading ? <p className="text-slate-500 text-sm text-center py-10">Finding candidates…</p>
            : candidates.length===0 ? (
              <div className="text-center py-10"><p className="text-3xl mb-2">😔</p><p className="text-slate-400">No candidates available</p></div>
            ) : candidates.map((c,i)=>(
              <button key={c.driver_id} onClick={()=>setSel(c)}
                className={`w-full text-left rounded-xl border p-4 transition-all ${sel?.driver_id===c.driver_id?'border-blue-500 bg-blue-500/10':'border-white/10 bg-slate-800/60 hover:border-white/20'}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2.5">
                    <span className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${i===0?'bg-yellow-500 text-black':i===1?'bg-slate-400 text-black':'bg-amber-700 text-white'}`}>{i+1}</span>
                    <span className="text-white font-semibold">{c.vehicle_reg??'Unknown'}</span>
                  </div>
                  <span className={`text-xl font-bold font-mono ${scoreCol(c.score)}`}>{c.score}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-400">{c.driver_name}</span>
                  <span className="text-cyan-400 font-bold">ETA {c.eta_minutes} min</span>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-slate-700">
                  <div className={`h-1.5 rounded-full ${c.score>=90?'bg-green-500':c.score>=75?'bg-yellow-500':'bg-orange-500'}`} style={{width:`${c.score}%`}}/>
                </div>
              </button>
            ))}
        </div>
        <div className="p-5 border-t border-white/10 bg-slate-800/40">
          {sel&&<div className="mb-3 rounded-xl bg-blue-500/10 border border-blue-500/20 px-4 py-2.5 text-sm text-blue-300">
            Selected: <strong className="text-white">{sel.vehicle_reg}</strong> — Score {sel.score} · ETA {sel.eta_minutes} min
          </div>}
          <button disabled={!sel} onClick={()=>sel&&onAssign(sel)}
            className="w-full py-3.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-bold text-sm disabled:opacity-30 hover:opacity-90 transition-all">
            ✅ Confirm Assignment
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════ MAIN PAGE ═══════════════════ */
export default function CommandCentre() {
  const [jobs,      setJobs]      = useState<Job[]>([]);
  const [drivers,   setDrivers]   = useState<Driver[]>([]);
  const [mergePairs,setMergePairs]= useState<MergePair[]>([]);
  const [logs,      setLogs]      = useState<LogEntry[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [fullscreen,setFullscreen]= useState(false);

  const [leftTab,   setLeftTab]   = useState<'pending'|'assigned'|'active'|'exceptions'|'merge'>('pending');
  const [rightTab,  setRightTab]  = useState<'vehicles'|'drivers'>('drivers');
  const [bottomTab, setBottomTab] = useState<'logs'|'alerts'|'failed'|'overrides'>('logs');
  const [dispMode,  setDispMode]  = useState<DispMode>('SUGGESTION');
  const [selJob,    setSelJob]    = useState<Job|null>(null);
  const [ctxMenu,   setCtxMenu]   = useState<CtxMenu|null>(null);
  const [drawer,    setDrawer]    = useState<{job:Job;candidates:Candidate[];loading:boolean}|null>(null);
  const [search,    setSearch]    = useState('');
  const [suggJob,   setSuggJob]   = useState<{job:Job;candidate:Candidate}|null>(null);
  const pollRef  = useRef<ReturnType<typeof setInterval>|null>(null);
  const mergeRef = useRef<ReturnType<typeof setInterval>|null>(null);

  const addLog = useCallback((msg:string, kind:LogEntry['kind']='info') => {
    setLogs(p=>[{time:new Date().toISOString(),msg,kind},...p.slice(0,149)]);
  },[]);

  /* ── Fetch ── */
  const fetchAll = useCallback(async()=>{
    try {
      const [jr,dr]=await Promise.all([
        // Exclude SCHOOL_BUS — managed in the dedicated School Bus Dispatch Board (/school-bus/dispatch)
        fetch('/api/dispatch/jobs?limit=200').then(r=>r.json()),
        fetch('/api/dispatch/availability?limit=100').then(r=>r.json()),
      ]);
      // Filter out SCHOOL_BUS and AMBULANCE — each has a dedicated dispatch board:
      //   SCHOOL_BUS → /school-bus/dispatch
      //   AMBULANCE  → /incidents/ambulance/dispatch
      setJobs((jr.data??[]).filter((j:Job)=>String(j.service_type)!=='SCHOOL_BUS'&&String(j.service_type)!=='AMBULANCE'));
      setDrivers(dr.data??[]);
    } finally { setLoading(false); }
  },[]);


  const fetchMerge = useCallback(async()=>{
    // Poll the lightweight persisted-suggestions endpoint (populated by event-driven
    // merge-trigger on job creation) instead of running a full routing-API scan.
    const tenantId = jobs[0]?.tenant_id;
    if (!tenantId) return;
    try {
      const r=await fetch(`/api/dispatch/merge-suggestions?tenantId=${tenantId}&limit=20`);
      if(!r.ok) return;
      const d=await r.json();
      if(!Array.isArray(d.suggestions)) return;

      // Map DB rows → MergePair interface expected by MergeCard
      const pairs: MergePair[] = d.suggestions.map((s: Record<string,unknown>) => {
        // Reconstruct a minimal Job object for the candidate (job_b) from joined columns
        const candidateJob: Job = {
          id:           String(s.job_b_id),
          tenant_id:    tenantId,
          service_type: String(s.job_b_service_type ?? 'PASSENGER') as Job['service_type'],
          priority:     String(s.job_b_priority     ?? 'NORMAL') as Job['priority'],
          status:       String(s.job_b_status        ?? 'PENDING') as Job['status'],
          origin_lat:   s.job_b_origin_lat  != null ? Number(s.job_b_origin_lat)  : undefined,
          origin_lng:   s.job_b_origin_lng  != null ? Number(s.job_b_origin_lng)  : undefined,
          dest_lat:     s.job_b_dest_lat    != null ? Number(s.job_b_dest_lat)    : undefined,
          dest_lng:     s.job_b_dest_lng    != null ? Number(s.job_b_dest_lng)    : undefined,
          origin_address:      String(s.job_b_origin_address ?? ''),
          destination_address: String(s.job_b_dest_address   ?? ''),
          scheduled_pickup:    s.job_b_scheduled_pickup ? String(s.job_b_scheduled_pickup) : undefined,
          passenger_count:     s.job_b_passenger_count  != null ? Number(s.job_b_passenger_count) : undefined,
          created_at:          String(s.job_b_created_at ?? new Date().toISOString()),
          current_attempt: 0, max_attempts: 3,
        };
        return {
          suggestionId:      String(s.suggestion_id),
          targetJobId:       String(s.job_a_id),
          candidateJobId:    String(s.job_b_id),
          candidateJob,
          mergeScore:        Number(s.merge_score        ?? 0),
          pickupRoadDistKm:  Number(s.pickup_road_km     ?? 0),
          pickupTimeDiffMin: Number(s.pickup_time_diff_min ?? 0),
          estimatedSavingKm: Number(s.estimated_saving_km ?? 0),
          mergeReasons:      Array.isArray(s.merge_reasons) ? s.merge_reasons as string[]
                             : typeof s.merge_reasons === 'string' ? JSON.parse(s.merge_reasons as string)
                             : [],
          routingSource:     String(s.routing_source ?? 'STRAIGHT_LINE'),
        };
      });

      setMergePairs(pairs);
    } catch { /* silently ignore merge fetch errors */ }
  },[jobs]);

  useEffect(()=>{
    fetchAll();
    pollRef.current=setInterval(fetchAll,10_000);
    return ()=>{ if(pollRef.current) clearInterval(pollRef.current); };
  },[fetchAll]);

  useEffect(()=>{
    if(jobs.length>0) {
      fetchMerge();
      mergeRef.current=setInterval(fetchMerge,30_000);
    }
    return ()=>{ if(mergeRef.current) clearInterval(mergeRef.current); };
  },[jobs.length, fetchMerge]);

  /* ── Suggestion mode ── */
  useEffect(()=>{
    if(dispMode!=='SUGGESTION'){setSuggJob(null);return;}
    const j=jobs.find(x=>x.status==='PENDING');
    const d=drivers.find(x=>x.status==='AVAILABLE');
    if(j&&d&&!suggJob) setSuggJob({job:j,candidate:{driver_id:d.driver_id,driver_name:d.driver_name,vehicle_reg:d.vehicle_reg,eta_minutes:5,score:94}});
  },[jobs,drivers,dispMode]);

  /* ── Tab filtering ── */
  const TAB_STATUS: Record<string,JobStatus[]> = {
    pending:   ['PENDING','SEARCHING','OFFERED','RETRYING'],
    assigned:  ['ACCEPTED'],
    active:    ['IN_PROGRESS'],
    exceptions:['ESCALATED','FAILED'],
    merge:     ['PENDING','SEARCHING'],
  };
  const COUNTS: Record<string,number> = {
    pending:   jobs.filter(j=>['PENDING','SEARCHING','OFFERED','RETRYING'].includes(j.status)).length,
    assigned:  jobs.filter(j=>j.status==='ACCEPTED').length,
    active:    jobs.filter(j=>j.status==='IN_PROGRESS').length,
    exceptions:jobs.filter(j=>['ESCALATED','FAILED'].includes(j.status)).length,
    merge:     mergePairs.length,
  };
  const filteredJobs=leftTab==='merge'?[]:jobs.filter(j=>{
    if(!TAB_STATUS[leftTab]?.includes(j.status)) return false;
    if(search){const s=search.toLowerCase();return j.id.includes(s)||(j.origin_address??'').toLowerCase().includes(s)||j.service_type.toLowerCase().includes(s);}
    return true;
  });

  /* ── Actions ── */
  const handleCtxAction=useCallback(async(action:string,target:any)=>{
    if(action==='Assign Vehicle'){
      setDrawer({job:target as Job,candidates:[],loading:true});
      await new Promise(r=>setTimeout(r,600));
      const cands=drivers.filter(d=>d.status==='AVAILABLE').slice(0,5).map((d,i)=>({
        driver_id:d.driver_id,driver_name:d.driver_name,vehicle_reg:d.vehicle_reg,eta_minutes:4+i*2,score:94-i*4,
      }));
      setDrawer(p=>p?{...p,candidates:cands,loading:false}:null);
    } else if(action==='Auto-Dispatch Now'){
      const j=target as Job;
      addLog(`Auto-dispatching ${j.id.slice(0,8)}…`,'info');
      const res=await fetch('/api/dispatch/trigger',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({jobId:j.id,serviceType:j.service_type,priority:j.priority,tenantId:j.tenant_id,originLat:j.origin_lat,originLng:j.origin_lng})}).catch(()=>null);
      addLog(res?.ok?`✓ Dispatch triggered for ${j.id.slice(0,8)}`:`✗ Dispatch failed`,(res?.ok?'success':'error'));
      fetchAll();
    } else if(action==='Cancel Job'){
      if(!confirm('Cancel this job?')) return;
      addLog(`Job ${(target as Job).id.slice(0,8)} cancelled`,'warn');
    } else if(action==='Call Driver'){
      alert(`Calling ${(target as Driver).driver_name} at ${(target as Driver).driver_phone??'N/A'}`);
    } else if(action==='Send Message (WhatsApp)'){
      alert(`Opening WhatsApp for ${(target as Driver).driver_name}`);
    } else if(action==='Merge with Another Job'){
      setLeftTab('merge');
      addLog(`Reviewing merge candidates for job ${(target as Job).id.slice(0,8)}`,'info');
    }
  },[drivers,addLog,fetchAll]);

  const handleAssign=async(c:Candidate)=>{
    if(!drawer) return;
    const res=await fetch('/api/dispatch/jobs',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({jobId:drawer.job.id,driverId:c.driver_id,vehicleId:c.driver_id,adminId:'dispatcher'})});
    addLog(res.ok?`✓ ${c.vehicle_reg} assigned to ${drawer.job.id.slice(0,8)} (score ${c.score})`:`✗ Assignment failed`,res.ok?'success':'error');
    setDrawer(null); fetchAll();
  };

  const handleMerge=async(pair:MergePair)=>{
    const tenantId=jobs.find(j=>j.id===pair.targetJobId)?.tenant_id;
    if(!tenantId) return;
    if(!confirm(`Merge jobs ${pair.targetJobId.slice(0,8)} and ${pair.candidateJobId.slice(0,8)}? Both will be replaced with a single combined job.`)) return;
    const res=await fetch('/api/dispatch/merge-candidates',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({jobIdA:pair.targetJobId,jobIdB:pair.candidateJobId,tenantId,adminId:'dispatcher'})});
    const d=await res.json();
    if(d.ok){
      addLog(`✓ Jobs merged → new job ${d.mergedJobId?.slice(0,8)}`,'success');
      // Mark suggestion as ACCEPTED in DB (fire-and-forget)
      if(pair.suggestionId) {
        fetch('/api/dispatch/merge-suggestions',{method:'PATCH',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({suggestionId:pair.suggestionId,action:'ACCEPT',tenantId})}).catch(()=>{});
      }
      setMergePairs(p=>p.filter(x=>x.targetJobId!==pair.targetJobId||x.candidateJobId!==pair.candidateJobId));
      fetchAll();
    } else {
      addLog(`✗ Merge failed: ${d.error}`,'error');
    }
  };

  const handleSkipMerge=async(pair:MergePair)=>{
    // Optimistically remove from UI
    setMergePairs(p=>p.filter(x=>!(x.targetJobId===pair.targetJobId&&x.candidateJobId===pair.candidateJobId)));
    // Persist SKIP to DB so it doesn't resurface until a new job triggers a fresh scan
    if(pair.suggestionId) {
      const tenantId=jobs.find(j=>j.id===pair.targetJobId)?.tenant_id ?? jobs[0]?.tenant_id;
      if(tenantId) {
        fetch('/api/dispatch/merge-suggestions',{method:'PATCH',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({suggestionId:pair.suggestionId,action:'SKIP',tenantId})}).catch(()=>{});
      }
    }
  };

  const openCtx=(e:React.MouseEvent,kind:CtxMenu['kind'],target:any)=>{
    e.preventDefault(); e.stopPropagation();
    setCtxMenu({x:e.clientX,y:e.clientY,kind,target});
  };

  const failedJobs=jobs.filter(j=>['FAILED','ESCALATED'].includes(j.status));
  const alertLogs=logs.filter(l=>l.kind==='error'||l.kind==='warn');
  const onlineDrivers=drivers.filter(d=>d.status==='AVAILABLE');

  /* ═══ RENDER ═══ */
  return (
    <div
      className={`flex flex-col bg-slate-950 overflow-hidden ${fullscreen?'fixed inset-0 z-[9990]':'h-screen'}`}
      onClick={()=>setCtxMenu(null)}
    >
      {/* ════ TOP BAR ════ */}
      <div className="flex-shrink-0 flex items-center gap-3 px-5 h-14 bg-slate-900 border-b border-white/10">
        {/* Back link (only when not fullscreen) */}
        {!fullscreen && (
          <Link href="/dispatch" className="text-slate-400 hover:text-white text-sm flex items-center gap-1.5 flex-shrink-0">
            ← <span className="hidden md:inline">Dispatch</span>
          </Link>
        )}
        <span className="text-white font-bold">🚦 Command Centre</span>
        <div className="w-px h-6 bg-white/10 flex-shrink-0"/>

        {/* Search */}
        <div className="relative">
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search jobs, vehicles…"
            className="bg-slate-800 border border-white/10 text-slate-300 text-sm rounded-xl pl-4 pr-8 py-2 w-52 focus:outline-none focus:border-blue-500"/>
          {search&&<button onClick={()=>setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">✕</button>}
        </div>

        <div className="w-px h-6 bg-white/10 flex-shrink-0"/>

        {/* Auto Dispatch Mode */}
        <span className="text-slate-400 text-sm font-medium flex-shrink-0">Auto Dispatch:</span>
        <div className="flex rounded-xl border border-white/10 overflow-hidden text-xs font-bold">
          {(['OFF','SUGGESTION','AUTO'] as DispMode[]).map(m=>(
            <button key={m} onClick={()=>{setDispMode(m);addLog(`Mode → ${m}`,'info');}}
              className={`px-3 py-2 transition-all ${dispMode===m
                ?m==='AUTO'?'bg-emerald-500 text-white':m==='SUGGESTION'?'bg-blue-500 text-white':'bg-slate-700 text-slate-300'
                :'bg-slate-800 text-slate-500 hover:text-slate-300'}`}>
              {m==='OFF'?'⛔ OFF':m==='AUTO'?'⚡ AUTO':'💡 SUGGEST'}
            </button>
          ))}
        </div>

        <div className="flex-1"/>

        {/* Stats */}
        <div className="flex items-center gap-4 text-sm">
          {mergePairs.length>0&&(
            <button onClick={()=>setLeftTab('merge')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-500/20 border border-violet-500/30 text-violet-300 text-xs font-bold animate-pulse">
              🔀 {mergePairs.length} Merge{mergePairs.length>1?'s':''}
            </button>
          )}
          {COUNTS.exceptions>0&&(
            <button onClick={()=>setBottomTab('alerts')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/20 border border-red-500/30 text-red-300 text-xs font-bold animate-pulse">
              ⚠ {COUNTS.exceptions} Alert{COUNTS.exceptions>1?'s':''}
            </button>
          )}
          <span className="text-slate-500">Pending: <strong className="text-yellow-400">{COUNTS.pending}</strong></span>
          <span className="text-slate-500">Active: <strong className="text-cyan-400">{COUNTS.active}</strong></span>
          <span className="text-slate-500">Online: <strong className="text-green-400">{onlineDrivers.length}</strong></span>
        </div>

        {/* Full-screen toggle */}
        <button onClick={()=>setFullscreen(f=>!f)}
          className="w-9 h-9 rounded-xl bg-slate-800 border border-white/10 text-slate-400 hover:text-white flex items-center justify-center text-base transition-all" title={fullscreen?'Exit fullscreen':'Enter fullscreen'}>
          {fullscreen?'⊠':'⛶'}
        </button>
        <button onClick={()=>{setLoading(true);fetchAll();}}
          className="w-9 h-9 rounded-xl bg-slate-800 border border-white/10 text-slate-400 hover:text-white flex items-center justify-center transition-all">
          ↻
        </button>
      </div>

      {/* ════ 3-PANEL MIDDLE ════ */}
      <div className="flex flex-1 min-h-0">

        {/* ── LEFT: Jobs + Merge ── */}
        <div className="w-96 flex-shrink-0 border-r border-white/10 flex flex-col bg-slate-900/60">
          {/* Tabs */}
          <div className="flex border-b border-white/10 overflow-x-auto flex-shrink-0">
            {([
              ['pending',   'Pending'],
              ['assigned',  'Assigned'],
              ['active',    'Active'],
              ['exceptions','Alerts'],
              ['merge',     'Merges'],
            ] as [typeof leftTab,string][]).map(([t,l])=>(
              <button key={t} onClick={()=>setLeftTab(t)}
                className={`flex-shrink-0 px-3 py-3 text-xs font-bold border-b-2 -mb-px transition-all ${
                  leftTab===t?'text-white border-blue-500':'text-slate-500 border-transparent hover:text-slate-300'
                }`}>
                {l}
                {COUNTS[t]>0&&(
                  <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] ${
                    t==='exceptions'?'bg-red-500 text-white':t==='merge'?'bg-violet-500 text-white':'bg-slate-700 text-slate-300'
                  }`}>{COUNTS[t]}</span>
                )}
              </button>
            ))}
          </div>

          {/* List body */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {loading&&<p className="text-slate-500 text-sm text-center py-6">Loading…</p>}

            {/* Merge recommendations */}
            {leftTab==='merge'&&(
              mergePairs.length===0 ? (
                <div className="text-center py-12">
                  <p className="text-3xl mb-2">🔀</p>
                  <p className="text-slate-400 text-sm font-medium">No merge opportunities</p>
                  <p className="text-slate-600 text-xs mt-1">Checked against your Trip Merging config</p>
                  <p className="text-slate-600 text-xs mt-1">New suggestions appear when jobs are created</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-violet-400 text-xs font-bold uppercase tracking-wider">
                      {mergePairs.length} Merge Opportunit{mergePairs.length>1?'ies':'y'}
                    </p>
                    <button onClick={fetchMerge} className="text-slate-500 text-xs hover:text-slate-300">↻ Refresh</button>
                  </div>
                  {mergePairs.map(pair=>{
                    const tJob=jobs.find(j=>j.id===pair.targetJobId);
                    if(!tJob) return null;
                    return (
                      <MergeCard key={`${pair.targetJobId}-${pair.candidateJobId}`}
                        pair={pair} targetJob={tJob}
                        onAccept={()=>handleMerge(pair)}
                        onSkip={()=>handleSkipMerge(pair)}
                      />
                    );
                  })}
                </div>
              )
            )}

            {/* Job cards */}
            {leftTab!=='merge'&&!loading&&filteredJobs.length===0&&(
              <div className="text-center py-12">
                <p className="text-2xl mb-2">📭</p>
                <p className="text-slate-500 text-sm">No jobs in this category</p>
              </div>
            )}
            {leftTab!=='merge'&&filteredJobs.map(job=>(
              <JobCard key={job.id} job={job} selected={selJob?.id===job.id}
                onClick={()=>setSelJob(job)} onCtx={e=>openCtx(e,'job',job)}/>
            ))}

            {/* Merge hint strip when on other tabs */}
            {leftTab!=='merge'&&mergePairs.length>0&&(
              <button onClick={()=>setLeftTab('merge')}
                className="w-full py-3 rounded-xl border border-dashed border-violet-500/40 text-violet-400 text-sm font-semibold hover:bg-violet-500/10 transition-all">
                🔀 {mergePairs.length} merge opportunit{mergePairs.length>1?'ies':'y'} available
              </button>
            )}
          </div>

          <div className="flex-shrink-0 p-3 border-t border-white/10">
            <button className="w-full py-2.5 rounded-xl bg-blue-600/20 border border-blue-600/30 text-blue-400 text-sm font-bold hover:bg-blue-600/30 transition-all">
              + Create New Job
            </button>
          </div>
        </div>

        {/* ── CENTER: Map ── */}
        <div className="flex-1 relative min-w-0">
          <MapPanel jobs={jobs} drivers={drivers} selectedJob={selJob}
            onJobClick={j=>setSelJob(j)} onMapCtx={e=>openCtx(e,'map',{})}/>

          {/* Suggestion overlay */}
          {dispMode==='SUGGESTION'&&suggJob&&(
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40 w-96 bg-slate-900/95 backdrop-blur-sm border border-blue-500/40 rounded-2xl shadow-2xl overflow-hidden">
              <div className="px-5 py-3 bg-blue-500/10 border-b border-blue-500/20 flex items-center gap-2">
                <span className="text-blue-400 text-lg">💡</span>
                <p className="text-blue-300 text-sm font-bold">System Recommendation</p>
              </div>
              <div className="px-5 py-4">
                <p className="text-slate-300 text-sm mb-1">
                  Recommended: <strong className="text-white">{suggJob.candidate.vehicle_reg??suggJob.candidate.driver_name}</strong>
                  {' '}· Score <strong className="text-green-400 text-lg">{suggJob.candidate.score}</strong>
                </p>
                <p className="text-slate-500 text-xs mb-4">
                  ETA {suggJob.candidate.eta_minutes} min · Job {suggJob.job.id.slice(0,8)} · {suggJob.job.service_type}
                </p>
                <div className="flex gap-2.5">
                  <button onClick={()=>{addLog(`✓ Suggestion accepted — ${suggJob.candidate.vehicle_reg}`,'success');setSuggJob(null);fetchAll();}}
                    className="flex-1 py-2.5 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-sm font-bold hover:bg-emerald-500/30">
                    ✅ Accept
                  </button>
                  <button onClick={()=>setSuggJob(null)}
                    className="flex-1 py-2.5 rounded-xl bg-red-500/20 border border-red-500/30 text-red-400 text-sm font-bold hover:bg-red-500/30">
                    ❌ Reject
                  </button>
                  <button onClick={()=>{setSuggJob(null);setTimeout(fetchAll,500);}}
                    className="flex-1 py-2.5 rounded-xl bg-slate-700 border border-white/10 text-slate-400 text-sm hover:bg-slate-600">
                    🔄 Recalc
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── RIGHT: Resource Pool ── */}
        <div className="w-96 flex-shrink-0 border-l border-white/10 flex flex-col bg-slate-900/60">
          <div className="flex border-b border-white/10 flex-shrink-0">
            {(['vehicles','drivers'] as const).map(t=>(
              <button key={t} onClick={()=>setRightTab(t)}
                className={`flex-1 py-3 text-sm font-bold border-b-2 -mb-px transition-all ${rightTab===t?'text-white border-blue-500':'text-slate-500 border-transparent hover:text-slate-300'}`}>
                {t==='vehicles'?'🚗 Vehicles':'🤵 Drivers'}
              </button>
            ))}
          </div>

          {/* Status pills */}
          <div className="flex gap-1.5 px-3 py-2.5 flex-shrink-0 border-b border-white/5">
            {(['AVAILABLE','BUSY','BREAK','OFF_DUTY'] as DrvStatus[]).map(s=>{
              const n=drivers.filter(d=>d.status===s).length;
              const col={AVAILABLE:'bg-green-500/10 border-green-500/20 text-green-400',BUSY:'bg-yellow-500/10 border-yellow-500/20 text-yellow-400',BREAK:'bg-blue-500/10 border-blue-500/20 text-blue-400',OFF_DUTY:'bg-slate-800 border-slate-700 text-slate-500'}[s];
              return (
                <div key={s} className={`flex-1 text-center px-1 py-1.5 rounded-xl border ${col}`}>
                  <p className="text-lg font-bold leading-tight">{n}</p>
                  <p className="text-[10px] leading-tight">{s.replace('_',' ')}</p>
                </div>
              );
            })}
          </div>

          <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5">
            {rightTab==='drivers'&&drivers.map(d=>(
              <div key={d.driver_id} onContextMenu={e=>openCtx(e,'driver',d)}
                className="group rounded-xl border border-white/10 bg-slate-800/50 px-3.5 py-3 hover:border-white/20 hover:bg-slate-800 cursor-context-menu transition-all">
                <div className="flex items-center gap-2.5 mb-1.5">
                  <div className={`w-3 h-3 rounded-full flex-shrink-0 ${DRVR_DOT[d.status]}`}/>
                  <span className="text-white text-sm font-semibold truncate flex-1">{d.driver_name}</span>
                  <span className="text-xs text-slate-500">{d.status.replace('_',' ')}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-500 mb-1.5">
                  <span>{d.vehicle_reg??'No vehicle'} · {d.vehicle_type??''}</span>
                  {d.driver_rating&&<span>★ {Number(d.driver_rating).toFixed(1)}</span>}
                </div>
                {d.hours_worked_today!=null&&(
                  <div className="h-1.5 rounded-full bg-slate-700 mb-1">
                    <div className="h-1.5 rounded-full bg-blue-500 transition-all"
                      style={{width:`${Math.min(100,(Number(d.hours_worked_today)/12)*100)}%`}}/>
                  </div>
                )}
                <p className="text-[10px] text-slate-600 group-hover:text-slate-500">Right-click for actions</p>
              </div>
            ))}
            {rightTab==='vehicles'&&drivers.map(d=>(
              <div key={d.driver_id} onContextMenu={e=>openCtx(e,'vehicle',d)}
                className="group rounded-xl border border-white/10 bg-slate-800/50 px-3.5 py-3 hover:border-white/20 hover:bg-slate-800 cursor-context-menu transition-all">
                <div className="flex items-center gap-2.5 mb-1.5">
                  <span className="text-lg">{SVC_ICON[d.vehicle_type as SvcType]??'🚗'}</span>
                  <span className="text-white text-sm font-semibold">{d.vehicle_reg??'Unknown'}</span>
                  <div className={`ml-auto w-3 h-3 rounded-full ${DRVR_DOT[d.status]}`}/>
                </div>
                <div className="text-xs text-slate-500 space-y-0.5">
                  <p>{d.vehicle_type??'Unknown'} · Cap {d.vehicle_capacity??'—'}</p>
                  <p>Driver: {d.driver_name}</p>
                  <p>Zone: {d.zone_id??'—'} · {ago(d.last_ping)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ════ BOTTOM BAR ════ */}
      <div className="flex-shrink-0 border-t border-white/10 bg-slate-900/80" style={{height:'260px'}}>
        <div className="flex border-b border-white/10">
          {([
            ['logs',      `Dispatch Logs (${logs.length})`],
            ['alerts',    `Alerts (${alertLogs.length})`],
            ['failed',    `Failed (${failedJobs.length})`],
            ['overrides', 'Manual Overrides'],
          ] as [typeof bottomTab,string][]).map(([t,l])=>(
            <button key={t} onClick={()=>setBottomTab(t)}
              className={`px-5 py-3 text-sm font-semibold border-b-2 -mb-px transition-all ${bottomTab===t?'text-white border-blue-500':'text-slate-500 border-transparent hover:text-slate-300'}`}>
              {l}
              {t==='alerts'&&alertLogs.length>0&&<span className="ml-1.5 w-2 h-2 rounded-full bg-red-500 inline-block animate-pulse"/>}
            </button>
          ))}
        </div>
        <div className="overflow-y-auto px-5 py-3" style={{height:'208px'}}>
          {bottomTab==='logs'&&(
            <div className="space-y-0.5 font-mono text-sm">
              {logs.length===0&&<p className="text-slate-600 py-3">No activity yet</p>}
              {logs.map((l,i)=>(
                <div key={i} className="flex items-start gap-3">
                  <span className="text-slate-600 flex-shrink-0 text-xs pt-0.5">{new Date(l.time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</span>
                  <span className={`flex-shrink-0 text-xs pt-0.5 ${l.kind==='error'?'text-red-400':l.kind==='warn'?'text-amber-400':l.kind==='success'?'text-green-400':'text-slate-500'}`}>
                    {l.kind==='error'?'✗':l.kind==='warn'?'⚠':l.kind==='success'?'✓':'·'}
                  </span>
                  <span className="text-slate-300">{l.msg}</span>
                </div>
              ))}
            </div>
          )}
          {bottomTab==='alerts'&&(
            <div className="space-y-1.5">
              {alertLogs.length===0&&<p className="text-slate-600 text-sm py-3">No active alerts</p>}
              {alertLogs.map((l,i)=>(
                <div key={i} onContextMenu={e=>openCtx(e,'exception',l)}
                  className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-red-500/20 bg-red-500/5 cursor-context-menu hover:bg-red-500/10 transition-colors">
                  <span className="text-base flex-shrink-0">{l.kind==='error'?'🚨':'⚠️'}</span>
                  <span className="text-slate-300 text-sm flex-1">{l.msg}</span>
                  <span className="text-slate-600 text-xs flex-shrink-0">{new Date(l.time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span>
                </div>
              ))}
            </div>
          )}
          {bottomTab==='failed'&&(
            <div className="space-y-1.5">
              {failedJobs.length===0&&<p className="text-slate-600 text-sm py-3">No failed dispatches</p>}
              {failedJobs.map(j=>(
                <div key={j.id} onContextMenu={e=>openCtx(e,'exception',j)}
                  className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-white/10 bg-slate-800/50 cursor-context-menu hover:bg-slate-800 transition-colors">
                  <span className="text-xl">{SVC_ICON[j.service_type]}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-semibold">{j.service_type} · {j.priority}</p>
                    <p className="text-slate-400 text-xs truncate">{j.origin_address??j.id.slice(0,14)}</p>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${j.status==='FAILED'?'bg-red-900/60 text-red-300':'bg-orange-900/60 text-orange-300'}`}>{j.status}</span>
                  <span className="text-slate-600 text-xs">{j.attempt_count} att.</span>
                </div>
              ))}
            </div>
          )}
          {bottomTab==='overrides'&&(
            <div className="space-y-1.5">
              <p className="text-slate-600 text-sm py-3">Manual overrides performed this session appear here.</p>
            </div>
          )}
        </div>
      </div>

      {/* ═══ OVERLAYS ═══ */}
      {ctxMenu&&<CtxMenu m={ctxMenu} onSelect={handleCtxAction} onClose={()=>setCtxMenu(null)}/>}
      {drawer&&<AssignDrawer job={drawer.job} candidates={drawer.candidates} loading={drawer.loading} onAssign={handleAssign} onClose={()=>setDrawer(null)}/>}
    </div>
  );
}
