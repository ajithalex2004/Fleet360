'use client';

/**
 * Tab 4 — Trip & Dispatch Rules.
 * Auto trip creation, auto dispatch, dispatch strategy, merge/split,
 * pooling, nearest-vehicle radius, driver/vendor auto-assignment.
 */

import { useMemo } from 'react';
import { useRuleTab } from './use-rule-tab';
import { Field, NumberInput, Toggle, Select, SaveBar, Section, type RuleTabProps } from './shared';
import {
  DEFAULT_TRIP_RULES, DISPATCH_STRATEGIES,
  type TripRules, type DispatchStrategy,
} from '@/types/service-rules';

export function TripTab({ typeId, scopeId, scopeLookup }: RuleTabProps) {
  const { rules, patch, loading, saving, savedMsg, error, configured, ownedScope, save, reload } =
    useRuleTab<TripRules>(typeId, 'trip', DEFAULT_TRIP_RULES, scopeId);

  const dirty = useMemo(() => JSON.stringify(rules) !== JSON.stringify(DEFAULT_TRIP_RULES) || configured, [rules, configured]);

  if (loading) return <div className="text-sm text-slate-500">Loading…</div>;

  return (
    <div className="space-y-6 max-w-3xl">
      <Section title="Trip creation">
        <Toggle label="Auto trip creation" hint="Spawn a Trip record when this service is requested"
          checked={rules.autoTripCreation} onChange={v => patch({ autoTripCreation: v })} />
        <Toggle label="Auto dispatch" hint="Skip manual review and dispatch immediately"
          checked={rules.autoDispatch} onChange={v => patch({ autoDispatch: v })} />
      </Section>

      <Section title="Dispatch strategy">
        <Field label="Strategy" hint="How the dispatch engine picks a driver/vendor">
          <Select value={rules.dispatchStrategy}
            options={DISPATCH_STRATEGIES}
            onChange={(v: DispatchStrategy) => patch({ dispatchStrategy: v })} />
        </Field>
        <Field label="Nearest-vehicle search radius (km)" hint="Used by NEAREST and pool-search strategies">
          <NumberInput value={rules.nearestVehicleRadiusKm} min={0}
            onChange={v => patch({ nearestVehicleRadiusKm: v })}
            placeholder="e.g. 25" />
        </Field>
      </Section>

      <Section title="Trip lifecycle flags">
        <Toggle label="Trip merge allowed" hint="Allow combining trips heading to nearby destinations"
          checked={rules.tripMergeAllowed} onChange={v => patch({ tripMergeAllowed: v })} />
        <Toggle label="Trip split allowed" hint="Allow splitting one request across vehicles"
          checked={rules.tripSplitAllowed} onChange={v => patch({ tripSplitAllowed: v })} />
        <Toggle label="Pooling allowed" hint="Multiple bookings can share a trip"
          checked={rules.poolingAllowed} onChange={v => patch({ poolingAllowed: v })} />
      </Section>

      <Section title="Auto-assignment">
        <Toggle label="Driver auto-assignment"
          checked={rules.driverAutoAssignment} onChange={v => patch({ driverAutoAssignment: v })} />
        <Toggle label="Vendor auto-assignment"
          checked={rules.vendorAutoAssignment} onChange={v => patch({ vendorAutoAssignment: v })} />
      </Section>

      <SaveBar configured={configured} dirty={dirty} saving={saving} error={error} savedMsg={savedMsg}
        onSave={save} onReset={reload}
        typeId={typeId} category="trip" scopeId={scopeId} ownedScope={ownedScope}
        scopeLookup={scopeLookup} onRolledBack={reload} />
    </div>
  );
}
