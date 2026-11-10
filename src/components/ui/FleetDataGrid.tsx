'use client';
/**
 * FleetDataGrid — a reusable, dependency-free data grid for the Logistics
 * module.
 *
 *   • Sortable column headers (click cycles asc → desc → none, with indicators)
 *   • Inline filter row (per-column text or select filters)
 *   • Smart toolbar: global search, column show/hide, density, CSV export,
 *     a live "X of Y" count, and a one-click clear-all
 *
 * Generic over the row type. Columns declare an `accessor` (used for sorting,
 * filtering, search and CSV) and an optional `render` for the cell. Pure client
 * state — no server round-trips, no external grid library. Styled with the
 * app's CSS custom properties so it follows the Light/Dark toggle.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowUp, ArrowDown, ChevronsUpDown, Search as SearchIcon, Columns3, Download,
  Rows3, Filter, X, ArrowUpDown, ChevronRight, ChevronDown, ChevronLeft,
} from 'lucide-react';

export type SortDir = 'asc' | 'desc';

export interface DataGridColumn<T> {
  key: string;
  header: string;
  /** Value used for sort / filter / global-search / CSV. Omit for action-only columns. */
  accessor?: (row: T) => string | number | null | undefined;
  /** Custom cell renderer. Falls back to the accessor value. */
  render?: (row: T) => React.ReactNode;
  sortable?: boolean;                  // default: true when accessor is present
  filter?: 'text' | 'select' | false;  // default: 'text' when accessor is present
  selectOptions?: string[];            // for filter='select'; derived from data when omitted
  align?: 'left' | 'right' | 'center';
  width?: string;                      // e.g. '160px'
  headerClassName?: string;
  cellClassName?: string;
}

interface ToolbarOptions {
  title?: string;
  search?: boolean;   // default true
  columns?: boolean;  // default true
  density?: boolean;  // default true
  filters?: boolean;  // show the Filters toggle (default true)
  exportCsv?: boolean; // default true
  exportName?: string; // CSV filename (without extension)
  actions?: React.ReactNode; // extra content on the toolbar's right
  /** Show explicit Sort dropdown that surfaces the active sort. Default false. */
  sortSelector?: boolean;
}

/** KPI summary tile rendered above the grid. Opt-in via the `kpis` prop. */
export type KpiAccent = 'default' | 'violet' | 'emerald' | 'sky' | 'amber' | 'rose' | 'slate';
export interface KpiTile {
  label: string;
  value: number | string;
  sub?: string;
  accent?: KpiAccent;
  icon?: LucideIcon;
}

/** Quick-toggle filter chip group rendered above the grid. Opt-in via `filterChips`. */
export interface FilterChipOption { value: string; label: string }
export interface FilterChipDef<T> {
  key: string;
  label: string;
  options: FilterChipOption[];
  /** True to keep this row when the given chip value is active. */
  predicate: (row: T, value: string) => boolean;
  /** Allow multiple chips within this group to be active at once (OR-combined). Default false. */
  multi?: boolean;
}

