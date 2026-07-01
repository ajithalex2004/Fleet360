'use client';
import React, { useState, useEffect, useCallback } from 'react';
import PasswordInput from '@/components/ui/PasswordInput';
import { usePermissions } from '@/contexts/PermissionContext';

/* ── Types ──────────────────────────────────────────────────── */
type Settings = Record<string, string>;

interface SettingField {
  key: string;
  label: string;
  description: string;
  type: 'select' | 'toggle' | 'number' | 'text' | 'password' | 'email' | 'url';
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  unit?: string;
  placeholder?: string;
}
interface Section {
  id: string;
  label: string;
  icon: string;
  color: string;
  fields: SettingField[];
}

/* ── Section Definitions ─────────────────────────────────── */
const SECTIONS: Section[] = [
  /* ── Platform ──────────────────────────────────────────── */
  {
    id: 'general', label: 'General', icon: '🌐', color: 'blue',
    fields: [
      {
        key: 'timezone', label: 'Timezone', description: 'Default timezone for date/time display', type: 'select',
        options: [
          { value: 'Asia/Dubai',       label: 'Asia/Dubai (UAE, GMT+4)' },
          { value: 'Asia/Riyadh',      label: 'Asia/Riyadh (KSA, GMT+3)' },
          { value: 'Europe/London',    label: 'Europe/London (GMT+0/1)' },
          { value: 'America/New_York', label: 'America/New_York (GMT-5/4)' },
          { value: 'UTC',              label: 'UTC (GMT+0)' },
        ],
      },
      {
        key: 'locale', label: 'Locale', description: 'Language and region for formatting', type: 'select',
        options: [
          { value: 'en-AE', label: 'English (UAE) — en-AE' },
          { value: 'ar-AE', label: 'العربية (الإمارات) — ar-AE' },
          { value: 'en-US', label: 'English (US) — en-US' },
          { value: 'en-GB', label: 'English (UK) — en-GB' },
        ],
      },
      {
        key: 'date_format', label: 'Date Format', description: 'How dates appear throughout the system', type: 'select',
        options: [
          { value: 'YYYY-MM-DD',  label: 'YYYY-MM-DD (ISO 8601)' },
          { value: 'DD/MM/YYYY',  label: 'DD/MM/YYYY (UK/UAE)' },
          { value: 'MM/DD/YYYY',  label: 'MM/DD/YYYY (US)' },
          { value: 'DD-MMM-YYYY', label: 'DD-MMM-YYYY (e.g. 22-Apr-2026)' },
        ],
      },
    ],
  },
  {
    id: 'finance', label: 'Finance', icon: '💲', color: 'emerald',
    fields: [
      {
        key: 'currency', label: 'Currency', description: 'Default currency for invoices and fees', type: 'select',
        options: [
          { value: 'AED', label: 'AED — UAE Dirham' },
          { value: 'USD', label: 'USD — US Dollar' },
          { value: 'EUR', label: 'EUR — Euro' },
          { value: 'GBP', label: 'GBP — British Pound' },
          { value: 'SAR', label: 'SAR — Saudi Riyal' },
        ],
      },
      { key: 'tax_enabled',        label: 'Tax / VAT Enabled',  description: 'Enable tax calculations on invoices',        type: 'toggle' },
      { key: 'tax_rate',           label: 'Tax Rate (%)',        description: 'Default VAT/tax percentage',                 type: 'number', min: 0, max: 30, unit: '%' },
      { key: 'late_fee_enabled',   label: 'Late Fee Enabled',   description: 'Auto-apply late fees on overdue invoices',   type: 'toggle' },
      { key: 'late_fee_percentage',label: 'Late Fee (%)',        description: 'Percentage charged for late payments/month', type: 'number', min: 0, max: 50, unit: '%' },
    ],
  },
  {
    id: 'feature_flags', label: 'Feature Flags', icon: '⚡', color: 'amber',
    fields: [
      { key: 'ff_whatsapp',        label: 'WhatsApp Integration',  description: 'Enable WhatsApp AI support bot',            type: 'toggle' },
      { key: 'ff_esign',           label: 'E-Signing',             description: 'Enable digital e-signing for agreements',   type: 'toggle' },
      { key: 'ff_predictive_maint',label: 'Predictive Maintenance',description: 'AI-powered maintenance predictions',        type: 'toggle' },
      { key: 'ff_ai_dispatch',     label: 'AI Dispatch Optimizer', description: 'Machine learning dispatch routing',         type: 'toggle' },
      { key: 'ff_customer_portal', label: 'Customer Portal',       description: 'Self-service customer tracking portal',     type: 'toggle' },
      { key: 'ff_mobile_app',      label: 'Mobile App Access',     description: 'Allow mobile app logins',                   type: 'toggle' },
    ],
  },
  {
    id: 'security', label: 'Security', icon: '🔒', color: 'rose',
    fields: [
      { key: 'password_min_length',     label: 'Min Password Length',  description: 'Minimum characters for user passwords', type: 'number', min: 6, max: 32 },
      { key: 'session_timeout_minutes', label: 'Session Timeout (min)',description: 'Auto-logout after inactivity',           type: 'number', min: 5, max: 10080, unit: 'min' },
      { key: 'two_factor_enabled',      label: 'Two-Factor Auth',      description: 'Require 2FA for admin users',           type: 'toggle' },
    ],
  },

];

