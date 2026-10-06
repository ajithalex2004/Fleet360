/** Render the production component in isolation; Playwright supplies synthetic HTTP responses. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { TripDisruptionPanel } from '@/components/bus-ops/trip-disruption-panel';
import DispatchPage from '@/app/(app)/bus-ops/dispatch/page';
import TripDetailPage from '@/app/(app)/bus-ops/trips/[id]/page';
import PassengerHomePage from '@/app/(app)/bus-ops/passenger/page';
import MobilePassengerApp from '@/app/(app)/bus-ops/passenger/app/page';
import './compiled.css';
const query=new URLSearchParams(location.search);
document.documentElement.classList.add(query.get('theme') ?? 'light');
createRoot(document.getElementById('root')!).render(<main style={{maxWidth:1100,margin:'24px auto',padding:16}}>
 {location.pathname==='/bus-ops/passenger/app'?<MobilePassengerApp/>:location.pathname==='/bus-ops/passenger'?<PassengerHomePage/>:location.pathname==='/bus-ops/dispatch'?<DispatchPage/>:location.pathname.startsWith('/bus-ops/trips/')?<TripDetailPage/>:<TripDisruptionPanel scheduleId="synthetic-trip" tripStatus={query.get('status') ?? 'STARTED'} onChanged={async()=>{document.body.dataset.refreshCount=String(Number(document.body.dataset.refreshCount ?? 0)+1);}}/>}
</main>);
