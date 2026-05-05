'use client';
import React, { useState, useEffect, useCallback } from 'react';

/* ─────────────────────────────────────────────────────────────
   Types
───────────────────────────────────────────────────────────── */
type Settings = Record<string, string>;

interface ChannelField {
  key: string;
  label: string;
  description: string;
  type: 'select' | 'toggle' | 'number' | 'text' | 'password' | 'email' | 'url';
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  unit?: string;
  placeholder?: string;
  group?: string;   // visual sub-group inside the channel card
}

/* ─────────────────────────────────────────────────────────────
   Channel Definitions
───────────────────────────────────────────────────────────── */
const EMAIL_FIELDS: ChannelField[] = [
  /* Sender */
  {
    key: 'email_provider', label: 'Email Provider', description: 'Email delivery service provider',
    group: 'Provider', type: 'select',
    options: [
      { value: 'none',      label: 'none — Disabled' },
      { value: 'smtp',      label: 'SMTP (Custom Server)' },
      { value: 'sendgrid',  label: 'SendGrid' },
      { value: 'mailgun',   label: 'Mailgun' },
      { value: 'ses',       label: 'AWS SES' },
      { value: 'postmark',  label: 'Postmark' },
    ],
  },
  { key: 'email_from_name',    group: 'Provider', label: 'From Name',        description: 'Sender display name (e.g., Al Arais School)',    type: 'text',  placeholder: 'Al Arais School' },
  { key: 'email_from_address', group: 'Provider', label: 'From Email',       description: 'For Microsoft 365 / Exchange SMTP, this must match your SMTP Username exactly (sender verification is enforced).',  type: 'email', placeholder: 'noreply@school.ae' },
  { key: 'email_reply_to',     group: 'Provider', label: 'Reply-To Address', description: 'Where replies should go',                         type: 'email', placeholder: 'support@school.ae' },
  /* SMTP */
  { key: 'smtp_host',      group: 'SMTP', label: 'SMTP Host',     description: 'SMTP server hostname (for SMTP provider)',    type: 'text',     placeholder: 'smtp.gmail.com' },
  { key: 'smtp_port',      group: 'SMTP', label: 'SMTP Port',     description: 'SMTP port (587 for TLS, 465 for SSL)',        type: 'number',   min: 1, max: 65535 },
  { key: 'smtp_username',  group: 'SMTP', label: 'SMTP Username', description: 'SMTP authentication username',                type: 'text',     placeholder: 'admin@example.com' },
  { key: 'smtp_password',  group: 'SMTP', label: 'SMTP Password', description: 'SMTP authentication password',                type: 'password', placeholder: '••••••••••' },
  {
    key: 'smtp_encryption', group: 'SMTP', label: 'Encryption', description: 'Connection encryption method', type: 'select',
    options: [
      { value: 'tls',  label: 'TLS — STARTTLS (port 587)' },
      { value: 'ssl',  label: 'SSL — Implicit TLS (port 465)' },
      { value: 'none', label: 'None — Insecure' },
    ],
  },
  /* API */
  { key: 'email_api_key',    group: 'API Keys', label: 'API Key',     description: 'API key for SendGrid / Mailgun / SES / Postmark', type: 'password', placeholder: '••••••••' },
  { key: 'email_api_region', group: 'API Keys', label: 'API Region',  description: 'Region for AWS SES (e.g., us-east-1)',           type: 'text',     placeholder: 'us-east-1' },
  /* Limits */
  { key: 'email_daily_limit', group: 'Delivery', label: 'Daily Send Limit', description: 'Max emails per day (0 = unlimited)',          type: 'number', min: 0, unit: 'emails / day' },
  { key: 'email_test_mode',   group: 'Delivery', label: 'Test Mode',        description: 'When enabled, emails are logged but not sent', type: 'toggle' },
];

