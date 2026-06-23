'use client';
import React, { useState, useEffect, useCallback } from 'react';

interface Config {
  id?: string; type: string; provider: string; host?: string; port?: string;
  username?: string; password?: string; apiKey?: string; apiSecret?: string;
  isEnabled: boolean; updatedAt?: string;
}
interface IntegrationField {
  key: keyof Config;
  label: string;
  ph: string;
  secret?: boolean;
}

const INTEGRATION_META = [
  {
    type: 'WEBHOOK', label: 'Webhooks', icon: 'H',
    color: 'from-violet-500 to-purple-600',
    description: 'HTTP POST webhooks for external system integration. Triggers on contract creation, payment events, booking confirmations, and incident reports.',
    fields: [
      { key: 'host',      label: 'Webhook URL',         ph: 'https://your-system.com/webhook' },
      { key: 'apiKey',    label: 'Secret / Auth Header', ph: 'Bearer token or HMAC secret', secret: true },
      { key: 'provider',  label: 'System Name',          ph: 'e.g. Zapier, Make, Custom API' },
    ] satisfies IntegrationField[],
    events: ['contract.created','contract.activated','contract.terminated','payment.received','payment.overdue','booking.confirmed','incident.logged'],
  },
  {
    type: 'ERP_SAP', label: 'SAP ERP', icon: 'S',
    color: 'from-blue-600 to-indigo-700',
    description: 'Sync invoices, payments, and AR data to SAP. Invoice records and receipts flow automatically on creation.',
    fields: [
      { key: 'provider',  label: 'SAP System',      ph: 'SAP S/4HANA, SAP Business One' },
      { key: 'host',      label: 'SAP Host / URL',  ph: 'https://sap.yourcompany.com' },
      { key: 'port',      label: 'Port',            ph: '443' },
      { key: 'username',  label: 'SAP Username',    ph: 'xl_integration_user' },
      { key: 'password',  label: 'SAP Password',    ph: '**hidden**', secret: true },
      { key: 'apiKey',    label: 'Client ID',       ph: 'OAuth Client ID' },
      { key: 'apiSecret', label: 'Client Secret',   ph: '**hidden**', secret: true },
    ] satisfies IntegrationField[],
  },
  {
    type: 'ERP_ORACLE', label: 'Oracle / NetSuite', icon: 'O',
    color: 'from-red-600 to-rose-700',
    description: 'Push financial transactions to Oracle Fusion or NetSuite. Supports invoice sync, payment allocation, and customer account creation.',
    fields: [
      { key: 'provider',  label: 'Oracle Product',  ph: 'Oracle Fusion, NetSuite' },
      { key: 'host',      label: 'Instance URL',    ph: 'https://xxx.oracle.com' },
      { key: 'username',  label: 'Username',        ph: '' },
      { key: 'password',  label: 'Password',        ph: '**hidden**', secret: true },
      { key: 'apiKey',    label: 'Consumer Key',    ph: '' },
      { key: 'apiSecret', label: 'Consumer Secret', ph: '**hidden**', secret: true },
    ] satisfies IntegrationField[],
  },
  {
    type: 'ERP_SAGE', label: 'Sage / QuickBooks', icon: 'Q',
    color: 'from-green-600 to-teal-700',
    description: 'Connect to Sage 50/200/300 or QuickBooks Online for invoice export, bank reconciliation, and VAT return preparation.',
    fields: [
      { key: 'provider',  label: 'Product',         ph: 'Sage 300, QuickBooks Online' },
      { key: 'host',      label: 'API Endpoint',    ph: 'https://api.quickbooks.intuit.com' },
      { key: 'apiKey',    label: 'Client ID',       ph: '' },
      { key: 'apiSecret', label: 'Client Secret',   ph: '**hidden**', secret: true },
      { key: 'username',  label: 'Company ID',      ph: '' },
    ] satisfies IntegrationField[],
  },
  {
    type: 'GPS', label: 'GPS / Telematics', icon: 'G',
    color: 'from-amber-500 to-orange-600',
    description: 'Connect a GPS/telematics provider to auto-capture odometer readings, vehicle location, and trigger mileage overage calculations.',
    fields: [
      { key: 'provider',  label: 'GPS Provider',    ph: 'e.g. Geotab, Verizon Connect, Samsara' },
      { key: 'host',      label: 'API Base URL',    ph: 'https://api.gpsvendor.com/v1' },
      { key: 'apiKey',    label: 'API Key',         ph: '**hidden**', secret: true },
      { key: 'apiSecret', label: 'API Secret',      ph: '**hidden**', secret: true },
      { key: 'username',  label: 'Account / Org ID', ph: '' },
    ] satisfies IntegrationField[],
  },
];

