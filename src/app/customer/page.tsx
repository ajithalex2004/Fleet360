'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Building2, CalendarPlus, CarFront, Headphones, Route, ShieldCheck } from 'lucide-react';

interface ActiveService {
  id: string;
  type: string;
  reference: string;
  status: string;
}

interface CustomerData {
  name: string;
  customerName: string;
  totalBookings: number;
  activeServices: ActiveService[];
}

export default function CustomerHome() {
  const [customerData, setCustomerData] = useState<CustomerData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    fetch('/api/customer/profile', { cache: 'no-store' })
      .then(res => res.ok ? res.json() : null)
      .then(async (data) => {
        if (!mounted) return;
        if (data) {
          setCustomerData(data);
          return;
        }
        const identity = await fetch('/api/customer/identity', { cache: 'no-store' })
          .then(res => res.ok ? res.json() : null)
          .catch(() => null);
        const customer = identity?.customer;
        setCustomerData(customer ? {
          name: customer.customerName,
          customerName: customer.customerName,
          totalBookings: 0,
          activeServices: [{
            id: customer.customerId,
            type: 'Corporate Transport Account',
            reference: customer.domain || 'Corporate customer',
            status: 'active',
          }],
        } : null);
      })
      .catch(() => {
        if (mounted) setCustomerData(null);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
  }, []);

  if (loading) {
    return (
      <div className="grid gap-4">
        <div className="h-36 animate-pulse rounded-lg bg-white/5" />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="h-28 animate-pulse rounded-lg bg-white/5" />
          <div className="h-28 animate-pulse rounded-lg bg-white/5" />
        </div>
      </div>
    );
  }

  const quickActions = [
    { label: 'Bookings', href: '/customer/my-bookings', detail: 'Reservations and trip status', icon: CalendarPlus },
    { label: 'Services', href: '/customer/my-services', detail: 'Active agreements and entitlements', icon: CarFront },
    { label: 'Transport', href: '/customer/transport', detail: 'Corporate shuttle schedules', icon: Route },
    { label: 'Support', href: '/customer/profile', detail: 'Contacts and account details', icon: Headphones },
  ];

  return (
    <div className="space-y-6 pb-20 lg:pb-0">
      <section className="overflow-hidden rounded-lg border border-white/10 bg-gradient-to-br from-slate-900 via-[#102033] to-[#082126] p-6 sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-md border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs font-semibold text-cyan-100">
              <Building2 className="h-4 w-4" />
              {customerData?.customerName ?? 'Corporate Portal'}
            </div>
            <h1 className="text-3xl font-bold tracking-normal text-white sm:text-4xl">
              Welcome, {customerData?.name ?? 'Customer'}
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300">
              Your corporate mobility account is ready for bookings, services, transport updates, and support.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:min-w-[280px]">
            <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Bookings</p>
              <p className="mt-2 text-3xl font-bold text-white">{customerData?.totalBookings ?? 0}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Services</p>
              <p className="mt-2 text-3xl font-bold text-white">{customerData?.activeServices?.length ?? 0}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {quickActions.map((action) => {
          const Icon = action.icon;
          return (
            <Link
              key={action.href}
              href={action.href}
              className="group rounded-lg border border-white/10 bg-slate-900/70 p-4 transition hover:border-cyan-300/40 hover:bg-slate-900"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-md bg-cyan-300/10 text-cyan-200">
                  <Icon className="h-5 w-5" />
                </div>
                <ArrowRight className="h-4 w-4 text-slate-500 transition group-hover:translate-x-0.5 group-hover:text-cyan-200" />
              </div>
              <p className="mt-4 text-base font-bold text-white">{action.label}</p>
              <p className="mt-1 text-sm leading-5 text-slate-400">{action.detail}</p>
            </Link>
          );
        })}
      </section>

      <section className="rounded-lg border border-white/10 bg-slate-900/70">
        <div className="flex items-center justify-between border-b border-white/10 p-4">
          <div>
            <h2 className="text-lg font-bold text-white">Active Services</h2>
            <p className="text-sm text-slate-400">Linked to your corporate customer account</p>
          </div>
          <ShieldCheck className="h-5 w-5 text-emerald-300" />
        </div>
        <div className="divide-y divide-white/10">
          {customerData?.activeServices?.length ? customerData.activeServices.map((service) => (
            <div key={service.id} className="flex items-center justify-between gap-4 p-4">
              <div>
                <p className="font-semibold text-white">{service.type}</p>
                <p className="mt-1 text-sm text-slate-400">{service.reference}</p>
              </div>
              <span className="rounded-md border border-emerald-300/20 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-200">
                {service.status}
              </span>
            </div>
          )) : (
            <div className="p-6 text-sm text-slate-400">No active services found.</div>
          )}
        </div>
      </section>
    </div>
  );
}
