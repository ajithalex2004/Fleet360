'use client';

import { useState, useEffect } from 'react';

// Enum matches Prisma
enum NotificationEvent {
    SR_CREATED = 'SR_CREATED',
    SR_ASSIGNED = 'SR_ASSIGNED',
    SR_COMPLETED = 'SR_COMPLETED',
    MAINTENANCE_REQUESTED = 'MAINTENANCE_REQUESTED',
    MAINTENANCE_APPROVED = 'MAINTENANCE_APPROVED',
    MAINTENANCE_REJECTED = 'MAINTENANCE_REJECTED',
    MAINTENANCE_COMPLETED = 'MAINTENANCE_COMPLETED',
    QUOTATION_SUBMITTED = 'QUOTATION_SUBMITTED',
    QUOTATION_APPROVED = 'QUOTATION_APPROVED',
    QUOTATION_REJECTED = 'QUOTATION_REJECTED',
    INVOICE_GENERATED = 'INVOICE_GENERATED',
    ALERT_TRIGGERED = 'ALERT_TRIGGERED'
}

const EventLabels: Record<string, string> = {
    SR_CREATED: 'Service Request Created',
    SR_ASSIGNED: 'Service Request Assigned',
    SR_COMPLETED: 'Service Request Completed',
    MAINTENANCE_REQUESTED: 'Maintenance Requested',
    MAINTENANCE_APPROVED: 'Maintenance Approved',
    MAINTENANCE_REJECTED: 'Maintenance Rejected',
    MAINTENANCE_COMPLETED: 'Maintenance Completed',
    QUOTATION_SUBMITTED: 'Quotation Submitted',
    QUOTATION_APPROVED: 'Quotation Approved',
    QUOTATION_REJECTED: 'Quotation Rejected',
    INVOICE_GENERATED: 'Invoice Generated',
    ALERT_TRIGGERED: 'System Alert Triggered'
};

const RecipientOptions = ['REQUESTER', 'ASSIGNEE', 'FLEET_MANAGER', 'ADMIN', 'CUSTOM'];

interface Rule {
    id: string;
    event: NotificationEvent;
    channels: string[];
    recipientTypes: string[];
    specificRecipientIds: string[];
    templateId?: string;
    template?: Template;
    isEnabled: boolean;
}

interface Template {
    id: string;
    name: string;
    event: NotificationEvent;
    channel: string;
    subject?: string;
    body: string;
    isActive: boolean;
}

