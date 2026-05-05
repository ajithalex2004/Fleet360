'use client';
import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useTenantPortal } from '../layout';

/* ─────────────────────────── Types ─────────────────────────── */
interface StudentStats {
  total: number;
  active: number;
  maxStudents?: number;
}

interface RouteRow {
  id: string;
  name?: string;
  routeCode?: string;
  route_code?: string;
  driverName?: string;
  driver_name?: string;
  vehicleReg?: string;
  vehicle_reg?: string;
  studentCount?: number;
  student_count?: number;
  departureTime?: string;
  departure_time?: string;
  status: string;
}

interface AttendanceStats {
  totalExpected: number;
  present: number;
  absent: number;
  pct: number;
}

interface AbsentStudent {
  id: string;
  name: string;
  route?: string;
  reason?: string;
  guardianNotified?: boolean;
}

interface NotificationStats {
  sentToday: number;
  readToday: number;
  readRate: number;
}

/* ─────────────────────────── Helpers ─────────────────────────── */
function fmtDate(d: string | undefined | null) {
  if (!d) return '—';
  try { return new Date(d).toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' }); }
  catch { return d; }
}

const ROUTE_STATUS_BADGE: Record<string, string> = {
  IN_PROGRESS: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  COMPLETED:   'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  SCHEDULED:   'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  DELAYED:     'bg-amber-500/20 text-amber-300 border-amber-500/30',
  CANCELLED:   'bg-red-500/20 text-red-300 border-red-500/30',
  ON_ROUTE:    'bg-blue-500/20 text-blue-300 border-blue-500/30',
};

function KpiCard({ icon, label, value, sub, colorClass = 'border-cyan-500/20 bg-cyan-500/5' }: {
  icon: string; label: string; value: string | number; sub?: string; colorClass?: string;
}) {
  return (
    <div className={`rounded-2xl border p-4 ${colorClass}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wide">{label}</p>
          <p className="text-2xl font-bold text-white mt-1">{value}</p>
          {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
        </div>
        <span className="text-2xl">{icon}</span>
      </div>
    </div>
  );
}

/* ─────────────────────────── Page ─────────────────────────── */
export default function TenantSchoolBusPage() {
  const params = useParams();
  const slug = (params?.tenantSlug as string) ?? '';
  const { tenant } = useTenantPortal();

  const [students, setStudents]     = useState<StudentStats | null>(null);
  const [routes, setRoutes]         = useState<RouteRow[]>([]);
  const [attendance, setAttendance] = useState<AttendanceStats | null>(null);
  const [absent, setAbsent]         = useState<AbsentStudent[]>([]);
  const [notifs, setNotifs]         = useState<NotificationStats | null>(null);
  const [alertCount, setAlertCount] = useState<number>(0);

  const [loadingRoutes, setLoadingRoutes]     = useState(true);
  const [loadingStudents, setLoadingStudents] = useState(true);

  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    if (!tenant) return;

    // Students
    fetch(`/api/school-bus/students?tenantId=${tenant.id}&summary=true`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) setStudents({ total: d.total ?? 0, active: d.active ?? d.total ?? 0, maxStudents: d.maxStudents });
      })
      .catch(() => {})
      .finally(() => setLoadingStudents(false));

    // Routes (today's)
    fetch(`/api/school-bus/routes?tenantId=${tenant.id}&date=${today}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        const rows = Array.isArray(d) ? d : d?.routes ?? d?.data ?? [];
        setRoutes(rows);
      })
      .catch(() => {})
      .finally(() => setLoadingRoutes(false));

    // Attendance today
    fetch(`/api/school-bus/attendance?tenantId=${tenant.id}&date=${today}&summary=true`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) {
          const total   = d.totalExpected ?? d.total ?? 0;
          const present = d.present ?? 0;
          const absent  = d.absent ?? (total - present);
          setAttendance({ totalExpected: total, present, absent, pct: total > 0 ? Math.round((present / total) * 100) : 0 });
          setAbsent(d.absentStudents ?? []);
        }
      })
      .catch(() => {});

    // Notifications
    fetch(`/api/school-bus/alerts?tenantId=${tenant.id}&date=${today}&summary=true`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) {
          setNotifs({ sentToday: d.sentToday ?? d.sent ?? 0, readToday: d.readToday ?? d.read ?? 0, readRate: d.readRate ?? 0 });
          setAlertCount(d.pending ?? d.unread ?? 0);
        }
      })
      .catch(() => {});
  }, [tenant, today]);

  const studentData = students ?? { total: 0, active: 0 };
  const attendData  = attendance ?? { totalExpected: 0, present: 0, absent: 0, pct: 0 };
  const notifData   = notifs ?? { sentToday: 0, readToday: 0, readRate: 0 };

  const nearStudentLimit = studentData.maxStudents && studentData.total / studentData.maxStudents >= 0.9;

  if (!tenant) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">🚌 School Bus</h1>
          <p className="text-slate-400 text-sm mt-1">{tenant.name} · Student transport overview</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/portal/${slug}/school-bus/attendance`}
            className="px-4 py-2 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/30 text-sm font-medium hover:bg-amber-500/30 transition-colors">
            ✅ Take Attendance
          </Link>
          <Link href={`/portal/${slug}/school-bus/students`}
            className="px-4 py-2 rounded-xl bg-slate-700 text-slate-300 border border-white/10 text-sm font-medium hover:bg-slate-600 transition-colors">
            + Add Student
          </Link>
          <Link href={`/portal/${slug}/school-bus`}
            className="px-4 py-2 rounded-xl bg-slate-700 text-slate-300 border border-white/10 text-sm font-medium hover:bg-slate-600 transition-colors">
            🗺️ View Routes
          </Link>
        </div>
      </div>

      {/* Student limit warning */}
      {nearStudentLimit && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-5 py-4 flex items-center gap-3">
          <span className="text-2xl">⚠️</span>
          <div>
            <p className="text-amber-300 font-semibold text-sm">Student Limit Warning</p>
            <p className="text-amber-400/80 text-xs mt-0.5">
              You have {studentData.total} of {studentData.maxStudents} allowed students registered.
              Contact your account manager to upgrade your plan.
            </p>
          </div>
        </div>
      )}

      {/* KPI cards */}
      <section>
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Today's Overview</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard icon="🎒" label="Total Students" value={loadingStudents ? '…' : studentData.total}
            sub={studentData.maxStudents ? `of ${studentData.maxStudents} max` : `${studentData.active} active`}
            colorClass="border-amber-500/20 bg-amber-500/5" />
          <KpiCard icon="🗺️" label="Active Routes" value={loadingRoutes ? '…' : routes.length}
            sub="Running today"
            colorClass="border-cyan-500/20 bg-cyan-500/5" />
          <KpiCard icon="📋" label="Attendance Today"
            value={attendance ? `${attendData.pct}%` : '—'}
            sub={attendance ? `${attendData.present} of ${attendData.totalExpected} present` : 'No data yet'}
            colorClass={`border-${attendData.pct >= 90 ? 'emerald' : attendData.pct >= 75 ? 'amber' : 'red'}-500/20 bg-${attendData.pct >= 90 ? 'emerald' : attendData.pct >= 75 ? 'amber' : 'red'}-500/5`} />
          <KpiCard icon="🔔" label="Pending Alerts" value={alertCount}
            sub={`${notifData.sentToday} sent today`}
            colorClass={`border-${alertCount > 0 ? 'red' : 'slate'}-500/20 bg-${alertCount > 0 ? 'red' : 'slate'}-500/5`} />
        </div>
      </section>

      {/* Today's routes table */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Today's Route Status</h2>
          <Link href={`/portal/${slug}/school-bus`} className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors">
            Full route board →
          </Link>
        </div>
        <div className="rounded-2xl border border-white/8 bg-slate-800/20 overflow-hidden">
          {loadingRoutes ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : routes.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-3xl mb-3">🗺️</p>
              <p className="text-slate-400 text-sm font-medium">No routes scheduled for today</p>
              <p className="text-slate-600 text-xs mt-1">Routes assigned to today's date will appear here</p>
              <Link href={`/portal/${slug}/school-bus`}
                className="mt-4 inline-flex items-center px-4 py-2 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/30 text-sm font-medium hover:bg-amber-500/30 transition-colors">
                Set up routes →
              </Link>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5 text-xs text-slate-500 uppercase tracking-wide">
                  <th className="px-4 py-3 text-left">Route</th>
                  <th className="px-4 py-3 text-left">Driver</th>
                  <th className="px-4 py-3 text-left">Vehicle</th>
                  <th className="px-4 py-3 text-center">Students</th>
                  <th className="px-4 py-3 text-center">Departure</th>
                  <th className="px-4 py-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {routes.map(r => {
                  const code   = r.routeCode ?? r.route_code ?? r.name ?? r.id.slice(0, 8);
                  const driver = r.driverName ?? r.driver_name;
                  const veh    = r.vehicleReg ?? r.vehicle_reg;
                  const count  = r.studentCount ?? r.student_count ?? 0;
                  const dep    = r.departureTime ?? r.departure_time;
                  const st     = r.status?.toUpperCase() ?? 'SCHEDULED';
                  return (
                    <tr key={r.id} className="border-b border-white/5 hover:bg-slate-800/40 transition-colors">
                      <td className="px-4 py-3 font-semibold text-white">{code}</td>
                      <td className="px-4 py-3 text-slate-300">{driver ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-400 text-xs">{veh ?? '—'}</td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-flex items-center gap-1 text-slate-300">
                          <span className="text-xs">🎒</span> {count}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-xs text-slate-400">{dep ? fmtDate(dep) : '—'}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${ROUTE_STATUS_BADGE[st] ?? ROUTE_STATUS_BADGE.SCHEDULED}`}>
                          {st.replace('_', ' ')}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Absent students + notifications row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Absent students */}
        <section>
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Absent Students Today</h2>
          <div className="rounded-2xl border border-white/8 bg-slate-800/20 overflow-hidden">
            {absent.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-2xl mb-2">✅</p>
                <p className="text-slate-400 text-sm">
                  {attendData.totalExpected > 0 ? 'No absences recorded' : 'No attendance data yet'}
                </p>
                <p className="text-slate-600 text-xs mt-1">Take attendance to log today's session</p>
              </div>
            ) : (
              <div className="divide-y divide-white/5">
                {absent.slice(0, 6).map(s => (
                  <div key={s.id} className="px-4 py-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm text-white font-medium">{s.name}</p>
                      {s.route && <p className="text-xs text-slate-500">{s.route}</p>}
                      {s.reason && <p className="text-xs text-slate-600 italic">{s.reason}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      {s.guardianNotified && (
                        <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                          Notified
                        </span>
                      )}
                      <span className="text-red-400 text-xs font-semibold">ABSENT</span>
                    </div>
                  </div>
                ))}
                {absent.length > 6 && (
                  <div className="px-4 py-3 text-center">
                    <Link href={`/portal/${slug}/school-bus/attendance`} className="text-xs text-cyan-400 hover:text-cyan-300">
                      View {absent.length - 6} more →
                    </Link>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Notification stats */}
        <section>
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Parent Notifications</h2>
          <div className="rounded-2xl border border-white/8 bg-slate-800/20 p-5 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-xl bg-slate-800/60 border border-white/5 p-3 text-center">
                <p className="text-2xl font-bold text-white">{notifData.sentToday}</p>
                <p className="text-xs text-slate-500 mt-1">Sent Today</p>
              </div>
              <div className="rounded-xl bg-slate-800/60 border border-white/5 p-3 text-center">
                <p className="text-2xl font-bold text-white">{notifData.readToday}</p>
                <p className="text-xs text-slate-500 mt-1">Read Today</p>
              </div>
            </div>

            {/* Read rate bar */}
            <div>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-slate-500">Read Rate</span>
                <span className="text-white font-semibold">{notifData.readRate}%</span>
              </div>
              <div className="h-2 rounded-full bg-slate-700">
                <div
                  className="h-2 rounded-full bg-gradient-to-r from-cyan-500 to-teal-400 transition-all"
                  style={{ width: `${Math.min(notifData.readRate, 100)}%` }}
                />
              </div>
            </div>

            <Link href={`/portal/${slug}/school-bus/alerts`}
              className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-slate-800/60 border border-white/5 hover:bg-slate-700/60 transition-colors group">
              <span className="text-sm text-slate-300 group-hover:text-white">View all alerts</span>
              <span className="text-slate-500 group-hover:text-slate-300 text-xs">→</span>
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
