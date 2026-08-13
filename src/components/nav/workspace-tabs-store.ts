/**
 * Workspace tabs — global singleton store.
 *
 * One store instance per page load, shared across every component that calls
 * `useWorkspaceTabs()`. Lives OUTSIDE React so navigating between layouts
 * (logistics → admin → fleet) does not destroy the tab list. Persisted to
 * sessionStorage so a hard refresh keeps the strip; closing the browser
 * session clears it (deliberate — long-lived state belongs in URLs).
 *
 * Cap policy: LRU-EVICT at MAX_TABS — opening a tab when full evicts the
 * oldest non-active tab (least-recently-used, per the `lru` array) and opens
 * the new one. This matches the original UX spec ("for the sixth tab, any of
 * the tabs should be closed"). If for some reason EVERY tab is pinned to
 * "recent" (edge case: all N tabs match state.activeKey which is impossible
 * for one-active-tab), the call throws WorkspaceTabsFullError so a caller
 * can still surface a message — but under normal use this never fires.
 */

import { useSyncExternalStore } from 'react';

export const MAX_TABS = 5;
const STORAGE_KEY = 'fleet360-workspace-tabs-v1';

export interface WorkspaceTab {
  /** Stable key — the route href. The active route always maps 1:1 to a tab key. */
  key: string;
  /** Display label in the tab. */
  label: string;
  /** Module id the tab belongs to (drives the sidebar highlight). */
  moduleId: string;
  /** Lucide icon name as a string — kept stringly because the store is JSON. */
  iconName: string;
}

export class WorkspaceTabsFullError extends Error {
  constructor(message: string) { super(message); this.name = 'WorkspaceTabsFullError'; }
}

interface State {
  tabs: WorkspaceTab[];
  activeKey: string | null;
  /** Least-recently-used order — last entry is most recent. Drives future LRU eviction. */
  lru: string[];
}

function emptyState(): State { return { tabs: [], activeKey: null, lru: [] }; }

// IMPORTANT: getServerSnapshot must return a STABLE reference. Returning a
// new object every call triggers React's "The result of getServerSnapshot
// should be cached to avoid an infinite loop" warning, because useSyncExternalStore
// re-renders whenever the snapshot reference changes — and a fresh object
// reference on every call would re-render forever.
const EMPTY_STATE: State = emptyState();

function hydrate(): State {
  if (typeof window === 'undefined') return emptyState();
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<State>;
    if (!Array.isArray(parsed.tabs)) return emptyState();
    return {
      tabs: parsed.tabs.filter(t => t && typeof t.key === 'string' && typeof t.label === 'string') as WorkspaceTab[],
      activeKey: typeof parsed.activeKey === 'string' ? parsed.activeKey : null,
      lru: Array.isArray(parsed.lru) ? parsed.lru.filter(k => typeof k === 'string') : [],
    };
  } catch {
    return emptyState();
  }
}

let state: State = emptyState();
let hydrated = false;
const listeners = new Set<() => void>();

function ensureHydrated() {
  if (hydrated || typeof window === 'undefined') return;
  state = hydrate();
  hydrated = true;
}

function persist() {
  if (typeof window === 'undefined') return;
  try { window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* quota */ }
}

function set(next: State) {
  state = next;
  persist();
  listeners.forEach(l => l());
}

function getSnapshot(): State { return state; }
function getServerSnapshot(): State { return EMPTY_STATE; }
function subscribe(listener: () => void): () => void {
  ensureHydrated();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useWorkspaceTabs() {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return snap;
}

function bumpLru(key: string, lru: string[]): string[] {
  const filtered = lru.filter(k => k !== key);
  filtered.push(key);
  return filtered;
}

/**
 * Open a tab. If a tab with the same key already exists, just switches to it.
 * When at MAX_TABS, evicts the least-recently-used non-active tab and opens
 * the new one — this is the "sixth tab replaces the oldest one" behaviour
 * per the original spec. Throws WorkspaceTabsFullError only in the pathological
 * edge case where no tab is evictable (should be unreachable in normal use).
 */
export function openTab(tab: WorkspaceTab) {
  ensureHydrated();
  const existing = state.tabs.find(t => t.key === tab.key);
  if (existing) {
    if (state.activeKey === tab.key) return;
    set({ ...state, activeKey: tab.key, lru: bumpLru(tab.key, state.lru) });
    return;
  }
  let tabs = state.tabs;
  let lru = state.lru;
  if (tabs.length >= MAX_TABS) {
    // Pick the LRU non-active tab to evict. `lru` is oldest-first, so scan
    // from the front and drop the first key that (a) is not the active tab
    // and (b) actually matches an open tab. Anything in `lru` for a tab we
    // already closed is a stale entry — safe to skip.
    const evictKey = lru.find(k => k !== state.activeKey && tabs.some(t => t.key === k));
    if (!evictKey) {
      throw new WorkspaceTabsFullError(`Max ${MAX_TABS} tabs open. Close one to open ${tab.label}.`);
    }
    tabs = tabs.filter(t => t.key !== evictKey);
    lru = lru.filter(k => k !== evictKey);
  }
  set({
    tabs: [...tabs, tab],
    activeKey: tab.key,
    lru: bumpLru(tab.key, lru),
  });
}

/** Switch to an already-open tab. No-op if the tab isn't open. */
export function activateTab(key: string) {
  ensureHydrated();
  if (!state.tabs.some(t => t.key === key)) return;
  if (state.activeKey === key) return;
  set({ ...state, activeKey: key, lru: bumpLru(key, state.lru) });
}

/**
 * Close a tab. If the closed tab was active, the previous-in-list tab
 * (or the most-recently-used remaining tab) becomes active.
 */
export function closeTab(key: string) {
  ensureHydrated();
  const idx = state.tabs.findIndex(t => t.key === key);
  if (idx === -1) return;
  const nextTabs = state.tabs.filter(t => t.key !== key);
  const nextLru = state.lru.filter(k => k !== key);
  let nextActive = state.activeKey;
  if (state.activeKey === key) {
    nextActive = nextLru.length ? nextLru[nextLru.length - 1] : (nextTabs[Math.max(0, idx - 1)]?.key ?? null);
  }
  set({ tabs: nextTabs, activeKey: nextActive, lru: nextLru });
}

/** Close every tab. */
export function closeAllTabs() {
  ensureHydrated();
  set(emptyState());
}
