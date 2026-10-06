'use client';
import { useEffect,useState } from 'react';
import type { PassengerJourney } from '@/lib/bus-ops/passenger-journey';
const time=(iso:string)=>new Date(iso).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
export function PassengerJourneyPanel({passengerId}:{passengerId:string}) {
 const [data,setData]=useState<PassengerJourney|null>(null),[error,setError]=useState(''),[now,setNow]=useState(Date.now());
 useEffect(()=>{
  let disposed=false,timer:ReturnType<typeof setTimeout>|undefined,controller:AbortController|undefined;
  setData(null);setError('');
  async function poll(){
   controller=new AbortController();const timeout=setTimeout(()=>controller?.abort(),10000);
   try{
    const res=await fetch(`/api/bus-ops/passenger/journeys/${encodeURIComponent(passengerId)}`,{cache:'no-store',signal:controller.signal});
    if(!res.ok)throw new Error('Journey updates unavailable');
    const next=await res.json();if(!disposed){setData(next);setError('');setNow(Date.now());}
   }catch{if(!disposed)setError('Journey updates unavailable. Retrying…');}
   finally{clearTimeout(timeout);if(!disposed)timer=setTimeout(poll,15000);}
  }
  poll();const clock=setInterval(()=>setNow(Date.now()),5000);
  return ()=>{disposed=true;clearTimeout(timer);clearInterval(clock);controller?.abort();};
 },[passengerId]);
 const expired=Boolean(data && now-Date.parse(data.asOf)>30000);
 const gpsExpired=Boolean(data?.lastGpsAt && now-Date.parse(data.lastGpsAt)>120000);
 const usable=Boolean(data&&!error&&!expired);
 const live=usable && !gpsExpired && data?.state==='live';
 return <section aria-label="Passenger journey" className="space-y-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-sm text-[var(--text-main)]">
  <h4 className="font-semibold">Journey status</h4>
  {!data&&!error&&<p role="status">Loading journey status…</p>}
  {(error||expired)&&<p role="status" className="text-[var(--text-muted)]">{error||'Updates delayed. Refreshing…'}</p>}
  {usable&&data&&<>
   <p>{data.phase==='pickup'?'Pickup':'Drop-off'}: {data.target?.name ?? 'Stop unavailable'}</p>
   {live&&data.etaAt?<p>Live estimate: <strong>{time(data.etaAt)}</strong> · {data.confidence} confidence</p>:
    <p>{gpsExpired && ['live','near-stop'].includes(data.state)?'Location is out of date; live ETA is paused':data.reason}</p>}
   {data.plannedAt && !['terminal','not-travelling','stop-reached'].includes(data.state)&&<p className="text-xs text-[var(--text-muted)]">{data.revisedDestinationArrivalAt?'Original scheduled time':'Scheduled time'}: {time(data.plannedAt)}</p>}
   {data.revisedDestinationArrivalAt&&<p>Revised destination arrival: {time(data.revisedDestinationArrivalAt)}</p>}
   {data.lastGpsAt&&<p className="text-xs text-[var(--text-muted)]">Last GPS update: {time(data.lastGpsAt)}</p>}
   <p>{data.occupancy.onboard}{data.occupancy.capacity!=null?` / ${data.occupancy.capacity}`:''} recorded aboard · {data.occupancy.reserved} reserved</p>
   {data.occupancy.capacity==null?<p className="text-xs">Capacity unknown</p>:<p className="text-xs">{data.occupancy.seatsNotOccupied} seats not occupied{data.occupancy.overCapacity?' · Over recorded capacity':''}</p>}
   <p className="text-xs text-[var(--text-muted)]">Occupancy is based on recorded attendance, not a physical passenger count. Updated {time(data.asOf)}.</p>
  </>}
 </section>;
}
