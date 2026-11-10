'use client';
/**
 * FleetDataGrid — a reusable, dependency-free data grid for the Logistics
 * module.
 *
 *   • Sortable column headers (click cycles asc → desc → none, with indicators)
 *   • Inline filter row (per-column text or select filters)
 *   • Smart toolbar: global search, column show/hide & custom column ordering,
 *     density, CSV export, a live "X of Y" count, and a one-click clear-all
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
  Rows3, Filter, X, ArrowUpDown, ChevronRight, ChevronDown, ChevronLeft, GripVertical, RotateCcw,
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
   * i.e. after sort and filters are applied, not raw array index.
   */
  numbered?: boolean;
  /**
   * Override the content of the `numbered` column for specific rows.
   */
  numberRender?: (row: T, position: number) => React.ReactNode;
  /**
   * Leading checkbox column for multi-row selection, for bulk actions.
   */
  selectable?: boolean;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  /**
   * Business-state-driven row background.
   */
  rowClassName?: (row: T) => string;
  /**
   * Per-row detail panel.
   */
  expandable?: (row: T) => React.ReactNode | null | undefined | false;
  /**
   * Show a single synchronized horizontal scrollbar at the bottom of the screen
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
  const storageKey = useMemo(
    () => `fleet360_grid_cols_${(gridName || tb.title || 'default').replace(/[^a-zA-Z0-9_-]/g, '_')}`,
    [gridName, tb.title],
  );

  const [sort, setSort] = useState<{ key: string; dir: SortDir } | null>(initialSort ?? null);
  const [colFilters, setColFilters] = useState<Record<string, string>>({});
  const [globalSearch, setGlobalSearch] = useState('');
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [columnOrder, setColumnOrder] = useState<string[]>(() => columns.map((c) => c.key));
  const [draggedColKey, setDraggedColKey] = useState<string | null>(null);
  const [dragOverColKey, setDragOverColKey] = useState<string | null>(null);
  const [dense, setDense] = useState(false);
  const [showFilters, setShowFilters] = useState(true);
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  /** Multi-value chip state: chip.key -> set of active option values. */
  const [chipValues, setChipValues] = useState<Record<string, Set<string>>>({});

  // Load saved column order & hidden state from localStorage on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const savedOrderRaw = localStorage.getItem(`${storageKey}_order`);
      if (savedOrderRaw) {
        const parsed = JSON.parse(savedOrderRaw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const validKeys = new Set(columns.map((c) => c.key));
          const filtered = parsed.filter((k): k is string => typeof k === 'string' && validKeys.has(k));
          const missing = columns.map((c) => c.key).filter((k) => !filtered.includes(k));
          setColumnOrder([...filtered, ...missing]);
        }
      }
      const savedHiddenRaw = localStorage.getItem(`${storageKey}_hidden`);
      if (savedHiddenRaw) {
        const parsedHidden = JSON.parse(savedHiddenRaw);
        if (Array.isArray(parsedHidden)) {
          setHidden(new Set(parsedHidden.filter((k): k is string => typeof k === 'string')));
        }
      }
    } catch {}
  }, [storageKey, columns]);

  // Keep columnOrder in sync if columns prop changes dynamically
  useEffect(() => {
    setColumnOrder((prev) => {
      const validKeys = new Set(columns.map((c) => c.key));
      const kept = prev.filter((k) => validKeys.has(k));
      const added = columns.map((c) => c.key).filter((k) => !kept.includes(k));
      if (kept.length === prev.length && added.length === 0) return prev;
      return [...kept, ...added];
    });
  }, [columns]);

  const persistColumnOrder = useCallback(
    (nextOrder: string[]) => {
      setColumnOrder(nextOrder);
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(`${storageKey}_order`, JSON.stringify(nextOrder));
        } catch {}
      }
    },
    [storageKey],
  );

  const toggleColumnVisibility = useCallback(
    (key: string) => {
      setHidden((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        if (typeof window !== 'undefined') {
          try {
            localStorage.setItem(`${storageKey}_hidden`, JSON.stringify(Array.from(next)));
          } catch {}
        }
        return next;
      });
    },
    [storageKey],
  );

  const moveColumnToIndex = useCallback(
    (key: string, targetIndex: number) => {
      const currentIdx = columnOrder.indexOf(key);
      if (currentIdx === -1) return;
      const boundedIdx = Math.max(0, Math.min(columnOrder.length - 1, targetIndex));
      if (currentIdx === boundedIdx) return;
      const next = [...columnOrder];
      next.splice(currentIdx, 1);
      next.splice(boundedIdx, 0, key);
      persistColumnOrder(next);
    },
    [columnOrder, persistColumnOrder],
  );

  const resetColumnsToDefault = useCallback(() => {
    const defaultOrder = columns.map((c) => c.key);
    setColumnOrder(defaultOrder);
    setHidden(new Set());
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem(`${storageKey}_order`);
        localStorage.removeItem(`${storageKey}_hidden`);
      } catch {}
    }
  }, [columns, storageKey]);

  const orderedColumns = useMemo(() => {
    const colMap = new Map(columns.map((c) => [c.key, c]));
    const result: DataGridColumn<T>[] = [];
    for (const k of columnOrder) {
      const col = colMap.get(k);
      if (col) {
        result.push(col);
        colMap.delete(k);
      }
    }
    for (const col of colMap.values()) {
      result.push(col);
    }
    return result;
  }, [columns, columnOrder]);

  const visibleColumns = useMemo(
    () => orderedColumns.filter((c) => !hidden.has(c.key)),
    [orderedColumns, hidden],
  );
  const sortableColumns = useMemo(
    () => orderedColumns.filter((c) => (c.sortable ?? !!c.accessor) && c.accessor),
    [orderedColumns],
  );

  // Horizontal scroll synchronization refs & state (single bottom horizontal scrollbar)
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const bottomScrollRef = useRef<HTMLDivElement | null>(null);
  const syncingRef = useRef<'table' | 'bottom' | 'button' | null>(null);
  const syncTimerRef = useRef<number | null>(null);
  const buttonAnimFrameRef = useRef<number | null>(null);
  const [scrollMetrics, setScrollMetrics] = useState<{
    scrollLeft: number;
    scrollWidth: number;
    clientWidth: number;
    dockLeft: number;
    dockWidth: number;
    showFixedBottomDock: boolean;
  }>({
    scrollLeft: 0,
    scrollWidth: 1960,
    clientWidth: 1000,
    dockLeft: 0,
    dockWidth: 0,
    showFixedBottomDock: false,
  });

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
    if (bottomScrollRef.current && syncingRef.current === null) {
      const maxTable = Math.max(1, sw - cw);
      const ratio = Math.max(0, Math.min(1, sl / maxTable));
      const maxBar = Math.max(
        0,
        bottomScrollRef.current.scrollWidth - bottomScrollRef.current.clientWidth,
      );
      const targetBarLeft = Math.round(ratio * maxBar);
      if (Math.abs(bottomScrollRef.current.scrollLeft - targetBarLeft) >= 1) {
        bottomScrollRef.current.scrollLeft = targetBarLeft;
      }
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

    const onWindowScrollOrResize = (e?: Event) => {
      // Never intercept horizontal scroll events from our own table or bottom scrollbar!
      if (
        e &&
        (e.target === tableScrollRef.current || e.target === bottomScrollRef.current)
      ) {
        return;
      }
      updateScrollMeasurement();
    };
    window.addEventListener('resize', onWindowScrollOrResize, { passive: true });
    window.addEventListener('scroll', onWindowScrollOrResize, true);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', onWindowScrollOrResize);
      window.removeEventListener('scroll', onWindowScrollOrResize, true);
      if (syncTimerRef.current != null) {
        window.clearTimeout(syncTimerRef.current);
      }
      if (buttonAnimFrameRef.current != null) {
        cancelAnimationFrame(buttonAnimFrameRef.current);
      }
    };
  }, [updateScrollMeasurement, processed.length, visibleColumns.length, dense]);

  const handleTableHorizontalScroll = () => {
    const el = tableScrollRef.current;
    if (!el) return;
    if (syncingRef.current === 'bottom' || syncingRef.current === 'button') return;
    syncingRef.current = 'table';
    if (syncTimerRef.current != null) {
      window.clearTimeout(syncTimerRef.current);
    }
    const sl = el.scrollLeft;
    const maxTable = Math.max(1, el.scrollWidth - el.clientWidth);
    const ratio = Math.max(0, Math.min(1, sl / maxTable));
    if (bottomScrollRef.current) {
      const maxBar = Math.max(
        0,
        bottomScrollRef.current.scrollWidth - bottomScrollRef.current.clientWidth,
      );
      const nextBarLeft = Math.round(ratio * maxBar);
      if (Math.abs(bottomScrollRef.current.scrollLeft - nextBarLeft) >= 1) {
        bottomScrollRef.current.scrollLeft = nextBarLeft;
      }
    }
    setScrollMetrics(prev => ({ ...prev, scrollLeft: sl }));
    syncTimerRef.current = window.setTimeout(() => {
      syncingRef.current = null;
      syncTimerRef.current = null;
    }, 120);
  };

  const handleBottomBarScroll = () => {
    const bar = bottomScrollRef.current;
    const el = tableScrollRef.current;
    if (!bar || !el) return;
    if (syncingRef.current === 'table' || syncingRef.current === 'button') return;
    syncingRef.current = 'bottom';
    if (syncTimerRef.current != null) {
      window.clearTimeout(syncTimerRef.current);
    }
    const maxBar = Math.max(1, bar.scrollWidth - bar.clientWidth);
    const maxTable = Math.max(0, el.scrollWidth - el.clientWidth);
    const ratio = Math.max(0, Math.min(1, bar.scrollLeft / maxBar));
    const nextTableLeft = Math.round(ratio * maxTable);
    if (Math.abs(el.scrollLeft - nextTableLeft) >= 1) {
      el.scrollLeft = nextTableLeft;
    }
    setScrollMetrics(prev => ({ ...prev, scrollLeft: nextTableLeft }));
    syncTimerRef.current = window.setTimeout(() => {
      syncingRef.current = null;
      syncTimerRef.current = null;
    }, 120);
  };

  const scrollHorizontallyBy = (deltaPx: number) => {
    const el = tableScrollRef.current;
    if (!el) return;
    if (buttonAnimFrameRef.current != null) {
      cancelAnimationFrame(buttonAnimFrameRef.current);
      buttonAnimFrameRef.current = null;
    }
    if (syncTimerRef.current != null) {
      window.clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    syncingRef.current = 'button';

    const startLeft = el.scrollLeft;
    const maxTable = Math.max(0, el.scrollWidth - el.clientWidth);
    const targetLeft = Math.max(0, Math.min(maxTable, startLeft + deltaPx));
    const distance = targetLeft - startLeft;

    if (Math.abs(distance) < 1) {
      syncingRef.current = null;
      return;
    }

    const durationMs = 180;
    const startTime = performance.now();

    const step = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const nextLeft = Math.round(startLeft + distance * eased);

      el.scrollLeft = nextLeft;
      const ratio = maxTable > 0 ? nextLeft / maxTable : 0;
      if (bottomScrollRef.current) {
        const maxBar = Math.max(
          0,
          bottomScrollRef.current.scrollWidth - bottomScrollRef.current.clientWidth,
        );
        bottomScrollRef.current.scrollLeft = Math.round(ratio * maxBar);
      }
      setScrollMetrics(prev => ({ ...prev, scrollLeft: nextLeft }));

      if (t < 1) {
        buttonAnimFrameRef.current = requestAnimationFrame(step);
      } else {
        buttonAnimFrameRef.current = null;
        syncTimerRef.current = window.setTimeout(() => {
          syncingRef.current = null;
          syncTimerRef.current = null;
        }, 80);
      }
    };

    buttonAnimFrameRef.current = requestAnimationFrame(step);
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
  const effectiveMinWidth =
    tableMinWidth ??
    (stickyBottomScrollbar
      ? 'max(2100px, calc(100% + 520px))'
      : visibleColumns.length >= 7
        ? '1380px'
        : undefined);
  const isCustomColumnOrder = useMemo(() => {
    const def = columns.map((c) => c.key);
    return def.length === columnOrder.length && def.some((k, idx) => columnOrder[idx] !== k);
  }, [columns, columnOrder]);

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
            <ToolbarButton active={colMenuOpen || isCustomColumnOrder || hidden.size > 0} onClick={() => setColMenuOpen(v => !v)} title="Show / hide & reorder columns">
              <Columns3 className="w-3.5 h-3.5" /> Columns
              {(isCustomColumnOrder || hidden.size > 0) && (
                <span className="ml-0.5 rounded-full bg-violet-500/20 text-violet-300 px-1.5 text-[10px]">
                  {visibleColumns.length}/{columns.length}
                </span>
              )}
            </ToolbarButton>
            {colMenuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setColMenuOpen(false)} />
                <div className="absolute right-0 mt-1 z-30 w-80 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-2xl p-2 space-y-1">
                  <div className="flex items-center justify-between px-2 py-1 border-b border-[var(--border-subtle)]">
                    <div>
                      <div className="text-[11px] font-bold text-[var(--text-main)]">Columns &amp; Order</div>
                      <div className="text-[10px] text-[var(--text-faint)]">Select/deselect, drag, or pick position #</div>
                    </div>
                    {(isCustomColumnOrder || hidden.size > 0) && (
                      <button
                        type="button"
                        onClick={resetColumnsToDefault}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[10px] font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors"
                        title="Reset column visibility and order to default"
                      >
                        <RotateCcw className="w-3 h-3" />
                        Reset
                      </button>
                    )}
                  </div>

                  <div className="max-h-80 overflow-y-auto space-y-0.5 pr-0.5">
                    {orderedColumns.map((c, idx) => {
                      const isVisible = !hidden.has(c.key);
                      const isDraggingThis = draggedColKey === c.key;
                      const isDragOverThis = dragOverColKey === c.key && draggedColKey !== c.key;
                      return (
                        <div
                          key={c.key}
                          draggable
                          onDragStart={() => setDraggedColKey(c.key)}
                          onDragOver={(e) => {
                            e.preventDefault();
                            if (draggedColKey && draggedColKey !== c.key) {
                              setDragOverColKey(c.key);
                            }
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            if (draggedColKey && draggedColKey !== c.key) {
                              moveColumnToIndex(draggedColKey, idx);
                            }
                            setDraggedColKey(null);
                            setDragOverColKey(null);
                          }}
                          onDragEnd={() => {
                            setDraggedColKey(null);
                            setDragOverColKey(null);
                          }}
                          className={`flex items-center justify-between gap-1.5 px-2 py-1.5 rounded-lg text-xs transition-colors ${
                            isDraggingThis
                              ? 'opacity-50 bg-violet-500/15'
                              : isDragOverThis
                              ? 'border border-violet-500 bg-violet-500/10'
                              : 'hover:bg-[var(--bg-surface-hover)]'
                          }`}
                        >
                          <div className="flex items-center gap-1.5 min-w-0 flex-1">
                            <span
                              className="cursor-grab active:cursor-grabbing text-[var(--text-faint)] hover:text-[var(--text-muted)] shrink-0"
                              title="Drag to reorder column"
                            >
                              <GripVertical className="w-3.5 h-3.5" />
                            </span>
                            <label className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={isVisible}
                                onChange={() => toggleColumnVisibility(c.key)}
                                className="accent-violet-500 w-3.5 h-3.5 shrink-0"
                              />
                              <span className={`truncate ${isVisible ? 'text-[var(--text-main)] font-medium' : 'text-[var(--text-faint)] line-through'}`}>
                                {c.header}
                              </span>
                            </label>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            {/* Direct Position Selector (e.g. Move Status from 2nd last to 3rd column) */}
                            <select
                              value={idx}
                              onChange={(e) => moveColumnToIndex(c.key, Number(e.target.value))}
                              title={`Move "${c.header}" to column position`}
                              className="bg-[var(--bg-main)] border border-[var(--border-subtle)] rounded px-1.5 py-0.5 text-[10px] font-mono font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] focus:outline-none focus:border-violet-500 cursor-pointer"
                            >
                              {orderedColumns.map((_, posIdx) => (
                                <option key={posIdx} value={posIdx}>
                                  #{posIdx + 1}
                                </option>
                              ))}
                            </select>

                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={() => moveColumnToIndex(c.key, idx - 1)}
                              className="p-1 rounded hover:bg-[var(--bg-main)] text-[var(--text-muted)] hover:text-[var(--text-main)] disabled:opacity-30 disabled:pointer-events-none"
                              title={`Move ${c.header} left / up`}
                            >
                              <ArrowUp className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              disabled={idx === orderedColumns.length - 1}
                              onClick={() => moveColumnToIndex(c.key, idx + 1)}
                              className="p-1 rounded hover:bg-[var(--bg-main)] text-[var(--text-muted)] hover:text-[var(--text-main)] disabled:opacity-30 disabled:pointer-events-none"
                              title={`Move ${c.header} right / down`}
                            >
                              <ArrowDown className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
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
        className={`overflow-x-auto ${stickyBottomScrollbar ? '[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden' : 'fleet-grid-hscroll'}`}
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
                const isDragOverHeader = dragOverColKey === c.key && draggedColKey !== c.key;
                return (
                  <th
                    key={c.key}
                    style={c.width ? { width: c.width } : undefined}
                    draggable
                    onDragStart={() => setDraggedColKey(c.key)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (draggedColKey && draggedColKey !== c.key) {
                        setDragOverColKey(c.key);
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (draggedColKey && draggedColKey !== c.key) {
                        const targetOrderIdx = columnOrder.indexOf(c.key);
                        if (targetOrderIdx !== -1) {
                          moveColumnToIndex(draggedColKey, targetOrderIdx);
                        }
                      }
                      setDraggedColKey(null);
                      setDragOverColKey(null);
                    }}
                    onDragEnd={() => {
                      setDraggedColKey(null);
                      setDragOverColKey(null);
                    }}
                    title="Click to sort · Drag header left/right to reorder column"
                    className={`${alignClass(c.align)} px-3 py-2.5 font-medium select-none ${c.headerClassName ?? ''} ${sortable ? 'cursor-pointer hover:text-[var(--text-muted)]' : 'cursor-grab'} ${isDragOverHeader ? 'bg-violet-500/15 border-l-2 border-violet-500' : ''}`}
                    onClick={sortable ? () => toggleSort(c.key) : undefined}
                  >
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

      {/* Single Persistent Horizontal Scrollbar (Floats at Bottom of Screen when table bottom is below fold, or docks inline at table bottom) */}
      {stickyBottomScrollbar && (
        <>
          {scrollMetrics.showFixedBottomDock && <div className="h-10" aria-hidden="true" />}
          <div
            style={
              scrollMetrics.showFixedBottomDock
                ? {
                    left: `${scrollMetrics.dockLeft}px`,
                    width: `${scrollMetrics.dockWidth}px`,
                  }
                : undefined
            }
            className={
              scrollMetrics.showFixedBottomDock
                ? 'fixed bottom-0 z-30 flex items-center gap-2.5 px-3 py-1.5 rounded-t-xl border border-b-0 border-blue-500/40 bg-[var(--bg-surface)]/95 backdrop-blur-md shadow-2xl'
                : 'flex items-center gap-2.5 px-3 py-1.5 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)]/80'
            }
          >
            <button
              type="button"
              onClick={() => scrollHorizontallyBy(-320)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-500 active:scale-95 shrink-0 transition-all shadow-sm cursor-pointer"
              title="Scroll table left"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Left</span>
            </button>

            <div
              ref={bottomScrollRef}
              onScroll={handleBottomBarScroll}
              className="flex-1 overflow-x-scroll fleet-grid-hscroll h-5 min-w-0 cursor-pointer"
            >
              <div
                style={{
                  width: `calc(100% + ${Math.max(520, scrollMetrics.scrollWidth - scrollMetrics.clientWidth)}px)`,
                  height: '1px',
                  pointerEvents: 'none',
                }}
              />
            </div>

            <button
              type="button"
              onClick={() => scrollHorizontallyBy(320)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-500 active:scale-95 shrink-0 transition-all shadow-sm cursor-pointer"
              title="Scroll table right"
            >
              <span>Right</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </>
      )}
      </div>
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
