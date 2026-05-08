'use client';

/**
 * Tab 5 — Finance Rules.
 * Pricing source, rate card link, dynamic/contract pricing toggles,
 * approval threshold, billing type, cost center, tax rule + rate,
 * auto-invoice generation.
 */

import { useMemo } from 'react';
import { useRuleTab } from './use-rule-tab';
import { Field, NumberInput, TextInput, Toggle, Select, SaveBar, Section } from './shared';
import {
  DEFAULT_FINANCE_RULES, PRICING_SOURCES, BILLING_TYPES, TAX_RULES,
  type FinanceRules, type PricingSource, type BillingType, type TaxRule,
} from '@/types/service-rules';

export function FinanceTab({ typeId }: { typeId: string }) {
  const { rules, patch, loading, saving, savedMsg, error, configured, save, reload } =
    useRuleTab<FinanceRules>(typeId, 'finance', DEFAULT_FINANCE_RULES);

  const dirty = useMemo(() => JSON.stringify(rules) !== JSON.stringify(DEFAULT_FINANCE_RULES) || configured, [rules, configured]);

  if (loading) return <div className="text-sm text-slate-500">Loading…</div>;

  return (
    <div className="space-y-6 max-w-3xl">
      <Section title="Pricing">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Pricing source" hint="Where the engine looks up the price">
            <Select value={rules.pricingSource}
              options={PRICING_SOURCES}
              onChange={(v: PricingSource) => patch({ pricingSource: v })} />
          </Field>
          <Field label="Rate card ID" hint="Required when source = RATE_CARD">
            <TextInput value={rules.rateCardId ?? ''}
              onChange={e => patch({ rateCardId: e.target.value || null })}
              placeholder="UUID of the rate card" />
          </Field>
        </div>
        <Toggle label="Dynamic pricing enabled" hint="Surge / demand-driven pricing"
          checked={rules.dynamicPricingEnabled} onChange={v => patch({ dynamicPricingEnabled: v })} />
        <Toggle label="Contract pricing enabled" hint="Use customer-specific contract rates"
          checked={rules.contractPricingEnabled} onChange={v => patch({ contractPricingEnabled: v })} />
      </Section>

      <Section title="Approval & billing">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Approval threshold (AED)" hint="Pricing above this requires approval">
            <NumberInput value={rules.approvalThresholdAed} min={0}
              onChange={v => patch({ approvalThresholdAed: v })}
              placeholder="e.g. 10000" />
          </Field>
          <Field label="Billing type">
            <Select value={rules.billingType}
              options={BILLING_TYPES}
              onChange={(v: BillingType) => patch({ billingType: v })} />
          </Field>
          <Field label="Cost center" hint="Internal cost-allocation tag">
            <TextInput value={rules.costCenter ?? ''}
              onChange={e => patch({ costCenter: e.target.value || null })}
              placeholder="e.g. CC-OPS-100" />
          </Field>
        </div>
        <Toggle label="Auto-generate invoice on closure"
          checked={rules.autoInvoiceGeneration} onChange={v => patch({ autoInvoiceGeneration: v })} />
      </Section>

      <Section title="Tax">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Tax rule">
            <Select value={rules.taxRule}
              options={TAX_RULES}
              onChange={(v: TaxRule) => patch({ taxRule: v })} />
          </Field>
          <Field label="Tax rate (%)" hint="Used when rule = STANDARD_VAT or CUSTOM">
            <NumberInput value={rules.taxRatePercent} min={0} max={100}
              onChange={v => patch({ taxRatePercent: v })} />
          </Field>
        </div>
      </Section>

      <SaveBar configured={configured} dirty={dirty} saving={saving} error={error} savedMsg={savedMsg}
        onSave={save} onReset={reload}
        typeId={typeId} category="finance" onRolledBack={reload} />
    </div>
  );
}
