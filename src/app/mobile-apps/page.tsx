'use client';

import React from 'react';
import Link from 'next/link';
import {
  BusFront,
  UserRound,
  ScanLine,
  Wrench,
  Smartphone,
  ArrowRight,
  Apple,
  type LucideIcon,
} from 'lucide-react';

interface MobileApp {
  id: string;
  name: string;
  audience: string;
  description: string;
  href: string;
  icon: LucideIcon;
  gradient: string;
  ring: string;
  tag: string;
  module: string;
  capabilities: string[];
}

const APPS: MobileApp[] = [
  {
    id: 'sts-driver',
    name: 'Fleet360 STS Driver',
    audience: 'Staff Transport Drivers',
    description: 'On-the-road app for staff bus drivers. Today\'s trips, depart / arrive, passenger boarding manifest, pre-trip safety checklist, incident reporting.',
    href: '/bus-ops/driver',
    icon: BusFront,
    gradient: 'from-violet-600 to-purple-600',
    ring: 'ring-violet-500/40',
    tag: 'Staff Transport',
    module: 'bus-ops',
    capabilities: ['Today\'s trips', 'Pre-trip check', 'Boarding manifest', 'Incident report'],
  },
  {
    id: 'sts-passenger',
    name: 'Fleet360 STS Passenger',
    audience: 'Staff Riders',
    description: 'Companion app for staff riders. Today\'s bus, BLE / NFC / QR boarding, absence registration, waitlist join with auto-promotion notifications.',
    href: '/bus-ops/passenger',
    icon: UserRound,
    gradient: 'from-cyan-600 to-sky-600',
    ring: 'ring-cyan-500/40',
    tag: 'Staff Transport',
    module: 'bus-ops',
    capabilities: ['Multi-method check-in', 'Absence', 'Waitlist', 'ETA & stop'],
  },
  {
    id: 'rac-counter',
    name: 'Fleet360 RAC Counter',
    audience: 'Rental Counter Staff',
    description: 'Mobile counter for rental handover and return. Walkaround photos, mileage capture, e-signature, damage flagging.',
    href: '/rental/counter',
    icon: ScanLine,
    gradient: 'from-emerald-600 to-teal-600',
    ring: 'ring-emerald-500/40',
    tag: 'Rent-A-Car',
    module: 'rental',
    capabilities: ['Handover', 'Walkaround', 'E-sign', 'Return'],
  },
  {
    id: 'leasing-field',
    name: 'Fleet360 Leasing Field',
    audience: 'Leasing Field Operators',
    description: 'Mobile capture for leasing operations on the lot — mileage readings, fuel logs, traffic-fine entry. Posts to existing endpoints.',
    href: '/leasing/field',
    icon: Wrench,
    gradient: 'from-amber-600 to-orange-600',
    ring: 'ring-amber-500/40',
    tag: 'Leasing',
    module: 'leasing',
    capabilities: ['Mileage', 'Fuel', 'Traffic fine', 'Bulk capture'],
  },
];

export default function MobileAppsPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <header className="sticky top-0 z-10 backdrop-blur-md bg-slate-950/80 border-b border-white/5">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-fuchsia-600 to-pink-600 flex items-center justify-center shadow-lg shadow-fuchsia-500/30">
              <Smartphone className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-fuchsia-300/70">Mobile Apps Module</div>
              <h1 className="text-xl font-bold text-white">Fleet360 PWA Gallery</h1>
            </div>
          </div>
          <Link href="/platform" className="text-xs text-slate-400 hover:text-white">← Platform</Link>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        <section>
          <p className="text-slate-400 max-w-3xl text-sm leading-relaxed">
            Installable progressive web apps. Open the link on your phone, then tap "Add to Home Screen" — the app installs scope-locked to its role,
            works offline-cached, and is a single codebase across iOS and Android. No app-store submission, no native build pipeline, no separate auth realm.
          </p>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {APPS.map((app) => {
            const Icon = app.icon;
            return (
              <div
                key={app.id}
                className={`group relative overflow-hidden rounded-3xl bg-slate-900/60 border border-white/10 hover:ring-2 ${app.ring} transition-all`}
              >
                <div className={`absolute -top-20 -right-20 w-64 h-64 rounded-full bg-gradient-to-br ${app.gradient} opacity-10 group-hover:opacity-20 blur-3xl transition-opacity`} />
                <div className="relative p-6 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-4">
                      <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${app.gradient} flex items-center justify-center shadow-lg`}>
                        <Icon className="w-7 h-7 text-white" strokeWidth={1.75} />
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-slate-500">{app.tag}</div>
                        <h2 className="text-lg font-bold text-white">{app.name}</h2>
                        <p className="text-xs text-slate-400 mt-0.5">{app.audience}</p>
                      </div>
                    </div>
                  </div>

                  <p className="text-sm text-slate-300 leading-relaxed">{app.description}</p>

                  <div className="flex flex-wrap gap-1.5">
                    {app.capabilities.map((c) => (
                      <span key={c} className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-[10px] text-slate-300">
                        {c}
                      </span>
                    ))}
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-white/5">
                    <Link
                      href={app.href}
                      className={`flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r ${app.gradient} text-white text-sm font-semibold hover:opacity-90 transition-opacity`}
                    >
                      Open app <ArrowRight className="w-4 h-4" />
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </section>

        <section className="rounded-2xl bg-slate-900/40 border border-white/5 p-6 text-sm text-slate-400 space-y-3">
          <div className="flex items-center gap-2 text-white font-semibold">
            <Apple className="w-4 h-4" />
            iOS Add to Home Screen
          </div>
          <ol className="list-decimal pl-5 space-y-1 text-xs">
            <li>Open the app URL in <strong>Safari</strong> (Chrome on iOS won't trigger install).</li>
            <li>Tap the Share button → <strong>Add to Home Screen</strong>.</li>
            <li>The app launches standalone (no Safari chrome) from the home-screen icon.</li>
          </ol>
          <div className="border-t border-white/5 pt-3">
            <div className="text-white font-semibold text-xs mb-1">Android</div>
            <p className="text-xs">Chrome shows the install prompt automatically when the manifest is detected. Or use the menu → "Install app".</p>
          </div>
          <div className="border-t border-white/5 pt-3 text-xs italic">
            Web Bluetooth + Web NFC are <strong>Android-only</strong> (Chrome). iOS staff can still use QR + manual boarding methods.
          </div>
        </section>
      </main>
    </div>
  );
}
