'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';

interface ActiveService {
  id: string;
  type: string;
  reference: string;
  status: string;
}

interface CustomerData {
  name: string;
  activeServices: ActiveService[];
}

export default function CustomerHome() {
  const [customerData, setCustomerData] = useState<CustomerData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const res = await fetch('/api/customer/profile');
        if (res.ok) {
          const data = await res.json();
          setCustomerData(data);
        }
      } catch (error) {
        console.error('Error fetching customer data:', error);
        setCustomerData({ name: 'User', activeServices: [] });
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Welcome Banner */}
      <div className="bg-gradient-to-br from-blue-600 to-indigo-600 rounded-2xl p-6 text-white">
        <h1 className="text-2xl font-bold mb-1">Hello, {customerData?.name || 'User'}!</h1>
        <p className="text-blue-100 text-sm">Welcome back to your transport dashboard</p>
      </div>

      {/* Quick Action Cards */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-300 px-2">Quick Actions</h2>

        <Link href="/customer/my-bookings">
          <div className="bg-slate-800/50 border border-white/10 rounded-xl p-4 active:bg-slate-700/50 transition-all cursor-pointer">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🚗</span>
              <div className="flex-1">
                <p className="text-white font-medium text-sm">Book a Car</p>
                <p className="text-slate-400 text-xs">Reserve a vehicle</p>
              </div>
              <span className="text-slate-400">→</span>
            </div>
          </div>
        </Link>

        <Link href="/customer/my-services">
          <div className="bg-slate-800/50 border border-white/10 rounded-xl p-4 active:bg-slate-700/50 transition-all cursor-pointer">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🔑</span>
              <div className="flex-1">
                <p className="text-white font-medium text-sm">My Lease</p>
                <p className="text-slate-400 text-xs">View leasing details</p>
              </div>
              <span className="text-slate-400">→</span>
            </div>
          </div>
        </Link>

        <Link href="/customer/transport">
          <div className="bg-slate-800/50 border border-white/10 rounded-xl p-4 active:bg-slate-700/50 transition-all cursor-pointer">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🚌</span>
              <div className="flex-1">
                <p className="text-white font-medium text-sm">My Shuttle</p>
                <p className="text-slate-400 text-xs">Staff transport schedule</p>
              </div>
              <span className="text-slate-400">→</span>
            </div>
          </div>
        </Link>

        <div className="bg-slate-800/50 border border-white/10 rounded-xl p-4 cursor-pointer hover:bg-slate-700/50 transition-all">
          <div className="flex items-center gap-3">
            <span className="text-2xl">💬</span>
            <div className="flex-1">
              <p className="text-white font-medium text-sm">Contact Support</p>
              <p className="text-slate-400 text-xs">Get help anytime</p>
            </div>
            <span className="text-slate-400">→</span>
          </div>
        </div>
      </div>

      {/* Active Services */}
      {customerData?.activeServices && customerData.activeServices.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-300 px-2">Active Services</h2>
          {customerData.activeServices.map((service) => (
            <div key={service.id} className="bg-slate-800/50 border border-white/10 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-white font-medium text-sm">{service.type}</p>
                <span className="text-xs px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  {service.status}
                </span>
              </div>
              <p className="text-slate-400 text-xs">{service.reference}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
