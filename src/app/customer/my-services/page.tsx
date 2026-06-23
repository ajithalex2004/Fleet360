'use client';

import React, { useEffect, useState } from 'react';
import { CarFront, KeyRound, ListChecks, Route, SearchX } from 'lucide-react';

interface Service {
  id: string;
  type: string;
  status: 'active' | 'inactive' | 'pending';
  description: string;
  startDate?: string;
  endDate?: string;
  reference: string;
}

export default function MyServicesPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    fetch('/api/customer/services', { cache: 'no-store' })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (mounted) setServices(data?.services ?? []);
      })
      .catch(() => {
        if (mounted) setServices([]);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
  }, []);

  if (loading) {
    return <div className="h-44 animate-pulse rounded-lg bg-white/5" />;
  }

  const getStatusColor = (status: string) => {
    if (status === 'active') return 'bg-emerald-400/10 text-emerald-200 border-emerald-300/20';
    if (status === 'pending') return 'bg-amber-400/10 text-amber-200 border-amber-300/20';
    return 'bg-slate-400/10 text-slate-300 border-slate-300/20';
  };

  const getServiceIcon = (type: string) => {
    if (type.includes('Lease')) return KeyRound;
    if (type.includes('Rental')) return CarFront;
    if (type.includes('Shuttle') || type.includes('Transport')) return Route;
    return ListChecks;
  };

  return (
    <div className="space-y-5 pb-20 lg:pb-0">
      <div>
        <h1 className="text-2xl font-bold text-white">My Services</h1>
        <p className="mt-1 text-sm text-slate-400">Corporate agreements, entitlements, and active services</p>
      </div>

      <div className="grid gap-3">
        {services.length > 0 ? services.map((service) => {
          const Icon = getServiceIcon(service.type);
          return (
            <div key={service.id} className="rounded-lg border border-white/10 bg-slate-900/70 p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-cyan-300/10 text-cyan-200">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-white">{service.type}</p>
                      <p className="mt-1 text-sm text-slate-400">{service.description}</p>
                    </div>
                    <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${getStatusColor(service.status)}`}>
                      {service.status}
                    </span>
                  </div>
                  <p className="mt-3 text-xs font-mono text-slate-500">{service.reference}</p>
                  {service.startDate && (
                    <p className="mt-2 text-sm text-slate-400">
                      {new Date(service.startDate).toLocaleDateString()} - {service.endDate ? new Date(service.endDate).toLocaleDateString() : 'Ongoing'}
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        }) : (
          <div className="flex flex-col items-center justify-center rounded-lg border border-white/10 bg-slate-900/70 py-12 text-center">
            <SearchX className="mb-3 h-10 w-10 text-slate-500" />
            <p className="text-sm text-slate-400">No services available</p>
          </div>
        )}
      </div>
    </div>
  );
}
