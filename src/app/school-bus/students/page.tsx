'use client';
import React, { useState, useEffect, useCallback, useRef } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Guardian { name: string | null; phone: string | null; email: string | null }
interface Student {
  id: string; studentCode: string; firstName: string; lastName: string; fullName: string;
  dateOfBirth: string | null; grade: string | null; section: string | null;
  schoolName: string | null; routeId: string | null; routeName: string | null;
  pickupStop: string | null; dropoffStop: string | null; rfidCard: string | null;
  guardian1: Guardian; guardian2: Guardian;
  medicalNotes: string | null; isActive: boolean; enrollmentDate: string;
}
interface Route { id: string; name: string }

// ── Helpers ───────────────────────────────────────────────────────────────────
function Badge({ label, color }: { label: string; color: string }) {
  return <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${color}`}>{label}</span>;
}

function Input({ label, ...p }: React.InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  return (
    <div className="space-y-1">
      {label && <label className="text-xs text-slate-400">{label}</label>}
      <input {...p} className={`w-full bg-slate-800/80 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-yellow-500/50 ${p.className ?? ''}`} />
    </div>
  );
}

function Select({ label, children, ...p }: React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  return (
    <div className="space-y-1">
      {label && <label className="text-xs text-slate-400">{label}</label>}
      <select {...p} className={`w-full bg-slate-800/80 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-yellow-500/50 ${p.className ?? ''}`}>
        {children}
      </select>
    </div>
  );
}

// ── Enroll / Edit Modal ────────────────────────────────────────────────────────
interface ModalProps { student?: Student | null; routes: Route[]; onClose: () => void; onSaved: () => void }

function StudentModal({ student, routes, onClose, onSaved }: ModalProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const isEdit = !!student;

  const [form, setForm] = useState({
    firstName:      student?.firstName      ?? '',
    lastName:       student?.lastName       ?? '',
    dateOfBirth:    student?.dateOfBirth    ?? '',
    grade:          student?.grade          ?? '',
    section:        student?.section        ?? '',
    schoolName:     student?.schoolName     ?? '',
    routeId:        student?.routeId        ?? '',
    pickupStop:     student?.pickupStop     ?? '',
    dropoffStop:    student?.dropoffStop    ?? '',
    rfidCard:       student?.rfidCard       ?? '',
    guardian1Name:  student?.guardian1.name  ?? '',
    guardian1Phone: student?.guardian1.phone ?? '',
    guardian1Email: student?.guardian1.email ?? '',
    guardian2Name:  student?.guardian2.name  ?? '',
    guardian2Phone: student?.guardian2.phone ?? '',
    guardian2Email: student?.guardian2.email ?? '',
    medicalNotes:   student?.medicalNotes   ?? '',
    enrollmentDate: student?.enrollmentDate ?? new Date().toISOString().slice(0, 10),
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  async function save() {
    if (!form.firstName.trim() || !form.lastName.trim()) { setError('First and last name are required'); return; }
    setSaving(true); setError('');
    try {
      const url    = isEdit ? `/api/school-bus/students/${student!.id}` : '/api/school-bus/students';
      const method = isEdit ? 'PATCH' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      if (!res.ok) { const d = await res.json(); setError(d.error ?? 'Save failed'); return; }
      onSaved();
    } catch { setError('Network error'); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-slate-900 border-b border-white/10 px-6 py-4 flex items-center justify-between z-10">
          <h2 className="text-white font-semibold">{isEdit ? 'Edit Student' : 'Enroll New Student'}</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-xl">✕</button>
        </div>

        <div className="px-6 py-5 space-y-6">
          {/* Personal */}
          <div>
            <p className="text-xs text-yellow-400 font-semibold uppercase tracking-wider mb-3">Personal Information</p>
            <div className="grid grid-cols-2 gap-3">
              <Input label="First Name *" value={form.firstName} onChange={set('firstName')} placeholder="e.g. John" />
              <Input label="Last Name *"  value={form.lastName}  onChange={set('lastName')}  placeholder="e.g. Smith" />
              <Input label="Date of Birth" type="date" value={form.dateOfBirth} onChange={set('dateOfBirth')} />
              <Input label="Enrollment Date" type="date" value={form.enrollmentDate} onChange={set('enrollmentDate')} />
              <Input label="Grade" value={form.grade} onChange={set('grade')} placeholder="e.g. Grade 5" />
              <Input label="Section / Class" value={form.section} onChange={set('section')} placeholder="e.g. A" />
              <div className="col-span-2">
                <Input label="School Name" value={form.schoolName} onChange={set('schoolName')} placeholder="e.g. Al Rashid International School" />
              </div>
            </div>
          </div>

          {/* Bus Assignment */}
          <div>
            <p className="text-xs text-yellow-400 font-semibold uppercase tracking-wider mb-3">Bus Assignment</p>
            <div className="grid grid-cols-2 gap-3">
              <Select label="Route" value={form.routeId} onChange={set('routeId')}>
                <option value="">— No route —</option>
                {routes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </Select>
              <Input label="RFID Card No." value={form.rfidCard} onChange={set('rfidCard')} placeholder="e.g. RF-2024-0042" />
              <Input label="Pickup Stop"   value={form.pickupStop}   onChange={set('pickupStop')}   placeholder="e.g. Gate 3 / Block B" />
              <Input label="Drop-off Stop" value={form.dropoffStop}  onChange={set('dropoffStop')}  placeholder="e.g. Main Entrance" />
            </div>
          </div>

          {/* Guardian 1 */}
          <div>
            <p className="text-xs text-yellow-400 font-semibold uppercase tracking-wider mb-3">Primary Guardian</p>
            <div className="grid grid-cols-3 gap-3">
              <Input label="Name"  value={form.guardian1Name}  onChange={set('guardian1Name')}  placeholder="Full name" />
              <Input label="Phone" value={form.guardian1Phone} onChange={set('guardian1Phone')} placeholder="+971 50 000 0000" />
              <Input label="Email" type="email" value={form.guardian1Email} onChange={set('guardian1Email')} placeholder="guardian@email.com" />
            </div>
          </div>

          {/* Guardian 2 */}
          <div>
            <p className="text-xs text-yellow-400 font-semibold uppercase tracking-wider mb-3">Secondary Guardian (optional)</p>
            <div className="grid grid-cols-3 gap-3">
              <Input label="Name"  value={form.guardian2Name}  onChange={set('guardian2Name')}  placeholder="Full name" />
              <Input label="Phone" value={form.guardian2Phone} onChange={set('guardian2Phone')} placeholder="+971 50 000 0000" />
              <Input label="Email" type="email" value={form.guardian2Email} onChange={set('guardian2Email')} placeholder="guardian@email.com" />
            </div>
          </div>

          {/* Medical */}
          <div>
            <p className="text-xs text-yellow-400 font-semibold uppercase tracking-wider mb-3">Medical / Special Notes</p>
            <textarea value={form.medicalNotes} onChange={set('medicalNotes')}
              rows={2} placeholder="Allergies, medical conditions, special requirements…"
              className="w-full bg-slate-800/80 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-yellow-500/50 resize-none" />
          </div>

          {error && <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}
        </div>

        <div className="sticky bottom-0 bg-slate-900 border-t border-white/10 px-6 py-4 flex justify-end gap-3">
          <button onClick={onClose} className="text-sm text-slate-400 hover:text-white px-4 py-2 rounded-lg border border-white/10 hover:border-white/20 transition-colors">Cancel</button>
          <button onClick={save} disabled={saving}
            className="text-sm font-semibold bg-yellow-500 hover:bg-yellow-400 disabled:opacity-50 text-slate-900 px-5 py-2 rounded-lg transition-colors">
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Enroll Student'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Student Detail Drawer ─────────────────────────────────────────────────────
function StudentDrawer({ student, onClose, onEdit, onArchive }: {
  student: Student; onClose: () => void; onEdit: () => void; onArchive: () => void;
}) {
  function Row({ label, value }: { label: string; value?: string | null }) {
    if (!value) return null;
    return (
      <div className="flex justify-between py-2 border-b border-white/5 text-sm">
        <span className="text-slate-500">{label}</span>
        <span className="text-slate-200 text-right max-w-[60%]">{value}</span>
      </div>
    );
  }

  const ageStr = student.dateOfBirth
    ? `${Math.floor((Date.now() - new Date(student.dateOfBirth).getTime()) / (365.25 * 24 * 3600 * 1000))} yrs`
    : null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="w-full max-w-md h-full bg-slate-900 border-l border-white/10 overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-6 py-5 border-b border-white/10 flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-yellow-400 to-amber-500 flex items-center justify-center text-2xl font-bold text-slate-900">
              {student.firstName[0]}{student.lastName[0]}
            </div>
            <div>
              <h2 className="text-white font-bold text-lg">{student.fullName}</h2>
              <p className="text-slate-400 text-xs">{student.studentCode}</p>
              <div className="flex gap-2 mt-1">
                {student.isActive
                  ? <Badge label="Active" color="bg-emerald-500/20 text-emerald-300" />
                  : <Badge label="Archived" color="bg-slate-700 text-slate-400" />}
                {student.grade && <Badge label={`${student.grade}${student.section ? ` ${student.section}` : ''}`} color="bg-yellow-500/20 text-yellow-300" />}
                {student.rfidCard && <Badge label="RFID" color="bg-purple-500/20 text-purple-300" />}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-xl flex-shrink-0">✕</button>
        </div>

        <div className="px-6 py-4 space-y-5">
          {/* Personal */}
          <div>
            <p className="text-xs text-yellow-400 font-semibold uppercase tracking-wider mb-2">Personal</p>
            <Row label="Date of Birth" value={student.dateOfBirth ? `${new Date(student.dateOfBirth).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} (${ageStr})` : null} />
            <Row label="School" value={student.schoolName} />
            <Row label="Enrolled" value={new Date(student.enrollmentDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} />
          </div>

          {/* Bus */}
          <div>
            <p className="text-xs text-yellow-400 font-semibold uppercase tracking-wider mb-2">Bus Assignment</p>
            <Row label="Route"        value={student.routeName} />
            <Row label="Pickup Stop"  value={student.pickupStop} />
            <Row label="Drop-off Stop" value={student.dropoffStop} />
            <Row label="RFID Card"    value={student.rfidCard} />
          </div>

          {/* Guardian 1 */}
          {(student.guardian1.name || student.guardian1.phone) && (
            <div>
              <p className="text-xs text-yellow-400 font-semibold uppercase tracking-wider mb-2">Primary Guardian</p>
              <Row label="Name"  value={student.guardian1.name} />
              <Row label="Phone" value={student.guardian1.phone} />
              <Row label="Email" value={student.guardian1.email} />
            </div>
          )}

          {/* Guardian 2 */}
          {(student.guardian2.name || student.guardian2.phone) && (
            <div>
              <p className="text-xs text-yellow-400 font-semibold uppercase tracking-wider mb-2">Secondary Guardian</p>
              <Row label="Name"  value={student.guardian2.name} />
              <Row label="Phone" value={student.guardian2.phone} />
              <Row label="Email" value={student.guardian2.email} />
            </div>
          )}

          {/* Medical */}
          {student.medicalNotes && (
            <div>
              <p className="text-xs text-yellow-400 font-semibold uppercase tracking-wider mb-2">Medical Notes</p>
              <p className="text-sm text-slate-300 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{student.medicalNotes}</p>
            </div>
          )}
        </div>

        <div className="px-6 pb-6 flex gap-3">
          <button onClick={onEdit}
            className="flex-1 text-sm font-semibold bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-300 border border-yellow-500/30 px-4 py-2.5 rounded-xl transition-colors">
            ✏️ Edit
          </button>
          {student.isActive && (
            <button onClick={onArchive}
              className="flex-1 text-sm font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-white/10 px-4 py-2.5 rounded-xl transition-colors">
              📦 Archive
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function SchoolBusStudentsPage() {
  const [students,    setStudents]    = useState<Student[]>([]);
  const [routes,      setRoutes]      = useState<Route[]>([]);
  const [total,       setTotal]       = useState(0);
  const [loading,     setLoading]     = useState(true);
  const [search,      setSearch]      = useState('');
  const [filterRoute, setFilterRoute] = useState('');
  const [filterGrade, setFilterGrade] = useState('');
  const [filterActive, setFilterActive] = useState<'true' | 'false' | 'all'>('true');
  const [page,        setPage]        = useState(1);

  const [showModal,   setShowModal]   = useState(false);
  const [editStudent, setEditStudent] = useState<Student | null>(null);
  const [viewStudent, setViewStudent] = useState<Student | null>(null);
  const [archiving,   setArchiving]   = useState<string | null>(null);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (s = search, ro = filterRoute, gr = filterGrade, ac = filterActive, pg = page) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ q: s, routeId: ro, grade: gr, active: ac, page: String(pg), limit: '50' });
      const res = await fetch(`/api/school-bus/students?${params}`);
      if (res.ok) {
        const d = await res.json();
        setStudents(d.students ?? []);
        setTotal(d.total ?? 0);
      }
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [search, filterRoute, filterGrade, filterActive, page]);

  // Load routes once
  useEffect(() => {
    fetch('/api/bus-ops/routes?limit=100').then(r => r.ok ? r.json() : null).then(d => {
      if (d?.routes) setRoutes(d.routes.map((r: { id: string; name: string }) => ({ id: r.id, name: r.name })));
    }).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  function handleSearch(v: string) {
    setSearch(v); setPage(1);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => load(v, filterRoute, filterGrade, filterActive, 1), 400);
  }

  async function handleArchive(id: string) {
    if (!confirm('Archive this student? They will be hidden from active lists.')) return;
    setArchiving(id);
    try {
      await fetch(`/api/school-bus/students/${id}`, { method: 'DELETE' });
      setViewStudent(null);
      load();
    } catch { /* silent */ }
    finally { setArchiving(null); }
  }

  const grades = Array.from(new Set(students.map(s => s.grade).filter(Boolean))).sort() as string[];

  const statActive   = students.filter(s => s.isActive).length;
  const statNoRoute  = students.filter(s => s.isActive && !s.routeId).length;
  const statNoRfid   = students.filter(s => s.isActive && !s.rfidCard).length;
  const statMedical  = students.filter(s => s.isActive && s.medicalNotes).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Student Registry</h1>
          <p className="text-slate-400 text-sm mt-0.5">Enroll students, assign routes, manage guardian contacts</p>
        </div>
        <button onClick={() => { setEditStudent(null); setShowModal(true); }}
          className="bg-yellow-500 hover:bg-yellow-400 text-slate-900 font-semibold px-4 py-2 rounded-xl text-sm transition-colors flex items-center gap-2">
          + Enroll Student
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { icon: '👧', label: 'Active Students', value: statActive,  color: 'text-yellow-300' },
          { icon: '🗺️', label: 'No Route Assigned', value: statNoRoute, color: statNoRoute > 0 ? 'text-amber-400' : 'text-slate-400' },
          { icon: '📡', label: 'No RFID Card',    value: statNoRfid,  color: statNoRfid > 0 ? 'text-amber-400' : 'text-slate-400' },
          { icon: '🏥', label: 'Medical Notes',   value: statMedical, color: statMedical > 0 ? 'text-red-400' : 'text-slate-400' },
        ].map(s => (
          <div key={s.label} className="bg-slate-900/60 border border-white/10 rounded-2xl p-4">
            <p className="text-xs text-slate-500">{s.icon} {s.label}</p>
            <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input type="text" placeholder="Search by name, ID, RFID, phone…"
          value={search} onChange={e => handleSearch(e.target.value)}
          className="flex-1 min-w-[220px] bg-slate-800/60 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-yellow-500/40" />
        <select value={filterActive} onChange={e => { setFilterActive(e.target.value as typeof filterActive); setPage(1); load(search, filterRoute, filterGrade, e.target.value as typeof filterActive, 1); }}
          className="bg-slate-800/60 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none">
          <option value="true">Active</option>
          <option value="false">Archived</option>
          <option value="all">All</option>
        </select>
        <select value={filterRoute} onChange={e => { setFilterRoute(e.target.value); setPage(1); load(search, e.target.value, filterGrade, filterActive, 1); }}
          className="bg-slate-800/60 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none">
          <option value="">All Routes</option>
          {routes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        {grades.length > 0 && (
          <select value={filterGrade} onChange={e => { setFilterGrade(e.target.value); setPage(1); load(search, filterRoute, e.target.value, filterActive, 1); }}
            className="bg-slate-800/60 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none">
            <option value="">All Grades</option>
            {grades.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        )}
      </div>

      {/* Table */}
      <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-white/10 flex items-center justify-between">
          <span className="text-sm font-medium text-slate-300">{total} student{total !== 1 ? 's' : ''}</span>
          <button onClick={() => load()} className="text-xs text-slate-400 hover:text-white border border-white/10 px-3 py-1.5 rounded-lg hover:border-white/20 transition-colors">↺ Refresh</button>
        </div>

        {loading ? (
          <div className="animate-pulse p-4 space-y-3">
            {[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-slate-800 rounded-xl" />)}
          </div>
        ) : students.length === 0 ? (
          <div className="py-16 text-center">
            <div className="text-5xl mb-3">👧</div>
            <p className="text-slate-400 text-sm">No students found</p>
            <p className="text-slate-600 text-xs mt-1">Try adjusting the filters or enroll a new student</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5 text-xs text-slate-500 uppercase tracking-wider">
                  <th className="text-left px-5 py-3">Student</th>
                  <th className="text-left px-3 py-3">Grade</th>
                  <th className="text-left px-3 py-3">Route</th>
                  <th className="text-left px-3 py-3">Guardian</th>
                  <th className="text-left px-3 py-3">RFID</th>
                  <th className="text-left px-3 py-3">Status</th>
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {students.map(s => (
                  <tr key={s.id} className="hover:bg-white/5 transition-colors cursor-pointer" onClick={() => setViewStudent(s)}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-yellow-400 to-amber-500 flex items-center justify-center text-xs font-bold text-slate-900 flex-shrink-0">
                          {s.firstName[0]}{s.lastName[0]}
                        </div>
                        <div>
                          <p className="text-white font-medium">{s.fullName}</p>
                          <p className="text-slate-500 text-xs">{s.studentCode}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-slate-300">
                      {s.grade ?? '—'}{s.section ? ` ${s.section}` : ''}
                    </td>
                    <td className="px-3 py-3">
                      {s.routeName
                        ? <span className="text-yellow-300 text-xs bg-yellow-500/10 border border-yellow-500/20 px-2 py-0.5 rounded-full">{s.routeName}</span>
                        : <span className="text-slate-600 text-xs">Unassigned</span>}
                    </td>
                    <td className="px-3 py-3">
                      <div className="text-xs">
                        <p className="text-slate-300">{s.guardian1.name ?? '—'}</p>
                        {s.guardian1.phone && <p className="text-slate-500">{s.guardian1.phone}</p>}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs">
                      {s.rfidCard
                        ? <span className="text-purple-300 bg-purple-500/10 border border-purple-500/20 px-2 py-0.5 rounded-full font-mono">{s.rfidCard}</span>
                        : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-3 py-3">
                      {s.isActive
                        ? <Badge label="Active"   color="bg-emerald-500/20 text-emerald-300" />
                        : <Badge label="Archived" color="bg-slate-700 text-slate-400" />}
                      {s.medicalNotes && <Badge label="⚕" color="bg-red-500/20 text-red-400 ml-1" />}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                        <button onClick={() => { setEditStudent(s); setShowModal(true); }}
                          className="text-slate-400 hover:text-yellow-300 text-sm px-2 py-1 rounded hover:bg-yellow-500/10 transition-colors">✏️</button>
                        {s.isActive && (
                          <button onClick={() => handleArchive(s.id)} disabled={archiving === s.id}
                            className="text-slate-400 hover:text-red-300 text-sm px-2 py-1 rounded hover:bg-red-500/10 transition-colors">
                            {archiving === s.id ? '…' : '📦'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {total > 50 && (
          <div className="px-5 py-3 border-t border-white/10 flex items-center justify-between text-xs text-slate-400">
            <span>Page {page} of {Math.ceil(total / 50)}</span>
            <div className="flex gap-2">
              <button disabled={page <= 1} onClick={() => { setPage(p => p - 1); load(search, filterRoute, filterGrade, filterActive, page - 1); }}
                className="disabled:opacity-30 hover:text-white px-3 py-1.5 border border-white/10 rounded-lg transition-colors">← Prev</button>
              <button disabled={page >= Math.ceil(total / 50)} onClick={() => { setPage(p => p + 1); load(search, filterRoute, filterGrade, filterActive, page + 1); }}
                className="disabled:opacity-30 hover:text-white px-3 py-1.5 border border-white/10 rounded-lg transition-colors">Next →</button>
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {showModal && (
        <StudentModal
          student={editStudent}
          routes={routes}
          onClose={() => { setShowModal(false); setEditStudent(null); }}
          onSaved={() => { setShowModal(false); setEditStudent(null); load(); }}
        />
      )}
      {viewStudent && (
        <StudentDrawer
          student={viewStudent}
          onClose={() => setViewStudent(null)}
          onEdit={() => { setEditStudent(viewStudent); setViewStudent(null); setShowModal(true); }}
          onArchive={() => handleArchive(viewStudent.id)}
        />
      )}
    </div>
  );
}
