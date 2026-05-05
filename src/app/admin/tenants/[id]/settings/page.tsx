'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import PasswordInput from '@/components/ui/PasswordInput';

type Tab = 'operations' | 'route' | 'notifications';

interface Settings {
  tripMergingEnabled: boolean; pickupMatchType: string; pickupDistanceKm: number;
  pickupTimeWindowMin: number; requireDropoffMatch: boolean; dropoffMatchType: string;
  dropoffDistanceKm: number; dropoffTimeWindowMin: number; maxPassengers: number;
  travelSpeedKmh: number; stopDurationMin: number; maxPickupDelayMin: number;
  autoMergeEnabled: boolean; triggerBeforePickupMin: number; lookAheadHours: number;
  autoDispatchEnabled: boolean; maxDriverAttempts: number; driverResponseTimeoutMin: number;
  dispatchRadius: number; preferNearestDriver: boolean;
  routeOptimizationEnabled: boolean; routingEngine: string; googleMapsApiKey: string;
  maxApiCallsPerHour: number; maxApiCallsPerDay: number;
  roadDistanceMultiplier: number; fallbackToStraightLine: boolean;
  emailNotificationsEnabled: boolean; smtpHost: string; smtpPort: string;
  smtpUser: string; smtpPass: string; smtpFromEmail: string; smtpFromName: string;
  smsNotificationsEnabled: boolean; smsProvider: string; smsApiKey: string; smsFromNumber: string;
  pushNotificationsEnabled: boolean; notificationPreferences: string; tripReminderTimingMin: number;
}

const NOTIFICATION_EVENTS = [
  'Trip Created', 'Trip Confirmed', 'Trip Reminder', 'Driver Assigned',
  'Driver En Route', 'Driver Arrived', 'Trip Started', 'Trip Completed', 'Trip Cancelled',
];
const DEFAULT_PREFS: Record<string, { email: boolean; sms: boolean; push: boolean }> = {
  'Trip Created':    { email: true,  sms: false, push: true },
  'Trip Confirmed':  { email: true,  sms: true,  push: true },
  'Trip Reminder':   { email: false, sms: true,  push: true },
  'Driver Assigned': { email: false, sms: true,  push: true },
  'Driver En Route': { email: false, sms: true,  push: true },
  'Driver Arrived':  { email: false, sms: true,  push: true },
  'Trip Started':    { email: false, sms: false, push: true },
  'Trip Completed':  { email: true,  sms: false, push: true },
  'Trip Cancelled':  { email: true,  sms: true,  push: true },
};

