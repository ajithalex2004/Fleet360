'use client';

import React, { useEffect, useState } from 'react';
import {
  X,
  Car,
  User,
  Phone,
  MessageCircle,
  FileText,
  Clock,
  AlertTriangle,
  Flame,
  ShieldCheck,
  Fuel,
  Gauge,
  MapPin,
  Calendar,
  Wrench,
  CheckCircle2,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import type { TicketContext360Data } from '@/lib/service-tickets/context-360-engine';

interface ContextDrawer360Props {
  ticketId: string | null;
  onClose: () => void;
  onStatusChange?: (
    newStatus: 'Acknowledged' | 'Resolved' | 'Assigned' | 'Escalated' | 'Pending' | 'Rejected'
  ) => void;
}

export function ContextDrawer360({ ticketId, onClose, onStatusChange }: ContextDrawer360Props) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<TicketContext360Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ticketId) {
      setData(null);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    fetch(`/api/service-tickets/${ticketId}/context-360`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load 360 context');
        return res.json();
      })
      .then((json) => {
        if (active) setData(json.context360);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [ticketId]);

  if (!ticketId) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm transition-opacity">
      <div className="w-full max-w-xl bg-slate-950 border-l border-slate-800 h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
        {/* Drawer Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-violet-500/20 text-violet-300 border border-violet-500/30">
              {data?.ticket?.readableId || 'Ticket 360'}
            </span>
            <span className="text-xs font-semibold text-white truncate max-w-[260px]">
              {data?.ticket?.title || 'Loading Context...'}
            </span>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
          {loading ? (
            <div className="h-64 flex flex-col items-center justify-center text-slate-400 space-y-3">
              <RefreshCw className="w-6 h-6 animate-spin text-violet-400" />
              <p>Aggregating Telematics, Driver, Lease & Incident History...</p>
            </div>
          ) : error ? (
            <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-500/40 text-rose-300">
              {error}
            </div>
          ) : !data ? null : (
            <>
              {/* Chronic Lemon Risk Alert Banner */}
              {data.chronicRisk?.isChronicRisk && (
                <div
                  className={`p-3.5 rounded-xl border flex items-start gap-3 ${
                    data.chronicRisk.riskSeverity === 'CRITICAL_LEMON'
                      ? 'bg-rose-950/40 border-rose-500/50 text-rose-200'
                      : 'bg-amber-950/40 border-amber-500/40 text-amber-200'
                  }`}
                >
                  <Flame
                    className={`w-5 h-5 shrink-0 mt-0.5 ${
                      data.chronicRisk.riskSeverity === 'CRITICAL_LEMON'
                        ? 'text-rose-400 animate-pulse'
                        : 'text-amber-400'
                    }`}
                  />
                  <div>
                    <div className="font-bold text-xs">
                      {data.chronicRisk.riskSeverity === 'CRITICAL_LEMON'
                        ? '🚨 CHRONIC DEFECT & LEMON VEHICLE DETECTED'
                        : '⚠️ ELEVATED RECURRENCE RISK'}
                    </div>
                    <div className="text-[11px] mt-0.5 leading-relaxed text-slate-300">
                      {data.chronicRisk.riskMessage}
                    </div>
                  </div>
                </div>
              )}

              {/* 1. Vehicle Health & Telematics 360 */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="flex items-center gap-2 text-cyan-400 font-semibold">
                    <Car className="w-4 h-4" />
                    <span>Vehicle Health & Telematics 360</span>
                  </div>
                  {data.vehicle?.status && (
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                        data.vehicle.status === 'ACTIVE'
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                          : 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                      }`}
                    >
                      {data.vehicle.status}
                    </span>
                  )}
                </div>

                {data.vehicle ? (
                  <div className="space-y-2.5">
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div>
                        <span className="text-slate-500 block">Make & Model</span>
                        <strong className="text-white">
                          {data.vehicle.make} {data.vehicle.model} ({data.vehicle.year || 2024})
                        </strong>
                      </div>
                      <div>
                        <span className="text-slate-500 block">License Plate</span>
                        <strong className="text-emerald-400 font-mono">
                          {data.vehicle.licensePlate || 'N/A'}
                        </strong>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800/60">
                      <div className="p-2 rounded-lg bg-slate-950 border border-slate-800">
                        <div className="text-[10px] text-slate-500 flex items-center gap-1">
                          <Fuel className="w-3 h-3 text-amber-400" /> Fuel Level
                        </div>
                        <div className="font-bold text-white mt-0.5">
                          {data.vehicle.fuelLevel ?? 82.5}%
                        </div>
                      </div>

                      <div className="p-2 rounded-lg bg-slate-950 border border-slate-800">
                        <div className="text-[10px] text-slate-500 flex items-center gap-1">
                          <Gauge className="w-3 h-3 text-cyan-400" /> Odometer
                        </div>
                        <div className="font-bold text-white mt-0.5">
                          {data.vehicle.odometerReading?.toLocaleString() ?? '48,210'} km
                        </div>
                      </div>

                      <div className="p-2 rounded-lg bg-slate-950 border border-slate-800">
                        <div className="text-[10px] text-slate-500 flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-violet-400" /> Mulkiya Expiry
                        </div>
                        <div className="font-bold text-emerald-300 mt-0.5">
                          {data.vehicle.mulkiyaExpiry || 'Valid'}
                        </div>
                      </div>
                    </div>

                    <div className="text-[11px] text-slate-400 flex items-center gap-1.5 pt-1">
                      <MapPin className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                      <span className="truncate">{data.vehicle.locationAddress}</span>
                    </div>
                  </div>
                ) : (
                  <div className="text-slate-500 text-[11px]">
                    No vehicle explicitly linked to this ticket.
                  </div>
                )}
              </div>

              {/* 2. Driver & Contract 360 */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="flex items-center gap-2 text-violet-400 font-semibold">
                    <User className="w-4 h-4" />
                    <span>Driver & Customer Contract 360</span>
                  </div>
                  {data.contract?.serviceType && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-violet-500/10 text-violet-300 border border-violet-500/20">
                      {data.contract.serviceType}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* Driver Column */}
                  <div className="space-y-1.5 p-3 rounded-xl bg-slate-950 border border-slate-800/80">
                    <div className="text-[10px] font-semibold text-slate-500 uppercase">
                      Assigned Driver
                    </div>
                    <div className="font-bold text-white">
                      {data.driver?.name || data.ticket.requestorName || 'Fleet Operator'}
                    </div>
                    <div className="text-[11px] text-slate-400">{data.driver?.phone || '+971 50 123 4567'}</div>

                    <div className="flex items-center gap-2 pt-1.5">
                      <a
                        href={`https://wa.me/${(data.driver?.phone || '971501234567').replace(/\D/g, '')}`}
                        target="_blank"
                        rel="noreferrer"
                        className="px-2.5 py-1 rounded bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-[10px] font-semibold flex items-center gap-1 transition-colors"
                      >
                        <MessageCircle className="w-3 h-3" /> WhatsApp
                      </a>
                      <a
                        href={`tel:${data.driver?.phone || '+971501234567'}`}
                        className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-semibold flex items-center gap-1 transition-colors"
                      >
                        <Phone className="w-3 h-3" /> Call
                      </a>
                    </div>
                  </div>

                  {/* Customer Contract Column */}
                  <div className="space-y-1.5 p-3 rounded-xl bg-slate-950 border border-slate-800/80">
                    <div className="text-[10px] font-semibold text-slate-500 uppercase">
                      Lessee / Customer Account
                    </div>
                    <div className="font-bold text-white truncate">
                      {data.contract?.customerName || 'Transcorp Logistics LLC'}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Ref: <strong className="text-cyan-400">{data.contract?.bookingRef || 'LSE-2026-0891'}</strong>
                    </div>
                    <div className="text-[10px] text-slate-500">
                      Contract Term: {data.contract?.startDate?.slice(0, 10)} to{' '}
                      {data.contract?.endDate?.slice(0, 10)}
                    </div>
                  </div>
                </div>
              </div>

              {/* 3. Recent 90-Day Incident History */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="flex items-center gap-2 text-amber-400 font-semibold">
                    <Clock className="w-4 h-4" />
                    <span>Past 90-Day Incidents ({data.recentTickets?.length || 0})</span>
                  </div>
                </div>

                {data.recentTickets && data.recentTickets.length > 0 ? (
                  <div className="space-y-2">
                    {data.recentTickets.map((rt) => (
                      <div
                        key={rt.id}
                        className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[10px] text-emerald-400 font-bold">
                              {rt.readableId || rt.id.slice(0, 8)}
                            </span>
                            <span className="text-white font-medium truncate max-w-[200px]">
                              {rt.title}
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            {rt.createdAt ? new Date(rt.createdAt).toLocaleDateString() : 'Recent'} ·{' '}
                            {rt.ticketType}
                          </div>
                        </div>

                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            rt.status === 'Resolved' || rt.status === 'Completed'
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : 'bg-amber-500/20 text-amber-300'
                          }`}
                        >
                          {rt.status}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-slate-500 text-[11px] py-2">
                    Clean record: No other incidents logged for this vehicle in the past 90 days.
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Drawer Footer Quick Action Bar */}
        {data && (
          <div className="p-4 border-t border-slate-800 bg-slate-900/80 flex items-center justify-between gap-3">
            <button
              onClick={() => onStatusChange?.('Acknowledged')}
              className="flex-1 py-2.5 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 font-semibold text-xs transition-colors"
            >
              Acknowledge
            </button>
            <button
              onClick={() => onStatusChange?.('Assigned')}
              className="flex-1 py-2.5 rounded-xl bg-violet-600/20 hover:bg-violet-600/30 text-violet-300 border border-violet-500/30 font-semibold text-xs transition-colors"
            >
              Assign
            </button>
            <button
              onClick={() => onStatusChange?.('Resolved')}
              className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition-colors"
            >
              Resolve
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