const SMS_FIELDS: ChannelField[] = [
  /* Provider */
  {
    key: 'sms_provider', label: 'SMS Provider', description: 'SMS delivery service provider',
    group: 'Provider', type: 'select',
    options: [
      { value: 'none',    label: 'none — Disabled' },
      { value: 'twilio',  label: 'Twilio' },
      { value: 'vonage',  label: 'Vonage (Nexmo)' },
      { value: 'aws_sns', label: 'AWS SNS' },
      { value: 'custom',  label: 'Custom API Gateway' },
    ],
  },
  { key: 'sms_from_number', group: 'Provider', label: 'Sender ID / Number',  description: 'Sender number or alphanumeric ID (e.g., SCHOOL)',   type: 'text',     placeholder: 'SCHOOL or +971501234567' },
  /* Credentials */
  { key: 'sms_account_sid', group: 'Credentials', label: 'Account SID / ID',    description: 'Account identifier (Twilio SID, Vonage Key, etc.)', type: 'text',     placeholder: 'ACxxxxxxxxxxxxxxxx' },
  { key: 'sms_auth_token',  group: 'Credentials', label: 'Auth Token / Secret', description: 'Authentication token or secret key',                type: 'password', placeholder: '••••••••' },
  { key: 'sms_api_url',     group: 'Credentials', label: 'API URL (Custom)',     description: 'Custom HTTP endpoint for bulk SMS gateway',          type: 'url',      placeholder: 'https://api.provider.com/send' },
  /* Limits */
  { key: 'sms_daily_limit', group: 'Delivery', label: 'Daily Send Limit', description: 'Max SMS per day (0 = unlimited)',          type: 'number', min: 0, unit: 'SMS / day' },
  { key: 'sms_test_mode',   group: 'Delivery', label: 'Test Mode',        description: 'When enabled, SMS are logged but not sent', type: 'toggle' },
];

/* Existing WhatsApp channel (kept as-is, uses integration-configs API) */
interface WaConfig {
  id?: string; type: string; provider: string;
  apiKey?: string; apiSecret?: string; fromNumber?: string; senderId?: string;
  isEnabled: boolean; updatedAt?: string;
}

