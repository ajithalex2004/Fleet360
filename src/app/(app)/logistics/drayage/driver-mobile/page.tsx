'use client';

import React from 'react';
import Link from 'next/link';
import {
  Smartphone,
  Download,
  ExternalLink,
  Navigation,
  Clock,
  CheckCircle2,
  Truck,
} from 'lucide-react';
import { PageHeader, Panel } from '@/components/ui/page-theme';
import DriverTodayPage from '@/app/(driver)/driver-app/today/page';

export default function DrayageDriverMobileWorkspacePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="LogiXL-Connect Driver App & Android APK Hub"
        subtitle="Simplest Port & Container Drayage Driver Experience — My Jobs (Active Jobs & History), Single Next-Action L1/L2/Reassign Workflow, 1-Tap Ramp Offload ETC (1/2/3/4 Hrs), and Turn-by-Turn Google Maps Navigation"
        icon={Smartphone}
        accent="blue"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <a
              href="/Fleet360-Driver.apk"
              download="Fleet360-Driver.apk"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold shadow-sm transition-colors"
            >
              <Download className="w-4 h-4" />
              <span>Download Android APK (Fleet360-Driver.apk)</span>
            </a>
            <Link
              href="/driver-app/today"
              target="_blank"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-bold text-[var(--text-main)] hover:border-blue-500/40 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5 text-blue-400" />
              <span>Open Standalone Driver App (/driver-app/today)</span>
            </Link>
          </div>
        }
      />

      {/* Feature Highlights Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 rounded-2xl bg-[var(--bg-surface)] border border-sky-500/30 space-y-2">
          <div className="flex items-center gap-2 text-sky-400 font-bold text-xs">
            <Truck className="w-4 h-4" />
            <span>1. Single Next-Action L1 / L2 / Reassign Workflow</span>
          </div>
          <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
            Zero clutter or pre-trip checklists — shows only the current status badge and the single next action button (Accept Job, Attach Trailer, Placed @ Yard / Placed @ Ramp, Detach Trailer).
          </p>
          <div className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Exact LogiXL-Connect 1-tap state progression</span>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-[var(--bg-surface)] border border-emerald-500/30 space-y-2">
          <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs">
            <Clock className="w-4 h-4" />
            <span>2. 1-Tap Ramp Offload ETC &amp; Inspection Photo</span>
          </div>
          <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
            When placing a container at a warehouse ramp, drivers select estimated offload duration (1 / 2 / 3 / 4 Hours) in one tap, or attach inspection photos during Under Inspection.
          </p>
          <div className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Syncs live to Dispatcher Control Tower</span>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-[var(--bg-surface)] border border-amber-500/30 space-y-2">
          <div className="flex items-center gap-2 text-amber-400 font-bold text-xs">
            <Navigation className="w-4 h-4" />
            <span>3. Direct Turn-by-Turn Google Maps Navigation</span>
          </div>
          <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
            Every job card and detail screen includes 1-tap Pickup and Dropoff Navigate buttons that launch native Google Maps turn-by-turn directions to the exact port gate or warehouse.
          </p>
          <div className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Works in Web Browser &amp; Native Android APK</span>
          </div>
        </div>
      </div>

      {/* Live Interactive Driver Mobile App Simulator & Console */}
      <Panel
        title="LogiXL-Connect Driver Mobile App (Live Interactive Handset View)"
        subtitle="My Jobs (Active Jobs & History) with Single Next-Action Button, Highlighted Trailer Box, and Turn-by-Turn Google Maps Navigation"
        icon={Smartphone}
        accent="blue"
      >
        <div className="max-w-lg mx-auto rounded-3xl overflow-hidden border-4 border-slate-700 shadow-2xl">
          <DriverTodayPage />
        </div>
      </Panel>
    </div>
  );
}
