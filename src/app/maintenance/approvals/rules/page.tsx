'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
    ApprovalRule,
    ApproverRole
} from '@/types/maintenance';
import { formatCurrency } from '@/utils/currency';

export default function ApprovalRulesPage() {
    const [rules, setRules] = useState<ApprovalRule[]>([
        {
            id: 'rule-1',
            name: 'Low Cost Maintenance',
            minCost: 0,
            maxCost: 1000,
            requiredApprovers: [ApproverRole.FLEET_MANAGER],
            autoApprove: true,
            escalationDays: 0
        },
        {
            id: 'rule-2',
            name: 'Medium Cost Maintenance',
            minCost: 1001,
            maxCost: 5000,
            requiredApprovers: [ApproverRole.FLEET_MANAGER],
            autoApprove: false,
            escalationDays: 2
        },
        {
            id: 'rule-3',
            name: 'High Cost Maintenance',
            minCost: 5001,
            maxCost: 999999,
            requiredApprovers: [ApproverRole.FLEET_MANAGER, ApproverRole.FINANCE_MANAGER],
            autoApprove: false,
            escalationDays: 1
        }
    ]);

    const [showAddModal, setShowAddModal] = useState(false);
    const [editingRule, setEditingRule] = useState<ApprovalRule | null>(null);
    const [formData, setFormData] = useState<Partial<ApprovalRule>>({
        name: '',
        minCost: 0,
        maxCost: 0,
        requiredApprovers: [],
        autoApprove: false,
        escalationDays: 2
    });

    const handleSaveRule = () => {
        if (!formData.name || !formData.maxCost) {
            alert('Please fill in all required fields');
            return;
        }

        if (editingRule) {
            // Update existing rule
            setRules(rules.map(r => r.id === editingRule.id ? { ...editingRule, ...formData } as ApprovalRule : r));
        } else {
            // Add new rule
            const newRule: ApprovalRule = {
                id: `rule-${Date.now()}`,
                name: formData.name!,
                minCost: formData.minCost!,
                maxCost: formData.maxCost!,
                requiredApprovers: formData.requiredApprovers!,
                autoApprove: formData.autoApprove!,
                escalationDays: formData.escalationDays
            };
            setRules([...rules, newRule]);
        }

        setShowAddModal(false);
        setEditingRule(null);
        setFormData({
            name: '',
            minCost: 0,
            maxCost: 0,
            requiredApprovers: [],
            autoApprove: false,
            escalationDays: 2
        });
    };

    const handleEditRule = (rule: ApprovalRule) => {
        setEditingRule(rule);
        setFormData(rule);
        setShowAddModal(true);
    };

    const handleDeleteRule = (ruleId: string) => {
        if (confirm('Are you sure you want to delete this rule?')) {
            setRules(rules.filter(r => r.id !== ruleId));
        }
    };

    const toggleApprover = (role: ApproverRole) => {
        const current = formData.requiredApprovers || [];
        if (current.includes(role)) {
            setFormData({ ...formData, requiredApprovers: current.filter(r => r !== role) });
        } else {
            setFormData({ ...formData, requiredApprovers: [...current, role] });
        }
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <div className="flex items-center gap-3 mb-1">
                        <Link href="/maintenance/approvals" className="text-slate-400 hover:text-slate-600">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
                            </svg>
                        </Link>
                        <h1 className="text-2xl font-bold text-slate-900">Approval Rules</h1>
                    </div>
                    <p className="text-slate-500 ml-8">Configure approval workflows based on cost thresholds</p>
                </div>
                <button
                    onClick={() => {
                        setEditingRule(null);
                        setFormData({
                            name: '',
                            minCost: 0,
                            maxCost: 0,
                            requiredApprovers: [],
                            autoApprove: false,
                            escalationDays: 2
                        });
                        setShowAddModal(true);
                    }}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                    + Add Rule
                </button>
            </div>

            {/* Rules List */}
            <div className="space-y-4">
                {rules.sort((a, b) => a.minCost - b.minCost).map(rule => (
                    <div key={rule.id} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                        <div className="flex items-start justify-between mb-4">
                            <div>
                                <h3 className="text-lg font-bold text-slate-900">{rule.name}</h3>
                                <p className="text-sm text-slate-500 mt-1">
                                    Cost Range: {formatCurrency(rule.minCost)} - {formatCurrency(rule.maxCost)}
                                </p>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => handleEditRule(rule)}
                                    className="rounded bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
                                >
                                    Edit
                                </button>
                                <button
                                    onClick={() => handleDeleteRule(rule.id)}
                                    className="rounded bg-red-100 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-200"
                                >
                                    Delete
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-6">
                            <div>
                                <label className="block text-xs text-slate-500 mb-1">Required Approvers</label>
                                <div className="flex flex-wrap gap-1">
                                    {rule.requiredApprovers.map(role => (
                                        <span key={role} className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                                            {role}
                                        </span>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs text-slate-500 mb-1">Auto-Approve</label>
                                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${rule.autoApprove
                                    ? 'bg-green-100 text-green-700'
                                    : 'bg-slate-100 text-slate-700'
                                    }`}>
                                    {rule.autoApprove ? 'Yes' : 'No'}
                                </span>
                            </div>
                            <div>
                                <label className="block text-xs text-slate-500 mb-1">Escalation</label>
                                <p className="text-sm font-medium text-slate-900">
                                    {rule.escalationDays ? `After ${rule.escalationDays} day(s)` : 'No escalation'}
                                </p>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Add/Edit Modal */}
            {showAddModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl">
                        <div className="p-6 border-b border-slate-200">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-bold text-slate-900">
                                    {editingRule ? 'Edit' : 'Add'} Approval Rule
                                </h3>
                                <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                        </div>

                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Rule Name *</label>
                                <input
                                    type="text"
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    className="w-full rounded-lg border border-slate-300 px-3 py-2 bg-white text-slate-900"
                                    placeholder="e.g., Medium Cost Maintenance"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-2">Min Cost (AED) *</label>
                                    <input
                                        type="number"
                                        value={formData.minCost}
                                        onChange={(e) => setFormData({ ...formData, minCost: Number(e.target.value) })}
                                        className="w-full rounded-lg border border-slate-300 px-3 py-2 bg-white text-slate-900"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-2">Max Cost (AED) *</label>
                                    <input
                                        type="number"
                                        value={formData.maxCost}
                                        onChange={(e) => setFormData({ ...formData, maxCost: Number(e.target.value) })}
                                        className="w-full rounded-lg border border-slate-300 px-3 py-2 bg-white text-slate-900"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Required Approvers *</label>
                                <div className="space-y-2">
                                    {Object.values(ApproverRole).map(role => (
                                        <label key={role} className="flex items-center gap-2 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={formData.requiredApprovers?.includes(role)}
                                                onChange={() => toggleApprover(role)}
                                                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                            />
                                            <span className="text-sm text-slate-700">{role}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    id="autoApprove"
                                    checked={formData.autoApprove}
                                    onChange={(e) => setFormData({ ...formData, autoApprove: e.target.checked })}
                                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                />
                                <label htmlFor="autoApprove" className="text-sm font-medium text-slate-700">
                                    Auto-approve requests in this range
                                </label>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Escalation Days</label>
                                <input
                                    type="number"
                                    value={formData.escalationDays}
                                    onChange={(e) => setFormData({ ...formData, escalationDays: Number(e.target.value) })}
                                    className="w-full rounded-lg border border-slate-300 px-3 py-2 bg-white text-slate-900"
                                    placeholder="Number of days before escalation"
                                />
                                <p className="text-xs text-slate-500 mt-1">
                                    Set to 0 for no escalation. Requests will escalate to next level if not approved within this timeframe.
                                </p>
                            </div>
                        </div>

                        <div className="p-6 border-t border-slate-200 flex justify-end gap-3">
                            <button
                                onClick={() => setShowAddModal(false)}
                                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSaveRule}
                                className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700"
                            >
                                {editingRule ? 'Update' : 'Create'} Rule
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
