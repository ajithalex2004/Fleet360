'use client';
/**
 * /bus-ops/planning-engine — the Planning Engine.
 *
 * One page, three tabs, consolidating what used to be three separate
 * routes:
 *
 *   /bus-ops/cba-rules  →  ?tab=cba       Operational Rules Engine
 *   /bus-ops/plan       →  ?tab=core      Planning Core   ← default
 *   /bus-ops/headway    →  ?tab=headway   Headway Management
 *
 * All three old paths still resolve; they redirect here preserving the
 * tab, so bookmarks and the dashboard tiles keep working.
 *
 * Visual order and default tab are deliberate and independent — changing
 * one doesn't imply the other. Operational Rules Engine (CBA) sits first
 * because it is upstream in the mental model — labour rules feed the
 * plan, and Planning Core literally pre-fills its WorkRules from the
 * default rule-set via cbaToWorkRules. Planning Core is the tab that
 * opens, because it is the daily-driver task while the other two are
 * configured rarely; landing on a config screen would tax the frequent
 * job every time. Headway's position (last) is a product decision, not
 * derived from the data-flow reasoning above.
 *
 * Guarded as a whole on bus-ops:admin:planning-core. That tightens CBA
 * and Headway, which previously had no page guard at all — their APIs
 * are gated separately (see the bus-ops:admin:cba-rules / :headway rows
 * in permissions.ts), because a page guard alone protects nothing.
 */

import React, { Suspense, useCallback, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Sparkles, ShieldCheck, Clock } from 'lucide-react';
import { PageHeader, TabStrip, type TabDef } from '@/components/bus-ops/theme';
import RequireTenantAdmin, { useBusOpsAdminAccess } from '@/components/bus-ops/RequireTenantAdmin';
import { CbaRulesPanel } from '@/components/bus-ops/planning-engine/CbaRulesPanel';
import { HeadwayPanel } from '@/components/bus-ops/planning-engine/HeadwayPanel';
import { PlanningCorePanel } from '@/components/bus-ops/planning-engine/PlanningCorePanel';
import PceRulesDrawer from '@/components/bus-ops/planning-engine/PceRulesDrawer';
import { resolvePlanningEngineTab } from '@/lib/bus-ops/planning-engine-tabs';

/** Visual order. `core` is the default active tab — see the file header. */
const TABS: TabDef[] = [
  { id: 'cba',     label: 'Operational Rules Engine', icon: ShieldCheck },
  { id: 'core',    label: 'Planning Core',            icon: Sparkles },
  { id: 'headway', label: 'Headway',                  icon: Clock },
];

export default function PlanningEnginePage() {
  return (
    <RequireTenantAdmin resource="planning-core">
      {/* useSearchParams needs a Suspense boundary at the tree boundary in
          Next 15 — same pattern as bus-ops/route-planner. Without it the
          whole route opts into dynamic rendering with a build warning. */}
      <Suspense fallback={<div className="p-10 text-center text-slate-500 text-sm">Loading…</div>}>
        <PlanningEngineInner />
      </Suspense>
    </RequireTenantAdmin>
  );
}

function PlanningEngineInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Tab lives in the querystring so a tab is linkable and survives a
  // reload. Unknown values fall back rather than rendering nothing —
  // see resolvePlanningEngineTab for the exact rules.
  const activeId = resolvePlanningEngineTab(searchParams.get('tab'));

  // Tabs the user has opened at least once. Panels mount lazily and then
  // stay mounted (see the render block) so in-progress work survives a
  // tab switch.
  const [visited, setVisited] = useState<Set<string>>(() => new Set([activeId]));
  if (!visited.has(activeId)) {
    // Covers arriving on a tab via a deep link or the back button, where
    // setTab never ran. Cheap and idempotent — guarded by the has() check.
    setVisited(prev => new Set(prev).add(activeId));
  }

  const setTab = useCallback((id: string) => {
    setVisited(prev => prev.has(id) ? prev : new Set(prev).add(id));
    const next = new URLSearchParams(searchParams.toString());
    next.set('tab', id);
    // replace, not push: flipping tabs shouldn't stack history entries
    // that the back button then has to walk through. scroll:false keeps
    // the viewport where it was.
    router.replace(`/bus-ops/planning-engine?${next.toString()}`, { scroll: false });
  }, [router, searchParams]);

  // Bumped whenever the CBA tab mutates a rule-set. Planning Core watches
  // this and offers to reload its pre-filled pay rules — it never
  // overwrites hand-edited values silently.
  const [cbaRevision, setCbaRevision] = useState(0);
  const onRuleSetsChanged = useCallback(() => setCbaRevision(n => n + 1), []);

  // The PCE drawer writes to /api/bus-ops/planning-constraints, which is
  // gated on its own resource. Offer the button only when the user can
  // actually use it.
  const pce = useBusOpsAdminAccess('planning-constraints');
  const [pceOpen, setPceOpen] = useState(false);

  const subtitle = useMemo(() => {
    switch (activeId) {
      case 'cba':     return 'Labour rules, service frequency, and the runcut/blocking/rostering engine — in the order they feed each other.';
      case 'headway': return 'Labour rules, service frequency, and the runcut/blocking/rostering engine — in the order they feed each other.';
      default:        return 'Runcut, block and roster staff transport — with the labour and frequency rules that feed it one tab away.';
    }
  }, [activeId]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Planning Engine"
        subtitle={subtitle}
        icon={Sparkles}
        accent="violet"
      />

      <TabStrip
        tabs={TABS}
        activeId={activeId}
        onChange={setTab}
        accent="violet"
        label="Planning Engine sections"
      />

      {/* Panels are mounted lazily but never unmounted once visited, and
          hidden with the `hidden` attribute rather than a conditional.
          This is load-bearing, not an optimisation: Planning Core holds
          the whole in-progress plan in local state (date range, edited pay
          rules, compute results, comparison selection). Unmounting on tab
          switch would discard it — which is exactly the problem this page
          exists to solve, since editing CBA used to mean navigating away
          from a half-built plan. It is also what makes the cbaRevision
          handshake meaningful: Planning Core is still mounted, holding the
          user's edits, while they change rule-sets on the CBA tab.

          Lazy-mount keeps the cost honest — an unvisited tab issues no
          fetches. */}
      {TABS.filter(t => visited.has(t.id)).map(t => (
        <div
          key={t.id}
          role="tabpanel"
          id={`panel-${t.id}`}
          aria-labelledby={`tab-${t.id}`}
          hidden={t.id !== activeId}
          tabIndex={0}
          className="focus:outline-none"
        >
          {t.id === 'cba'     && <CbaRulesPanel onRuleSetsChanged={onRuleSetsChanged} />}
          {t.id === 'headway' && <HeadwayPanel />}
          {t.id === 'core'    && (
            <PlanningCorePanel
              cbaRevision={cbaRevision}
              onEditPceRules={pce.allowed && !pce.loading ? () => setPceOpen(true) : undefined}
            />
          )}
        </div>
      ))}

      <PceRulesDrawer
        open={pceOpen}
        onClose={() => setPceOpen(false)}
      />
    </div>
  );
}
