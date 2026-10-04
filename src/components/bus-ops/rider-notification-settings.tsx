 'use client';
import { useEffect, useState } from 'react';
import { defaultRules, RIDER_CHANNELS, type RiderRule } from '@/lib/bus-ops/rider-notification-defaults';
type Delivery={id:string;event_type:string;channel:string;status:string;attempts:number;last_error:string|null};
export function RiderNotificationSettings() {
 const [rules,setRules]=useState<RiderRule[]>(defaultRules);
 const [deliveries,setDeliveries]=useState<Delivery[]>([]);
 const [message,setMessage]=useState('');
 const [busy,setBusy]=useState(false);
 const [loaded,setLoaded]=useState(false);
 async function load() {
  try { const response=await fetch('/api/bus-ops/rider-notifications',{cache:'no-store'}); const data=await response.json();
   if(!response.ok) throw new Error(data.error); setRules(data.rules);setDeliveries(data.deliveries);setLoaded(true);
  } catch(e) {setMessage(e instanceof Error ? e.message : 'Failed to load notifications');}
 }
 useEffect(()=>{void load();},[]);
 function patch(index:number,change:Partial<RiderRule>){setRules(current=>current.map((r,i)=>i===index?{...r,...change}:r));}
 async function save(rule:RiderRule){setBusy(true);setMessage('');try{
  const response=await fetch('/api/bus-ops/rider-notifications',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(rule)});
  const data=await response.json();if(!response.ok) throw new Error(data.error);setMessage('Rule saved. Applies to future events.');
 }catch(e){setMessage(e instanceof Error?e.message:'Failed to save');}finally{setBusy(false);}}
 async function retry(deliveryId:string){setBusy(true);try{
  const response=await fetch('/api/bus-ops/rider-notifications',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deliveryId})});
  const data=await response.json();if(!response.ok)throw new Error(data.error);await load();setMessage('Delivery queued for retry.');
 }catch(e){setMessage(e instanceof Error?e.message:'Retry failed');}finally{setBusy(false);}}
 return <section className="rounded-xl border p-5 space-y-4">
  <h2 className="text-xl font-semibold">Automatic rider notifications</h2>
  <p className="text-sm">Choose events and channels for this tenant. Messages use active passenger employee contacts. Rules start disabled. SENT means accepted by the provider; BLOCKED and UNCERTAIN require operator review.</p>
  {message && <p role="status">{message}</p>}
  {rules.map((rule,index)=><details key={rule.event_type} className="border rounded p-3">
   <summary>{rule.event_type} · {rule.enabled?'Enabled':'Disabled'}</summary>
   <div className="space-y-3 pt-3">
    <label className="flex gap-2"><input type="checkbox" checked={rule.enabled} onChange={e=>patch(index,{enabled:e.target.checked})}/>Enable this event</label>
    <div className="flex gap-4">{RIDER_CHANNELS.map(channel=><label key={channel} className="flex gap-2"><input type="checkbox" checked={rule.channels.includes(channel)} onChange={e=>patch(index,{channels:e.target.checked?[...rule.channels,channel]:rule.channels.filter(c=>c!==channel)})}/>{channel}</label>)}</div>
    <label className="block">Subject<input className="block border rounded w-full p-2" value={rule.subject} maxLength={200} onChange={e=>patch(index,{subject:e.target.value})}/></label>
    <label className="block">Message<textarea className="block border rounded w-full p-2" value={rule.body} maxLength={2000} onChange={e=>patch(index,{body:e.target.value})}/></label>
    <p className="text-xs">Placeholders: {'{{tripNumber}}, {{stopName}}, {{minutesToArrival}}, {{delayMinutes}}, {{reason}}, {{passengerName}}'}</p>
    <button type="button" disabled={busy || !loaded || !rule.channels.length} onClick={()=>void save(rule)} className="border rounded px-3 py-2 disabled:opacity-50">Save rule</button>
   </div>
  </details>)}
  <div className="flex justify-between"><h3 className="font-semibold">Recent delivery attempts</h3><button type="button" onClick={()=>void load()}>Refresh</button></div>
  <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{['Event','Channel','Status','Attempts','Reason','Action'].map(h=><th key={h} className="text-left p-2">{h}</th>)}</tr></thead><tbody>
   {deliveries.map(d=><tr key={d.id}><td className="p-2">{d.event_type}</td><td>{d.channel}</td><td>{d.status}</td><td>{d.attempts}</td><td>{d.last_error ?? '—'}</td><td>{['BLOCKED','FAILED'].includes(d.status) && <button type="button" disabled={busy} onClick={()=>void retry(d.id)}>Retry</button>}</td></tr>)}
  </tbody></table>{!deliveries.length && <p>No delivery attempts yet.</p>}</div>
 </section>;
}
