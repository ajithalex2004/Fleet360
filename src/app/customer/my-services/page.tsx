'use client';

import React, { useState, useEffect } from 'react';

interface Service {
  id: string;
  type: string;
  status: 'active' | 'inactive' | 'pending';
  description: string;
  startDate?: string;
  endDate?: string;
}

export default function MyServicesPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchServices = async () => {
      try {
        setLoading(true);
        const res = await fetch('/api/customer/services');
        if (res.ok) {
          const data = await res.json();
          setServices(data.services || []);
        }
      } catch (error) {
        console.error('Error fetching services:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchServices();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    if (status === 'active') return 'bg-emerald-500/20 text-emerald-400';
    if (status === 'pending') return 'bg-amber-500/20 text-amber-400';
    return 'bg-slate-500/20 text-slate-300';
  };

  const getServiceIcon = (type: string) => {
    if (type.includes('Lease')) return '🔑';
    if (type.includes('Rental')) return '🚗';
    if (type.includes('Shuttle')) return '🚌';
    return '📋';
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-white">My Services</h1>

      <div className="space-y-3">
        {services.length > 0 ? (
          services.map((service) => (
            <div key={service.id} className="bg-slate-800/50 border border-white/10 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <span className="text-3xl">{getServiceIcon(service.type)}</span>
                <div className="flex-1">
                  <div className="flex items-start justify-between mb-2">
                    <p className="text-white font-semibold text-sm">{service.type}</p>
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${getStatusColor(service.status)}`}>
                      {service.status}
                    </span>
                  </div>
                  <p className="text-slate-400 text-xs mb-2">{service.description}</p>
                  {service.startDate && (
                    <p className="text-slate-500 text-xs">
                      {new Date(service.startDate).toLocaleDateString()} - {service.endDate ? new Date(service.endDate).toLocaleDateString() : 'Ongoing'}
                    </p>
                  )}
                  <button className="mt-2 text-blue-400 text-xs font-medium hover:text-blue-300">
                    View Details →
                  </button>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <span className="text-5xl mb-3">📭</span>
            <p className="text-slate-400 text-sm">No services available</p>
          </div>
        )}
      </div>
    </div>
  );
}
