/** Customer Portal — Transport: request types, stages and labels shared by the pages. */

import type { TransportCategory } from '@/lib/customer-portal/catalog';

export type TransportStatus =
  | 'PENDING_APPROVAL' | 'SUBMITTED' | 'CONFIRMED' | 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'REJECTED' | 'CANCELLED';

export interface TransportRequest {
  id: string;
  requestNo: string;
  category: TransportCategory;
  categoryTitle: string;
  status: TransportStatus;
  values: Record<string, string | number | boolean>;
  pickup: string | null;
  dropoff: string | null;
  serviceDate: string | null;
  serviceTime: string | null;
  vehicleCategory: string | null;
  requestedByName: string | null;
  driver: { name: string; phone: string | null } | null;
  vehicle: string | null;
  routed: { module: string; ref: string | null } | null;
  customerNote: string | null;
  lifecycle: Array<{ status: TransportStatus; at: string; by: string; note?: string }>;
  createdAt: string;
  updatedAt: string;
}

/** The stepper: approval is shown only for requests that needed it. */
export const STAGES: TransportStatus[] = ['SUBMITTED', 'CONFIRMED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED'];

export const STATUS_LABEL: Record<TransportStatus, string> = {
  PENDING_APPROVAL: 'Awaiting approval',
  SUBMITTED: 'Submitted',
  CONFIRMED: 'Confirmed',
  ASSIGNED: 'Driver assigned',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

export const STATUS_TONE: Record<TransportStatus, string> = {
  PENDING_APPROVAL: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
  SUBMITTED: 'bg-blue-500/10 text-blue-600 border-blue-500/30',
  CONFIRMED: 'bg-indigo-500/10 text-indigo-600 border-indigo-500/30',
  ASSIGNED: 'bg-violet-500/10 text-violet-600 border-violet-500/30',
  IN_PROGRESS: 'bg-cyan-500/10 text-cyan-600 border-cyan-500/30',
  COMPLETED: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30',
  REJECTED: 'bg-rose-500/10 text-rose-600 border-rose-500/30',
  CANCELLED: 'bg-slate-500/10 text-slate-500 border-slate-500/30',
};

export const isOpen = (s: TransportStatus) => ['PENDING_APPROVAL', 'SUBMITTED', 'CONFIRMED', 'ASSIGNED', 'IN_PROGRESS'].includes(s);

export const MODULE_LABEL: Record<string, string> = {
  LOGISTICS: 'Logistics shipping request',
  RENTAL: 'Rental inquiry',
  STAFF_TRANSPORT: 'Bus Ops transport request',
};

/** Categories whose requests go to a module of their own. */
export const ROUTED_CATEGORIES = ['LOGISTICS', 'RAC', 'STAFF_TRANSPORT'];

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function fmtService(r: Pick<TransportRequest, 'serviceDate' | 'serviceTime'>): string {
  if (!r.serviceDate) return '—';
  const d = new Date(`${r.serviceDate}T00:00:00`);
  const day = Number.isNaN(d.getTime()) ? r.serviceDate : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  return r.serviceTime ? `${day}, ${r.serviceTime}` : day;
}

export async function fetchTransportRequests(query = ''): Promise<TransportRequest[]> {
  const res = await fetch(`/api/customer-portal/transport/requests${query}`, { cache: 'no-store' });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) throw new Error(data?.error ?? 'Could not load your requests');
  return data.requests;
}
