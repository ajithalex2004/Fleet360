'use client';
/**
 * /bus-ops/planning-engine — the Planning Engine.
 *
 * One page, five tabs, consolidating what used to be five separate
 * routes:
 *
 *   /bus-ops/cba-rules            →  ?tab=cba          Operational Rules Engine
 *   /bus-ops/planning-constraints →  ?tab=constraints  Planning Constraints (PCE)
 *   /bus-ops/plan                 →  ?tab=core         Planning Core   ← default
 *   /bus-ops/headway              →  ?tab=headway      Headway Management
 *   /bus-ops/planning-optimizer   →  ?tab=optimizer    Planning Optimizer
 *
 * All five old paths still resolve; they redirect here preserving the
 * tab, so bookmarks and the dashboard tiles keep working.
 *
 * Visual order and default tab are deliberate and independent — changing
 * one doesn't imply the other. Operational Rules Engine (CBA) sits first
 * because it is upstream in the mental model — operational rules feed the
 * plan, and Planning Core literally pre-fills its WorkRules from the
 * default rule-set via cbaToWorkRules. Planning Constraints follows for
 * the same reason: PCE rules gate what the plan is allowed to become.
 * Planning Core is the tab that opens, because it is the daily-driver task
 * while the other three are configured rarely; landing on a config screen
 * would tax the frequent job every time. Planning Optimizer sits last
 * because it consumes what Planning Core produces — it ranks saved plans.
 * Headway's position is a product decision, not derived from the data-flow
 * reasoning above.
 *
 * The Optimizer tab deliberately gets no props: it ranks plans and must not
 * act on them. See its file header — the no-apply-from-here rule predates
 * this page and was not relaxed by moving it in.
 *
 * The Constraints tab is permission-filtered rather than merely gated by
 * the page wrapper — it needs bus-ops:admin:planning-constraints, which is
 * a separate resource from the planning-core one guarding this page and is
 * documented in permissions.ts as independently restrictable.
 *
 * Guarded as a whole on bus-ops:admin:planning-core. That tightens CBA
 * and Headway, which previously had no page guard at all — their APIs
 * are gated separately (see the bus-ops:admin:cba-rules / :headway rows
 * in permissions.ts), because a page guard alone protects nothing.
 */

import React, { Suspense, useCallback, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Sparkles, ShieldCheck, Shield, Clock, Trophy } from 'lucide-react';
import { PageHeader, TabStrip, type TabDef } from '@/components/bus-ops/theme';
import RequireTenantAdmin, { useBusOpsAdminAccess } from '@/components/bus-ops/RequireTenantAdmin';
import { CbaRulesPanel } from '@/components/bus-ops/planning-engine/CbaRulesPanel';
import { HeadwayPanel } from '@/components/bus-ops/planning-engine/HeadwayPanel';
import { PlanningCorePanel } from '@/components/bus-ops/planning-engine/PlanningCorePanel';
import { PlanningConstraintsPanel } from '@/components/bus-ops/planning-engine/PlanningConstraintsPanel';
import { PlanningOptimizerPanel } from '@/components/bus-ops/planning-engine/PlanningOptimizerPanel';
import { resolvePlanningEngineTab } from '@/lib/bus-ops/planning-engine-tabs';

/**
 * Visual order. `core` is the default active tab — see the file header.
 *
 * Kept in the same order as PLANNING_ENGINE_TAB_IDS, which is a second
 * source of truth for tab identity rather than just a validity list.
 *
 * `constraints` is only offered to users who hold bus-ops:admin:planning-
 * constraints — a different permission from the planning-core one gating
 * this page, and deliberately grantable on its own. See buildTabs below.
 */
const BASE_TABS: TabDef[] = [
  { id: 'cba',         label: 'Operational Rules Engine', icon: ShieldCheck },
  { id: 'constraints', label: 'Planning Constraints',     icon: Shield },
  { id: 'core',        label: 'Planning Core',            icon: Sparkles },
  { id: 'headway',     label: 'Headway',                  icon: Clock },
  { id: 'optimizer',   label: 'Planning Optimizer',       icon: Trophy },
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

  // The Constraints tab writes to /api/bus-ops/planning-constraints, gated
  // on its own resource — a different one from the planning-core permission
  // wrapping this page. Gate the tab itself rather than leaning on the page
  // wrapper: BUS_OPS_ADMIN_ONLY_RESOURCES is empty today so both land on the
  // same roles, but permissions.ts documents restricting a single resource
  // as a one-line change, and folding PCE under planning-core would quietly
  // break that.
  const pce = useBusOpsAdminAccess('planning-constraints');
  const canEditPce = pce.allowed && !pce.loading;

  const tabs = useMemo(
    () => BASE_TABS.filter(t => t.id !== 'constraints' || canEditPce),
    [canEditPce],
  );

  // Bumped whenever the Constraints tab mutates a rule. Planning Core stays
  // mounted on its own tab holding a plan computed against the old rules, so
  // without this it would keep showing a stale result with nothing to say it
  // moved. Same handshake as cbaRevision — it offers a recompute, it does
  // not silently discard in-progress work.
  const [pceRevision, setPceRevision] = useState(0);
  const onConstraintsChanged = useCallback(() => setPceRevision(n => n + 1), []);

  const subtitle = useMemo(() => {
    switch (activeId) {
      case 'cba':         return 'Operational rules, service frequency, and the runcut/blocking/rostering engine — in the order they feed each other.';
      case 'headway':     return 'Operational rules, service frequency, and the runcut/blocking/rostering engine — in the order they feed each other.';
      case 'constraints': return 'Rules the planner must respect — evaluated on every plan apply and every route merge.';
      case 'optimizer':   return 'Rank saved plans by cost and constraint penalties. Read-only — apply from the Planning Core tab.';
      default:        return 'Runcut, block and roster staff transport — with the operational and frequency rules that feed it one tab away.';
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
        tabs={tabs}
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
      {tabs.filter(t => visited.has(t.id)).map(t => (
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
          {t.id === 'constraints' && (
            <PlanningConstraintsPanel onConstraintsChanged={onConstraintsChanged} />
          )}
          {/* Rendered with no props on purpose. The optimizer ranks plans and
              must not act on them: no apply affordance, and no hand-off that
              pre-selects the winner on Planning Core. See its file header —
              that separation used to be enforced by being a separate page,
              and now rests on there being nothing here to wire. */}
          {t.id === 'optimizer' && <PlanningOptimizerPanel />}
          {t.id === 'core'    && (
            <PlanningCorePanel
              cbaRevision={cbaRevision}
              pceRevision={pceRevision}
              // Switches tabs rather than opening a drawer. PceRulesDrawer
              // used to cover the four constraints that bound Planning Core,
              // because deep-linking to the old standalone page discarded the
              // in-progress plan. A tab cannot: panels here are never
              // unmounted, so Planning Core keeps its state while the
              // operator edits rules on the Constraints tab. Kept as an
              // affordance so the route from "my plan is gated" to "edit the
              // rule" stays one click.
              onEditPceRules={canEditPce ? () => setTab('constraints') : undefined}
            />
          )}
        </div>
      ))}
    </div>
  );
}
