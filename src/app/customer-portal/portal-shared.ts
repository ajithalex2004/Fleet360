/** Customer Portal — shapes and helpers shared by the portal pages. */

export interface CustomerRequest {
  id: string;
  readableId: string | null;
  title: string;
  description: string | null;
  ticketType: string;
  priority: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  serviceNeededAt: string | null;
  entitlementType: string | null;
  requestChannel: string | null;
  siteId: string | null;
  siteName: string | null;
  assetNo: string | null;
  assetName: string | null;
  serialNumber: string | null;
  sla: { responseHours: number | null; onSiteHours: number | null; resolutionHours: number | null } | null;
  photos: number;
  lifecycle: Array<{ status: string; at: string; by: string }>;
  technician?: { name: string; email: string | null; mobile: string | null } | null;
}

export const ACTIVE_STATUSES = ['Pending', 'Awaiting Approval', 'Acknowledged', 'Assigned', 'Escalated', 'In Progress'];
export const isActive = (s: string) => ACTIVE_STATUSES.includes(s);

/** The six customer-facing stages and the stage each status reaches. */
export const STAGES = ['Submitted', 'Acknowledged', 'Assigned', 'On site', 'Resolved', 'Closed'] as const;
export function stageIndex(status: string): number {
  switch (status) {
    case 'Pending': case 'Awaiting Approval': return 0;
    case 'Acknowledged': return 1;
    case 'Assigned': case 'Escalated': return 2;
    case 'In Progress': return 3;
    case 'Resolved': return 4;
    case 'Closed': return 5;
    default: return 0;
  }
}
export const stageLabel = (status: string) =>
  status === 'In Progress' ? 'On site' : status === 'Pending' ? 'Submitted' : status;

export type SlaState = 'on-track' | 'at-risk' | 'breached' | 'met' | 'none';

/** Resolution SLA state: open requests past 75% of the target are at risk. */
export function slaState(r: CustomerRequest, now = Date.now()): SlaState {
  const hours = r.sla?.resolutionHours;
  if (!hours) return 'none';
  const due = new Date(r.createdAt).getTime() + hours * 3600_000;
  if (!isActive(r.status)) {
    const resolved = [...r.lifecycle].reverse().find((l) => l.status === 'Resolved' || l.status === 'Closed');
    const at = resolved ? new Date(resolved.at).getTime() : new Date(r.updatedAt).getTime();
    return at <= due ? 'met' : 'breached';
  }
  if (now > due) return 'breached';
  return now > new Date(r.createdAt).getTime() + hours * 3600_000 * 0.75 ? 'at-risk' : 'on-track';
}
export const SLA_LABEL: Record<SlaState, string> = {
  'on-track': 'On track', 'at-risk': 'At risk', breached: 'Breached', met: 'Met', none: '—',
};
export const SLA_TONE: Record<SlaState, string> = {
  'on-track': 'text-emerald-600', 'at-risk': 'text-amber-600', breached: 'text-rose-600', met: 'text-emerald-600', none: 'text-[var(--text-muted)]',
};

export const PRIORITY_LABEL: Record<string, string> = { Critical: 'P1 - Critical', High: 'P2 - High', Medium: 'P3 - Medium', Low: 'P4 - Low' };
export const PRIORITY_TONE: Record<string, string> = {
  Critical: 'bg-rose-500/15 text-rose-600 border-rose-500/30', High: 'bg-amber-500/15 text-amber-700 border-amber-500/30',
  Medium: 'bg-blue-500/15 text-blue-600 border-blue-500/30', Low: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30',
};
export const STATUS_TONE = (s: string) =>
  s === 'Resolved' || s === 'Closed' ? 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30'
    : s === 'Rejected' ? 'bg-rose-500/15 text-rose-600 border-rose-500/30'
      : s === 'In Progress' ? 'bg-blue-500/15 text-blue-600 border-blue-500/30'
        : 'bg-[var(--bg-surface-hover)] text-[var(--text-main)] border-[var(--border-subtle)]';

export const ENTITLEMENT_LABEL: Record<string, string> = {
  AMC: 'AMC', WARRANTY: 'Under Warranty', SLA_CONTRACT: 'Service Contract / SLA', CHARGEABLE: 'Chargeable', GOODWILL: 'Goodwill',
};

export const fmtDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

export async function fetchRequests(query = ''): Promise<CustomerRequest[]> {
  const res = await fetch(`/api/customer-portal/fsm/requests${query}`, { cache: 'no-store' });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) throw new Error(data?.error ?? 'Could not load your requests');
  return data.requests as CustomerRequest[];
}