const ToggleSwitch = ({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) => (
  <button type="button" onClick={() => onChange(!checked)}
    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${checked ? 'bg-blue-600' : 'bg-slate-600'}`}>
    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
  </button>
);

const Field = ({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) => (
  <div>
    <label className="block text-sm font-medium text-slate-300 mb-1">{label}</label>
    {children}
    {help && <p className="text-xs text-slate-500 mt-1">{help}</p>}
  </div>
);

const NumInput = ({ value, onChange, placeholder, min }: { value: number; onChange: (v: number) => void; placeholder?: string; min?: number }) => (
  <input type="number" value={value} min={min ?? 0} placeholder={placeholder}
    onChange={e => onChange(parseFloat(e.target.value) || 0)}
    className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none text-sm" />
);

const Section = ({ title, desc, icon, children }: { title: string; desc: string; icon: string; children: React.ReactNode }) => (
  <div className="bg-slate-800/50 border border-white/10 rounded-2xl overflow-hidden mb-6">
    <div className="p-5 border-b border-white/10 flex items-start gap-3">
      <div className="w-9 h-9 rounded-xl bg-slate-700 flex items-center justify-center text-lg flex-shrink-0">{icon}</div>
      <div><div className="font-semibold text-white">{title}</div><div className="text-sm text-slate-400">{desc}</div></div>
    </div>
    <div className="p-5">{children}</div>
  </div>
);

export default function TenantSettingsPage() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab]         = useState<Tab>('operations');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [notifPrefs, setNotifPrefs] = useState(DEFAULT_PREFS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/tenants/${id}/settings`);
      const data = await res.json();
      setSettings(data);
      if (data.notificationPreferences) {
        try { setNotifPrefs({ ...DEFAULT_PREFS, ...JSON.parse(data.notificationPreferences) }); }
        catch {}
      }
    } catch {} finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const set = (key: keyof Settings, val: any) =>
    setSettings(p => p ? { ...p, [key]: val } : p);

  const save = async () => {
    if (!settings) return;
    setSaving(true); setSaveMsg('');
    try {
      const payload = { ...settings, notificationPreferences: JSON.stringify(notifPrefs) };
      const res = await fetch(`/api/admin/tenants/${id}/settings`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? 'Save failed'); }
      setSaveMsg('Settings saved successfully');
      setTimeout(() => setSaveMsg(''), 3000);
    } catch (e: any) {
      setSaveMsg('Error: ' + (e.message ?? 'Save failed'));
    } finally { setSaving(false); }
  };

  if (loading) return <div className="flex items-center justify-center h-full"><div className="text-slate-400 animate-pulse">Loading settings...</div></div>;
  if (!settings) return <div className="text-rose-400 p-8">Failed to load settings</div>;

  const s = settings;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-1">Tenant Settings</h1>
          <p className="text-slate-400 text-sm">Configure operational settings, auto-dispatch rules, and notification preferences</p>
        </div>
        <div className="flex items-center gap-3">
          {saveMsg && <span className={`text-sm ${saveMsg.includes('Error') ? 'text-rose-400' : 'text-emerald-400'}`}>{saveMsg}</span>}
          <button onClick={save} disabled={saving}
            className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-medium hover:opacity-90 disabled:opacity-50">
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-white/10">
        {([['operations','Operations'],['route','Route Optimization'],['notifications','Notifications']] as [Tab,string][]).map(([t,l]) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-all ${tab===t ? 'text-white border-blue-500' : 'text-slate-400 border-transparent hover:text-slate-300'}`}>
            {l}
          </button>
        ))}
      </div>

      {/*  OPERATIONS TAB  */}
      {tab === 'operations' && (
        <div>
          {/* Trip Merging */}
          <Section title="Trip Merging" desc="Configure how trips are merged together" icon="M">
            <div className="flex items-center justify-between mb-5">
              <div>
                <div className="text-sm font-medium text-white">Enable Trip Merging</div>
                <div className="text-xs text-slate-400">Merge compatible trips to optimize fleet utilisation</div>
              </div>
              <ToggleSwitch checked={s.tripMergingEnabled} onChange={v => set('tripMergingEnabled', v)} />
            </div>
            {s.tripMergingEnabled && (
              <div className="space-y-5">
                <div>
                  <h4 className="text-sm font-semibold text-slate-300 mb-3">Pickup Matching</h4>
                  <div className="grid grid-cols-3 gap-4">
                    <Field label="Pickup Match Type">
                      <select value={s.pickupMatchType} onChange={e => set('pickupMatchType', e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-blue-500 focus:outline-none text-sm">
                        <option value="DISTANCE">Distance-based</option>
                        <option value="TIME">Time-based</option>
                        <option value="HYBRID">Hybrid</option>
                      </select>
                    </Field>
                    <Field label="Pickup Distance (km)" help="Maximum distance between pickup points to consider merging">
                      <NumInput value={s.pickupDistanceKm} onChange={v => set('pickupDistanceKm', v)} placeholder="7" min={0} />
                    </Field>
                    <Field label="Pickup Time Window (min)" help="Maximum time difference between pickup times">
                      <NumInput value={s.pickupTimeWindowMin} onChange={v => set('pickupTimeWindowMin', v)} placeholder="30" min={0} />
                    </Field>
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-semibold text-slate-300">Dropoff Matching</h4>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">Require Dropoff Match</span>
                      <ToggleSwitch checked={s.requireDropoffMatch} onChange={v => set('requireDropoffMatch', v)} />
                    </div>
                  </div>
                  {s.requireDropoffMatch && (
                    <div className="grid grid-cols-3 gap-4">
                      <Field label="Dropoff Match Type">
                        <select value={s.dropoffMatchType} onChange={e => set('dropoffMatchType', e.target.value)}
                          className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-blue-500 focus:outline-none text-sm">
                          <option value="DISTANCE">Distance-based</option>
                          <option value="TIME">Time-based</option>
                          <option value="HYBRID">Hybrid</option>
                        </select>
                      </Field>
                      <Field label="Dropoff Distance (km)" help="Maximum distance between dropoff points to consider merging">
                        <NumInput value={s.dropoffDistanceKm} onChange={v => set('dropoffDistanceKm', v)} placeholder="25" />
                      </Field>
                      <Field label="Dropoff Time Window (min)" help="Maximum time difference between dropoff times">
                        <NumInput value={s.dropoffTimeWindowMin} onChange={v => set('dropoffTimeWindowMin', v)} placeholder="30" />
                      </Field>
                    </div>
                  )}
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-slate-300 mb-3">Capacity & Routing</h4>
                  <div className="grid grid-cols-4 gap-4">
                    <Field label="Max Passengers" help="Maximum number of passengers in a merged trip">
                      <NumInput value={s.maxPassengers} onChange={v => set('maxPassengers', v)} placeholder="5" min={1} />
                    </Field>
                    <Field label="Travel Speed (km/h)" help="Average travel speed for route calculations">
                      <NumInput value={s.travelSpeedKmh} onChange={v => set('travelSpeedKmh', v)} placeholder="40" min={1} />
                    </Field>
                    <Field label="Stop Duration (min)" help="Time added per pickup/dropoff stop">
                      <NumInput value={s.stopDurationMin} onChange={v => set('stopDurationMin', v)} placeholder="10" min={0} />
                    </Field>
                    <Field label="Max Pickup Delay (min)" help="Maximum extra time allowed due to merging">
                      <NumInput value={s.maxPickupDelayMin} onChange={v => set('maxPickupDelayMin', v)} placeholder="30" min={0} />
                    </Field>
                  </div>
                </div>
              </div>
            )}
          </Section>

          {/* Auto-Merge */}
          <Section title="Auto-Merge" desc="Automatically merge eligible trips before departure" icon="A">
            <div className="flex items-center justify-between mb-5">
              <div>
                <div className="text-sm font-medium text-white">Enable Auto-Merge</div>
                <div className="text-xs text-slate-400">System automatically merges trips without manual intervention</div>
              </div>
              <ToggleSwitch checked={s.autoMergeEnabled} onChange={v => set('autoMergeEnabled', v)} />
            </div>
            {s.autoMergeEnabled && (
              <div className="grid grid-cols-2 gap-4">
                <Field label="Trigger Before Pickup (min)" help="How long before pickup to run auto-merge">
                  <NumInput value={s.triggerBeforePickupMin} onChange={v => set('triggerBeforePickupMin', v)} placeholder="30" min={1} />
                </Field>
                <Field label="Look Ahead (hours)" help="How far ahead to look for eligible bookings">
                  <NumInput value={s.lookAheadHours} onChange={v => set('lookAheadHours', v)} placeholder="24" min={1} />
                </Field>
              </div>
            )}
          </Section>

          {/* Auto Dispatch */}
          <Section title="Auto Dispatch" desc="Automatically assign drivers to trips" icon="D">
            <div className="flex items-center justify-between mb-5">
              <div>
                <div className="text-sm font-medium text-white">Enable Auto Dispatch</div>
                <div className="text-xs text-slate-400">Automatically assign the nearest available driver to confirmed trips</div>
              </div>
              <ToggleSwitch checked={s.autoDispatchEnabled} onChange={v => set('autoDispatchEnabled', v)} />
            </div>
            {s.autoDispatchEnabled && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Max Driver Attempts" help="Number of drivers to try before marking dispatch as failed">
                    <NumInput value={s.maxDriverAttempts} onChange={v => set('maxDriverAttempts', v)} placeholder="3" min={1} />
                  </Field>
                  <Field label="Driver Response Timeout (min)" help="How long to wait for a driver to accept before trying the next one">
                    <NumInput value={s.driverResponseTimeoutMin} onChange={v => set('driverResponseTimeoutMin', v)} placeholder="6" min={1} />
                  </Field>
                  <Field label="Dispatch Radius (km)" help="Search radius to find available drivers">
                    <NumInput value={s.dispatchRadius} onChange={v => set('dispatchRadius', v)} placeholder="10" min={1} />
                  </Field>
                </div>
                <div className="flex items-center gap-3">
                  <ToggleSwitch checked={s.preferNearestDriver} onChange={v => set('preferNearestDriver', v)} />
                  <div>
                    <div className="text-sm font-medium text-white">Prefer Nearest Driver</div>
                    <div className="text-xs text-slate-400">Always dispatch to the closest available driver first</div>
                  </div>
                </div>
              </div>
            )}
          </Section>
        </div>
      )}

      {/*  ROUTE OPTIMIZATION TAB  */}
      {tab === 'route' && (
        <div>
          <Section title="Route Optimization" desc="Configure routing engine settings for accurate distance calculations" icon="R">
            <div className="flex items-center justify-between mb-5">
              <div>
                <div className="text-sm font-medium text-white">Enable Route Optimization</div>
                <div className="text-xs text-slate-400">Use routing engine for real road distances and ETAs</div>
              </div>
              <ToggleSwitch checked={s.routeOptimizationEnabled} onChange={v => set('routeOptimizationEnabled', v)} />
            </div>
            <div className="space-y-5">
              <div>
                <h4 className="text-sm font-semibold text-slate-300 mb-3">Routing Engine</h4>
                <Field label="Routing Engine">
                  <select value={s.routingEngine} onChange={e => set('routingEngine', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-blue-500 focus:outline-none text-sm">
                    <option value="GOOGLE_MAPS">Google Maps</option>
                    <option value="OSRM">OSRM (Open Source)</option>
                    <option value="HERE">HERE Maps</option>
                    <option value="MAPBOX">Mapbox</option>
                  </select>
                </Field>
              </div>
              {s.routingEngine === 'GOOGLE_MAPS' && (
                <div>
                  <h4 className="text-sm font-semibold text-slate-300 mb-3">Google Maps Configuration</h4>
                  <Field label="Google Maps API Key" help="Your Google Maps API key for routing services">
                    <PasswordInput value={s.googleMapsApiKey ?? ''} onChange={e => set('googleMapsApiKey', e.target.value)}
                      placeholder="AIza..."
                      className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none text-sm font-mono" />
                  </Field>
                </div>
              )}
              <div>
                <h4 className="text-sm font-semibold text-slate-300 mb-3">Rate Limiting</h4>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Max API Calls Per Hour" help="Maximum number of API calls allowed per hour">
                    <NumInput value={s.maxApiCallsPerHour} onChange={v => set('maxApiCallsPerHour', v)} placeholder="500" min={1} />
                  </Field>
                  <Field label="Max API Calls Per Day" help="Maximum number of API calls allowed per day">
                    <NumInput value={s.maxApiCallsPerDay} onChange={v => set('maxApiCallsPerDay', v)} placeholder="5000" min={1} />
                  </Field>
                </div>
              </div>
              <div>
                <h4 className="text-sm font-semibold text-slate-300 mb-3">Distance & Fallback Settings</h4>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Road Distance Multiplier" help="Scaling factor for road vs straight-line distance">
                    <NumInput value={s.roadDistanceMultiplier} onChange={v => set('roadDistanceMultiplier', v)} placeholder="1.5" min={1} />
                  </Field>
                  <div className="flex items-start gap-3 pt-6">
                    <ToggleSwitch checked={s.fallbackToStraightLine} onChange={v => set('fallbackToStraightLine', v)} />
                    <div>
                      <div className="text-sm font-medium text-white">Fallback to Straight Line</div>
                      <div className="text-xs text-slate-400">Use straight-line calculation if routing engine fails</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Section>
        </div>
      )}

      {/*  NOTIFICATIONS TAB  */}
      {tab === 'notifications' && (
        <div>
          {/* Email */}
          <Section title="Email" desc="Configure SMTP settings for email notifications" icon="E">
            <div className="flex items-center justify-between mb-4">
              <div className="text-sm text-slate-400">{s.emailNotificationsEnabled ? 'Email notifications are enabled' : 'Email notifications are disabled. Enable to configure SMTP settings.'}</div>
              <ToggleSwitch checked={s.emailNotificationsEnabled} onChange={v => set('emailNotificationsEnabled', v)} />
            </div>
            {s.emailNotificationsEnabled && (
              <div className="grid grid-cols-3 gap-4">
                {[{l:'SMTP Host',k:'smtpHost',ph:'smtp.gmail.com'},{l:'SMTP Port',k:'smtpPort',ph:'587'},{l:'Username',k:'smtpUser',ph:'user@domain.com'},{l:'Password',k:'smtpPass',ph:'**hidden**',pwd:true},{l:'From Email',k:'smtpFromEmail',ph:'noreply@company.com'},{l:'From Name',k:'smtpFromName',ph:'XL AI Smart Mobility'}].map(({l,k,ph,pwd})=>(
                  <Field key={k} label={l}>
                    <input type={pwd ? 'password' : 'text'} value={(s as any)[k] ?? ''} onChange={e => set(k as keyof Settings, e.target.value)} placeholder={ph}
                      className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none text-sm" />
                  </Field>
                ))}
              </div>
            )}
          </Section>

          {/* SMS */}
          <Section title="SMS" desc="Configure SMS provider for text notifications" icon="S">
            <div className="flex items-center justify-between mb-4">
              <div className="text-sm text-slate-400">{s.smsNotificationsEnabled ? 'SMS notifications are enabled' : 'SMS notifications are disabled. Enable to configure provider settings.'}</div>
              <ToggleSwitch checked={s.smsNotificationsEnabled} onChange={v => set('smsNotificationsEnabled', v)} />
            </div>
            {s.smsNotificationsEnabled && (
              <div className="grid grid-cols-3 gap-4">
                {[{l:'SMS Provider',k:'smsProvider',ph:'Twilio, AWS SNS'},{l:'API Key',k:'smsApiKey',ph:'**hidden**',pwd:true},{l:'From Number',k:'smsFromNumber',ph:'+971XXXXXXXXX'}].map(({l,k,ph,pwd})=>(
                  <Field key={k} label={l}>
                    <input type={pwd ? 'password' : 'text'} value={(s as any)[k] ?? ''} onChange={e => set(k as keyof Settings, e.target.value)} placeholder={ph}
                      className="w-full px-3 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none text-sm" />
                  </Field>
                ))}
              </div>
            )}
          </Section>

          {/* Notification Preferences Matrix */}
          <Section title="Notification Preferences" desc="Configure which channels to use for each event type" icon="N">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left py-3 pr-6 text-slate-400 font-medium">Event</th>
                    <th className="text-center py-3 px-6 text-blue-400 font-medium">Email</th>
                    <th className="text-center py-3 px-6 text-emerald-400 font-medium">SMS</th>
                    <th className="text-center py-3 px-6 text-violet-400 font-medium">Push</th>
                  </tr>
                </thead>
                <tbody>
                  {NOTIFICATION_EVENTS.map(event => {
                    const pref = notifPrefs[event] ?? { email: false, sms: false, push: false };
                    const toggle = (ch: 'email'|'sms'|'push') =>
                      setNotifPrefs(p => ({ ...p, [event]: { ...pref, [ch]: !pref[ch] } }));
                    return (
                      <tr key={event} className="border-b border-white/5">
                        <td className="py-3 pr-6 text-white">{event}</td>
                        {(['email','sms','push'] as const).map(ch => (
                          <td key={ch} className="text-center py-3 px-6">
                            <input type="checkbox" checked={pref[ch]}
                              onChange={() => toggle(ch)}
                              className="w-4 h-4 rounded accent-blue-500 cursor-pointer" />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-5">
              <Field label="Trip Reminder Timing (minutes before pickup)" help="How many minutes before the scheduled pickup to send reminders">
                <NumInput value={s.tripReminderTimingMin} onChange={v => set('tripReminderTimingMin', v)} placeholder="60" min={1} />
              </Field>
            </div>
          </Section>
        </div>
      )}
    </div>
  );
}
