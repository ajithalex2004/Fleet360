'use client';
import { useCallback,useEffect,useState } from 'react';
/** Operational passenger data must never live in a session-long URL-only cache. */
export function usePassengerToday<T>(employeeId='') {
 const [data,setData]=useState<T|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const [generation,setGeneration]=useState(0);
 const refresh=useCallback(()=>setGeneration(n=>n+1),[]);
 useEffect(()=>{
  let disposed=false,timer:ReturnType<typeof setTimeout>|undefined,controller:AbortController|undefined;
  async function poll(){
   controller=new AbortController();const timeout=setTimeout(()=>controller?.abort(),10000);
   try{const res=await fetch(`/api/bus-ops/passenger/today${employeeId?`?employeeId=${encodeURIComponent(employeeId)}`:''}`,{cache:'no-store',signal:controller.signal});const body=await res.json();if(!res.ok)throw new Error(body.error ?? 'Trips unavailable');if(!disposed){setData(body);setError('');}}
   catch(e){if(!disposed){setError(e instanceof Error?e.message:'Trips unavailable');setData(null);}}
   finally{clearTimeout(timeout);if(!disposed){setLoading(false);timer=setTimeout(poll,30000);}}
  }
  poll();return ()=>{disposed=true;clearTimeout(timer);controller?.abort();};
 },[generation,employeeId]);
 return {data,error,loading,refresh};
}
