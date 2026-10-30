'use client';

import React, { useState, useEffect } from 'react';
import { VehicleRef, DriverRef } from '@/components/ui/EntityRef';
import {
  MoreVertical,
  ClipboardCheck,
  ShieldAlert,
  ShieldCheck,
  X,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Gauge,
  User,
  Car,
} from 'lucide-react';

interface Shift {
  id: string;
  driverId: string;
  vehicleId: string | null;
  shiftDate: string;
  startTime: string;
  endTime: string | null;
  totalHours: number | null;
  status: string | null;
  checklist?: Record<string, { ok: boolean | null; note?: string }> | null;
  checklistSignedAt?: string | null;
  checklistSignatureSvg?: string | null;
  startOdometer?: number | null;
  endOdometer?: number | null;
  notes?: string | null;
  driverName?: string | null;
  driverCode?: string | null;
  vehiclePlate?: string | null;
  vehicleCode?: string | null;
}

const CHECKLIST_LABELS: Record<string, { label: string; category: string }> = {
  tyres_tread:          { label: 'Tyre tread depth OK',                category: 'Tyres & Wheels' },
  tyres_pressure:       { label: 'Tyre pressure OK',                  category: 'Tyres & Wheels' },
  brakes_service:       { label: 'Service brake responsive',          category: 'Brakes' },
  brakes_park:          { label: 'Park brake holds',                  category: 'Brakes' },
  lights_head:          { label: 'Headlights working',                category: 'Lights' },
  lights_tail:          { label: 'Tail / brake lights working',       category: 'Lights' },
  lights_indicators:    { label: 'Indicators / hazards working',     category: 'Lights' },
  safety_triangle:      { label: 'Warning triangle in vehicle',       category: 'Safety Equipment' },
  safety_extinguisher:  { label: 'Fire extinguisher inspected',       category: 'Safety Equipment' },
  safety_seatbelts:     { label: 'All seatbelts functional',         category: 'Safety Equipment' },
  safety_first_aid:     { label: 'First aid kit complete',            category: 'Safety Equipment' },
  docs_insurance:       { label: 'Vehicle insurance valid',           category: 'Documents' },
  docs_registration:    { label: 'Registration (Mulkia) valid',       category: 'Documents' },
  fluids_oil:           { label: 'Engine oil level OK',               category: 'Fluids & Engine' },
  fluids_coolant:       { label: 'Coolant level OK',                  category: 'Fluids & Engine' },
  fluids_washer:        { label: 'Washer fluid filled',               category: 'Fluids & Engine' },
  cabin_clean:          { label: 'Cabin clean (no hazards)',          category: 'Cabin' },
  cabin_mirror:         { label: 'Mirrors adjusted and clean',       category: 'Cabin' },
};

