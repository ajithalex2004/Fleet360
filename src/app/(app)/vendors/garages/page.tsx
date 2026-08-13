/**
 * Garage Management — owned by the Vendors module (Phase B migration from Maintenance).
 * Previously split across /maintenance/garage and /maintenance/data-masters/garages.
 */
'use client';

import { Building2, MapPin, Phone, Star } from 'lucide-react';

const MOCK_GARAGES = [
  { id: 'g1', name: 'Autopro Service Centre', location: 'Musaffah, Abu Dhabi', rating: 4.8, status: 'Active', specialisation: 'General', contact: '+971 2 555 0101' },
  { id: 'g2', name: 'ProFix Auto Workshop', location: 'Al Quoz, Dubai', rating: 4.5, status: 'Active', specialisation: 'Heavy Vehicles', contact: '+971 4 555 0202' },
  { id: 'g3', name: 'Gulf Motors Garage', location: 'Sharjah Industrial', rating: 4.2, status: 'Active', specialisation: 'Electrical', contact: '+971 6 555 0303' },
];

export default function VendorGaragesPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Garage Management</h1>
          <p className="mt-1 text-slate-500">Register and manage approved repair centres.</p>
        </div>
        <button className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          + Add Garage
        </button>
      </div>

      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
        <p className="text-sm text-amber-300">
          <span className="font-semibold">Domain ownership:</span> Garage master data is managed
          here. Previously split across{' '}
          <code className="rounded bg-slate-800 px-1 text-xs">/maintenance/garage</code> and{' '}
          <code className="rounded bg-slate-800 px-1 text-xs">/maintenance/data-masters/garages</code>.
          Maintenance retains a read-only view at{' '}
          <code className="rounded bg-slate-800 px-1 text-xs">/maintenance/garage-assignments</code>.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {MOCK_GARAGES.map(g => (
          <div key={g.id} className="rounded-xl border border-white/10 bg-slate-900 p-5 space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-white">{g.name}</h3>
                <div className="flex items-center gap-1 mt-1 text-xs text-slate-500">
                  <MapPin className="h-3 w-3" />
                  {g.location}
                </div>
              </div>
              <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-300">
                {g.status}
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-400 border-t border-white/5 pt-3">
              <span className="flex items-center gap-1">
                <Star className="h-3 w-3 text-yellow-400" />
                {g.rating}
              </span>
              <span>{g.specialisation}</span>
              <span className="flex items-center gap-1 ml-auto">
                <Phone className="h-3 w-3" />
                {g.contact}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
