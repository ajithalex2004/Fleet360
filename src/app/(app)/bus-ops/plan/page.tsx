/**
 * Legacy route — Planning Core is now tab 3 of the Planning Engine.
 *
 * Kept as a redirect rather than deleted: /bus-ops/plan is linked from
 * the bus-ops dashboard tiles and is the P0 entry point operators are
 * likely to have bookmarked.
 *
 * redirect (307), deliberately NOT permanentRedirect (308). A 308 is
 * cached by the browser indefinitely, so if this consolidation is ever
 * reversed, every user who visited would keep being bounced to a page
 * that no longer exists — with no way to clear it short of asking them
 * to wipe their cache. There is no SEO upside to trade against that on
 * an authenticated internal app. Promote to 308 once the layout has
 * settled, if ever.
 */

import { redirect } from 'next/navigation';
import { planningEngineHref } from '@/lib/bus-ops/planning-engine-tabs';

export default function PlanPageRedirect() {
  redirect(planningEngineHref('core'));
}
