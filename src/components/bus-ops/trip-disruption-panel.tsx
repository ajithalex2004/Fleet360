'use client';
import { useCallback,useEffect,useState } from 'react';
import { PRETRIP_CHECKLIST } from '@/lib/bus-pretrip-checklist';
type Disruption={id:string;status:string;version:number;reason:string;location:string|null;reportedAt:string;revisedEta:string|null;recoveryNotes:string|null;resolutionNotes:string|null;reportEventId:string|null;recoveryEventId:string|null;resolutionEventId:string|null};
type History={disruptions:Disruption[];deliveries:{event_id:string;status:string;count:number}[];notificationsEnabled:boolean;vehicles:{id:string;licensePlate:string|null;plateNumber:string|null;seatingCapacity:number|null;status:string|null}[];drivers:{id:string;name:string|null;firstName:string|null;lastName:string|null}[]};
const inputClass='w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-main)]';
const buttonClass='rounded-lg bg-violet-600 px-4 py-2 text-sm text-white disabled:opacity-50';
export function TripDisruptionPanel({scheduleId,tripStatus,onChanged}:{scheduleId:string;tripStatus:string|null;onChanged:()=>Promise<void>}){
 const [data,setData]=useState<History|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [reason,setReason]=useState(''),[location,setLocation]=useState(''),[severity,setSeverity]=useState('HIGH');
 const [vehicleId,setVehicleId]=useState(''),[driverId,setDriverId]=useState(''),[eta,setEta]=useState(''),[notes,setNotes]=useState('');
 const [checks,setChecks]=useState<Record<string,boolean>>({}),[requestKey,setRequestKey]=useState('');
 const base=`/api/bus-ops/schedules/${encodeURIComponent(scheduleId)}/disruptions`;
 const load=useCallback(async()=>{const res=await fetch(base,{cache:'no-store'});const json=await res.json();if(!res.ok)throw new Error(json.error ?? 'Unable to load disruption workflow');setData(json);},[base]);
 useEffect(()=>{setRequestKey(crypto.randomUUID());load().catch(e=>setError(e.message));},[load]);
 const current=data?.disruptions.find(d=>d.status!=='RESOLVED');
 const operable=['SCHEDULED','STARTED','EN_ROUTE','DEPARTED','IN_TRANSIT'].includes(tripStatus ?? '');
 async function submit(body:unknown,id?:string){
  setBusy(true);setError('');
  try{const res=await fetch(id?`${base}/${encodeURIComponent(id)}`:base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   const json=await res.json();if(!res.ok){const blocked=json.validation?.checks?.filter((c:{severity:string})=>c.severity==='BLOCK').map((c:{title:string})=>c.title).join('; ');throw new Error([json.error,blocked].filter(Boolean).join(': '));}
   setRequestKey(crypto.randomUUID());setReason('');setLocation('');setNotes('');setChecks({});await load();await onChanged();
  }catch(e){setError(e instanceof Error?e.message:'Disruption command failed');await load().catch(()=>{});}finally{setBusy(false);}
 }
 return <section className="space-y-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 text-[var(--text-main)]">
  <div className="flex items-center justify-between"><h2 className="font-semibold">Disruption response</h2><button type="button" disabled={busy} onClick={()=>load().catch(e=>setError(e.message))} className="text-sm underline">Refresh history</button></div>
  <p className="text-sm text-[var(--text-muted)]">Report breakdown → inspect and assign substitute → revised destination arrival → rider update → confirm response complete.</p>
  {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
  {!data?<p>Loading disruption history…</p>:<>
   <p className="text-sm">Rider updates: {data.notificationsEnabled?'enabled through tenant notification rules.':'disabled. Enable “trip.disruption_updated” in Bus Ops Settings to send rider updates.'} Delivery counts below show provider acceptance and failures.</p>
   {!current && operable && <form className="grid gap-3 md:grid-cols-2" onSubmit={e=>{e.preventDefault();submit({requestKey,reason,location,severity});}}>
    <label className="md:col-span-2 text-sm">Breakdown details<textarea required minLength={5} maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)} className={inputClass}/></label>
    <label className="text-sm">Location<input maxLength={300} value={location} onChange={e=>setLocation(e.target.value)} className={inputClass}/></label>
    <label className="text-sm">Severity<select value={severity} onChange={e=>setSeverity(e.target.value)} className={inputClass}>{['LOW','MEDIUM','HIGH','CRITICAL'].map(v=><option key={v}>{v}</option>)}</select></label>
    <div><button className={buttonClass} disabled={busy || !requestKey}>Report disruption</button></div>
   </form>}
   {current && <div className="space-y-3">
    <p className="font-medium">{current.status}: {current.reason}</p>
    {current.status==='REPORTED' && operable && <form className="space-y-3" onSubmit={e=>{e.preventDefault();submit({action:'recover',expectedVersion:current.version,vehicleId,driverId,revisedEta:new Date(eta).toISOString(),notes,items:PRETRIP_CHECKLIST.map(i=>({key:i.key,ok:checks[i.key]===true}))},current.id);}}>
     <div className="grid gap-3 md:grid-cols-2">
      <label className="text-sm">Substitute bus<select required value={vehicleId} onChange={e=>{setVehicleId(e.target.value);setChecks({});}} className={inputClass}><option value="">Select bus</option>{data.vehicles.map(v=><option key={v.id} value={v.id}>{v.licensePlate ?? v.plateNumber ?? v.id} · {v.seatingCapacity ?? '?'} seats · {v.status}</option>)}</select></label>
      <label className="text-sm">Driver<select required value={driverId} onChange={e=>{setDriverId(e.target.value);setChecks({});}} className={inputClass}><option value="">Select driver</option>{data.drivers.map(d=><option key={d.id} value={d.id}>{d.name ?? [d.firstName,d.lastName].filter(Boolean).join(' ')}</option>)}</select></label>
      <label className="text-sm">Revised destination arrival (your local time)<input required type="datetime-local" value={eta} onChange={e=>setEta(e.target.value)} className={inputClass}/></label>
      <label className="text-sm">Recovery notes<textarea required minLength={5} maxLength={2000} value={notes} onChange={e=>setNotes(e.target.value)} className={inputClass}/></label>
     </div>
     <fieldset className="grid gap-2 md:grid-cols-2"><legend className="mb-2 text-sm font-medium">Confirm inspection of the selected bus and driver</legend>{PRETRIP_CHECKLIST.map(i=><label key={i.key} className="flex gap-2 text-sm"><input type="checkbox" checked={checks[i.key]===true} onChange={e=>setChecks({...checks,[i.key]:e.target.checked})}/>{i.label}</label>)}</fieldset>
     <p className="text-xs text-[var(--text-muted)]">The service checks capacity, compliance and conflicting assignments before saving. Existing passenger attendance is retained.</p>
     <button disabled={busy || !vehicleId || !driverId || !PRETRIP_CHECKLIST.every(i=>checks[i.key])} className={buttonClass}>Validate, assign substitute and queue rider update</button>
    </form>}
    {(current.status==='RECOVERED' || tripStatus==='CANCELLED') && <form className="space-y-3" onSubmit={e=>{e.preventDefault();submit({action:'resolve',expectedVersion:current.version,notes},current.id);}}>
     {current.revisedEta && <p className="text-sm">Revised destination arrival: {new Date(current.revisedEta).toLocaleString()}</p>}
     <label className="block text-sm">Confirm service resumed or record final outcome<textarea required minLength={5} maxLength={2000} value={notes} onChange={e=>setNotes(e.target.value)} className={inputClass}/></label>
     <button className={buttonClass} disabled={busy}>Confirm response complete</button>
    </form>}
   </div>}
   {data.disruptions.length>0 && <div className="overflow-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Reported</th><th className="p-2">Status / outcome</th><th className="p-2">Rider delivery history</th></tr></thead><tbody>{data.disruptions.map(d=><tr key={d.id} className="border-t border-[var(--border-subtle)]"><td className="p-2">{new Date(d.reportedAt).toLocaleString()}</td><td className="p-2">{d.status}<br/>{d.resolutionNotes ?? d.recoveryNotes ?? d.reason}</td><td className="p-2">{data.deliveries.filter(x=>[d.reportEventId,d.recoveryEventId,d.resolutionEventId].includes(x.event_id)).map(x=>`${x.status}: ${x.count}`).join(', ') || 'No deliveries queued yet'}</td></tr>)}</tbody></table></div>}
  </>}
 </section>;
}
