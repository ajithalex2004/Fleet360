'use client';

/**
 * Tab 3 — Vehicle Rules.
 * Eligibility filter for which vehicles a service can use — class, type,
 * group, usage, seat capacity range, special requirements.
 */

import { useMemo } from 'react';
import { useRuleTab } from './use-rule-tab';
import { Field, NumberInput, Toggle, ChipMultiSelect, SaveBar, Section } from './shared';
import {
  DEFAULT_VEHICLE_RULES, VEHICLE_CLASSES, VEHICLE_USAGES,
  type VehicleRules,
} from '@/types/service-rules';

const SUGGESTED_REQS = [
  'wheelchair-access', 'oxygen', 'child-seat', 'cooler-box', 'gps-tracker',
  'ramp', 'stretcher', 'cargo-tie-downs',
];

export function VehicleTab({ typeId }: { typeId: string }) {
  const { rules, patch, loading, saving, savedMsg, error, configured, save, reload } =
    useRuleTab<VehicleRules>(typeId, 'vehicle', DEFAULT_VEHICLE_RULES);

  const dirty = useMemo(() => JSON.stringify(rules) !== JSON.stringify(DEFAULT_VEHICLE_RULES) || configured, [rules, configured]);

  if (loading) return <div className="text-sm text-slate-500">Loading…</div>;

  return (
    <div className="space-y-6 max-w-3xl">
      <Section title="Eligibility gate" hint="Whether this service can run without a linked vehicle">
        <Toggle label="Vehicle required" hint="Block ticket creation when no vehicle is selected"
          checked={rules.vehicleRequired} onChange={v => patch({ vehicleRequired: v })} />
      </Section>

      <Section title="Class & usage">
        <Field label="Vehicle classes" hint="Empty = all allowed">
          <ChipMultiSelect values={rules.vehicleClasses}
            onChange={v => patch({ vehicleClasses: v })}
            suggestions={VEHICLE_CLASSES}
            placeholder="e.g. Sedan, SUV…" />
        </Field>
        <Field label="Vehicle usage" hint="Lease, RAC, Staff, School, Logistics, Ambulance…">
          <ChipMultiSelect values={rules.vehicleUsage}
            onChange={v => patch({ vehicleUsage: v })}
            suggestions={VEHICLE_USAGES} />
        </Field>
      </Section>

      <Section title="Type & group" hint="Free-form labels matching your vehicle master data">
        <Field label="Vehicle types">
          <ChipMultiSelect values={rules.vehicleTypes}
            onChange={v => patch({ vehicleTypes: v })}
            placeholder="Type label…" />
        </Field>
        <Field label="Vehicle groups">
          <ChipMultiSelect values={rules.vehicleGroups}
            onChange={v => patch({ vehicleGroups: v })}
            placeholder="Group label…" />
        </Field>
      </Section>

      <Section title="Capacity">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Min seats" hint="Lower bound of allowed seat capacity">
            <NumberInput value={rules.minSeatCapacity} min={1}
              onChange={v => patch({ minSeatCapacity: v })} />
          </Field>
          <Field label="Max seats" hint="Upper bound, leave blank for unlimited">
            <NumberInput value={rules.maxSeatCapacity} min={1}
              onChange={v => patch({ maxSeatCapacity: v })} />
          </Field>
        </div>
      </Section>

      <Section title="Special requirements" hint="Vehicle must have ALL listed features">
        <ChipMultiSelect values={rules.specialRequirements}
          onChange={v => patch({ specialRequirements: v })}
          suggestions={SUGGESTED_REQS}
          placeholder="Add a requirement…" />
      </Section>

      <SaveBar configured={configured} dirty={dirty} saving={saving} error={error} savedMsg={savedMsg}
        onSave={save} onReset={reload}
        typeId={typeId} category="vehicle" onRolledBack={reload} />
    </div>
  );
}