export default function NotificationRulesPage() {
    const [rules, setRules] = useState<Rule[]>([]);
    const [selectedEvent, setSelectedEvent] = useState<NotificationEvent | null>(null);
    const [loading, setLoading] = useState(true);

    // Edit State
    const [editingRule, setEditingRule] = useState<Rule | null>(null);
    const [templateSubject, setTemplateSubject] = useState('');
    const [templateBody, setTemplateBody] = useState('');
    const [searchTerm, setSearchTerm] = useState('');

    // Custom Recipient State
    const [customName, setCustomName] = useState('');
    const [customEmail, setCustomEmail] = useState('');

    const ChannelColors: Record<string, string> = {
        'EMAIL': 'bg-blue-100 border-blue-300 text-blue-800',
        'SMS': 'bg-amber-100 border-amber-300 text-amber-800',
        'WHATSAPP': 'bg-emerald-100 border-emerald-300 text-emerald-800'
    };

    const RecipientColors: Record<string, string> = {
        'REQUESTER': 'bg-orange-100 border-orange-300 text-orange-800',
        'ASSIGNEE': 'bg-violet-100 border-violet-300 text-violet-800',
        'FLEET_MANAGER': 'bg-sky-100 border-sky-300 text-sky-800',
        'ADMIN': 'bg-rose-100 border-rose-300 text-rose-800',
        'CUSTOM': 'bg-slate-100 border-slate-300 text-slate-800'
    };

    useEffect(() => {
        fetchRules();
    }, []);

    const fetchRules = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/admin/notification-rules');
            if (res.ok) {
                const data = await res.json();
                setRules(data);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleEventSelect = (event: NotificationEvent) => {
        setSelectedEvent(event);
        const existingRule = rules.find(r => r.event === event);

        if (existingRule) {
            setEditingRule({ ...existingRule });
            setTemplateSubject(existingRule.template?.subject || '');
            setTemplateBody(existingRule.template?.body || '');
        } else {
            // Default new rule
            setEditingRule({
                id: '',
                event: event,
                channels: ['EMAIL'],
                recipientTypes: ['FLEET_MANAGER'],
                specificRecipientIds: [],
                isEnabled: true
            });
            setTemplateSubject(`${EventLabels[event]} Notification`);
            setTemplateBody(`Hello,\n\nThis is a notification for ${EventLabels[event]}.\n\nReference: {{readableId}}`);
        }
    };

    const saveRule = async () => {
        if (!editingRule) return;

        // 1. Save/Create Template first (simplified logic: one template per rule for now)
        try {
            const templateData = {
                name: `${editingRule.event} Template`,
                event: editingRule.event,
                channel: 'EMAIL', // Defaulting to Email template for now
                subject: templateSubject,
                body: templateBody,
                isActive: true
            };

            // Only POST enabled for simplicity in this version, effectively "Upsert" logic needed on backend or here
            // For now, assuming we create a new template ID or update existing if we had tracking.

            // To properly implement, we'd loop through channels and create templates for each.
            // Simplified: We just save the Rule. Middleware/Backend should handle Template creation if we want to be robust.
            // BUT, since we are frontend-focused, let's just save the Rule and assume Template logic is handled or we mock it.

            // ACTUALLY, let's just save the Rule to the API we created.
            // The API we created expects a 'templateId'. We need to create the template first.

            const templateRes = await fetch('/api/admin/notification-templates', {
                method: 'POST',
                body: JSON.stringify(templateData)
            });
            const template = await templateRes.json();

            const ruleData = {
                ...editingRule,
                templateId: template.id
            };

            const method = editingRule.id ? 'PUT' : 'POST';
            const res = await fetch('/api/admin/notification-rules', {
                method,
                body: JSON.stringify(ruleData)
            });

            if (res.ok) {
                alert('Configuration Saved!');
                fetchRules();
            } else {
                alert('Failed to save.');
            }
        } catch (err) {
            console.error(err);
            alert('Error saving configuration.');
        }
    };

    const toggleChannel = (channel: string) => {
        if (!editingRule) return;
        const channels = editingRule.channels.includes(channel)
            ? editingRule.channels.filter(c => c !== channel)
            : [...editingRule.channels, channel];
        setEditingRule({ ...editingRule, channels });
    };

    const toggleRecipient = (type: string) => {
        if (!editingRule) return;
        const recipientTypes = editingRule.recipientTypes.includes(type)
            ? editingRule.recipientTypes.filter(t => t !== type)
            : [...editingRule.recipientTypes, type];
        setEditingRule({ ...editingRule, recipientTypes });
    };

    const addCustomRecipient = () => {
        if (!editingRule || !customName || !customEmail) return;

        const recipientObj = { name: customName, email: customEmail };
        const recipientString = JSON.stringify(recipientObj);

        // Avoid duplicates
        if (!editingRule.specificRecipientIds.includes(recipientString)) {
            setEditingRule({
                ...editingRule,
                specificRecipientIds: [...editingRule.specificRecipientIds, recipientString]
            });
        }

        setCustomName('');
        setCustomEmail('');
    };

    const removeCustomRecipient = (idToRemove: string) => {
        if (!editingRule) return;
        setEditingRule({
            ...editingRule,
            specificRecipientIds: editingRule.specificRecipientIds.filter(id => id !== idToRemove)
        });
    };

    const parseRecipient = (recipientString: string) => {
        try {
            const parsed = JSON.parse(recipientString);
            return parsed.name ? `${parsed.name} (${parsed.email})` : parsed.email || recipientString;
        } catch (e) {
            return recipientString;
        }
    };

    return (
        <div className="flex h-screen bg-slate-50">
            {/* Sidebar List of Events */}
            <div className="w-80 bg-white border-r border-slate-200 overflow-y-auto">
                <div className="p-4 border-b border-slate-200">
                    <h2 className="font-bold text-slate-800">System Events</h2>
                    <p className="text-xs text-slate-500">Select an event to configure</p>
                </div>
                <div>
                    {Object.keys(NotificationEvent).map((key) => {
                        const event = key as NotificationEvent;
                        const isConfigured = rules.some(r => r.event === event && r.isEnabled);
                        return (
                            <div
                                key={event}
                                onClick={() => handleEventSelect(event)}
                                className={`p-4 border-b border-slate-100 cursor-pointer hover:bg-slate-50 ${selectedEvent === event ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''}`}
                            >
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-sm font-medium text-slate-900">{EventLabels[event]}</span>
                                    {isConfigured && <span className="h-2 w-2 rounded-full bg-green-500"></span>}
                                </div>
                                <p className="text-xs text-slate-500">{event}</p>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Config Area */}
            <div className="flex-1 overflow-y-auto">
                {selectedEvent && editingRule ? (
                    <div className="p-8 max-w-4xl mx-auto space-y-8">
                        <div>
                            <h1 className="text-2xl font-bold text-slate-900">{EventLabels[selectedEvent]}</h1>
                            <p className="text-slate-500">Configure notifications for this event.</p>
                        </div>

                        {/* Enable/Disable Toggle */}
                        <div className="flex items-center gap-3">
                            <span className="text-sm font-medium text-slate-700">Notification Status:</span>
                            <button
                                onClick={() => setEditingRule({ ...editingRule, isEnabled: !editingRule.isEnabled })}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${editingRule.isEnabled ? 'bg-blue-600' : 'bg-slate-200'}`}
                            >
                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out ${editingRule.isEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                            </button>
                            <span className={`text-sm ${editingRule.isEnabled ? 'text-blue-600 font-medium' : 'text-slate-500'}`}>
                                {editingRule.isEnabled ? 'Active' : 'Inactive'}
                            </span>
                        </div>

                        {/* Channels */}
                        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                            <h3 className="font-bold text-slate-800 mb-4">Channels</h3>
                            <div className="flex gap-4">
                                {['EMAIL', 'SMS', 'WHATSAPP'].map(ch => (
                                    <button
                                        key={ch}
                                        onClick={() => toggleChannel(ch)}
                                        className={`px-4 py-2 rounded-lg border text-sm font-medium transition-all ${editingRule.channels.includes(ch)
                                            ? `${ChannelColors[ch] || 'bg-slate-100'} shadow-sm scale-105`
                                            : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                                            }`}
                                    >
                                        <div className="flex items-center gap-2">
                                            {ch}
                                            {editingRule.channels.includes(ch) && (
                                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                                                    <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" />
                                                </svg>
                                            )}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Recipients */}
                        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                            <h3 className="font-bold text-slate-800 mb-4">Recipients</h3>
                            <div className="flex flex-wrap gap-3">
                                {RecipientOptions.map(type => (
                                    <button
                                        key={type}
                                        onClick={() => toggleRecipient(type)}
                                        className={`px-3 py-1.5 rounded-full border text-xs font-bold transition-all ${editingRule.recipientTypes.includes(type)
                                            ? `${RecipientColors[type] || 'bg-gray-100'} shadow-sm scale-105`
                                            : 'bg-white border-slate-200 text-slate-400 hover:bg-slate-50'
                                            }`}
                                    >
                                        {type.replace('_', ' ')}
                                    </button>
                                ))}
                            </div>

                            {/* Custom Recipient Inputs */}
                            {editingRule.recipientTypes.includes('CUSTOM') && (
                                <div className="mt-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
                                    <h4 className="text-sm font-semibold text-slate-700 mb-3">Manage Custom Recipients</h4>

                                    <div className="flex gap-2 mb-4">
                                        <input
                                            type="text"
                                            placeholder="Name"
                                            value={customName}
                                            onChange={(e) => setCustomName(e.target.value)}
                                            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                        />
                                        <input
                                            type="email"
                                            placeholder="Email"
                                            value={customEmail}
                                            onChange={(e) => setCustomEmail(e.target.value)}
                                            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                        />
                                        <button
                                            onClick={addCustomRecipient}
                                            disabled={!customName || !customEmail}
                                            className="px-4 py-2 bg-slate-800 text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-slate-900 transition-colors"
                                        >
                                            Add
                                        </button>
                                    </div>

                                    <div className="space-y-2">
                                        {editingRule.specificRecipientIds.map((recipient, idx) => (
                                            <div key={idx} className="flex justify-between items-center bg-white px-3 py-2 rounded border border-slate-200 text-sm">
                                                <span className="text-slate-700 font-medium">
                                                    {parseRecipient(recipient)}
                                                </span>
                                                <button
                                                    onClick={() => removeCustomRecipient(recipient)}
                                                    className="text-red-500 hover:text-red-700 text-xs font-bold"
                                                >
                                                    Remove
                                                </button>
                                            </div>
                                        ))}
                                        {editingRule.specificRecipientIds.length === 0 && (
                                            <p className="text-xs text-slate-400 italic">No custom recipients added yet.</p>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Template Editor */}
                        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                            <h3 className="font-bold text-slate-800 mb-4">Template Configuration</h3>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Subject Line</label>
                                    <input
                                        type="text"
                                        value={templateSubject}
                                        onChange={e => setTemplateSubject(e.target.value)}
                                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">
                                        Body Content
                                        <span className="ml-2 text-xs font-normal text-slate-400">Supported variables: {'{{requestId}}'}, {'{{status}}'}, {'{{assignee}}'}</span>
                                    </label>
                                    <textarea
                                        rows={6}
                                        value={templateBody}
                                        onChange={e => setTemplateBody(e.target.value)}
                                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-end pt-4">
                            <button
                                onClick={saveRule}
                                className="px-6 py-2.5 bg-blue-600 text-white rounded-xl font-medium shadow-lg shadow-blue-500/30 hover:bg-blue-700 transition-all hover:scale-105 active:scale-95"
                            >
                                Save Configuration
                            </button>
                        </div>

                    </div>
                ) : (
                    <div className="flex h-full items-center justify-center text-slate-400">
                        <div className="text-center">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-12 h-12 mx-auto mb-3 opacity-50">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l.546.944a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 0 1 0 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-.547.944a1.125 1.125 0 0 1-1.37.491l-1.216-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-1.094c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-.547-.943a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l.547-.944a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281Z" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                            </svg>
                            Select an event to configure
                        </div>
                    </div>
                )
                }
            </div>
        </div>
    );
}
