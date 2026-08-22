/**
 * Legacy route — headway management is now tab 2 of the Planning Engine.
 * See ../planning-engine/page.tsx.
 *
 * 307, not 308 — see the note in ../plan/page.tsx.
 */

import { redirect } from 'next/navigation';
import { planningEngineHref } from '@/lib/bus-ops/planning-engine-tabs';

export default function HeadwayPageRedirect() {
  redirect(planningEngineHref('headway'));
}
