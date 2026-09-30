'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { formatCurrency } from '@/utils/currency';
import type { ApprovalRuleRow } from '@/lib/maintenance/approval-rules';

interface RoleOption { code: string; name: string }

interface FormState {
    name: string;
    minCost: string;
    maxCost: string;
    requiredRoles: string[];
    autoApprove: boolean;
    isActive: boolean;
}

const blankForm = (): FormState => ({ name: '', minCost: '0', maxCost: '', requiredRoles: [], autoApprove: false, isActive: true });

async function send(url: string, method: string, body?: unknown) {
    const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
    return json;
}

export default function ApprovalRulesPage() {
    const [rules, setRules] = useState<ApprovalRuleRow[]>([]);
    const [canManage, setCanManage] = useState(false);
    const [roles, setRoles] = useState<RoleOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [formError, setFormError] = useState<string | null>(null);
    const [showModal, setShowModal] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState<FormState>(blankForm());

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const json = await send('/api/maintenance/approval-rules', 'GET');
            setRules(Array.isArray(json.rules) ? json.rules : []);
            setCanManage(Boolean(json.canManage));
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load approval rules');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    useEffect(() => {
        fetch('/api/admin/roles', { cache: 'no-store' })
            .then(r => (r.ok ? r.json() : []))
            .then((rows: Array<Record<string, unknown>>) => setRoles((Array.isArray(rows) ? rows : [])
                .filter(r => typeof r.code === 'string' && r.code !== 'SUPER_ADMIN')
                .map(r => ({ code: String(r.code), name: String(r.name ?? r.code) }))))
            .catch(() => setRoles([]));
    }, []);

    const roleName = (code: string) => roles.find(r => r.code === code)?.name ?? code;

    const openCreate = () => { setEditingId(null); setForm(blankForm()); setFormError(null); setShowModal(true); };
    const openEdit = (r: ApprovalRuleRow) => {
        setEditingId(r.id);
        setForm({ name: r.name, minCost: String(r.minCost), maxCost: r.maxCost == null ? '' : String(r.maxCost),
            requiredRoles: r.requiredRoles, autoApprove: r.autoApprove, isActive: r.isActive });
        setFormError(null);
        setShowModal(true);
    };

    const handleSave = async () => {
        setSaving(true);
        setFormError(null);
        try {
            const body = {
                name: form.name,
                minCost: form.minCost === '' ? 0 : Number(form.minCost),
                maxCost: form.maxCost === '' ? null : Number(form.maxCost),
                requiredRoles: form.autoApprove ? [] : form.requiredRoles,
                autoApprove: form.autoApprove,
                isActive: form.isActive,
            };
            const saved: ApprovalRuleRow = editingId
                ? await send(`/api/maintenance/approval-rules/${editingId}`, 'PATCH', body)
                : await send('/api/maintenance/approval-rules', 'POST', body);
            setRules(prev => (editingId ? prev.map(r => (r.id === saved.id ? saved : r)) : [...prev, saved]));
            setShowModal(false);
        } catch (e) {
            setFormError(e instanceof Error ? e.message : 'Could not save the rule');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (r: ApprovalRuleRow) => {
        if (!confirm(`Delete the rule "${r.name}"?`)) return;
        setError(null);
        try {
            await send(`/api/maintenance/approval-rules/${r.id}`, 'DELETE');
            setRules(prev => prev.filter(x => x.id !== r.id));
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not delete the rule');
        }
    };

    const toggleRole = (code: string) => setForm(f => ({
        ...f,
        requiredRoles: f.requiredRoles.includes(code) ? f.requiredRoles.filter(c => c !== code) : [...f.requiredRoles, code],
    }));

    const field = 'w-full rounded-lg border border-[var(--border-subtle)] px-3 py-2 bg-[var(--bg-surface)] text-[var(--text-main)]';

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <div className="flex items-center gap-3 mb-1">
                        <Link href="/maintenance/approvals" className="text-[var(--text-muted)] hover:text-[var(--text-main)]">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
                            </svg>
                        </Link>
                        <h1 className="text-2xl font-bold text-[var(--text-main)]">Approval Rules</h1>
                    </div>
                    <p className="text-xs text-[var(--text-faint)] ml-8">
                        Who may approve a maintenance estimate, by its amount. Estimates with no matching rule can be approved as before.
                    </p>
                </div>
                {canManage && (
                    <button onClick={openCreate} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                        + Add Rule
                    </button>
                )}
            </div>

            {!loading && !canManage && (
                <p className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-sm text-[var(--text-muted)]">
                    Only tenant administrators can change these rules.
                </p>
            )}
            {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">{error}</div>}

            <div className="space-y-4">
                {loading ? (
                    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-10 text-center text-sm text-[var(--text-faint)]">Loading rules…</div>
                ) : rules.length === 0 ? (
                    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-10 text-center text-sm text-[var(--text-faint)]">
                        No approval rules yet: anyone who can approve estimates may approve any amount.
                    </div>
                ) : [...rules].sort((a, b) => a.minCost - b.minCost).map(rule => (
                    <div key={rule.id} className={`rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 shadow-sm ${rule.isActive ? '' : 'opacity-60'}`}>
                        <div className="flex items-start justify-between mb-4">
                            <div>
                                <h3 className="text-lg font-bold text-[var(--text-main)]">
                                    {rule.name}{!rule.isActive && <span className="ml-2 text-xs font-normal text-[var(--text-faint)]">(inactive)</span>}
                                </h3>
                                <p className="text-sm text-[var(--text-faint)] mt-1">
                                    Estimates from {formatCurrency(rule.minCost)} {rule.maxCost == null ? 'and above' : `to ${formatCurrency(rule.maxCost)}`}
                                </p>
                            </div>
                            {canManage && (
                                <div className="flex gap-2">
                                    <button onClick={() => openEdit(rule)} className="rounded bg-[var(--bg-surface-hover)]/40 px-3 py-1 text-xs font-medium text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)]">Edit</button>
                                    <button onClick={() => void handleDelete(rule)} className="rounded bg-red-500/20 px-3 py-1 text-xs font-medium text-red-400 hover:bg-red-500/30">Delete</button>
                                </div>
                            )}
                        </div>
                        <div>
                            <label className="block text-xs text-[var(--text-faint)] mb-1">Approval</label>
                            {rule.autoApprove ? (
                                <span className="inline-flex items-center rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-400">Approved automatically when submitted</span>
                            ) : rule.requiredRoles.length === 0 ? (
                                <span className="text-sm text-[var(--text-muted)]">Anyone who can approve estimates</span>
                            ) : (
                                <div className="flex flex-wrap items-center gap-1">
                                    <span className="text-sm text-[var(--text-muted)] mr-1">One of:</span>
                                    {rule.requiredRoles.map(code => (
                                        <span key={code} className="inline-flex items-center rounded-full bg-blue-500/20 px-2 py-0.5 text-xs font-medium text-blue-400">{roleName(code)}</span>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="bg-[var(--bg-surface)] rounded-2xl w-full max-w-2xl shadow-2xl">
                        <div className="p-6 border-b border-[var(--border-subtle)] flex items-center justify-between">
                            <h3 className="text-lg font-bold text-[var(--text-main)]">{editingId ? 'Edit' : 'Add'} Approval Rule</h3>
                            <button onClick={() => setShowModal(false)} className="text-[var(--text-muted)] hover:text-[var(--text-main)]">✕</button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Rule name *</label>
                                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className={field} placeholder="e.g. Medium cost repairs" />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">From (AED)</label>
                                    <input type="number" min={0} value={form.minCost} onChange={e => setForm({ ...form, minCost: e.target.value })} className={field} />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">To (AED)</label>
                                    <input type="number" min={0} value={form.maxCost} onChange={e => setForm({ ...form, maxCost: e.target.value })} className={field} placeholder="No upper limit" />
                                </div>
                            </div>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input type="checkbox" checked={form.autoApprove} onChange={e => setForm({ ...form, autoApprove: e.target.checked })} className="h-4 w-4 rounded" />
                                <span className="text-sm font-medium text-[var(--text-muted)]">Approve estimates in this range automatically when submitted</span>
                            </label>
                            {!form.autoApprove && (
                                <div>
                                    <label className="block text-sm font-medium text-[var(--text-muted)] mb-1">Who may approve</label>
                                    <p className="text-xs text-[var(--text-faint)] mb-2">The approver must hold one of these roles. Leave all unticked to allow anyone who can approve estimates.</p>
                                    {roles.length === 0 ? (
                                        <p className="text-sm text-[var(--text-faint)]">No roles found.</p>
                                    ) : (
                                        <div className="grid grid-cols-2 gap-2">
                                            {roles.map(r => (
                                                <label key={r.code} className="flex items-center gap-2 cursor-pointer">
                                                    <input type="checkbox" checked={form.requiredRoles.includes(r.code)} onChange={() => toggleRole(r.code)} className="h-4 w-4 rounded" />
                                                    <span className="text-sm text-[var(--text-muted)]">{r.name}</span>
                                                </label>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input type="checkbox" checked={form.isActive} onChange={e => setForm({ ...form, isActive: e.target.checked })} className="h-4 w-4 rounded" />
                                <span className="text-sm text-[var(--text-muted)]">Active</span>
                            </label>
                            {formError && <p className="text-sm text-red-400">{formError}</p>}
                        </div>
                        <div className="p-6 border-t border-[var(--border-subtle)] flex justify-end gap-3">
                            <button onClick={() => setShowModal(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)]">Cancel</button>
                            <button onClick={() => void handleSave()} disabled={saving || !form.name.trim()} className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                                {saving ? 'Saving…' : editingId ? 'Update Rule' : 'Create Rule'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
