'use client';

import { useState } from 'react';
import {
    MaintenanceSchedule,
    MaintenanceTemplate,
    MaintenanceType
} from '@/types/maintenance';
import { formatCurrency } from '@/utils/currency';

export default function SchedulePage() {
    const [schedules, setSchedules] = useState<MaintenanceSchedule[]>([
        {
            id: 'sched-1',
            vehicleId: 'v1',
            templateId: 'tmpl-1',
            scheduledDate: '2024-12-15',
            maintenanceType: MaintenanceType.PREVENTIVE,
            description: 'Regular Oil Change',
            estimatedCost: 150,
            autoCreateRequest: true,
            notifyDaysBefore: 7,
            recurring: true,
            recurringInterval: 90
        },
        {
            id: 'sched-2',
            vehicleId: 'v2',
            templateId: 'tmpl-2',
            scheduledDate: '2024-12-20',
            maintenanceType: MaintenanceType.PREVENTIVE,
            description: 'Brake System Inspection',
            estimatedCost: 200,
            autoCreateRequest: true,
            notifyDaysBefore: 5,
            recurring: true,
            recurringInterval: 180
        }
    ]);

    const [templates, setTemplates] = useState<MaintenanceTemplate[]>([
        {
            id: 'tmpl-1',
            name: 'Oil Change Service',
            maintenanceType: MaintenanceType.PREVENTIVE,
            description: 'Standard oil change with filter replacement',
            estimatedDuration: 1,
            estimatedCost: 150,
            requiredParts: ['Engine Oil (5L)', 'Oil Filter'],
            checklistItems: ['Drain old oil', 'Replace oil filter', 'Add new oil', 'Check oil level'],
            intervalDays: 90
        },
        {
            id: 'tmpl-2',
            name: 'Brake Inspection',
            maintenanceType: MaintenanceType.PREVENTIVE,
            description: 'Complete brake system inspection',
            estimatedDuration: 2,
            estimatedCost: 200,
            requiredParts: [],
            checklistItems: ['Check brake pads', 'Inspect brake discs', 'Test brake fluid', 'Check brake lines'],
            intervalDays: 180
        }
    ]);

    const [showScheduleModal, setShowScheduleModal] = useState(false);
    const [showTemplateModal, setShowTemplateModal] = useState(false);
    const [scheduleForm, setScheduleForm] = useState({
        vehicleId: '',
        templateId: '',
        scheduledDate: '',
        autoCreateRequest: true,
        notifyDaysBefore: 7,
        recurring: false,
        recurringInterval: 90
    });

    const [templateForm, setTemplateForm] = useState({
        name: '',
        maintenanceType: MaintenanceType.PREVENTIVE,
        description: '',
        estimatedDuration: 1,
        estimatedCost: 0,
        intervalDays: 90
    });

    const handleCreateSchedule = () => {
        const selectedTemplate = templates.find(t => t.id === scheduleForm.templateId);

        const newSchedule: MaintenanceSchedule = {
            id: `sched-${Date.now()}`,
            vehicleId: scheduleForm.vehicleId,
            templateId: scheduleForm.templateId,
            scheduledDate: scheduleForm.scheduledDate,
            maintenanceType: selectedTemplate?.maintenanceType || MaintenanceType.PREVENTIVE,
            description: selectedTemplate?.name || '',
            estimatedCost: selectedTemplate?.estimatedCost || 0,
            autoCreateRequest: scheduleForm.autoCreateRequest,
            notifyDaysBefore: scheduleForm.notifyDaysBefore,
            recurring: scheduleForm.recurring,
            recurringInterval: scheduleForm.recurringInterval
        };

        setSchedules([...schedules, newSchedule]);
        setShowScheduleModal(false);
        setScheduleForm({
            vehicleId: '',
            templateId: '',
            scheduledDate: '',
            autoCreateRequest: true,
            notifyDaysBefore: 7,
            recurring: false,
            recurringInterval: 90
        });
        alert('Schedule created successfully!');
    };

    const handleCreateTemplate = () => {
        const newTemplate: MaintenanceTemplate = {
            id: `tmpl-${Date.now()}`,
            name: templateForm.name,
            maintenanceType: templateForm.maintenanceType,
            description: templateForm.description,
            estimatedDuration: templateForm.estimatedDuration,
            estimatedCost: templateForm.estimatedCost,
            requiredParts: [],
            checklistItems: [],
            intervalDays: templateForm.intervalDays
        };

        setTemplates([...templates, newTemplate]);
        setShowTemplateModal(false);
        setTemplateForm({
            name: '',
            maintenanceType: MaintenanceType.PREVENTIVE,
            description: '',
            estimatedDuration: 1,
            estimatedCost: 0,
            intervalDays: 90
        });
        alert('Template created successfully!');
    };

    const getDaysUntil = (date: string) => {
        const today = new Date();
        const scheduled = new Date(date);
        const diff = scheduled.getTime() - today.getTime();
        return Math.ceil(diff / (1000 * 60 * 60 * 24));
    };

    const getStatusColor = (daysUntil: number) => {
        if (daysUntil < 0) return 'bg-red-500/20 text-red-700 border-red-300';
        if (daysUntil <= 7) return 'bg-amber-500/20 text-yellow-700 border-yellow-300';
        return 'bg-emerald-500/20 text-green-700 border-green-300';
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white">Preventive Maintenance Schedule</h1>
                    <p className="mt-1 text-slate-500">Automated maintenance scheduling and templates</p>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={() => setShowTemplateModal(true)}
                        className="rounded-lg bg-slate-600 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
                    >
                        + Template
                    </button>
                    <button
                        onClick={() => setShowScheduleModal(true)}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                    >
                        + Schedule
                    </button>
                </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="rounded-xl border border-white/10 bg-slate-900 p-6 shadow-sm">
                    <p className="text-sm text-slate-500">Total Schedules</p>
                    <p className="text-2xl font-bold text-white">{schedules.length}</p>
                </div>
                <div className="rounded-xl border border-yellow-200 bg-amber-500/10 p-6 shadow-sm">
                    <p className="text-sm text-yellow-700">Due This Week</p>
                    <p className="text-2xl font-bold text-amber-300">
                        {schedules.filter(s => getDaysUntil(s.scheduledDate) <= 7 && getDaysUntil(s.scheduledDate) >= 0).length}
                    </p>
                </div>
                <div className="rounded-xl border border-red-200 bg-red-500/10 p-6 shadow-sm">
                    <p className="text-sm text-red-700">Overdue</p>
                    <p className="text-2xl font-bold text-red-300">
                        {schedules.filter(s => getDaysUntil(s.scheduledDate) < 0).length}
                    </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-slate-900 p-6 shadow-sm">
                    <p className="text-sm text-slate-500">Templates</p>
                    <p className="text-2xl font-bold text-white">{templates.length}</p>
                </div>
            </div>

            {/* Schedules List */}
            <div className="rounded-xl border border-white/10 bg-slate-900 shadow-sm">
                <div className="p-6 border-b border-white/10">
                    <h3 className="text-lg font-bold text-white">Upcoming Schedules</h3>
                </div>
                <div className="divide-y divide-white/10">
                    {schedules.sort((a, b) => new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime()).map(schedule => {
                        const daysUntil = getDaysUntil(schedule.scheduledDate);
                        return (
                            <div key={schedule.id} className="p-6 hover:bg-white/5 transition-colors">
                                <div className="flex items-start justify-between">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-3 mb-2">
                                            <h4 className="text-base font-bold text-white">{schedule.description}</h4>
                                            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border ${getStatusColor(daysUntil)}`}>
                                                {daysUntil < 0 ? `${Math.abs(daysUntil)} days overdue` : daysUntil === 0 ? 'Today' : `In ${daysUntil} days`}
                                            </span>
                                            {schedule.recurring && (
                                                <span className="inline-flex items-center rounded-full bg-blue-500/20 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                                                    Recurring
                                                </span>
                                            )}
                                        </div>
                                        <div className="grid grid-cols-4 gap-4 text-sm">
                                            <div>
                                                <span className="text-slate-500">Vehicle:</span>
                                                <span className="ml-2 font-medium text-white">{schedule.vehicleId.toUpperCase()}</span>
                                            </div>
                                            <div>
                                                <span className="text-slate-500">Date:</span>
                                                <span className="ml-2 font-medium text-white">{new Date(schedule.scheduledDate).toLocaleDateString()}</span>
                                            </div>
                                            <div>
                                                <span className="text-slate-500">Est. Cost:</span>
                                                <span className="ml-2 font-medium text-white">{formatCurrency(schedule.estimatedCost)}</span>
                                            </div>
                                            <div>
                                                <span className="text-slate-500">Auto-Create:</span>
                                                <span className="ml-2 font-medium text-white">{schedule.autoCreateRequest ? 'Yes' : 'No'}</span>
                                            </div>
                                        </div>
                                        {schedule.recurring && (
                                            <p className="text-xs text-slate-500 mt-2">
                                                Repeats every {schedule.recurringInterval} days
                                            </p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Templates */}
            <div className="rounded-xl border border-white/10 bg-slate-900 shadow-sm">
                <div className="p-6 border-b border-white/10">
                    <h3 className="text-lg font-bold text-white">Maintenance Templates</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-6">
                    {templates.map(template => (
                        <div key={template.id} className="rounded-lg border border-white/10 bg-slate-800/50 p-4">
                            <h4 className="text-base font-bold text-white mb-2">{template.name}</h4>
                            <p className="text-sm text-slate-600 mb-3">{template.description}</p>
                            <div className="grid grid-cols-2 gap-2 text-xs text-slate-300">
                                <div>
                                    <span className="text-slate-500">Duration:</span> {template.estimatedDuration}h
                                </div>
                                <div>
                                    <span className="text-slate-500">Cost:</span> {formatCurrency(template.estimatedCost)}
                                </div>
                                <div>
                                    <span className="text-slate-500">Interval:</span> {template.intervalDays} days
                                </div>
                                <div>
                                    <span className="text-slate-500">Type:</span> {template.maintenanceType}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Schedule Modal */}
            {showScheduleModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="bg-slate-900 rounded-2xl w-full max-w-2xl shadow-2xl">
                        <div className="p-6 border-b border-white/10">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-bold text-white">Create Schedule</h3>
                                <button onClick={() => setShowScheduleModal(false)} className="text-slate-400 hover:text-slate-300">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                        </div>

                        <div className="p-6 space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-2">Vehicle ID</label>
                                    <input
                                        type="text"
                                        value={scheduleForm.vehicleId}
                                        onChange={(e) => setScheduleForm({ ...scheduleForm, vehicleId: e.target.value })}
                                        className="w-full rounded-lg border border-white/15 px-3 py-2 bg-slate-900 text-white"
                                        placeholder="e.g., v1"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-2">Template</label>
                                    <select
                                        value={scheduleForm.templateId}
                                        onChange={(e) => setScheduleForm({ ...scheduleForm, templateId: e.target.value })}
                                        className="w-full rounded-lg border border-white/15 px-3 py-2 bg-slate-900 text-white"
                                    >
                                        <option value="">Select template</option>
                                        {templates.map(t => (
                                            <option key={t.id} value={t.id}>{t.name}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-2">Scheduled Date</label>
                                <input
                                    type="date"
                                    value={scheduleForm.scheduledDate}
                                    onChange={(e) => setScheduleForm({ ...scheduleForm, scheduledDate: e.target.value })}
                                    className="w-full rounded-lg border border-white/15 px-3 py-2 bg-slate-900 text-white"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-2">Notify Days Before</label>
                                <input
                                    type="number"
                                    value={scheduleForm.notifyDaysBefore}
                                    onChange={(e) => setScheduleForm({ ...scheduleForm, notifyDaysBefore: Number(e.target.value) })}
                                    className="w-full rounded-lg border border-white/15 px-3 py-2 bg-slate-900 text-white"
                                />
                            </div>

                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    id="autoCreate"
                                    checked={scheduleForm.autoCreateRequest}
                                    onChange={(e) => setScheduleForm({ ...scheduleForm, autoCreateRequest: e.target.checked })}
                                    className="h-4 w-4 rounded border-white/15 text-blue-600"
                                />
                                <label htmlFor="autoCreate" className="text-sm text-slate-300">
                                    Auto-create maintenance request
                                </label>
                            </div>

                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    id="recurring"
                                    checked={scheduleForm.recurring}
                                    onChange={(e) => setScheduleForm({ ...scheduleForm, recurring: e.target.checked })}
                                    className="h-4 w-4 rounded border-white/15 text-blue-600"
                                />
                                <label htmlFor="recurring" className="text-sm text-slate-300">
                                    Recurring schedule
                                </label>
                            </div>

                            {scheduleForm.recurring && (
                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-2">Interval (days)</label>
                                    <input
                                        type="number"
                                        value={scheduleForm.recurringInterval}
                                        onChange={(e) => setScheduleForm({ ...scheduleForm, recurringInterval: Number(e.target.value) })}
                                        className="w-full rounded-lg border border-white/15 px-3 py-2 bg-slate-900 text-white"
                                    />
                                </div>
                            )}
                        </div>

                        <div className="p-6 border-t border-white/10 flex justify-end gap-3">
                            <button
                                onClick={() => setShowScheduleModal(false)}
                                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 hover:bg-white/10"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleCreateSchedule}
                                className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700"
                            >
                                Create Schedule
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Template Modal */}
            {showTemplateModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="bg-slate-900 rounded-2xl w-full max-w-2xl shadow-2xl">
                        <div className="p-6 border-b border-white/10">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-bold text-white">Create Template</h3>
                                <button onClick={() => setShowTemplateModal(false)} className="text-slate-400 hover:text-slate-300">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                        </div>

                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-2">Template Name</label>
                                <input
                                    type="text"
                                    value={templateForm.name}
                                    onChange={(e) => setTemplateForm({ ...templateForm, name: e.target.value })}
                                    className="w-full rounded-lg border border-white/15 px-3 py-2 bg-slate-900 text-white"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-2">Description</label>
                                <textarea
                                    rows={3}
                                    value={templateForm.description}
                                    onChange={(e) => setTemplateForm({ ...templateForm, description: e.target.value })}
                                    className="w-full rounded-lg border border-white/15 px-3 py-2 bg-slate-900 text-white"
                                />
                            </div>

                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-2">Duration (hours)</label>
                                    <input
                                        type="number"
                                        value={templateForm.estimatedDuration}
                                        onChange={(e) => setTemplateForm({ ...templateForm, estimatedDuration: Number(e.target.value) })}
                                        className="w-full rounded-lg border border-white/15 px-3 py-2 bg-slate-900 text-white"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-2">Cost (AED)</label>
                                    <input
                                        type="number"
                                        value={templateForm.estimatedCost}
                                        onChange={(e) => setTemplateForm({ ...templateForm, estimatedCost: Number(e.target.value) })}
                                        className="w-full rounded-lg border border-white/15 px-3 py-2 bg-slate-900 text-white"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-2">Interval (days)</label>
                                    <input
                                        type="number"
                                        value={templateForm.intervalDays}
                                        onChange={(e) => setTemplateForm({ ...templateForm, intervalDays: Number(e.target.value) })}
                                        className="w-full rounded-lg border border-white/15 px-3 py-2 bg-slate-900 text-white"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="p-6 border-t border-white/10 flex justify-end gap-3">
                            <button
                                onClick={() => setShowTemplateModal(false)}
                                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 hover:bg-white/10"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleCreateTemplate}
                                className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700"
                            >
                                Create Template
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