interface DataGridProps<T> {
  rows: T[];
  columns: DataGridColumn<T>[];
  getRowId: (row: T) => string;
  onRowClick?: (row: T) => void;
  selectedId?: string | null;
  loading?: boolean;
  emptyMessage?: string;
  initialSort?: { key: string; dir: SortDir };
  toolbar?: ToolbarOptions;
  /** KPI summary tiles rendered above the grid. Omit for no header row. */
  kpis?: KpiTile[];
  /** Filter chip groups rendered above the grid; complement per-column filters. */
  filterChips?: FilterChipDef<T>[];
  className?: string;
  /**
   * Stable product name for this instance — shown in the toolbar and
   * as data-grid-name for support / QA (e.g. "RoutesGrid", "SchedulesGrid").
   */
  gridName?: string;
  /**
   * Leading "#" column showing each row's position in the CURRENT view —
   * i.e. after sort and filters are applied, not raw array index. A row's
   * number moves when the user sorts or filters; that's intentional, it's
   * "row 3 of what I'm looking at now", not a stable row identity. Default
   * false — existing consumers are unaffected unless they opt in.
   */
  numbered?: boolean;
  /**
   * Override the content of the `numbered` column for specific rows —
   * e.g. swapping a trophy icon in for the winning row's position number.
   * Receives the row and its 1-based position in the current view (same
   * value the plain numbered column would render). Return the number
   * itself (or any node) to fall back to default-looking output. Ignored
   * when `numbered` is false.
   */
  numberRender?: (row: T, position: number) => React.ReactNode;
  /**
   * Leading checkbox column for multi-row selection, for bulk actions the
   * page wants to build on top (bulk delete/export/status-change/etc — this
   * component only tracks which ids are checked, it doesn't know what to do
   * with them). Independent of `selectedId` above, which is a single active
   * row for click/highlight (e.g. master-detail) — the two are unrelated
   * concepts and a page could use either, both, or neither.
   *
   * Controlled: pass `selectedIds` + `onSelectionChange`, same pattern as a
   * controlled input. The "select all" header checkbox acts on the rows
   * currently visible after filtering (`processed`), matching how filtered
   * bulk-select conventionally behaves elsewhere (e.g. Gmail's "select all
   * that match this search") — not the full unfiltered `rows`.
   */
  selectable?: boolean;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  /**
   * Business-state-driven row background (e.g. tinting a "winner" row,
   * muting an infeasible one) — a concern the grid has no opinion on.
   * When provided for a given row, it fully replaces the default
   * hover/selected background for that row rather than combining with
   * it, so conflicting `bg-*` utilities never fight over specificity.
   * Return '' to opt a specific row back into "no special background".
   */
  rowClassName?: (row: T) => string;
  /**
   * Per-row detail panel — when this returns a node for a given row, that
   * row gets a leading chevron and becomes expandable; clicking the
   * chevron (or the row itself, when `onRowClick` isn't also set) inserts
   * the returned content as a full-width row beneath it. Return null/
   * undefined/false to make a specific row non-expandable while the
   * feature is still on for the rest. Uncontrolled and single-open, like
   * an accordion — expanding one row collapses whichever was open before.
   * Not a fit for pages needing multiple rows open at once.
   */
  expandable?: (row: T) => React.ReactNode | null | undefined | false;
  /**
   * Show a synchronized horizontal scrollbar docked at the bottom of the screen
   * so users can easily scroll wide tables right and left even when the list is long.
   */
  stickyBottomScrollbar?: boolean;
  /** Optional minimum width for the table (e.g. '1420px') to guarantee comfortable column spacing & horizontal scrolling. */
  tableMinWidth?: string;
}

const KPI_ACCENTS: Record<KpiAccent, { bg: string; text: string }> = {
  default: { bg: 'bg-slate-500/15',   text: 'text-[var(--text-main)]'   },
  violet:  { bg: 'bg-violet-500/15',  text: 'text-violet-300'  },
  emerald: { bg: 'bg-emerald-500/15', text: 'text-emerald-300' },
  sky:     { bg: 'bg-sky-500/15',     text: 'text-sky-300'     },
  amber:   { bg: 'bg-amber-500/15',   text: 'text-amber-300'   },
  rose:    { bg: 'bg-rose-500/15',    text: 'text-rose-300'    },
  slate:   { bg: 'bg-slate-500/15',   text: 'text-[var(--text-muted)]'   },
};

const cmp = (a: unknown, b: unknown): number => {
  const an = a == null || a === '';
  const bn = b == null || b === '';
  if (an && bn) return 0;
  if (an) return 1;   // nulls last
  if (bn) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
};

