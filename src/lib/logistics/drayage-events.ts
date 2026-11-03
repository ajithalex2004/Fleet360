import crypto from 'crypto';
import type { DrayageAutomationConfig } from './drayage-domain';

export interface DrayageRealtimeEvent {
  id: string;
  tenantId: string;
  type: string;
  action?: string;
  jobId?: string | null;
  jobCode?: string | null;
  containerNumber?: string | null;
  vehicleId?: string | null;
  lat?: number | null;
  lng?: number | null;
  timestamp: string;
}

export interface CachedWorkspaceEntry<T = Record<string, unknown>> {
  timestamp: number;
  etag: string;
  data: T;
}

export interface CachedMasterDataEntry {
  timestamp: number;
  terminalRows: Array<Record<string, unknown>>;
  warehouseRows: Array<Record<string, unknown>>;
  clientRows: Array<Record<string, unknown>>;
  geofenceRows: Array<Record<string, unknown>>;
  rawCustomers: Array<Record<string, unknown>>;
  automationConfig: DrayageAutomationConfig;
}

type DrayageEventListener = (event: DrayageRealtimeEvent) => void;

interface DrayageGlobalState {
  workspaceCache: Map<string, CachedWorkspaceEntry>;
  masterDataCache: Map<string, CachedMasterDataEntry>;
  etcCheckTimestamps: Map<string, number>;
  subscribers: Map<string, Set<DrayageEventListener>>;
}

const GLOBAL_KEY = '__fleet360_drayage_PerfState_v1__';

function getGlobalState(): DrayageGlobalState {
  const g = globalThis as unknown as Record<string, DrayageGlobalState | undefined>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      workspaceCache: new Map(),
      masterDataCache: new Map(),
      etcCheckTimestamps: new Map(),
      subscribers: new Map(),
    };
  }
  return g[GLOBAL_KEY]!;
}

export const WORKSPACE_CACHE_TTL_MS = 5_000; // 5s fresh window, invalidated immediately on any write
export const MASTER_DATA_CACHE_TTL_MS = 30_000; // 30s TTL for static master tables
export const ETC_CHECK_THROTTLE_MS = 30_000; // Run background ETC sweep at most once per 30s per tenant on GET

const MASTER_MUTATION_ACTIONS = new Set([
  'create_terminal',
  'update_terminal',
  'delete_terminal',
  'create_warehouse',
  'update_warehouse',
  'delete_warehouse',
  'create_client',
  'update_client',
  'delete_client',
  'create_geofence',
  'update_geofence',
  'delete_geofence',
  'set_auto_l2_mode',
  'save_automation_config',
]);

export function computeWorkspaceEtag(data: Record<string, unknown>): string {
  const jobs = Array.isArray(data.jobs) ? data.jobs : [];
  const containers = Array.isArray(data.containers) ? data.containers : [];
  const statusLogs = Array.isArray(data.statusLogs) ? data.statusLogs : [];
  const messages = Array.isArray(data.messages) ? data.messages : [];
  const allowances = Array.isArray(data.allowances) ? data.allowances : [];
  const terminals = Array.isArray(data.terminals) ? data.terminals : [];
  const warehouses = Array.isArray(data.warehouses) ? data.warehouses : [];
  const trailers = Array.isArray(data.trailers) ? data.trailers : [];

  const firstJob = jobs[0] as Record<string, unknown> | undefined;
  const firstLog = statusLogs[0] as Record<string, unknown> | undefined;
  const lastMsg = messages[messages.length - 1] as Record<string, unknown> | undefined;

  const jobDigest = jobs
    .slice(0, 40)
    .map((j: Record<string, unknown>) => `${j.id}:${j.status}:${j.updatedAt}:${j.assignedVehicleId ?? ''}:${j.assignedDriverId ?? ''}:${j.pcsTokenNumber ?? ''}`)
    .join('|');

  const fingerprint = [
    `j:${jobs.length}:${firstJob?.updatedAt ?? ''}`,
    `c:${containers.length}`,
    `l:${statusLogs.length}:${firstLog?.id ?? ''}`,
    `m:${messages.length}:${lastMsg?.id ?? ''}`,
    `a:${allowances.length}`,
    `t:${terminals.length}`,
    `w:${warehouses.length}`,
    `tr:${trailers.length}`,
    jobDigest,
  ].join('#');

  const hash = crypto.createHash('sha1').update(fingerprint).digest('hex').slice(0, 16);
  return `W/"drayage-${hash}"`;
}