/* ── Color map ───────────────────────────────────────────── */
const COLORS: Record<string, { badge: string; toggle: string; border: string; icon: string; ring: string }> = {
  blue:    { badge: 'bg-blue-500/20 text-blue-400',       toggle: 'bg-blue-500',    border: 'border-blue-500/30',    icon: 'text-blue-400',    ring: 'focus:ring-blue-500/50' },
  emerald: { badge: 'bg-emerald-500/20 text-emerald-400', toggle: 'bg-emerald-500', border: 'border-emerald-500/30', icon: 'text-emerald-400', ring: 'focus:ring-emerald-500/50' },
  amber:   { badge: 'bg-amber-500/20 text-amber-400',     toggle: 'bg-amber-500',   border: 'border-amber-500/30',   icon: 'text-amber-400',   ring: 'focus:ring-amber-500/50' },
  rose:    { badge: 'bg-rose-500/20 text-rose-400',       toggle: 'bg-rose-500',    border: 'border-rose-500/30',    icon: 'text-rose-400',    ring: 'focus:ring-rose-500/50' },
};

/* ── Password Field with show/hide ───────────────────────── */
function PasswordField({ value, onChange, placeholder, ring }: {
  value: string; onChange: (v: string) => void; placeholder?: string; ring: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className={`bg-slate-800 border border-white/10 text-white text-sm rounded-lg px-3 py-2 w-64 pr-10 focus:outline-none focus:ring-2 ${ring} placeholder-slate-600`}
      />
      <button
        type="button"
        onClick={() => setShow(s => !s)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors text-base"
        title={show ? 'Hide' : 'Show'}
      >
        {show ? '🙈' : '👁'}
      </button>
    </div>
  );
}

/* ── Toggle Component ────────────────────────────────────── */
function Toggle({ checked, onChange, color }: { checked: boolean; onChange: (v: boolean) => void; color: string }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative w-12 h-6 rounded-full transition-all duration-200 ${checked ? COLORS[color].toggle : 'bg-slate-600'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${checked ? 'translate-x-6' : ''}`} />
    </button>
  );
}

/* ── Setting Row ─────────────────────────────────────────── */
function SettingRow({ field, value, onChange, color }: {
  field: SettingField; value: string; onChange: (key: string, v: string) => void; color: string;
}) {
  const c = COLORS[color];
  const inputBase = `bg-slate-800 border border-white/10 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 ${c.ring} placeholder-slate-600`;

  return (
    <div className="flex items-center justify-between py-4 border-b border-white/5 last:border-0 gap-8">
      <div className="min-w-0">
        <p className="text-sm font-medium text-white">{field.label}</p>
        <p className="text-xs text-slate-400 mt-0.5">{field.description}</p>
        <p className="text-[10px] text-slate-600 font-mono mt-0.5">{field.key}</p>
      </div>
      <div className="flex-shrink-0">
        {field.type === 'select' && (
          <select value={value} onChange={e => onChange(field.key, e.target.value)}
            className={`${inputBase} min-w-[220px]`}>
            {field.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
        {field.type === 'toggle' && (
          <div className="flex items-center gap-2">
            <span className={`text-xs font-medium ${value === 'true' ? c.icon : 'text-slate-500'}`}>
              {value === 'true' ? 'Enabled' : 'Disabled'}
            </span>
            <Toggle checked={value === 'true'} onChange={v => onChange(field.key, v ? 'true' : 'false')} color={color} />
          </div>
        )}
        {field.type === 'number' && (
          <div className="flex items-center gap-2">
            <input type="number" value={value} min={field.min} max={field.max}
              onChange={e => onChange(field.key, e.target.value)}
              className={`${inputBase} w-28 text-center`} />
            {field.unit && <span className="text-slate-500 text-xs whitespace-nowrap">{field.unit}</span>}
          </div>
        )}
        {(field.type === 'text' || field.type === 'email' || field.type === 'url') && (
          <input type={field.type === 'email' ? 'email' : field.type === 'url' ? 'url' : 'text'}
            value={value} placeholder={field.placeholder}
            onChange={e => onChange(field.key, e.target.value)}
            className={`${inputBase} w-64`} />
        )}
        {field.type === 'password' && (
          <PasswordField value={value} onChange={v => onChange(field.key, v)} placeholder={field.placeholder} ring={c.ring} />
        )}
      </div>
    </div>
  );
}

/* ── Change Password Modal ───────────────────────────────── */
function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const { user } = usePermissions();
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok?: boolean; error?: string } | null>(null);
  const [strength, setStrength] = useState(0);

  const checkStrength = (pw: string) => {
    let s = 0;
    if (pw.length >= 8) s++;
    if (/[A-Z]/.test(pw)) s++;
    if (/[0-9]/.test(pw)) s++;
    if (/[^A-Za-z0-9]/.test(pw)) s++;
    return s;
  };

  const handleChange = (k: keyof typeof form, v: string) => {
    setForm(f => ({ ...f, [k]: v }));
    if (k === 'next') setStrength(checkStrength(v));
    setResult(null);
  };

  const handleSubmit = async () => {
    if (!form.current || !form.next || !form.confirm) { setResult({ error: 'All fields are required' }); return; }
    if (form.next !== form.confirm)  { setResult({ error: 'New passwords do not match' }); return; }
    if (form.next.length < 8)        { setResult({ error: 'Password must be at least 8 characters' }); return; }
    if (!user?.id) { setResult({ error: 'Session not found — please refresh the page' }); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/admin/change-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id, current_password: form.current, new_password: form.next }),
      });
      const data = await res.json();
      if (res.ok) { setResult({ ok: true }); setTimeout(onClose, 1500); }
      else { setResult({ error: data.error || 'Failed to change password' }); }
    } catch { setResult({ error: 'Network error' }); }
    finally { setSaving(false); }
  };

  const strengthLabel = ['', 'Weak', 'Fair', 'Good', 'Strong'];
  const strengthColor = ['', 'bg-red-500', 'bg-amber-500', 'bg-blue-500', 'bg-emerald-500'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-bold text-white">Change Password</h2>
            <p className="text-xs text-slate-400 mt-0.5">Update your admin account password</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">✕</button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Current Password</label>
            <PasswordInput placeholder="Enter current password" value={form.current}
              onChange={e => handleChange('current', e.target.value)}
              className="w-full bg-slate-800 border border-white/10 text-white text-sm rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-violet-500/50 placeholder-slate-600" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">New Password</label>
            <PasswordInput placeholder="Enter new password" value={form.next}
              onChange={e => handleChange('next', e.target.value)}
              className="w-full bg-slate-800 border border-white/10 text-white text-sm rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-violet-500/50 placeholder-slate-600" />
            {form.next && (
              <div className="mt-2">
                <div className="flex gap-1">
                  {[1,2,3,4].map(i => (
                    <div key={i} className={`h-1 flex-1 rounded-full ${i <= strength ? strengthColor[strength] : 'bg-slate-700'}`} />
                  ))}
                </div>
                <p className={`text-xs mt-1 ${strengthColor[strength].replace('bg-','text-')}`}>{strengthLabel[strength]}</p>
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Confirm New Password</label>
            <PasswordInput placeholder="Confirm new password" value={form.confirm}
              onChange={e => handleChange('confirm', e.target.value)}
              className={`w-full bg-slate-800 border text-white text-sm rounded-xl px-4 py-3 focus:outline-none focus:ring-2 placeholder-slate-600 ${
                form.confirm && form.confirm !== form.next ? 'border-red-500/50 focus:ring-red-500/50' :
                form.confirm && form.confirm === form.next ? 'border-emerald-500/50 focus:ring-emerald-500/50' :
                'border-white/10 focus:ring-violet-500/50'}`} />
            {form.confirm && form.confirm === form.next && <p className="text-xs text-emerald-400 mt-1">✓ Passwords match</p>}
          </div>
          <div className="bg-slate-800/50 rounded-xl p-3">
            <p className="text-xs font-medium text-slate-400 mb-2">Password requirements:</p>
            {[
              ['At least 8 characters', form.next.length >= 8],
              ['One uppercase letter',  /[A-Z]/.test(form.next)],
              ['One number',            /[0-9]/.test(form.next)],
              ['One special character', /[^A-Za-z0-9]/.test(form.next)],
            ].map(([rule, met]) => (
              <div key={String(rule)} className="flex items-center gap-2 mb-1">
                <span className={`text-xs ${met ? 'text-emerald-400' : 'text-slate-600'}`}>{met ? '✓' : '○'}</span>
                <span className={`text-xs ${met ? 'text-slate-300' : 'text-slate-500'}`}>{String(rule)}</span>
              </div>
            ))}
          </div>
        </div>
        {result && (
          <div className={`mt-4 p-3 rounded-xl text-sm ${result.ok ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-red-500/20 text-red-300 border border-red-500/30'}`}>
            {result.ok ? '✓ Password changed successfully!' : `✕ ${result.error}`}
          </div>
        )}
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl bg-slate-800 text-slate-300 text-sm hover:bg-slate-700 transition-colors">Cancel</button>
          <button onClick={handleSubmit} disabled={saving}
            className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50">
            {saving ? 'Saving…' : 'Change Password'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Collapsible Section Card ────────────────────────────── */
function SettingSection({ section, settings, onChange }: {
  section: Section; settings: Settings; onChange: (key: string, value: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const c = COLORS[section.color];

  return (
    <div className={`bg-slate-900/60 border rounded-2xl overflow-hidden ${c.border}`}>
      {/* Section header */}
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between p-5 hover:bg-white/[0.02] transition-colors">
        <div className="flex items-center gap-3">
          <span className={`w-9 h-9 rounded-xl flex items-center justify-center text-lg ${c.badge}`}>{section.icon}</span>
          <div className="text-left">
            <p className="text-base font-semibold text-white">{section.label}</p>
          </div>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.badge}`}>
            {section.fields.length} settings
          </span>
        </div>
        <span className={`text-slate-400 text-lg transition-transform duration-200 ${open ? 'rotate-90' : ''}`}>›</span>
      </button>

      {/* Fields */}
      {open && (
        <div className="px-5 pb-2 border-t border-white/5">
          {section.fields.map(field => (
            <SettingRow key={field.key} field={field} value={settings[field.key] ?? ''}
              onChange={onChange} color={section.color} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Main Page ───────────────────────────────────────────── */
export default function PlatformSettingsPage() {
  const [settings, setSettings] = useState<Settings>({});
  const [dirty, setDirty] = useState<Settings>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showPwModal, setShowPwModal] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/platform-settings');
      const data = await res.json();
      setSettings(data.settings ?? {});
      setDirty({});
    } catch { setError('Failed to load settings'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleChange = (key: string, value: string) => {
    setSettings(s => ({ ...s, [key]: value }));
    setDirty(d => ({ ...d, [key]: value }));
    setSaved(false);
  };

  const handleSave = async () => {
    if (!Object.keys(dirty).length) return;
    setSaving(true); setError('');
    try {
      const res = await fetch('/api/admin/platform-settings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dirty),
      });
      if (!res.ok) throw new Error('Save failed');
      setDirty({}); setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch { setError('Failed to save settings'); }
    finally { setSaving(false); }
  };

  const handleDiscard = () => { load(); setSaved(false); setError(''); };
  const hasDirty = Object.keys(dirty).length > 0;


  return (
    <div className="min-h-screen bg-[#0c1a3e] text-white">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-slate-950/95 backdrop-blur border-b border-white/10 px-8 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Platform Settings</h1>
          <p className="text-sm text-slate-400 mt-0.5">Configure system-wide defaults, channels, and feature controls</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setShowPwModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 border border-white/10 text-slate-300 text-sm hover:bg-slate-700 hover:text-white transition-all">
            🔑 Change Password
          </button>
          {hasDirty && (
            <button onClick={handleDiscard}
              className="px-4 py-2.5 rounded-xl bg-slate-800 text-slate-300 text-sm hover:bg-slate-700 transition-colors">
              Discard
            </button>
          )}
          <button onClick={handleSave} disabled={!hasDirty || saving}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all ${
              hasDirty
                ? 'bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:opacity-90 shadow-lg shadow-violet-900/30'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed'
            }`}>
            {saving   ? <><span className="animate-spin">⟳</span> Saving…</> :
             saved    ? <><span className="text-emerald-400">✓</span> Saved!</> :
             hasDirty ? <><span>💾</span> Save Changes <span className="ml-1 bg-white/20 text-white text-xs px-1.5 py-0.5 rounded-full">{Object.keys(dirty).length}</span></> :
                        <><span>💾</span> Save Changes</>}
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-8 py-8 space-y-6">
        {/* Error */}
        {error && (
          <div className="bg-red-500/20 border border-red-500/30 rounded-xl p-4 text-red-300 text-sm flex items-center gap-2">
            <span>⚠️</span> {error}
            <button onClick={() => setError('')} className="ml-auto text-red-400 hover:text-white">✕</button>
          </div>
        )}

        {/* Dirty banner */}
        {hasDirty && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 flex items-center gap-2 text-amber-300 text-sm">
            <span>⚠</span> You have <strong>{Object.keys(dirty).length}</strong> unsaved change{Object.keys(dirty).length !== 1 ? 's' : ''}.
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="text-4xl mb-3 animate-spin">⟳</div>
              <p className="text-slate-400 text-sm">Loading settings…</p>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-4">
              {SECTIONS.map(section => (
                <SettingSection key={section.id} section={section} settings={settings} onChange={handleChange} />
              ))}
            </div>

            {/* Danger Zone */}
            <div className="bg-red-950/30 border border-red-500/20 rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-red-500/10 flex items-center gap-3">
                <span className="w-9 h-9 rounded-xl bg-red-500/20 text-red-400 flex items-center justify-center text-lg">⚠️</span>
                <span className="text-base font-semibold text-white">Danger Zone</span>
              </div>
              <div className="p-5 space-y-4">
                <div className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-sm font-medium text-white">Change Admin Password</p>
                    <p className="text-xs text-slate-400 mt-0.5">Update your admin account credentials</p>
                  </div>
                  <button onClick={() => setShowPwModal(true)}
                    className="px-4 py-2 rounded-xl bg-red-500/20 border border-red-500/30 text-red-400 text-sm hover:bg-red-500/30 transition-colors">
                    🔑 Change Password
                  </button>
                </div>
                <div className="flex items-center justify-between py-2 border-t border-red-500/10">
                  <div>
                    <p className="text-sm font-medium text-white">Reset All Settings</p>
                    <p className="text-xs text-slate-400 mt-0.5">Restore all platform settings to defaults</p>
                  </div>
                  <button onClick={() => { if (confirm('Reset all settings to defaults? This cannot be undone.')) load(); }}
                    className="px-4 py-2 rounded-xl bg-red-500/20 border border-red-500/30 text-red-400 text-sm hover:bg-red-500/30 transition-colors">
                    ↺ Reset Defaults
                  </button>
                </div>
              </div>
            </div>

            <div className="text-center py-4">
              <p className="text-xs text-slate-600">
                Settings stored in <code className="text-slate-500 font-mono">platform_settings</code> · Changes take effect immediately
              </p>
            </div>
          </>
        )}
      </div>

      {showPwModal && <ChangePasswordModal onClose={() => setShowPwModal(false)} />}
    </div>
  );
}
