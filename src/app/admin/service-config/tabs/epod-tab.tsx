'use client';

/**
 * Tab 7 — EPOD (Electronic Proof Of Delivery / Service) Rules.
 * Photo, signature, geo-location, OTP, document upload mandates plus
 * minimum photo count.
 */

import { useMemo } from 'react';
import { useRuleTab } from './use-rule-tab';
import { Field, NumberInput, Toggle, SaveBar, Section } from './shared';
import { DEFAULT_EPOD_RULES, type EpodRules } from '@/types/service-rules';

export function EpodTab({ typeId }: { typeId: string }) {
  const { rules, patch, loading, saving, savedMsg, error, configured, save, reload } =
    useRuleTab<EpodRules>(typeId, 'epod', DEFAULT_EPOD_RULES);

  const dirty = useMemo(() => JSON.stringify(rules) !== JSON.stringify(DEFAULT_EPOD_RULES) || configured, [rules, configured]);

  if (loading) return <div className="text-sm text-slate-500">Loading…</div>;

  const subduedClass = rules.epodRequired ? '' : 'opacity-50 pointer-events-none';

  return (
    <div className="space-y-6 max-w-3xl">
      <Section title="EPOD gate">
        <Toggle label="EPOD required" hint="Service cannot close without EPOD evidence"
          checked={rules.epodRequired} onChange={v => patch({ epodRequired: v })} />
      </Section>

      <Section title="Mandatory evidence">
        <div className={`space-y-2 ${subduedClass}`}>
          <Toggle label="Photo mandatory" hint="At least one photo required at completion"
            checked={rules.photoMandatory} onChange={v => patch({ photoMandatory: v })} />
          <Toggle label="Signature required" hint="Customer signature on completion"
            checked={rules.signatureRequired} onChange={v => patch({ signatureRequired: v })} />
          <Toggle label="Geo-location required" hint="Stamp lat/lng at sign-off"
            checked={rules.geoLocationRequired} onChange={v => patch({ geoLocationRequired: v })} />
          <Toggle label="OTP verification" hint="One-time PIN sent to the customer"
            checked={rules.otpVerification} onChange={v => patch({ otpVerification: v })} />
          <Toggle label="Document upload required" hint="Auxiliary docs (waybill, certificate)"
            checked={rules.documentUploadRequired} onChange={v => patch({ documentUploadRequired: v })} />
          <Field label="Minimum photo count" hint="0 means no minimum (only matters when photos are mandatory)">
            <NumberInput value={rules.minPhotoCount} min={0}
              onChange={v => patch({ minPhotoCount: v ?? 0 })} />
          </Field>
        </div>
      </Section>

      <SaveBar configured={configured} dirty={dirty} saving={saving} error={error} savedMsg={savedMsg}
        onSave={save} onReset={reload}
        typeId={typeId} category="epod" onRolledBack={reload} />
    </div>
  );
}
