/**
 * Backwards-compat shim. The theme primitives now live at
 * src/components/ui/page-theme.tsx so every module can use them.
 *
 * Existing bus-ops pages continue to import from here — no changes
 * required. New code should import from '@/components/ui/page-theme'.
 */

export { PageHeader, KpiCard, Panel, StatusPill } from '@/components/ui/page-theme';
export type { PageAccent, BusOpsAccent } from '@/components/ui/page-theme';