export function getCachedDrayageWorkspace(tenantId: string): CachedWorkspaceEntry | null {
  const state = getGlobalState();
  const entry = state.workspaceCache.get(tenantId);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > WORKSPACE_CACHE_TTL_MS) {
    state.workspaceCache.delete(tenantId);
    return null;
  }
  return entry;
}

export function setCachedDrayageWorkspace(
  tenantId: string,
  data: Record<string, unknown>,
): CachedWorkspaceEntry {
  const state = getGlobalState();
  const entry: CachedWorkspaceEntry = {
    timestamp: Date.now(),
    etag: computeWorkspaceEtag(data),
    data,
  };
  state.workspaceCache.set(tenantId, entry);
  return entry;
}

export function invalidateDrayageWorkspaceCache(tenantId?: string): void {
  const state = getGlobalState();
  if (tenantId) {
    state.workspaceCache.delete(tenantId);
  } else {
    state.workspaceCache.clear();
  }
}

export function getCachedDrayageMasterData(tenantId: string): CachedMasterDataEntry | null {
  const state = getGlobalState();
  const entry = state.masterDataCache.get(tenantId);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > MASTER_DATA_CACHE_TTL_MS) {
    state.masterDataCache.delete(tenantId);
    return null;
  }
  return entry;
}

export function setCachedDrayageMasterData(
  tenantId: string,
  entry: Omit<CachedMasterDataEntry, 'timestamp'>,
): CachedMasterDataEntry {
  const state = getGlobalState();
  const full: CachedMasterDataEntry = {
    ...entry,
    timestamp: Date.now(),
  };
  state.masterDataCache.set(tenantId, full);
  return full;
}

export function invalidateDrayageMasterCache(tenantId?: string): void {
  const state = getGlobalState();
  if (tenantId) {
    state.masterDataCache.delete(tenantId);
    state.workspaceCache.delete(tenantId);
  } else {
    state.masterDataCache.clear();
    state.workspaceCache.clear();
  }
}

export function shouldRunEtcAutoActivationCheck(
  tenantId: string,
  throttleMs = ETC_CHECK_THROTTLE_MS,
): boolean {
  const state = getGlobalState();
  const now = Date.now();
  const lastRun = state.etcCheckTimestamps.get(tenantId) ?? 0;
  if (now - lastRun < throttleMs) {
    return false;
  }
  state.etcCheckTimestamps.set(tenantId, now);
  return true;
}

export function resetEtcAutoActivationThrottle(tenantId: string): void {
  const state = getGlobalState();
  state.etcCheckTimestamps.delete(tenantId);
}

export function subscribeDrayageEvents(
  tenantId: string,
  listener: DrayageEventListener,
): () => void {
  const state = getGlobalState();
  let set = state.subscribers.get(tenantId);
  if (!set) {
    set = new Set();
    state.subscribers.set(tenantId, set);
  }
  set.add(listener);

  return () => {
    const currentSet = state.subscribers.get(tenantId);
    if (currentSet) {
      currentSet.delete(listener);
      if (currentSet.size === 0) {
        state.subscribers.delete(tenantId);
      }
    }
  };
}

export function emitDrayageEvent(
  tenantId: string,
  input: {
    type: string;
    action?: string;
    jobId?: string | null;
    jobCode?: string | null;
    containerNumber?: string | null;
    vehicleId?: string | null;
    lat?: number | null;
    lng?: number | null;
    invalidateMaster?: boolean;
  },
): DrayageRealtimeEvent {
  const state = getGlobalState();

  // Always invalidate workspace cache on any domain event
  state.workspaceCache.delete(tenantId);

  if (input.invalidateMaster || (input.action && MASTER_MUTATION_ACTIONS.has(input.action))) {
    state.masterDataCache.delete(tenantId);
  }

  const event: DrayageRealtimeEvent = {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    tenantId,
    type: input.type,
    action: input.action,
    jobId: input.jobId ?? null,
    jobCode: input.jobCode ?? null,
    containerNumber: input.containerNumber ?? null,
    vehicleId: input.vehicleId ?? null,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    timestamp: new Date().toISOString(),
  };

  const listeners = state.subscribers.get(tenantId);
  if (listeners && listeners.size > 0) {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        // Ignore broken listener
      }
    }
  }

  return event;
}
