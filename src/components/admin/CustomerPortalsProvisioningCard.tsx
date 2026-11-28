'use client';

/**
 * Customer Portals Provisioning Card — used in:
 *   1. Admin → Tenants → Manage → Modules (`/admin/tenants/[id]`)
 *   2. Admin → Tenants → Create Tenant → Module Configuration (`/admin/tenants`)
 *
 * Gives Super Admins an explicit, one-click control to provision either or
 * both Customer Portals (`Field Services` & `Transport Services`) for a
 * tenant, synced with `tenant_feature_overrides` (`customer-mgmt.portal-fsm`,
 * `customer-mgmt.portal-transport`) and the tenant's enabled modules.
 */

import React from 'react';
import { Wrench, Truck, CheckCircle2, AlertTriangle } from 'lucide-react';
import {
  CUSTOMER_PORTAL_FSM_FLAG,
  CUSTOMER_PORTAL_TRANSPORT_FLAG,
  type FeatureFlagMap,
} from '@/lib/module-features';
import { MODULE_BY_KEY } from '@/lib/modules';
import {
  TRANSPORT_VERTICAL_MODULE_KEYS,
  computeTenantPortalEntitlements,
} from '@/lib/customer-portal/entitlement-rules';

interface CustomerPortalsProvisioningCardProps {
  enabledModules: readonly string[];
  featureFlags: FeatureFlagMap;
  onModulesChange: (next: string[]) => void;
  onFlagsChange: (next: FeatureFlagMap) => void;
  /** True on Manage Tenant page where ALWAYS_ON modules can also be toggled. */
  allowOverrideAll?: boolean;
}