export default function IntegrationsPage() {
  const [configs, setConfigs]     = useState<Record<string, Config>>({});
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState<string | null>(null);
  const [msg, setMsg]             = useState<Record<string, string>>({});
  const [editForms, setEditForms] = useState<Record<string, Partial<Config>>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/integration-configs');
      const data = await res.json();
      const map: Record<string, Config> = {};
      (Array.isArray(data) ? data : []).forEach((c: Config) => { map[c.type] = c; });
      setConfigs(map);
      const forms: Record<string, Partial<Config>> = {};
      INTEGRATION_META.forEach(i => { forms[i.type] = map[i.type] ?? { type: i.type, provider: '', isEnabled: false }; });
      setEditForms(forms);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const setField = (type: string, key: string, value: string) =>
    setEditForms(p => ({ ...p, [type]: { ...p[type], [key]: value } }));

  const toggleEnabled = async (type: string) => {
    const current = configs[type];
    const newVal = !(current?.isEnabled ?? false);
    await save(type, { ...editForms[type], isEnabled: newVal });
  };

  const save = async (type: string, overrideData?: Partial<Config>) => {
    setSaving(type); setMsg(p => ({ ...p, [type]: '' }));
    try {
      const payload = { ...(overrideData ?? editForms[type]), type, updatedAt: new Date().toISOString() };
      if (!payload.provider) { setMsg(p => ({ ...p, [type]: 'System Name / Provider is required' })); return; }
      const res = await fetch('/api/integration-configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-confirm-action': 'integration-config.update' },
        body: JSON.stringify(payload),
      });
      const d = await res.json().catch(() => ({}));
      if (res.status === 428) {
        setMsg(p => ({ ...p, [type]: `Queued for approval: ${d.approvalRequest?.id ?? 'pending request'}` }));
        return;
      }
      if (!res.ok) {
        throw new Error(d.error ?? `Save failed (${res.status})`);
      }
      setMsg(p => ({ ...p, [type]: 'Saved successfully' }));
      setTimeout(() => setMsg(p => ({ ...p, [type]: '' })), 3000);
      load();
    } catch (e) {
      setMsg(p => ({ ...p, [type]: e instanceof Error ? e.message : 'Failed to save' }));
    } finally { setSaving(null); }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="text-slate-400 animate-pulse">Loading integrations...</div>
    </div>
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold text-white mb-2">Integrations & ERP</h1>
        <p className="text-slate-400">Configure webhooks, ERP connectors, and GPS/telematics providers</p>
      </div>

      {INTEGRATION_META.map(intg => {
        const existing = configs[intg.type];
        const form     = editForms[intg.type] ?? {};
        const isActive = existing?.isEnabled ?? false;
        const isSaving = saving === intg.type;
        const message  = msg[intg.type];

        return (
          <div key={intg.type} className="bg-slate-800/50 border border-white/10 rounded-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-white/10">
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${intg.color} flex items-center justify-center text-white font-bold text-lg`}>
                  {intg.icon}
                </div>
                <div>
                  <div className="flex items-center gap-3">
                    <h2 className="text-lg font-semibold text-white">{intg.label}</h2>
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${isActive ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-slate-700 text-slate-400 border-white/10'}`}>
                      {isActive ? 'Connected' : 'Not Connected'}
                    </span>
                    {existing?.updatedAt && (
                      <span className="text-xs text-slate-500">
                        Last saved: {new Date(existing.updatedAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  <p className="text-slate-400 text-sm">{intg.description}</p>
                </div>
              </div>
              <button
                onClick={() => toggleEnabled(intg.type)}
                className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${isActive ? 'bg-rose-500/20 text-rose-400 border-rose-500/30 hover:bg-rose-500/30' : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/30'}`}>
                {isActive ? 'Disconnect' : 'Connect'}
              </button>
            </div>

            {/* Fields */}
            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {intg.fields.map(f => (
                  <div key={f.key}>
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">{f.label}</label>
                    <input
                      type={f.secret ? 'password' : 'text'}
                      value={String(form[f.key] ?? '')}
                      onChange={e => setField(intg.type, f.key, e.target.value)}
                      placeholder={f.ph}
                      className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 text-sm focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                ))}
              </div>

              {/* Webhook events */}
              {'events' in intg && Array.isArray(intg.events) && (
                <div className="mt-4">
                  <p className="text-xs text-slate-500 font-medium uppercase tracking-wider mb-2">Trigger Events</p>
                  <div className="flex flex-wrap gap-2">
                    {intg.events.map((ev: string) => (
                      <span key={ev} className="text-xs font-mono px-2 py-1 rounded bg-slate-700 text-slate-300 border border-white/10">{ev}</span>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-4 mt-5">
                <button
                  onClick={() => save(intg.type)}
                  disabled={isSaving}
                  className={`px-6 py-2.5 rounded-xl bg-gradient-to-r ${intg.color} text-white font-medium hover:opacity-90 disabled:opacity-50 transition-all text-sm`}>
                  {isSaving ? 'Saving...' : 'Save Configuration'}
                </button>
                {message && (
                  <span className={`text-sm ${message.includes('success') || message.includes('Saved') ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {message}
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
