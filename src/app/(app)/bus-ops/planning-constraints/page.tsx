/**
 * Legacy route — Planning Constraints (PCE) is now tab 2 of the Planning
 * Engine, sitting directly after Operational Rules Engine. See
 * ../planning-engine/page.tsx.
 *
 * Kept because four places still link here: the bus-ops dashboard (a card
 * and a quick-link), the Route Consolidation page, and the scoring-policy
 * API's documentation. Redirecting is cheaper than chasing every caller,
 * and keeps any operator bookmarks working.
 *
 * 307, not 308 — see the note in ../plan/page.tsx.
 */

import { redirect } from 'next/navigation';
import { planningEngineHref } from '@/lib/bus-ops/planning-engine-tabs';

export default function PlanningConstraintsPageRedirect() {
  redirect(planningEngineHref('constraints'));
}
