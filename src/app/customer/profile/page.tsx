'use client';

import React, { useEffect, useState } from 'react';
import { Building2, CreditCard, Mail, MapPin, Phone, UserRound } from 'lucide-react';

interface UserProfile {
  name: string;
  customerName: string;
  email: string;
  phone: string;
  address: string;
  memberSince: string;
  totalBookings: number;
  preferredPayment: string;
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    fetch('/api/customer/profile', { cache: 'no-store' })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (mounted) setProfile(data);
      })
      .catch(() => {
        if (mounted) setProfile(null);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
  }, []);

  if (loading) {
    return <div className="h-56 animate-pulse rounded-lg bg-white/5" />;
  }

  if (!profile) {
    return (
      <div className="rounded-lg border border-white/10 bg-slate-900/70 p-6 text-sm text-slate-400">
        Profile is not available.
      </div>
    );
  }

  const fields = [
    { label: 'Email', value: profile.email || 'Not provided', icon: Mail },
    { label: 'Phone', value: profile.phone || 'Not provided', icon: Phone },
    { label: 'Address', value: profile.address || 'Not provided', icon: MapPin },
    { label: 'Billing', value: profile.preferredPayment || 'Corporate account', icon: CreditCard },
  ];

  return (
    <div className="space-y-5 pb-20 lg:pb-0">
      <div>
        <h1 className="text-2xl font-bold text-white">Profile</h1>
        <p className="mt-1 text-sm text-slate-400">Customer portal identity and account details</p>
      </div>

      <section className="rounded-lg border border-white/10 bg-slate-900/70 p-5">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-md bg-cyan-300/10 text-cyan-200">
              <UserRound className="h-8 w-8" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">{profile.name}</h2>
              <p className="mt-1 text-sm text-slate-400">Member since {new Date(profile.memberSince).getFullYear()}</p>
            </div>
          </div>
          <div className="rounded-md border border-white/10 bg-white/[0.03] px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Bookings</p>
            <p className="mt-1 text-2xl font-bold text-white">{profile.totalBookings}</p>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-white/10 bg-slate-900/70">
        <div className="flex items-center gap-3 border-b border-white/10 p-4">
          <Building2 className="h-5 w-5 text-cyan-200" />
          <div>
            <h2 className="font-bold text-white">{profile.customerName}</h2>
            <p className="text-sm text-slate-400">Corporate customer account</p>
          </div>
        </div>
        <div className="grid gap-0 sm:grid-cols-2">
          {fields.map((field) => {
            const Icon = field.icon;
            return (
              <div key={field.label} className="border-b border-white/10 p-4 sm:border-r">
                <div className="flex items-start gap-3">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{field.label}</p>
                    <p className="mt-1 break-words text-sm text-slate-200">{field.value}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