export function CustomerPortalsProvisioningCard({
  enabledModules,
  featureFlags,
  onModulesChange,
  onFlagsChange,
  allowOverrideAll = false,
}: CustomerPortalsProvisioningCardProps) {
  const ent = computeTenantPortalEntitlements({ enabledModules, featureFlags });
  const fsmOn = ent.portals.FSM.flagEnabled;
  const transportOn = ent.portals.TRANSPORT.flagEnabled;

  const activeVerticals = TRANSPORT_VERTICAL_MODULE_KEYS.filter((k) =>
    ent.enabledModules.includes(k),
  );

  const setPortalFlags = (nextFsm: boolean, nextTransport: boolean) => {
    onFlagsChange({
      ...featureFlags,
      [CUSTOMER_PORTAL_FSM_FLAG]: nextFsm,
      [CUSTOMER_PORTAL_TRANSPORT_FLAG]: nextTransport,
    });

    // When Super Admin turns a portal ON in explicit-override mode, ensure its
    // backing module is enabled so the portal is immediately usable.
    if (allowOverrideAll) {
      const nextMods = new Set(enabledModules);
      let changed = false;
      if (nextFsm && !nextMods.has('service-tickets')) {
        nextMods.add('service-tickets');
        changed = true;
      }
      if (nextTransport && !nextMods.has('booking-portal') && activeVerticals.length === 0) {
        nextMods.add('booking-portal');
        changed = true;
      }
      if (changed) onModulesChange([...nextMods]);
    }
  };

  return (
    <div className="rounded-2xl border border-cyan-500/30 bg-cyan-500/5 p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-[var(--text-main)] flex items-center gap-2">
            <span>🌐</span> Customer Portals Provisioning (Field Services &amp; Transport Services)
          </h3>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Choose which external Customer Portals this tenant can offer to its customers. Controls{' '}
            <code className="font-mono text-[11px]">/customer-mgmt/portal-access</code>,{' '}
            <code className="font-mono text-[11px]">/customer-mgmt/transport-catalog</code>, and Customer Portal sign-in.
          </p>
        </div>

        {/* Quick presets */}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <button
            type="button"
            onClick={() => setPortalFlags(true, true)}
            className={`px-2.5 py-1 rounded-lg border font-semibold transition-colors ${
              fsmOn && transportOn
                ? 'border-cyan-500/50 bg-cyan-500/20 text-cyan-700 dark:text-cyan-300'
                : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-main)]'
            }`}
          >
            Both Portals
          </button>
          <button
            type="button"
            onClick={() => setPortalFlags(true, false)}
            className={`px-2.5 py-1 rounded-lg border font-semibold transition-colors ${
              fsmOn && !transportOn
                ? 'border-violet-500/50 bg-violet-500/20 text-violet-700 dark:text-violet-300'
                : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-main)]'
            }`}
          >
            Field Services Only
          </button>
          <button
            type="button"
            onClick={() => setPortalFlags(false, true)}
            className={`px-2.5 py-1 rounded-lg border font-semibold transition-colors ${
              !fsmOn && transportOn
                ? 'border-blue-500/50 bg-blue-500/20 text-blue-700 dark:text-blue-300'
                : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-main)]'
            }`}
          >
            Transport Only
          </button>
          <button
            type="button"
            onClick={() => setPortalFlags(false, false)}
            className={`px-2.5 py-1 rounded-lg border font-semibold transition-colors ${
              !fsmOn && !transportOn
                ? 'border-rose-500/50 bg-rose-500/15 text-rose-700 dark:text-rose-300'
                : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-main)]'
            }`}
          >
            Disable Both
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {/* Field Services (FSM) Portal */}
        <label
          className={`flex items-start gap-3 rounded-xl border p-4 cursor-pointer transition-all ${
            ent.portals.FSM.enabled
              ? 'border-violet-500/40 bg-violet-500/10'
              : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)]'
          }`}
        >
          <input
            type="checkbox"
            checked={fsmOn}
            onChange={(e) => setPortalFlags(e.target.checked, transportOn)}
            aria-label="Enable Field Services Customer Portal"
            className="mt-1 h-4 w-4 rounded border-[var(--border-subtle)] accent-violet-500"
          />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-bold text-[var(--text-main)] inline-flex items-center gap-1.5">
                <Wrench className="w-4 h-4 text-violet-500" /> Field Services Portal (FSM)
              </span>
              {ent.portals.FSM.enabled ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                  <CheckCircle2 className="w-3 h-3" /> Active
                </span>
              ) : fsmOn && !ent.portals.FSM.moduleEnabled ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                  <AlertTriangle className="w-3 h-3" /> Module Off
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--bg-main)] text-[var(--text-muted)] border border-[var(--border-subtle)]">
                  Disabled
                </span>
              )}
            </div>
            <p className="text-xs text-[var(--text-muted)] leading-relaxed">
              Service tickets, site &amp; equipment registry, spare-parts inventory, SLA tracking, and assigned technician view.
            </p>
            <p className="text-[11px] text-[var(--text-muted)]">
              Requires module:{' '}
              <span className={ent.portals.FSM.moduleEnabled ? 'font-semibold text-emerald-600 dark:text-emerald-400' : 'font-semibold text-amber-600 dark:text-amber-400'}>
                Field Service Management ({ent.portals.FSM.moduleEnabled ? 'enabled' : 'disabled'})
              </span>
            </p>
          </div>
        </label>

        {/* Transport Services Portal */}
        <label
          className={`flex items-start gap-3 rounded-xl border p-4 cursor-pointer transition-all ${
            ent.portals.TRANSPORT.enabled
              ? 'border-blue-500/40 bg-blue-500/10'
              : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)]'
          }`}
        >
          <input
            type="checkbox"
            checked={transportOn}
            onChange={(e) => setPortalFlags(fsmOn, e.target.checked)}
            aria-label="Enable Transport Services Customer Portal"
            className="mt-1 h-4 w-4 rounded border-[var(--border-subtle)] accent-blue-500"
          />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-bold text-[var(--text-main)] inline-flex items-center gap-1.5">
                <Truck className="w-4 h-4 text-blue-500" /> Transport Services Portal
              </span>
              {ent.portals.TRANSPORT.enabled ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                  <CheckCircle2 className="w-3 h-3" /> Active
                </span>
              ) : transportOn && !ent.portals.TRANSPORT.moduleEnabled ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                  <AlertTriangle className="w-3 h-3" /> Modules Off
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--bg-main)] text-[var(--text-muted)] border border-[var(--border-subtle)]">
                  Disabled
                </span>
              )}
            </div>
            <p className="text-xs text-[var(--text-muted)] leading-relaxed">
              Vehicle requests across Rent-a-Car, Leasing, Staff Transport, Executive, Logistics, School Bus &amp; custom categories.
            </p>
            <div className="flex flex-wrap items-center gap-1 pt-0.5">
              {activeVerticals.length > 0 ? (
                activeVerticals.map((k) => (
                  <span
                    key={k}
                    className="px-1.5 py-0.5 rounded border border-blue-500/30 bg-blue-500/10 text-[10px] font-semibold text-blue-700 dark:text-blue-300"
                  >
                    {MODULE_BY_KEY[k]?.shortName ?? k}
                  </span>
                ))
              ) : (
                <span className="text-[11px] text-[var(--text-muted)]">
                  {ent.hasModuleRestrictions
                    ? 'Only categories unlocked to All Staff (enable transport modules below to unlock domains)'
                    : 'All transport domains available'}
                </span>
              )}
            </div>
          </div>
        </label>
      </div>
    </div>
  );
}
