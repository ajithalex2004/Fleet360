'use client';

import React from 'react';
import Link from 'next/link';
import {
  Smartphone,
  Download,
  ExternalLink,
  ScanLine,
  Receipt,
  WifiOff,
  CheckCircle2,
} from 'lucide-react';
import { PageHeader, Panel } from '@/components/ui/page-theme';
import DriverTodayPage from '@/app/(driver)/driver-app/today/page';

export default function DrayageDriverMobileWorkspacePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Driver Mobile App & Android APK Hub"
        subtitle="Camera OCR Container & Bolt Seal Gate-Out Guard, Voice Note & Expense Receipt Upload to Driver Payments, and Port Dead-Zone Offline Queue Mode"
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
            <ScanLine className="w-4 h-4" />
            <span>1. Camera OCR Container &amp; Seal Gate-Out Guard</span>
          </div>
          <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
            Driver snaps a photo of the container door and bolt seal; Gemini Vision OCR verifies the characters match the assigned job&apos;s container/seal number before allowing gate-out.
          </p>
          <div className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Blocks mismatched container gate-out automatically</span>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-[var(--bg-surface)] border border-emerald-500/30 space-y-2">
          <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs">
            <Receipt className="w-4 h-4" />
            <span>2. Voice Note &amp; Expense Receipt Upload</span>
          </div>
          <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
            Drivers snap photos of physical port gate passes, weighbridge slips, or tire/toll receipts and record an audio Voice Note directly from the mobile app.
          </p>
          <div className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Auto-appears in Dispatcher&apos;s Driver Payments screen</span>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-[var(--bg-surface)] border border-amber-500/30 space-y-2">
          <div className="flex items-center gap-2 text-amber-400 font-bold text-xs">
            <WifiOff className="w-4 h-4" />
            <span>3. Port Dead-Zone Offline Queue Mode</span>
          </div>
          <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
            Caches active trip milestones, ePOD signatures, OCR scans, and expense receipts on the phone when inside port dead-zones and auto-syncs when signal returns.
          </p>
          <div className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Zero data loss inside Jebel Ali / Khalifa Port cranes</span>
          </div>
        </div>
      </div>

      {/* Live Interactive Driver Mobile App Simulator & Console */}
      <Panel
        title="Live Interactive Driver Mobile App (Embedded Handset View)"
        subtitle="Test Camera OCR Container/Seal verification, upload Expense Receipts & Voice Notes, or toggle Offline Queue Mode directly below"
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
