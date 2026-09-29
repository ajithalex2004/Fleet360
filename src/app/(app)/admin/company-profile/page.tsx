'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { usePermissions } from '@/contexts/PermissionContext';
import { EMIRATES, emirateOf, isValidTrn, normalizeTrn } from '@/lib/finance/uae';

/**
 * Company profile — the identity printed on tax invoices and Peppol
 * e-invoices (TRN, registered address, Arabic name, finance contact).
 * Administrators edit; everyone else sees it read-only.
 */

interface Profile {
  name: string;
  arabicName: string | null;
  trn: string | null;
  trnValid: boolean;
  address: string | null;
  emirate: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  updatedAt: string | null;
}

type Form = {
  trn: string; arabicName: string; address: string;
  contactName: string; contactEmail: string; contactPhone: string;
};

const ADMIN_ROLES = ['SUPER_ADMIN', 'TENANT_ADMIN'];

const toForm = (p: Profile): Form => ({
  trn:          p.trn ?? '',
  arabicName:   p.arabicName ?? '',
  address:      p.address ?? '',
  contactName:  p.contactName ?? '',
  contactEmail: p.contactEmail ?? '',
  contactPhone: p.contactPhone ?? '',
});

// 100-1234-5678-9012 → easier to check against the FTA certificate.
const formatTrn = (trn: string) => {
  const d = normalizeTrn(trn);
  return d.length === 15 ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7, 11)}-${d.slice(11)}` : trn;
};

function Field({ label, hint, error, children }: { label: string; hint?: React.ReactNode; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">{label}</label>
      {children}
      {error
        ? <p className="text-xs text-red-400 mt-1">{error}</p>
        : hint && <p className="text-xs text-[var(--text-faint)] mt-1">{hint}</p>}
    </div>
  );
}

export default function CompanyProfilePage() {
  const { user } = usePermissions();
  const canEdit = ADMIN_ROLES.includes(user?.roleCode ?? '');

  const [profile, setProfile] = useState<Profile | null>(null);
  const [form, setForm]       = useState<Form | null>(null);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [errors, setErrors]   = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoadError('');
    const res = await fetch('/api/admin/company-profile', { cache: 'no-store' });
    if (!res.ok) { setLoadError('Could not load the company profile.'); return; }
    const { profile: p } = await res.json();
    setProfile(p);
    setForm(toForm(p));
  }, []);

  useEffect(() => { load(); }, [load]);

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm(f => f && { ...f, [k]: e.target.value });
    setErrors(er => { const n = { ...er }; delete n[k]; return n; });
    setSaved(false);
  };

  const dirty = !!(profile && form) && JSON.stringify(toForm(profile)) !== JSON.stringify(form);
  const trnDigits = normalizeTrn(form?.trn);
  const trnOk = !trnDigits || isValidTrn(trnDigits);
  const detectedEmirate = emirateOf(form?.address);

  const save = async () => {
    if (!form) return;
    if (trnDigits && !isValidTrn(trnDigits)) {
      setErrors({ trn: 'TRN must be 15 digits starting with 100.' });
      return;
    }
    setSaving(true);
    const res = await fetch('/api/admin/company-profile', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, trn: trnDigits }),
    });
    const body = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setErrors(body.fields ?? { _: body.error ?? 'Save failed' });
      return;
    }
    setProfile(body.profile);
    setForm(toForm(body.profile));
    setErrors({});
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const inp = (bad?: boolean) =>
    `w-full bg-[var(--bg-surface)] border rounded-xl px-3 py-2.5 text-sm text-[var(--text-main)] focus:outline-none disabled:opacity-60 ${
      bad ? 'border-red-500/60 focus:border-red-500' : 'border-[var(--border-subtle)] focus:border-violet-500'
    }`;
  const card = 'bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-2xl p-6 space-y-4';

  return (
    <div>
      <div className="sticky top-0 z-10 bg-[var(--bg-canvas)]/95 backdrop-blur border-b border-[var(--border-subtle)] px-8 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-main)]">Company Profile</h1>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">Your company identity on tax invoices and UAE Peppol e-invoices</p>
        </div>
        {canEdit && form && (
          <div className="flex items-center gap-3">
            {dirty && (
              <button onClick={() => { setForm(toForm(profile!)); setErrors({}); }}
                className="px-4 py-2.5 rounded-xl bg-[var(--bg-surface)] text-[var(--text-muted)] text-sm hover:bg-[var(--bg-surface-hover)]">
                Discard
              </button>
            )}
            <button onClick={save} disabled={!dirty || saving}
              className={`px-5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                dirty ? 'bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:opacity-90'
                      : 'bg-[var(--bg-surface)] text-[var(--text-faint)] cursor-not-allowed'}`}>
              {saving ? 'Saving…' : saved ? '✓ Saved' : '💾 Save Changes'}
            </button>
          </div>
        )}
      </div>

      <div className="max-w-3xl mx-auto px-8 py-8 space-y-6">
        {loadError && (
          <div className="bg-red-500/20 border border-red-500/30 rounded-xl p-4 text-red-300 text-sm">⚠️ {loadError}</div>
        )}
        {errors._ && (
          <div className="bg-red-500/20 border border-red-500/30 rounded-xl p-4 text-red-300 text-sm">⚠️ {errors._}</div>
        )}
        {!canEdit && profile && (
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-3 text-blue-300 text-sm">
            ℹ️ Only company administrators can change these details.
          </div>
        )}

        {!profile || !form ? (
          !loadError && <div className="h-64 rounded-2xl bg-[var(--bg-surface)]/60 animate-pulse" />
        ) : (
          <>
            {/* E-invoicing readiness */}
            <div className={`rounded-2xl border p-4 flex items-start gap-3 ${
              profile.trnValid ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-amber-500/10 border-amber-500/30'}`}>
              <span className="text-xl">{profile.trnValid ? '✅' : '⚠️'}</span>
              <div>
                <p className={`text-sm font-semibold ${profile.trnValid ? 'text-emerald-300' : 'text-amber-300'}`}>
                  {profile.trnValid ? 'Ready for UAE Peppol e-invoicing' : 'Peppol e-invoices are blocked until a valid TRN is saved'}
                </p>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  {profile.trnValid
                    ? <>Invoices are issued by <strong>{profile.name}</strong>, TRN <span className="font-mono">{formatTrn(profile.trn!)}</span>{profile.emirate ? `, ${profile.emirate}` : ''}.</>
                    : 'The FTA requires the seller TRN on every tax invoice. Enter it below exactly as shown on your VAT registration certificate.'}
                </p>
              </div>
            </div>

            {/* Legal identity */}
            <div className={card}>
              <h2 className="text-sm font-semibold text-[var(--text-main)]">🏢 Legal identity</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Legal name (English)" hint="To change the registered name, contact platform support.">
                  <input value={profile.name} disabled className={inp()} />
                </Field>
                <Field label="Legal name (Arabic)" hint="Shown on bilingual tax invoices.">
                  <input value={form.arabicName} onChange={set('arabicName')} disabled={!canEdit}
                    dir="rtl" placeholder="الاسم القانوني" className={inp()} />
                </Field>
              </div>
              <Field
                label="Tax Registration Number (TRN) *"
                error={errors.trn ?? (!trnOk ? `${trnDigits.length}/15 digits — must be 15 digits starting with 100.` : undefined)}
                hint={trnDigits ? `${formatTrn(trnDigits)} · ${trnDigits.length}/15 digits` : '15 digits starting with 100, from your FTA VAT registration certificate.'}
              >
                <input value={form.trn} onChange={set('trn')} disabled={!canEdit} inputMode="numeric"
                  placeholder="100XXXXXXXXXXXX" className={`${inp(!trnOk || !!errors.trn)} font-mono tracking-wider`} />
              </Field>
            </div>

            {/* Address */}
            <div className={card}>
              <h2 className="text-sm font-semibold text-[var(--text-main)]">📍 Registered address</h2>
              <Field
                label="Address"
                hint={detectedEmirate
                  ? `Emirate on e-invoices: ${detectedEmirate}`
                  : `Include the emirate (${EMIRATES.join(', ')}); e-invoices default to Dubai when none is named.`}
              >
                <textarea value={form.address} onChange={set('address')} disabled={!canEdit} rows={3}
                  placeholder="Office 101, Building 5, Al Quoz Industrial Area 1, Dubai"
                  className={`${inp()} resize-none`} />
              </Field>
            </div>

            {/* Finance contact */}
            <div className={card}>
              <h2 className="text-sm font-semibold text-[var(--text-main)]">👤 Finance contact</h2>
              <p className="text-xs text-[var(--text-faint)] -mt-2">Printed on e-invoices as the seller contact for billing queries.</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Field label="Name">
                  <input value={form.contactName} onChange={set('contactName')} disabled={!canEdit}
                    placeholder="Finance Department" className={inp()} />
                </Field>
                <Field label="Email" error={errors.contactEmail}>
                  <input type="email" value={form.contactEmail} onChange={set('contactEmail')} disabled={!canEdit}
                    placeholder="billing@company.ae" className={inp(!!errors.contactEmail)} />
                </Field>
                <Field label="Phone" error={errors.contactPhone}>
                  <input value={form.contactPhone} onChange={set('contactPhone')} disabled={!canEdit}
                    placeholder="+971 4 123 4567" className={inp(!!errors.contactPhone)} />
                </Field>
              </div>
            </div>

            {profile.updatedAt && (
              <p className="text-xs text-[var(--text-faint)] text-center">
                Last updated {new Date(profile.updatedAt).toLocaleString('en-AE', { dateStyle: 'medium', timeStyle: 'short' })} · changes are recorded in the audit log
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