export default function FleetDataGrid<T>({
  rows, columns, getRowId, onRowClick, selectedId, loading, emptyMessage = 'No rows',
  initialSort, toolbar = {}, kpis, filterChips, className = '', gridName = 'FleetDataGrid',
  numbered = false, numberRender, selectable = false, selectedIds, onSelectionChange, rowClassName,
  expandable, stickyBottomScrollbar = true, tableMinWidth,
}: DataGridProps<T>) {
  const tb = { search: true, columns: true, density: true, filters: true, exportCsv: true, sortSelector: false, ...toolbar };

  const [sort, setSort] = useState<{ key: string; dir: SortDir } | null>(initialSort ?? null);
  const [colFilters, setColFilters] = useState<Record<string, string>>({});
  const [globalSearch, setGlobalSearch] = useState('');
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [dense, setDense] = useState(false);
  const [showFilters, setShowFilters] = useState(true);
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  /** Multi-value chip state: chip.key -> set of active option values. */
  const [chipValues, setChipValues] = useState<Record<string, Set<string>>>({});

  // Horizontal scroll synchronization refs & state (for bottom-of-screen horizontal scrollbar)
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const bottomScrollRef = useRef<HTMLDivElement | null>(null);
  const fixedBottomScrollRef = useRef<HTMLDivElement | null>(null);
  const syncingRef = useRef<'table' | 'bottom' | 'fixed' | null>(null);
  const [scrollMetrics, setScrollMetrics] = useState<{
    scrollLeft: number;
    scrollWidth: number;
    clientWidth: number;
    dockLeft: number;
    dockWidth: number;
    showFixedBottomDock: boolean;
  }>({
    scrollLeft: 0,
    scrollWidth: 1400,
    clientWidth: 1000,
    dockLeft: 0,
    dockWidth: 0,
    showFixedBottomDock: false,
  });

  const visibleColumns = useMemo(() => columns.filter(c => !hidden.has(c.key)), [columns, hidden]);
  const sortableColumns = useMemo(() => columns.filter(c => (c.sortable ?? !!c.accessor) && c.accessor), [columns]);

  // Unique values for select filters (per column), derived from the data.
  const selectValues = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const c of columns) {
      if (c.filter === 'select' && c.accessor) {
        map[c.key] = c.selectOptions
          ?? Array.from(new Set(rows.map(r => {
            const v = c.accessor?.(r);
            return v == null || v === '' ? null : String(v);
          }).filter((v): v is string => v != null))).sort((a, b) => a.localeCompare(b));
      }
    }
    return map;
  }, [columns, rows]);

  const processed = useMemo(() => {
    const q = globalSearch.trim().toLowerCase();
    const activeColFilters = Object.entries(colFilters).filter(([, v]) => v.trim() !== '');
    const activeChips = filterChips
      ? filterChips
          .map(chip => ({ chip, values: Array.from(chipValues[chip.key] ?? []) }))
          .filter(entry => entry.values.length > 0)
      : [];

    let out = rows.filter(row => {
      // global search across all accessors
      if (q) {
        const hit = columns.some(c => {
          const v = c.accessor?.(row);
          return v != null && String(v).toLowerCase().includes(q);
        });
        if (!hit) return false;
      }
      // per-column filters
      for (const [key, val] of activeColFilters) {
        const col = columns.find(c => c.key === key);
        const v = col?.accessor?.(row);
        const cell = v == null ? '' : String(v);
        if (col?.filter === 'select') {
          if (cell !== val) return false;
        } else if (!cell.toLowerCase().includes(val.trim().toLowerCase())) {
          return false;
        }
      }
      // filter chips — OR within a group, AND across groups.
      for (const { chip, values } of activeChips) {
        const ok = values.some(v => chip.predicate(row, v));
        if (!ok) return false;
      }
      return true;
    });

    if (sort) {
      const col = columns.find(c => c.key === sort.key);
      if (col?.accessor) {
        const acc = col.accessor;
        out = [...out].sort((a, b) => {
          const r = cmp(acc(a), acc(b));
          return sort.dir === 'asc' ? r : -r;
        });
      }
    }
    return out;
  }, [rows, columns, globalSearch, colFilters, chipValues, filterChips, sort]);

  const updateScrollMeasurement = useCallback(() => {
    const el = tableScrollRef.current;
    if (!el || typeof window === 'undefined') return;
    const rect = el.getBoundingClientRect();
    const sw = Math.max(el.scrollWidth, el.clientWidth);
    const cw = el.clientWidth;
    const sl = el.scrollLeft;
    // Show the fixed bottom-of-screen horizontal scrollbar whenever the grid is visible on screen
    // and its bottom edge is near or below the viewport bottom (so users don't have to scroll down past all rows).
    const isGridInViewport = rect.top < window.innerHeight - 70 && rect.bottom > 120;
    const isBottomBelowFold = rect.bottom > window.innerHeight - 36;
    setScrollMetrics({
      scrollLeft: sl,
      scrollWidth: sw,
      clientWidth: cw,
      dockLeft: Math.max(0, rect.left),
      dockWidth: Math.max(240, rect.width),
      showFixedBottomDock: Boolean(stickyBottomScrollbar && isGridInViewport && isBottomBelowFold),
    });
    if (bottomScrollRef.current && syncingRef.current !== 'bottom') {
      bottomScrollRef.current.scrollLeft = sl;
    }
    if (fixedBottomScrollRef.current && syncingRef.current !== 'fixed') {
      fixedBottomScrollRef.current.scrollLeft = sl;
    }
  }, [stickyBottomScrollbar]);

  useEffect(() => {
    updateScrollMeasurement();
    const el = tableScrollRef.current;
    if (!el || typeof window === 'undefined') return;

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => updateScrollMeasurement()) : null;
    if (ro) {
      ro.observe(el);
      const tbl = el.querySelector('table');
      if (tbl) ro.observe(tbl);
    }

    const onWindowScrollOrResize = () => updateScrollMeasurement();
    window.addEventListener('resize', onWindowScrollOrResize, { passive: true });
    window.addEventListener('scroll', onWindowScrollOrResize, true);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', onWindowScrollOrResize);
      window.removeEventListener('scroll', onWindowScrollOrResize, true);
    };
  }, [updateScrollMeasurement, processed.length, visibleColumns.length, dense]);

  const handleTableHorizontalScroll = () => {
    const el = tableScrollRef.current;
    if (!el) return;
    if (syncingRef.current === 'bottom' || syncingRef.current === 'fixed') return;
    syncingRef.current = 'table';
    const sl = el.scrollLeft;
    if (bottomScrollRef.current) bottomScrollRef.current.scrollLeft = sl;
    if (fixedBottomScrollRef.current) fixedBottomScrollRef.current.scrollLeft = sl;
    setScrollMetrics(prev => ({ ...prev, scrollLeft: sl }));
    requestAnimationFrame(() => {
      syncingRef.current = null;
    });
  };

  const handleBottomBarScroll = () => {
    const bar = bottomScrollRef.current;
    const el = tableScrollRef.current;
    if (!bar || !el) return;
    if (syncingRef.current === 'table' || syncingRef.current === 'fixed') return;
    syncingRef.current = 'bottom';
    const sl = bar.scrollLeft;
    el.scrollLeft = sl;
    if (fixedBottomScrollRef.current) fixedBottomScrollRef.current.scrollLeft = sl;
    setScrollMetrics(prev => ({ ...prev, scrollLeft: sl }));
    requestAnimationFrame(() => {
      syncingRef.current = null;
    });
  };

  const handleFixedBottomBarScroll = () => {
    const bar = fixedBottomScrollRef.current;
    const el = tableScrollRef.current;
    if (!bar || !el) return;
    if (syncingRef.current === 'table' || syncingRef.current === 'bottom') return;
    syncingRef.current = 'fixed';
    const sl = bar.scrollLeft;
    el.scrollLeft = sl;
    if (bottomScrollRef.current) bottomScrollRef.current.scrollLeft = sl;
    setScrollMetrics(prev => ({ ...prev, scrollLeft: sl }));
    requestAnimationFrame(() => {
      syncingRef.current = null;
    });
  };

  const scrollHorizontallyBy = (deltaPx: number) => {
    const el = tableScrollRef.current;
    if (!el) return;
    const next = Math.max(0, Math.min(el.scrollWidth - el.clientWidth, el.scrollLeft + deltaPx));
    el.scrollTo({ left: next, behavior: 'smooth' });
  };

  const activeFilterCount =
    Object.values(colFilters).filter(v => v.trim() !== '').length +
    (globalSearch.trim() ? 1 : 0) +
    Object.values(chipValues).reduce((n, s) => n + s.size, 0);

  const toggleChip = (chipKey: string, value: string, multi: boolean) => {
    setChipValues(prev => {
      const current = prev[chipKey] ?? new Set<string>();
      const next = new Set(current);
      if (next.has(value)) {
        next.delete(value);
      } else {
        if (!multi) next.clear();
        next.add(value);
      }
      return { ...prev, [chipKey]: next };
    });
  };

  const toggleSort = (key: string) => {
    setSort(prev => {
      if (!prev || prev.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return null; // third click clears
    });
  };

  const clearAll = () => { setColFilters({}); setGlobalSearch(''); setChipValues({}); };

  const selection = selectedIds ?? new Set<string>();
  const toggleRow = (id: string) => {
    const next = new Set(selection);
    if (next.has(id)) next.delete(id); else next.add(id);
    onSelectionChange?.(next);
  };
  const visibleIds = useMemo(() => processed.map(getRowId), [processed, getRowId]);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selection.has(id));
  const someVisibleSelected = !allVisibleSelected && visibleIds.some(id => selection.has(id));
  const toggleAllVisible = () => {
    const next = new Set(selection);
    if (allVisibleSelected) {
      for (const id of visibleIds) next.delete(id);
    } else {
      for (const id of visibleIds) next.add(id);
    }
    onSelectionChange?.(next);
  };
  const headerCheckboxRef = (el: HTMLInputElement | null) => {
    if (el) el.indeterminate = someVisibleSelected;
  };

  const toggleExpanded = (id: string) => {
    setExpandedId(prev => (prev === id ? null : id));
  };

  const leadingColCount = (expandable ? 1 : 0) + (numbered ? 1 : 0) + (selectable ? 1 : 0);
  const totalColCount = visibleColumns.length + leadingColCount;

  const exportCsv = () => {
    const cols = visibleColumns.filter(c => c.accessor);
    const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const header = cols.map(c => esc(c.header)).join(',');
    const lines = processed.map(r => cols.map(c => {
      const v = c.accessor?.(r);
      return esc(v == null ? '' : String(v));
    }).join(','));
    const csv = [header, ...lines].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${tb.exportName ?? gridName}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const pad = dense ? 'py-1.5' : 'py-3';
  const alignClass = (a?: string) => a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left';
  const title = tb.title ?? gridName;

  const hasHeader = (kpis && kpis.length > 0) || (filterChips && filterChips.length > 0);
  const effectiveMinWidth = tableMinWidth ?? (visibleColumns.length >= 7 ? '1380px' : undefined);
  const scrollableRangePx = Math.max(1, scrollMetrics.scrollWidth - scrollMetrics.clientWidth);

  return (
    <div data-grid-name={gridName} className={hasHeader ? `space-y-4 ${className}` : className}>
      {/* KPI tiles */}
      {kpis && kpis.length > 0 && (
        <div className={`grid gap-3 grid-cols-2 md:grid-cols-${Math.min(6, kpis.length)}`}>
          {kpis.map((k, i) => {
            const a = KPI_ACCENTS[k.accent ?? 'default'];
            const Icon = k.icon;
            return (
              <div key={i} className="rounded-2xl bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] p-4 hover:border-[var(--border-strong)] transition-colors">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className="text-[11px] uppercase tracking-wider text-[var(--text-faint)] font-medium">{k.label}</span>
                  {Icon && (
                    <div className={`w-7 h-7 rounded-lg ${a.bg} flex items-center justify-center`}>
                      <Icon className={`w-3.5 h-3.5 ${a.text}`} strokeWidth={2} />
                    </div>
                  )}
                </div>
                <div className={`text-3xl font-bold ${a.text}`}>{k.value}</div>
                {k.sub && <div className="text-xs text-[var(--text-faint)] mt-1">{k.sub}</div>}
              </div>
            );
          })}
        </div>
      )}

      {/* Filter chips */}
      {filterChips && filterChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {filterChips.map(chip => (
            <div key={chip.key} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]/50 px-2 py-1">
              <span className="text-[11px] uppercase tracking-wider text-[var(--text-faint)] font-medium mr-0.5">{chip.label}</span>
              {chip.options.map(opt => {
                const active = chipValues[chip.key]?.has(opt.value) ?? false;
                return (
                  <button key={opt.value} type="button" onClick={() => toggleChip(chip.key, opt.value, chip.multi ?? false)}
                    className={`px-2 py-0.5 rounded-md text-xs transition-colors ${
                      active
                        ? 'bg-violet-500/25 text-violet-100 border border-violet-500/60'
                        : 'bg-[var(--bg-surface)]/50 text-[var(--text-muted)] border border-[var(--border-subtle)] hover:bg-[var(--bg-surface)]'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/50 overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap px-3 py-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/60">
        {title && <span className="text-sm font-semibold text-[var(--text-main)] mr-1">{title}</span>}
        <span className="text-xs text-[var(--text-faint)]">{processed.length} of {rows.length}</span>

        <div className="flex-1" />

        {tb.search && (
          <div className="flex items-center gap-1.5 bg-[var(--bg-canvas)]/60 border border-[var(--border-subtle)] rounded-lg px-2.5 py-1.5 focus-within:border-violet-500/40 w-44">
            <SearchIcon className="w-3.5 h-3.5 text-[var(--text-faint)] shrink-0" />
            <input value={globalSearch} onChange={e => setGlobalSearch(e.target.value)} placeholder="Search…"
              className="flex-1 min-w-0 bg-transparent border-0 outline-none p-0 text-sm text-[var(--text-main)] placeholder-[var(--text-faint)]" />
          </div>
        )}

        {tb.filters && (
          <ToolbarButton active={showFilters} onClick={() => setShowFilters(v => !v)} title="Toggle filter row">
            <Filter className="w-3.5 h-3.5" /> Filters
            {activeFilterCount > 0 && <span className="ml-0.5 rounded-full bg-violet-500/20 text-violet-300 px-1.5 text-[10px]">{activeFilterCount}</span>}
          </ToolbarButton>
        )}

        {tb.sortSelector && sortableColumns.length > 0 && (
          <div className="relative">
            <ToolbarButton active={!!sort || sortMenuOpen} onClick={() => setSortMenuOpen(v => !v)} title="Sort">
              <ArrowUpDown className="w-3.5 h-3.5" />
              Sort
              {sort && (
                <span className="text-violet-300">
                  · {columns.find(c => c.key === sort.key)?.header ?? sort.key} {sort.dir === 'asc' ? '↑' : '↓'}
                </span>
              )}
            </ToolbarButton>
            {sortMenuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setSortMenuOpen(false)} />
                <div className="absolute right-0 mt-1 z-20 w-56 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-xl p-1.5">
                  <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] px-2 py-1">Sort by</div>
                  {sortableColumns.map(c => {
                    const isThisCol = sort?.key === c.key;
                    return (
                      <div key={c.key} className="flex items-center gap-1">
                        <button type="button"
                          onClick={() => { setSort({ key: c.key, dir: 'asc' }); setSortMenuOpen(false); }}
                          className={`flex-1 text-left px-2 py-1.5 rounded-lg text-sm hover:bg-[var(--bg-surface-hover)] ${isThisCol && sort!.dir === 'asc' ? 'text-violet-200' : 'text-[var(--text-muted)]'}`}
                        >
                          <ArrowUp className="inline w-3 h-3 mr-1" />{c.header}
                        </button>
                        <button type="button"
                          onClick={() => { setSort({ key: c.key, dir: 'desc' }); setSortMenuOpen(false); }}
                          className={`px-2 py-1.5 rounded-lg text-sm hover:bg-[var(--bg-surface-hover)] ${isThisCol && sort!.dir === 'desc' ? 'text-violet-200' : 'text-[var(--text-muted)]'}`}
                          title={`Sort ${c.header} descending`}
                        >
                          <ArrowDown className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                  {sort && (
                    <button type="button" onClick={() => { setSort(null); setSortMenuOpen(false); }}
                      className="w-full mt-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-main)] px-2 py-1.5 rounded-lg hover:bg-[var(--bg-surface-hover)] border-t border-[var(--border-subtle)]">
                      Clear sort
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {tb.columns && (
          <div className="relative">
            <ToolbarButton active={colMenuOpen} onClick={() => setColMenuOpen(v => !v)} title="Show / hide columns">
              <Columns3 className="w-3.5 h-3.5" /> Columns
            </ToolbarButton>
            {colMenuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setColMenuOpen(false)} />
                <div className="absolute right-0 mt-1 z-20 w-52 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-xl p-1.5">
                  {columns.map(c => (
                    <label key={c.key} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--bg-surface-hover)] cursor-pointer text-sm text-[var(--text-muted)]">
                      <input type="checkbox" checked={!hidden.has(c.key)} onChange={() => setHidden(prev => {
                        const next = new Set(prev);
                        if (next.has(c.key)) next.delete(c.key); else next.add(c.key);
                        return next;
                      })} className="accent-violet-500 w-3.5 h-3.5" />
                      {c.header}
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {tb.density && (
          <ToolbarButton active={dense} onClick={() => setDense(v => !v)} title="Toggle density">
            <Rows3 className="w-3.5 h-3.5" /> {dense ? 'Compact' : 'Comfort'}
          </ToolbarButton>
        )}

        {tb.exportCsv && (
          <ToolbarButton onClick={exportCsv} title="Export current view to CSV">
            <Download className="w-3.5 h-3.5" /> CSV
          </ToolbarButton>
        )}

        {activeFilterCount > 0 && (
          <button type="button" onClick={clearAll} className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-main)] px-2 py-1.5">
            <X className="w-3.5 h-3.5" /> Clear
          </button>
        )}

        {tb.actions}
      </div>

      {/* Table */}
      <div
        ref={tableScrollRef}
        onScroll={handleTableHorizontalScroll}
        className="overflow-x-auto fleet-grid-hscroll"
      >
        <table
          className="w-full text-sm"
          style={{
            tableLayout: 'auto',
            minWidth: effectiveMinWidth,
          }}
        >
          <thead>
            <tr className="border-b border-[var(--border-subtle)] text-[var(--text-faint)] text-[11px] uppercase tracking-wider bg-[var(--bg-surface)]/40">
              {expandable && (
                <th className="px-3 py-2.5 w-8" />
              )}
              {numbered && (
                <th className="px-3 py-2.5 font-medium text-left w-10">#</th>
              )}
              {selectable && (
                <th className="px-3 py-2.5 w-10">
                  <input
                    type="checkbox"
                    ref={headerCheckboxRef}
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                    disabled={visibleIds.length === 0}
                    aria-label="Select all rows"
                    className="accent-violet-500 w-3.5 h-3.5"
                  />
                </th>
              )}
              {visibleColumns.map(c => {
                const sortable = c.sortable ?? !!c.accessor;
                const isSorted = sort?.key === c.key;
                return (
                  <th key={c.key} style={c.width ? { width: c.width } : undefined}
                    className={`${alignClass(c.align)} px-3 py-2.5 font-medium select-none ${c.headerClassName ?? ''} ${sortable ? 'cursor-pointer hover:text-[var(--text-muted)]' : ''}`}
                    onClick={sortable ? () => toggleSort(c.key) : undefined}>
                    <span className="inline-flex items-center gap-1">
                      {c.header}
                      {sortable && (
                        isSorted
                          ? (sort!.dir === 'asc' ? <ArrowUp className="w-3 h-3 text-violet-300" /> : <ArrowDown className="w-3 h-3 text-violet-300" />)
                          : <ChevronsUpDown className="w-3 h-3 text-[var(--text-faint)]" />
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>

            {showFilters && (
              <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)]/40">
                {expandable && <th className="px-2 py-1.5" />}
                {numbered && <th className="px-2 py-1.5" />}
                {selectable && <th className="px-2 py-1.5" />}
                {visibleColumns.map(c => {
                  const filterable = c.filter !== false && (c.filter !== undefined || !!c.accessor);
                  return (
                    <th key={c.key} className="px-2 py-1.5">
                      {!filterable ? null : c.filter === 'select' ? (
                        <select value={colFilters[c.key] ?? ''} onChange={e => setColFilters(f => ({ ...f, [c.key]: e.target.value }))}
                          className="w-full bg-[var(--bg-surface)]/70 border border-[var(--border-subtle)] rounded-md px-2 py-1 text-xs text-[var(--text-main)] font-normal normal-case focus:outline-none focus:border-violet-500/40">
                          <option value="">All</option>
                          {(selectValues[c.key] ?? []).map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                      ) : (
                        <input value={colFilters[c.key] ?? ''} onChange={e => setColFilters(f => ({ ...f, [c.key]: e.target.value }))}
                          placeholder="Filter…"
                          className="w-full bg-[var(--bg-surface)]/70 border border-[var(--border-subtle)] rounded-md px-2 py-1 text-xs text-[var(--text-main)] font-normal normal-case placeholder-[var(--text-faint)] focus:outline-none focus:border-violet-500/40" />
                      )}
                    </th>
                  );
                })}
              </tr>
            )}
          </thead>

          <tbody className="divide-y divide-[var(--border-subtle)]">
            {loading ? (
              [...Array(6)].map((_, i) => (
                <tr key={i}><td colSpan={totalColCount} className="px-3 py-2"><div className="h-6 bg-[var(--bg-surface)]/50 rounded animate-pulse" /></td></tr>
              ))
            ) : processed.length === 0 ? (
              <tr><td colSpan={totalColCount} className="text-center text-[var(--text-faint)] py-12">{emptyMessage}</td></tr>
            ) : processed.map((row, i) => {
              const id = getRowId(row);
              const isSelected = selection.has(id);
              const detail = expandable?.(row);
              const isExpandableRow = !!expandable && detail != null && detail !== false;
              const isExpanded = isExpandableRow && expandedId === id;
              const rowClickHandler = onRowClick
                ? () => onRowClick(row)
                : isExpandableRow ? () => toggleExpanded(id) : undefined;
              const customRowCls = rowClassName?.(row);
              return (
                <React.Fragment key={id}>
                  <tr onClick={rowClickHandler}
                    className={`${rowClickHandler ? 'cursor-pointer' : ''} transition-colors ${
                      customRowCls
                        ? customRowCls
                        : selectedId === id
                          ? 'bg-violet-500/10'
                          : isSelected
                            ? 'bg-violet-500/5'
                            : 'hover:bg-white/[0.03]'
                    }`}>
                    {expandable && (
                      <td className={`px-3 ${pad} text-[var(--text-faint)]`} onClick={isExpandableRow ? e => { e.stopPropagation(); toggleExpanded(id); } : undefined}>
                        {isExpandableRow && (isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />)}
                      </td>
                    )}
                    {numbered && (
                      <td className={`px-3 ${pad} text-left text-[var(--text-faint)] tabular-nums`}>{numberRender ? numberRender(row, i + 1) : i + 1}</td>
                    )}
                    {selectable && (
                      <td className={`px-3 ${pad}`} onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleRow(id)}
                          aria-label={`Select row ${i + 1}`}
                          className="accent-violet-500 w-3.5 h-3.5"
                        />
                      </td>
                    )}
                    {visibleColumns.map(c => (
                      <td key={c.key} className={`px-3 ${pad} ${alignClass(c.align)} ${c.cellClassName ?? 'text-[var(--text-muted)]'}`}>
                        {c.render ? c.render(row) : (() => { const v = c.accessor?.(row); return v == null || v === '' ? '—' : String(v); })()}
                      </td>
                    ))}
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={totalColCount} className="bg-[var(--bg-surface)]/60 px-6 py-4">{detail}</td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Inline Horizontal Scroll Bar at Bottom of Table */}
      {stickyBottomScrollbar && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)]/80">
          <button
            type="button"
            onClick={() => scrollHorizontallyBy(-280)}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[11px] font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] shrink-0 transition-colors"
            title="Scroll table left"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span>Left</span>
          </button>
          <div
            ref={bottomScrollRef}
            onScroll={handleBottomBarScroll}
            className="flex-1 overflow-x-scroll fleet-grid-hscroll h-3.5"
          >
            <div style={{ width: `${Math.max(scrollMetrics.scrollWidth, scrollMetrics.clientWidth + 240)}px`, height: '1px' }} />
          </div>
          <button
            type="button"
            onClick={() => scrollHorizontallyBy(280)}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[11px] font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] shrink-0 transition-colors"
            title="Scroll table right"
          >
            <span>Right</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      </div>

      {/* Fixed Bottom-of-Screen Horizontal Scrollbar Dock when the table list is taller than the screen */}
      {scrollMetrics.showFixedBottomDock && (
        <div
          style={{
            left: `${scrollMetrics.dockLeft}px`,
            width: `${scrollMetrics.dockWidth}px`,
          }}
          className="fixed bottom-0 z-30 flex items-center gap-2.5 px-3 py-1.5 rounded-t-xl border border-b-0 border-blue-500/40 bg-[var(--bg-surface)]/95 backdrop-blur-md shadow-2xl"
        >
          <button
            type="button"
            onClick={() => scrollHorizontallyBy(-300)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-600/15 border border-blue-500/30 text-xs font-bold text-blue-400 hover:bg-blue-600/25 shrink-0 transition-colors"
            title="Scroll table left"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span>Left</span>
          </button>

          <div className="flex-1 flex flex-col gap-1 min-w-0">
            <div
              ref={fixedBottomScrollRef}
              onScroll={handleFixedBottomBarScroll}
              className="w-full overflow-x-scroll fleet-grid-hscroll h-3.5"
            >
              <div style={{ width: `${Math.max(scrollMetrics.scrollWidth, scrollMetrics.clientWidth + 260)}px`, height: '1px' }} />
            </div>
            <input
              type="range"
              min={0}
              max={scrollableRangePx}
              value={Math.min(scrollableRangePx, scrollMetrics.scrollLeft)}
              onChange={(e) => {
                const next = Number(e.target.value);
                if (tableScrollRef.current) {
                  tableScrollRef.current.scrollLeft = next;
                }
              }}
              aria-label="Horizontal table scroll position"
              className="w-full h-1.5 accent-blue-500 cursor-pointer"
            />
          </div>

          <button
            type="button"
            onClick={() => scrollHorizontallyBy(300)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-600/15 border border-blue-500/30 text-xs font-bold text-blue-400 hover:bg-blue-600/25 shrink-0 transition-colors"
            title="Scroll table right"
          >
            <span>Right</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

function ToolbarButton({ active, onClick, title, children }: { active?: boolean; onClick: () => void; title?: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} title={title}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
        active ? 'border-violet-500/40 bg-violet-500/10 text-violet-200' : 'border-[var(--border-subtle)] text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)]'
      }`}>
      {children}
    </button>
  );
}
