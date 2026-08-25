/**
 * Legacy route — the Planning Optimizer is now the last tab of the
 * Planning Engine. See ../planning-engine/page.tsx.
 *
 * Last, because visual order follows the data flow and this consumes what
 * Planning Core produces: it ranks saved StaffTransportPlan rows.
 *
 * 307, not 308 — see the note in ../plan/page.tsx.
 */

import { redirect } from 'next/navigation';
import { planningEngineHref } from '@/lib/bus-ops/planning-engine-tabs';

export default function PlanningOptimizerPageRedirect() {
  redirect(planningEngineHref('optimizer'));
}