export default function ShiftManagement() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [activeActionMenuId, setActiveActionMenuId] = useState<string | null>(null);
  const [selectedChecklistShift, setSelectedChecklistShift] = useState<Shift | null>(null);

  const [formData, setFormData] = useState({
    driverId: '',
    shiftDate: '',
    startTime: '',
    endTime: '',
    vehicleId: '',
    notes: '',
  });

  useEffect(() => {
    fetchShifts();
  }, []);

  // Close 3-dot dropdown menu when clicking anywhere outside
  useEffect(() => {
    const handleOutsideClick = () => setActiveActionMenuId(null);
    window.addEventListener('click', handleOutsideClick);
    return () => window.removeEventListener('click', handleOutsideClick);
  }, []);

  const fetchShifts = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetch('/api/drivers/shifts');
      if (!res.ok) throw new Error('Failed to fetch shifts');
      const json = await res.json();
      setShifts(Array.isArray(json?.data) ? json.data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load shifts');
    } finally {
      setLoading(false);
    }
  };

  const filteredShifts = shifts.filter((shift) => {
    const shiftDate = new Date(shift.shiftDate);
    const matchesStart = !filterStartDate || shiftDate >= new Date(filterStartDate);
    const matchesEnd = !filterEndDate || shiftDate <= new Date(filterEndDate);
    return matchesStart && matchesEnd;
  });

  const handleAddShift = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        driverId:  formData.driverId,
        vehicleId: formData.vehicleId || undefined,
        shiftDate: new Date(formData.shiftDate).toISOString(),
        startTime: new Date(`${formData.shiftDate}T${formData.startTime}`).toISOString(),
        endTime:   formData.endTime ? new Date(`${formData.shiftDate}T${formData.endTime}`).toISOString() : undefined,
        notes:     formData.notes || undefined,
      };
      const res = await fetch('/api/drivers/shifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to add shift');
      setShowModal(false);
      setFormData({ driverId: '', shiftDate: '', startTime: '', endTime: '', vehicleId: '', notes: '' });
      fetchShifts();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to add shift');
    }
  };

  const getStatusColor = (status: string | null) => {
    switch (status) {
      case 'SCHEDULED':
        return 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30';
      case 'ACTIVE':
        return 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 animate-pulse';
      case 'COMPLETED':
      case 'CLOSED':
        return 'bg-slate-500/20 text-[var(--text-muted)] border border-slate-500/30';
      case 'ABSENT':
        return 'bg-red-500/20 text-red-400 border border-red-500/30';
      default:
        return 'bg-slate-500/20 text-[var(--text-muted)] border border-slate-500/30';
    }
  };

  const fmtTime = (iso: string | null) =>
    iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—';

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[200px]">
        <div className="animate-spin">
          <div className="w-12 h-12 border-4 border-[var(--border-strong)] border-t-cyan-500 rounded-full"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-6 text-red-400">
        <p className="font-medium">Error loading shifts</p>
        <p className="text-sm mt-1">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-main)]">Shift Management</h1>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Monitor real-time active shifts, driver duty hours, and pre-trip safety checklists
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="rounded-xl bg-gradient-to-r from-cyan-600 to-teal-600 px-6 py-3 text-sm font-semibold text-white hover:shadow-lg hover:shadow-cyan-500/20 transition-all active:scale-95"
        >
          + New Shift
        </button>
      </div>

      {/* Date Range Filter */}
      <div className="flex gap-4">
        <div className="flex-1">
          <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Start Date</label>
          <input
            type="date"
            value={filterStartDate}
            onChange={(e) => setFilterStartDate(e.target.value)}
            className="w-full bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-xl px-4 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:ring-2 focus:ring-cyan-500"
          />
        </div>
        <div className="flex-1">
          <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">End Date</label>
          <input
            type="date"
            value={filterEndDate}
            onChange={(e) => setFilterEndDate(e.target.value)}
            className="w-full bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-xl px-4 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:ring-2 focus:ring-cyan-500"
          />
        </div>
      </div>

      {/* Shifts Table */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-6 overflow-hidden">
        {filteredShifts.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">⏰</div>
            <p className="text-[var(--text-muted)]">No shifts scheduled or recorded</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-[var(--bg-surface-hover)]">
                <tr className="border-b border-[var(--border-subtle)]">
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Driver</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Vehicle</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Shift Date</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Start Time</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">End Time</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Total Hours</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">Driver Checklist</th>
                  <th className="px-6 py-3 text-right text-xs font-semibold text-[var(--text-muted)]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredShifts.map((shift) => {
                  const checklistEntries = shift.checklist ? Object.entries(shift.checklist) : [];
                  const hasChecklist = checklistEntries.length > 0;
                  const failedCount = checklistEntries.filter(([, v]) => v?.ok === false).length;

                  return (
                    <tr key={shift.id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)] transition-colors">
                      <td className="px-6 py-4 text-sm text-[var(--text-main)] font-medium">
                        <div className="flex items-center gap-2">
                          <DriverRef id={shift.driverId} />
                          {shift.driverCode && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-700/40 text-slate-300">
                              {shift.driverCode}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-[var(--text-muted)]">
                        <div className="flex items-center gap-2">
                          <VehicleRef id={shift.vehicleId} />
                          {shift.vehiclePlate && (
                            <span className="text-xs font-bold text-slate-200">
                              {shift.vehiclePlate}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-[var(--text-muted)]">{new Date(shift.shiftDate).toLocaleDateString()}</td>
                      <td className="px-6 py-4 text-sm text-[var(--text-muted)]">{fmtTime(shift.startTime)}</td>
                      <td className="px-6 py-4 text-sm text-[var(--text-muted)]">{fmtTime(shift.endTime)}</td>
                      <td className="px-6 py-4 text-sm text-[var(--text-muted)]">{shift.totalHours != null ? `${shift.totalHours.toFixed(1)} hrs` : '—'}</td>
                      <td className="px-6 py-4 text-sm">
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(shift.status)}`}>
                          {shift.status ?? 'UNKNOWN'}
                        </span>
                      </td>

                      {/* Driver Checklist Badge */}
                      <td className="px-6 py-4 text-sm">
                        {hasChecklist ? (
                          <button
                            type="button"
                            onClick={() => setSelectedChecklistShift(shift)}
                            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border transition active:scale-95 ${
                              failedCount === 0
                                ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/25'
                                : 'bg-rose-500/15 text-rose-400 border-rose-500/30 hover:bg-rose-500/25'
                            }`}
                            title="Click to view full inspection checklist"
                          >
                            {failedCount === 0 ? (
                              <>
                                <ShieldCheck className="w-3.5 h-3.5" />
                                <span>✓ {checklistEntries.length} Passed</span>
                              </>
                            ) : (
                              <>
                                <ShieldAlert className="w-3.5 h-3.5" />
                                <span>{failedCount} Issue{failedCount > 1 ? 's' : ''} Flagged</span>
                              </>
                            )}
                          </button>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs text-[var(--text-muted)] bg-slate-500/10 border border-slate-500/20">
                            — Not Submitted
                          </span>
                        )}
                      </td>

                      {/* 3-Dot Action Menu */}
                      <td className="px-6 py-4 text-sm text-right relative">
                        <div className="inline-block text-left">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveActionMenuId(activeActionMenuId === shift.id ? null : shift.id);
                            }}
                            className={`p-2 rounded-xl transition border ${
                              activeActionMenuId === shift.id
                                ? 'bg-cyan-500 text-white border-cyan-400 shadow-md shadow-cyan-500/20'
                                : 'bg-[var(--bg-canvas)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-muted)] hover:text-[var(--text-main)] border-[var(--border-subtle)]'
                            }`}
                            title="Shift Actions"
                          >
                            <MoreVertical className="w-4 h-4" />
                          </button>

                          {activeActionMenuId === shift.id && (
                            <div
                              className="absolute right-0 mt-2 w-56 rounded-2xl bg-white dark:bg-slate-900 border-2 border-slate-300 dark:border-slate-700 shadow-2xl shadow-slate-900/30 z-50 py-1.5 text-left divide-y divide-slate-200 dark:divide-slate-800 animate-in fade-in zoom-in-95 duration-100"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="px-4 py-2 bg-slate-100 dark:bg-slate-800/80">
                                <div className="text-[10px] uppercase font-black tracking-wider text-cyan-600 dark:text-cyan-400">
                                  Shift Options
                                </div>
                                <div className="text-xs font-bold text-slate-950 dark:text-slate-200 truncate">
                                  {new Date(shift.shiftDate).toLocaleDateString()}
                                </div>
                              </div>

                              <div className="py-1">
                                {hasChecklist ? (
                                  <button
                                    onClick={() => {
                                      setSelectedChecklistShift(shift);
                                      setActiveActionMenuId(null);
                                    }}
                                    className="w-full px-4 py-2.5 text-xs font-bold text-slate-950 dark:text-white hover:bg-cyan-50 dark:hover:bg-slate-800 flex items-center gap-3 transition"
                                  >
                                    <span className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-400">
                                      <ClipboardCheck className="w-4 h-4" />
                                    </span>
                                    <span>View Driver Checklist</span>
                                  </button>
                                ) : (
                                  <div className="px-4 py-2 text-xs text-slate-400 italic">
                                    No checklist submitted
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Driver Checklist Inspection Modal */}
      {selectedChecklistShift && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-white dark:bg-slate-900 border-2 border-slate-300 dark:border-slate-700 rounded-3xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900/80">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-2xl bg-cyan-500/10 text-cyan-500">
                  <ClipboardCheck className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-lg font-black text-slate-950 dark:text-white">
                    Driver Pre-Trip Safety Inspection
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Submitted for Shift on {new Date(selectedChecklistShift.shiftDate).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedChecklistShift(null)}
                className="p-2 rounded-xl text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1 text-slate-900 dark:text-slate-100">
              {/* Summary Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-2xl bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase">
                    <User className="w-3.5 h-3.5 text-cyan-500" />
                    <span>Driver</span>
                  </div>
                  <div className="text-xs font-black text-slate-950 dark:text-white truncate mt-1">
                    {selectedChecklistShift.driverName || 'Assigned Driver'}
                  </div>
                  {selectedChecklistShift.driverCode && (
                    <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                      {selectedChecklistShift.driverCode}
                    </div>
                  )}
                </div>

                <div className="p-3 rounded-2xl bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase">
                    <Car className="w-3.5 h-3.5 text-teal-500" />
                    <span>Vehicle</span>
                  </div>
                  <div className="text-xs font-black text-slate-950 dark:text-white truncate mt-1">
                    {selectedChecklistShift.vehiclePlate || 'Vehicle Plate'}
                  </div>
                  {selectedChecklistShift.vehicleCode && (
                    <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                      {selectedChecklistShift.vehicleCode}
                    </div>
                  )}
                </div>

                <div className="p-3 rounded-2xl bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase">
                    <Gauge className="w-3.5 h-3.5 text-amber-500" />
                    <span>Start Odo</span>
                  </div>
                  <div className="text-xs font-black text-slate-950 dark:text-white mt-1">
                    {selectedChecklistShift.startOdometer != null
                      ? `${selectedChecklistShift.startOdometer.toLocaleString()} km`
                      : '—'}
                  </div>
                </div>

                <div className="p-3 rounded-2xl bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase">
                    <Clock className="w-3.5 h-3.5 text-emerald-500" />
                    <span>Signed At</span>
                  </div>
                  <div className="text-xs font-black text-slate-950 dark:text-white mt-1">
                    {selectedChecklistShift.checklistSignedAt
                      ? new Date(selectedChecklistShift.checklistSignedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                      : '—'}
                  </div>
                </div>
              </div>

              {/* Inspection Items List */}
              <div>
                <div className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3 flex items-center justify-between">
                  <span>Pre-Trip 18-Point Inspection Results</span>
                  {selectedChecklistShift.checklist && (
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400">
                      {Object.keys(selectedChecklistShift.checklist).length} Points Verified
                    </span>
                  )}
                </div>

                {selectedChecklistShift.checklist ? (
                  <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden bg-slate-50/50 dark:bg-slate-900/50">
                    {Object.entries(selectedChecklistShift.checklist).map(([key, item]) => {
                      const def = CHECKLIST_LABELS[key] || {
                        label: key.replace(/_/g, ' '),
                        category: 'General',
                      };
                      const isOk = item.ok === true;
                      const isFailed = item.ok === false;

                      return (
                        <div key={key} className="p-3.5 flex items-start justify-between gap-3 hover:bg-white dark:hover:bg-slate-800/40 transition">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                                {def.category}
                              </span>
                              <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                                {def.label}
                              </span>
                            </div>
                            {item.note && (
                              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400 font-medium pl-2 border-l-2 border-amber-500">
                                Note: {item.note}
                              </p>
                            )}
                          </div>

                          <div className="shrink-0">
                            {isOk ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-500 border border-emerald-500/30">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>PASS</span>
                              </span>
                            ) : isFailed ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-500/15 text-rose-500 border border-rose-500/30">
                                <AlertTriangle className="w-3.5 h-3.5" />
                                <span>DEFECT</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs text-slate-400 bg-slate-500/10">
                                <span>—</span>
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500 italic">No checklist items recorded.</p>
                )}
              </div>

              {/* Driver Signature Card */}
              {selectedChecklistShift.checklistSignatureSvg && (
                <div>
                  <div className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                    Driver Digital Signature
                  </div>
                  <div className="p-4 rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 flex flex-col items-center justify-center">
                    <div
                      className="w-full max-w-sm h-28 flex items-center justify-center invert dark:invert-0"
                      dangerouslySetInnerHTML={{ __html: selectedChecklistShift.checklistSignatureSvg }}
                    />
                    <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mt-2">
                      Digitally signed by driver on {selectedChecklistShift.checklistSignedAt ? new Date(selectedChecklistShift.checklistSignedAt).toLocaleString() : 'shift start'}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/80 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setSelectedChecklistShift(null)}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-white hover:bg-slate-300 dark:hover:bg-slate-700 transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create New Shift Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-[var(--bg-surface-elevated)] border border-[var(--border-subtle)] rounded-2xl p-8 max-w-md w-full">
            <h2 className="text-2xl font-bold text-[var(--text-main)] mb-6">Create New Shift</h2>

            <form onSubmit={handleAddShift} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Driver ID</label>
                <input
                  type="text"
                  value={formData.driverId}
                  onChange={(e) => setFormData({ ...formData, driverId: e.target.value })}
                  className="w-full bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-xl px-4 py-2 text-[var(--text-main)] focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Shift Date</label>
                <input
                  type="date"
                  value={formData.shiftDate}
                  onChange={(e) => setFormData({ ...formData, shiftDate: e.target.value })}
                  className="w-full bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-xl px-4 py-2 text-[var(--text-main)] focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Start Time</label>
                  <input
                    type="time"
                    value={formData.startTime}
                    onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                    className="w-full bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-xl px-4 py-2 text-[var(--text-main)] focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">End Time</label>
                  <input
                    type="time"
                    value={formData.endTime}
                    onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                    className="w-full bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-xl px-4 py-2 text-[var(--text-main)] focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Vehicle ID (optional)</label>
                <input
                  type="text"
                  value={formData.vehicleId}
                  onChange={(e) => setFormData({ ...formData, vehicleId: e.target.value })}
                  className="w-full bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-xl px-4 py-2 text-[var(--text-main)] focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Notes</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full bg-[var(--input-bg)] border border-[var(--border-subtle)] rounded-xl px-4 py-2 text-[var(--text-main)] focus:outline-none focus:ring-2 focus:ring-cyan-500 resize-none"
                  rows={3}
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  className="flex-1 rounded-xl bg-gradient-to-r from-cyan-600 to-teal-600 px-4 py-2 text-sm font-medium text-white hover:shadow-lg hover:shadow-cyan-500/20 transition-all"
                >
                  Create Shift
                </button>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 rounded-xl bg-[var(--bg-surface-hover)] px-4 py-2 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--bg-surface-elevated)] transition-all"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
