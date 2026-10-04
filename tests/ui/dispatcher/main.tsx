/** Render the production component in isolation; Playwright supplies synthetic HTTP responses. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { TripDisruptionPanel } from '@/components/bus-ops/trip-disruption-panel';
import './compiled.css';
const query=new URLSearchParams(location.search);
document.documentElement.classList.add(query.get('theme') ?? 'light');
createRoot(document.getElementById('root')!).render(<main style={{maxWidth:1100,margin:'24px auto',padding:16}}>
 <TripDisruptionPanel scheduleId="synthetic-trip" tripStatus={query.get('status') ?? 'STARTED'} onChanged={async()=>{document.body.dataset.refreshCount=String(Number(document.body.dataset.refreshCount ?? 0)+1);}}/>
</main>);