/* ─────────────────────────────────────────────────────────────
   Small UI helpers
───────────────────────────────────────────────────────────── */
function Toggle({ checked, onChange, onColor = 'bg-blue-500' }: {
  checked: boolean; onChange: (v: boolean) => void; onColor?: string;
}) {
  return (
    <button onClick={() => onChange(!checked)}
      className={`relative w-12 h-6 rounded-full transition-all duration-200 ${checked ? onColor : 'bg-slate-600'}`}>
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${checked ? 'translate-x-6' : ''}`} />
    </button>
  );
}

function PasswordInput({ value, onChange, placeholder, className }: {
  value: string; onChange: (v: string) => void; placeholder?: string; className?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input type={show ? 'text' : 'password'} value={value} placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className={`${className ?? ''} pr-9`} />
      <button type="button" onClick={() => setShow(s => !s)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-sm">
        {show ? '🙈' : '👁'}
      </button>
    </div>
  );
}

function TestBtn({ channelKey, settings, onColor }: {
  channelKey: 'email' | 'sms'; settings: Settings; onColor: string;
}) {
  const [state, setState]   = useState<'idle' | 'running' | 'ok' | 'fail'>('idle');
  const [errMsg, setErrMsg] = useState('');

  const run = async () => {
    setErrMsg('');
    setState('running');
    try {
      const res = await fetch('/api/admin/test-channel', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel:  channelKey,
          settings,
          // For email: send the test to the "from" address so you receive it
          toEmail: settings['email_from_address'] || settings['smtp_username'] || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setErrMsg(data.error ?? `HTTP ${res.status}`);
        setState('fail');
      } else {
        setState('ok');
      }
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : 'Network error');
      setState('fail');
    }
    setTimeout(() => { setState('idle'); setErrMsg(''); }, 6000);
  };

  return (
    <div className="flex flex-col items-start gap-1">
      <button onClick={run} disabled={state === 'running'}
        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold border transition-all disabled:opacity-60 ${
          state === 'ok'      ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-300' :
          state === 'fail'    ? 'bg-red-500/20 border-red-500/30 text-red-300' :
          state === 'running' ? 'bg-slate-700 border-white/10 text-slate-400' :
                                `${onColor} border-transparent text-white hover:opacity-90`
        }`}>
        {state === 'running' ? <><span className="animate-spin inline-block">⟳</span> Sending…</> :
         state === 'ok'      ? <>✓ Email Delivered!</> :
         state === 'fail'    ? <>✕ Failed</> :
         channelKey === 'email' ? <>📧 Send Test Email</> :
                                  <>📱 Send Test SMS</>}
      </button>
      {state === 'fail' && errMsg && (
        <p className="text-xs text-red-400 max-w-xs leading-snug">{errMsg}</p>
      )}
      {state === 'ok' && (
        <p className="text-xs text-emerald-400">Check your inbox at {settings['email_from_address'] || settings['smtp_username']}</p>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Channel Field Row
───────────────────────────────────────────────────────────── */
function FieldRow({ field, value, onChange }: {
  field: ChannelField; value: string; onChange: (k: string, v: string) => void;
}) {
  const base = 'bg-slate-800 border border-white/10 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/50 placeholder-slate-600 w-full';

  return (
    <div className="flex items-center justify-between py-3.5 border-b border-white/5 last:border-0 gap-6">
      <div className="min-w-0">
        <p className="text-sm font-medium text-white">{field.label}</p>
        <p className="text-xs text-slate-400 mt-0.5">{field.description}</p>
        <p className="text-[10px] text-slate-600 font-mono mt-0.5">{field.key}</p>
      </div>
      <div className="flex-shrink-0 w-72">
        {field.type === 'select' && (
          <select value={value} onChange={e => onChange(field.key, e.target.value)} className={base}>
            {field.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
        {field.type === 'toggle' && (
          <div className="flex items-center gap-2">
            <Toggle checked={value === 'true'} onChange={v => onChange(field.key, v ? 'true' : 'false')} />
            <span className={`text-xs font-medium ${value === 'true' ? 'text-blue-400' : 'text-slate-500'}`}>
              {value === 'true' ? 'Enabled' : 'Disabled'}
            </span>
          </div>
        )}
        {field.type === 'number' && (
          <div className="flex items-center gap-2">
            <input type="number" value={value} min={field.min} max={field.max}
              onChange={e => onChange(field.key, e.target.value)}
              className={`${base} w-32 text-center`} />
            {field.unit && <span className="text-slate-500 text-xs whitespace-nowrap">{field.unit}</span>}
          </div>
        )}
        {(field.type === 'text' || field.type === 'email' || field.type === 'url') && (
          <input type={field.type === 'email' ? 'email' : 'text'}
            value={value} placeholder={field.placeholder}
            onChange={e => onChange(field.key, e.target.value)} className={base} />
        )}
        {field.type === 'password' && (
          <PasswordInput value={value} onChange={v => onChange(field.key, v)}
            placeholder={field.placeholder} className={base} />
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Email / SMS Channel Card
   (reads & writes platform_settings)
───────────────────────────────────────────────────────────── */
function ChannelCard({ channelKey, label, icon, gradient, borderColor, fields, settings, onChange, onSave, saving, saved, testMode }: {
  channelKey: 'email' | 'sms';
  label: string; icon: string; gradient: string; borderColor: string;
  fields: ChannelField[];
  settings: Settings;
  onChange: (k: string, v: string) => void;
  onSave: () => void;
  saving: boolean; saved: boolean;
  testMode: string;
}) {
  const providerKey = channelKey === 'email' ? 'email_provider' : 'sms_provider';
  const provider = settings[providerKey] || 'none';
  const enabled  = provider !== 'none';

  /* Group fields by their 'group' label */
  const groups: { name: string; fields: ChannelField[] }[] = [];
  for (const f of fields) {
    const g = f.group ?? 'General';
    let grp = groups.find(x => x.name === g);
    if (!grp) { grp = { name: g, fields: [] }; groups.push(grp); }
    grp.fields.push(f);
  }

  return (
    <div className={`bg-slate-900/70 border rounded-2xl overflow-hidden ${borderColor}`}>
      {/* Card header */}
      <div className={`bg-gradient-to-r ${gradient} p-5 flex items-center justify-between`}>
        <div className="flex items-center gap-3">
          <span className="text-2xl">{icon}</span>
          <div>
            <h2 className="text-lg font-bold text-white">{label}</h2>
            <p className="text-white/70 text-xs mt-0.5">
              {enabled ? `Provider: ${provider}` : 'No provider configured'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {testMode === 'true' && (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/30 text-amber-300 text-xs font-semibold border border-amber-400/30">
              🧪 Test Mode ON
            </span>
          )}
          <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${
            enabled
              ? 'bg-white/20 text-white border-white/30'
              : 'bg-black/30 text-white/60 border-white/10'
          }`}>
            {enabled ? '● Active' : '○ Disabled'}
          </span>
        </div>
      </div>

      {/* Field groups */}
      <div className="divide-y divide-white/5">
        {groups.map(grp => (
          <div key={grp.name} className="px-6 py-1">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pt-4 pb-1">{grp.name}</p>
            {grp.fields.map(f => (
              <FieldRow key={f.key} field={f} value={settings[f.key] ?? ''} onChange={onChange} />
            ))}
          </div>
        ))}
      </div>

      {/* Footer actions */}
      <div className="px-6 py-4 border-t border-white/10 flex items-center justify-between bg-slate-900/40">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${enabled ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
          <span className="text-xs text-slate-400">
            {enabled ? `Delivery via ${provider}` : 'Enable a provider to start sending'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <TestBtn channelKey={channelKey} settings={settings}
            onColor={channelKey === 'email' ? 'bg-indigo-600' : 'bg-purple-600'} />
          <button onClick={onSave} disabled={saving}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
              saved
                ? 'bg-emerald-500/20 border border-emerald-500/30 text-emerald-300'
                : `bg-gradient-to-r ${gradient} text-white hover:opacity-90 disabled:opacity-50`
            }`}>
            {saving ? <><span className="animate-spin inline-block">⟳</span> Saving…</> :
             saved   ? <>✓ Saved!</> :
                       <>💾 Save {label}</>}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Notification Preferences Matrix
───────────────────────────────────────────────────────────── */
type NotifChannel = 'email' | 'sms' | 'push' | 'whatsapp';
type NotifPref    = Record<NotifChannel, boolean>;
type NotifPrefs   = Record<string, NotifPref>;

const CHANNELS: { key: NotifChannel; label: string; color: string }[] = [
  { key: 'email',     label: 'Email',     color: 'text-indigo-400' },
  { key: 'sms',       label: 'SMS',       color: 'text-purple-400' },
  { key: 'push',      label: 'Push',      color: 'text-amber-400'  },
  { key: 'whatsapp',  label: 'WhatsApp',  color: 'text-emerald-400' },
];

const NOTIF_GROUPS: { label: string; icon: string; events: { key: string; label: string; default: NotifPref }[] }[] = [
  {
    label: 'Staff Transport & Booking', icon: '🚌',
    events: [
      { key: 'transport.trip_created',    label: 'Trip Created',       default: { email: true,  sms: false, push: true,  whatsapp: false } },
      { key: 'transport.trip_confirmed',  label: 'Trip Confirmed',     default: { email: true,  sms: true,  push: true,  whatsapp: true  } },
      { key: 'transport.trip_reminder',   label: 'Trip Reminder',      default: { email: false, sms: true,  push: true,  whatsapp: true  } },
      { key: 'transport.driver_assigned', label: 'Driver Assigned',    default: { email: false, sms: true,  push: true,  whatsapp: true  } },
      { key: 'transport.driver_enroute',  label: 'Driver En Route',    default: { email: false, sms: true,  push: true,  whatsapp: false } },
      { key: 'transport.driver_arrived',  label: 'Driver Arrived',     default: { email: false, sms: true,  push: true,  whatsapp: false } },
      { key: 'transport.trip_started',    label: 'Trip Started',       default: { email: false, sms: false, push: true,  whatsapp: false } },
      { key: 'transport.trip_completed',  label: 'Trip Completed',     default: { email: true,  sms: false, push: true,  whatsapp: false } },
      { key: 'transport.trip_cancelled',  label: 'Trip Cancelled',     default: { email: true,  sms: true,  push: true,  whatsapp: true  } },
    ],
  },
  {
    label: 'School Bus Transportation', icon: '🏫',
    events: [
      { key: 'school.route_started',   label: 'Route Started',       default: { email: false, sms: true,  push: true,  whatsapp: true  } },
      { key: 'school.student_boarded', label: 'Student Boarded',     default: { email: false, sms: false, push: true,  whatsapp: true  } },
      { key: 'school.student_alighted',label: 'Student Alighted',    default: { email: false, sms: false, push: true,  whatsapp: true  } },
      { key: 'school.route_completed', label: 'Route Completed',     default: { email: true,  sms: false, push: true,  whatsapp: false } },
      { key: 'school.absence_alert',   label: 'Absence Alert',       default: { email: true,  sms: true,  push: true,  whatsapp: true  } },
      { key: 'school.bus_delay',       label: 'Bus Delay Alert',     default: { email: false, sms: true,  push: true,  whatsapp: true  } },
    ],
  },
  {
    label: 'Leasing', icon: '📋',
    events: [
      { key: 'leasing.contract_created',  label: 'Contract Created',    default: { email: true,  sms: false, push: true,  whatsapp: false } },
      { key: 'leasing.contract_approved', label: 'Contract Approved',   default: { email: true,  sms: true,  push: true,  whatsapp: true  } },
      { key: 'leasing.expiry_alert',      label: 'Contract Expiry Alert',default: { email: true,  sms: true,  push: true,  whatsapp: true  } },
      { key: 'leasing.payment_due',       label: 'Payment Due',         default: { email: true,  sms: true,  push: true,  whatsapp: true  } },
      { key: 'leasing.payment_received',  label: 'Payment Received',    default: { email: true,  sms: false, push: true,  whatsapp: false } },
      { key: 'leasing.vehicle_handover',  label: 'Vehicle Handover',    default: { email: true,  sms: true,  push: true,  whatsapp: false } },
      { key: 'leasing.vehicle_return',    label: 'Vehicle Return',      default: { email: true,  sms: true,  push: true,  whatsapp: false } },
    ],
  },
  {
    label: 'Rent-a-Car (RAC)', icon: '🚗',
    events: [
      { key: 'rac.booking_created',   label: 'Booking Created',     default: { email: true,  sms: false, push: true,  whatsapp: false } },
      { key: 'rac.booking_confirmed', label: 'Booking Confirmed',   default: { email: true,  sms: true,  push: true,  whatsapp: true  } },
      { key: 'rac.vehicle_ready',     label: 'Vehicle Ready',       default: { email: false, sms: true,  push: true,  whatsapp: true  } },
      { key: 'rac.pickup_reminder',   label: 'Pickup Reminder',     default: { email: false, sms: true,  push: true,  whatsapp: true  } },
      { key: 'rac.return_reminder',   label: 'Return Reminder',     default: { email: false, sms: true,  push: true,  whatsapp: true  } },
      { key: 'rac.late_return',       label: 'Late Return Alert',   default: { email: true,  sms: true,  push: true,  whatsapp: true  } },
    ],
  },
  {
    label: 'Incident & Ambulance Management', icon: '🚑',
    events: [
      { key: 'incident.reported',     label: 'Incident Reported',   default: { email: true,  sms: true,  push: true,  whatsapp: true  } },
      { key: 'incident.dispatched',   label: 'Ambulance Dispatched',default: { email: false, sms: true,  push: true,  whatsapp: true  } },
      { key: 'incident.enroute',      label: 'En Route to Scene',   default: { email: false, sms: true,  push: true,  whatsapp: false } },
      { key: 'incident.patient_pickup',label: 'Patient Picked Up',  default: { email: false, sms: true,  push: true,  whatsapp: false } },
      { key: 'incident.hospital',     label: 'Hospital Arrived',    default: { email: false, sms: true,  push: true,  whatsapp: false } },
      { key: 'incident.closed',       label: 'Incident Closed',     default: { email: true,  sms: false, push: true,  whatsapp: false } },
    ],
  },
  {
    label: 'Logistics Management', icon: '📦',
    events: [
      { key: 'logistics.order_created',   label: 'Order Created',      default: { email: true,  sms: false, push: true,  whatsapp: false } },
      { key: 'logistics.order_confirmed', label: 'Order Confirmed',    default: { email: true,  sms: true,  push: true,  whatsapp: true  } },
      { key: 'logistics.pickup_done',     label: 'Pickup Done',        default: { email: false, sms: true,  push: true,  whatsapp: false } },
      { key: 'logistics.in_transit',      label: 'In Transit',         default: { email: false, sms: false, push: true,  whatsapp: false } },
      { key: 'logistics.delivered',       label: 'Delivered',          default: { email: true,  sms: true,  push: true,  whatsapp: true  } },
      { key: 'logistics.delivery_failed', label: 'Delivery Failed',    default: { email: true,  sms: true,  push: true,  whatsapp: true  } },
    ],
  },
  {
    label: 'Maintenance', icon: '🔧',
    events: [
      { key: 'maint.service_due',       label: 'Service Due',         default: { email: true,  sms: false, push: true,  whatsapp: false } },
      { key: 'maint.service_completed', label: 'Service Completed',   default: { email: true,  sms: false, push: true,  whatsapp: false } },
      { key: 'maint.breakdown',         label: 'Breakdown Alert',     default: { email: true,  sms: true,  push: true,  whatsapp: true  } },
      { key: 'maint.inspection_due',    label: 'Inspection Due',      default: { email: true,  sms: false, push: true,  whatsapp: false } },
    ],
  },
  {
    label: 'Finance & Billing', icon: '💳',
    events: [
      { key: 'finance.invoice_generated', label: 'Invoice Generated',  default: { email: true,  sms: false, push: true,  whatsapp: false } },
      { key: 'finance.payment_received',  label: 'Payment Received',   default: { email: true,  sms: false, push: true,  whatsapp: false } },
      { key: 'finance.payment_overdue',   label: 'Payment Overdue',    default: { email: true,  sms: true,  push: true,  whatsapp: true  } },
      { key: 'finance.invoice_approved',  label: 'Invoice Approved',   default: { email: true,  sms: false, push: false, whatsapp: false } },
    ],
  },
  {
    label: 'Compliance & Documents', icon: '📜',
    events: [
      { key: 'compliance.license_expiry',   label: 'License Expiry Alert',   default: { email: true, sms: true, push: true, whatsapp: true  } },
      { key: 'compliance.insurance_expiry', label: 'Insurance Expiry Alert', default: { email: true, sms: true, push: true, whatsapp: true  } },
      { key: 'compliance.permit_expiry',    label: 'Permit Expiry Alert',    default: { email: true, sms: true, push: true, whatsapp: false } },
    ],
  },
];

const DEFAULT_NOTIF_PREFS: NotifPrefs = Object.fromEntries(
  NOTIF_GROUPS.flatMap(g => g.events.map(e => [e.key, { ...e.default }]))
);

function NotificationPrefsMatrix({ settings, onSave }: {
  settings: Settings;
  onSave: (prefs: NotifPrefs) => Promise<void>;
}) {
  const [prefs, setPrefs]   = useState<NotifPrefs>(DEFAULT_NOTIF_PREFS);
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(
    Object.fromEntries(NOTIF_GROUPS.map(g => [g.label, true]))
  );

  // Load from settings JSON
  useEffect(() => {
    const raw = settings['platform_notification_prefs'];
    if (raw) {
      try { setPrefs({ ...DEFAULT_NOTIF_PREFS, ...JSON.parse(raw) }); } catch {}
    }
  }, [settings]);

  const toggle = (eventKey: string, ch: NotifChannel) =>
    setPrefs(p => ({ ...p, [eventKey]: { ...p[eventKey], [ch]: !p[eventKey][ch] } }));

  const handleSave = async () => {
    setSaving(true); setSaved(false);
    await onSave(prefs);
    setSaved(true); setTimeout(() => setSaved(false), 3000);
    setSaving(false);
  };

  return (
    <div className="bg-slate-900/70 border border-rose-500/25 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-rose-600 to-pink-600 p-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🔔</span>
          <div>
            <h2 className="text-lg font-bold text-white">Notification Preferences</h2>
            <p className="text-white/70 text-xs mt-0.5">Configure Email, SMS, Push & WhatsApp delivery per event across all modules</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {saved && <span className="text-emerald-300 text-xs font-medium">✓ Saved!</span>}
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-white/20 hover:bg-white/30 text-white transition-all disabled:opacity-50">
            {saving ? <><span className="animate-spin inline-block">⟳</span> Saving…</> : <>💾 Save Preferences</>}
          </button>
        </div>
      </div>

      {/* Channel legend */}
      <div className="px-6 py-3 border-b border-white/10 flex items-center gap-6">
        <span className="text-xs text-slate-500 uppercase tracking-widest font-bold">Channels:</span>
        {CHANNELS.map(c => (
          <div key={c.key} className={`flex items-center gap-1.5 text-xs font-medium ${c.color}`}>
            <span className="w-2 h-2 rounded-full bg-current" />{c.label}
          </div>
        ))}
      </div>

      {/* Groups */}
      <div className="divide-y divide-white/5">
        {NOTIF_GROUPS.map(group => {
          const isOpen = openGroups[group.label] !== false;
          return (
            <div key={group.label}>
              {/* Group header — click to collapse */}
              <button
                onClick={() => setOpenGroups(prev => ({ ...prev, [group.label]: !isOpen }))}
                className="w-full flex items-center justify-between px-6 py-3.5 text-left hover:bg-white/5 transition-colors">
                <div className="flex items-center gap-2.5">
                  <span className="text-base">{group.icon}</span>
                  <span className="text-sm font-semibold text-white">{group.label}</span>
                  <span className="text-[10px] text-slate-600">{group.events.length} events</span>
                </div>
                <span className={`text-slate-500 text-xs transition-transform ${isOpen ? 'rotate-180' : ''}`}>▼</span>
              </button>

              {isOpen && (
                <div className="px-6 pb-2">
                  {/* Column headers */}
                  <div className="grid text-[10px] font-bold uppercase tracking-widest text-slate-600 pb-1.5 border-b border-white/5"
                    style={{ gridTemplateColumns: '1fr repeat(4, 80px)' }}>
                    <span>Event</span>
                    {CHANNELS.map(c => <span key={c.key} className={`text-center ${c.color}`}>{c.label}</span>)}
                  </div>
                  {group.events.map(evt => {
                    const pref = prefs[evt.key] ?? evt.default;
                    return (
                      <div key={evt.key}
                        className="grid items-center border-b border-white/5 last:border-0 py-2.5"
                        style={{ gridTemplateColumns: '1fr repeat(4, 80px)' }}>
                        <span className="text-sm text-slate-300">{evt.label}</span>
                        {CHANNELS.map(ch => (
                          <div key={ch.key} className="flex justify-center">
                            <button
                              onClick={() => toggle(evt.key, ch.key)}
                              className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                                pref[ch.key]
                                  ? 'border-current bg-current'
                                  : 'border-slate-600 bg-transparent'
                              } ${ch.color}`}>
                              {pref[ch.key] && <span className="text-slate-900 text-[10px] font-bold leading-none">✓</span>}
                            </button>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="px-6 py-4 border-t border-white/10 bg-slate-900/40 flex items-center justify-between">
        <p className="text-xs text-slate-500">Preferences stored in <code className="text-slate-600 font-mono">platform_settings</code> as JSON</p>
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-gradient-to-r from-rose-600 to-pink-600 text-white hover:opacity-90 disabled:opacity-50 transition-all">
          {saving ? <><span className="animate-spin inline-block">⟳</span> Saving…</> : saved ? <>✓ Saved!</> : <>💾 Save Preferences</>}
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   WhatsApp Channel Card  (legacy — uses integration-configs)
───────────────────────────────────────────────────────────── */
const WA_FIELDS = [
  { key: 'provider',   label: 'Provider',            ph: 'e.g. Twilio, 360dialog' },
  { key: 'apiKey',     label: 'API Key',              ph: '•••••', secret: true },
  { key: 'apiSecret',  label: 'API Secret',           ph: '•••••', secret: true },
  { key: 'fromNumber', label: 'WhatsApp Number',      ph: '+971XXXXXXXXX' },
  { key: 'senderId',   label: 'Sender ID / WABA ID',  ph: '' },
];

function WhatsAppCard() {
  const [cfg, setCfg]     = useState<WaConfig>({ type: 'WHATSAPP', provider: '', isEnabled: false });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg]     = useState('');

  useEffect(() => {
    fetch('/api/integration-configs')
      .then(r => r.json())
      .then((rows: WaConfig[]) => {
        const wa = rows.find(r => r.type === 'WHATSAPP');
        if (wa) setCfg(wa);
      }).catch(() => {});
  }, []);

  const setField = (k: string, v: string) => setCfg(p => ({ ...p, [k]: v }));

  const save = async () => {
    if (!cfg.provider) { setMsg('Provider is required'); return; }
    setSaving(true); setMsg('');
    try {
      const res = await fetch('/api/integration-configs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...cfg, type: 'WHATSAPP', updatedAt: new Date().toISOString() }),
      });
      if (!res.ok) throw new Error();
      setMsg('Saved!');
      setTimeout(() => setMsg(''), 3000);
    } catch { setMsg('Failed to save'); }
    finally { setSaving(false); }
  };

  return (
    <div className="bg-slate-900/70 border border-green-500/25 rounded-2xl overflow-hidden">
      <div className="bg-gradient-to-r from-green-600 to-emerald-600 p-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">💬</span>
          <div>
            <h2 className="text-lg font-bold text-white">WhatsApp Business</h2>
            <p className="text-white/70 text-xs mt-0.5">
              {cfg.provider ? `Provider: ${cfg.provider}` : 'No provider configured'}
            </p>
          </div>
        </div>
        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${
          cfg.isEnabled ? 'bg-white/20 text-white border-white/30' : 'bg-black/30 text-white/60 border-white/10'
        }`}>
          {cfg.isEnabled ? '● Active' : '○ Disabled'}
        </span>
      </div>
      <div className="px-6 py-2">
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pt-4 pb-1">Credentials</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
          {WA_FIELDS.map(f => (
            <div key={f.key} className="py-3 border-b border-white/5 last:border-0">
              <label className="block text-sm font-medium text-white mb-1.5">{f.label}</label>
              {(f as any).secret ? (
                <PasswordInput value={(cfg as any)[f.key] ?? ''} onChange={v => setField(f.key, v)}
                  placeholder={f.ph}
                  className="bg-slate-800 border border-white/10 text-white text-sm rounded-lg px-3 py-2 w-full focus:outline-none focus:ring-2 focus:ring-green-500/50 placeholder-slate-600" />
              ) : (
                <input type="text" value={(cfg as any)[f.key] ?? ''} placeholder={f.ph}
                  onChange={e => setField(f.key, e.target.value)}
                  className="bg-slate-800 border border-white/10 text-white text-sm rounded-lg px-3 py-2 w-full focus:outline-none focus:ring-2 focus:ring-green-500/50 placeholder-slate-600" />
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="px-6 py-4 border-t border-white/10 bg-slate-900/40 flex items-center justify-between">
        <p className="text-xs text-slate-500">Supported: Twilio · 360dialog · MessageBird</p>
        <div className="flex items-center gap-3">
          {msg && <span className={`text-xs ${msg === 'Saved!' ? 'text-emerald-400' : 'text-red-400'}`}>{msg}</span>}
          <button onClick={save} disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-gradient-to-r from-green-600 to-emerald-600 text-white hover:opacity-90 disabled:opacity-50 transition-all">
            {saving ? <><span className="animate-spin inline-block">⟳</span> Saving…</> : <>💾 Save WhatsApp</>}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Main Page
───────────────────────────────────────────────────────────── */
export default function NotificationChannelsPage() {
  const [settings, setSettings] = useState<Settings>({});
  const [loading, setLoading]   = useState(true);
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailSaved,  setEmailSaved]  = useState(false);
  const [smsSaving,   setSmsSaving]   = useState(false);
  const [smsSaved,    setSmsSaved]    = useState(false);
  const [error, setError] = useState('');

  /* Email keys */
  const EMAIL_KEYS = EMAIL_FIELDS.map(f => f.key);
  /* SMS keys */
  const SMS_KEYS = SMS_FIELDS.map(f => f.key);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/platform-settings');
      const data = await res.json();
      setSettings(data.settings ?? {});
    } catch { setError('Failed to load settings'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleChange = (k: string, v: string) =>
    setSettings(s => ({ ...s, [k]: v }));

  const saveKeys = async (
    keys: string[],
    setSaving: (b: boolean) => void,
    setSaved: (b: boolean) => void,
  ) => {
    setSaving(true);
    const payload: Settings = {};
    keys.forEach(k => { payload[k] = settings[k] ?? ''; });
    try {
      const res = await fetch('/api/admin/platform-settings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch { setError('Failed to save — please try again'); }
    finally { setSaving(false); }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <div className="text-4xl animate-spin mb-3">⟳</div>
        <p className="text-slate-400 text-sm">Loading channel settings…</p>
      </div>
    </div>
  );

  return (
    <div className="space-y-8 pb-12">
      {/* Page header */}
      <div>
        <h1 className="text-3xl font-bold text-white">Notification Channels</h1>
        <p className="text-slate-400 mt-1">Configure Email, SMS, and WhatsApp providers for the platform</p>
      </div>

      {error && (
        <div className="bg-red-500/20 border border-red-500/30 rounded-xl p-4 text-red-300 text-sm flex items-center gap-2">
          ⚠️ {error}
          <button onClick={() => setError('')} className="ml-auto text-red-400 hover:text-white">✕</button>
        </div>
      )}

      {/* Email */}
      <ChannelCard
        channelKey="email"
        label="Email Service"
        icon="✉️"
        gradient="from-indigo-600 to-blue-600"
        borderColor="border-indigo-500/25"
        fields={EMAIL_FIELDS}
        settings={settings}
        onChange={handleChange}
        onSave={() => saveKeys(EMAIL_KEYS, setEmailSaving, setEmailSaved)}
        saving={emailSaving}
        saved={emailSaved}
        testMode={settings['email_test_mode'] ?? 'false'}
      />

      {/* SMS */}
      <ChannelCard
        channelKey="sms"
        label="SMS Service"
        icon="📱"
        gradient="from-purple-600 to-violet-600"
        borderColor="border-purple-500/25"
        fields={SMS_FIELDS}
        settings={settings}
        onChange={handleChange}
        onSave={() => saveKeys(SMS_KEYS, setSmsSaving, setSmsSaved)}
        saving={smsSaving}
        saved={smsSaved}
        testMode={settings['sms_test_mode'] ?? 'false'}
      />

      {/* WhatsApp (existing card, unchanged) */}
      <WhatsAppCard />

      {/* Notification Preferences Matrix */}
      <NotificationPrefsMatrix
        settings={settings}
        onSave={async (prefs) => {
          const json = JSON.stringify(prefs);
          await fetch('/api/admin/platform-settings', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ platform_notification_prefs: json }),
          });
          setSettings(s => ({ ...s, platform_notification_prefs: json }));
        }}
      />

      <p className="text-xs text-slate-600 text-center pt-2">
        Email & SMS settings stored in <code className="text-slate-500 font-mono">platform_settings</code> · WhatsApp stored in <code className="text-slate-500 font-mono">integration_configs</code>
      </p>
    </div>
  );
}
