'use client';
/**
 * SmartDataGrid — reusable data grid with a KPI header and a full-featured
 * toolbar. Forked from LogisticsDataGrid and extended with:
 *
 *   Header:  KPI summary tiles, filter chips (quick-toggle predicates)
 *   Toolbar: bulk actions on row selection, sort selector,
 *            column visibility, density, CSV export, global search
 *
 * All new capabilities are opt-in via props — omit them and the grid behaves
 * exactly like the original data grid (sort headers + inline column filters).
 *
 * Generic over the row type. Pure client state, no server round-trips.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowUp, ArrowDown, ChevronsUpDown, Search as SearchIcon, Columns3, Download,
  Rows3, Filter, X, ArrowUpDown, CheckSquare, Square,
} from 'lucide-react';

// ── Types ───────────────────────────────────────────────────────────────────

export type SortDir = 'asc' | 'desc';

export interface SmartDataGridColumn<T> {
  key: string;
  header: string;
  /** Value used for sort / filter / global-search / CSV / group-by. Omit for action-only columns. */
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

export type KpiAccent = 'default' | 'violet' | 'emerald' | 'sky' | 'amber' | 'rose' | 'slate';

export interface KpiTile {
  label: string;
  value: number | string;
  sub?: string;
  accent?: KpiAccent;
  icon?: LucideIcon;
}

export interface FilterChipOption {
  value: string;
  label: string;
}

export interface FilterChipDef<T> {
  key: string;
  label: string;
  options: FilterChipOption[];
  /** True to keep this row when the given chip value is active. */
  predicate: (row: T, value: string) => boolean;
  /** Allow multiple chips within this group to be active at once (OR-combined). Default false. */
  multi?: boolean;
}

export interface BulkAction<T> {
  key: string;
  label: string;
  icon?: LucideIcon;
  variant?: 'default' | 'destructive';
  /** Optional confirmation message shown in a native confirm() before running. */
  confirm?: (rows: T[]) => string;
  /** Runs the action on the current selection. Grid clears selection + calls onBulkComplete after. */
  run: (rows: T[]) => Promise<void> | void;
}

interface ToolbarOptions {
  title?: string;
  /** Show global search input. Default true. */
  search?: boolean;
  /** Show columns show/hide menu. Default true. */
  columns?: boolean;
  /** Show density toggle. Default true. */
  density?: boolean;
  /** Show inline per-column filter row toggle. Default true. */
  filters?: boolean;
  /** Show CSV export button. Default true. */
  exportCsv?: boolean;
  /** Filename (without extension) used for CSV. */
  exportName?: string;
  /** Show explicit sort selector dropdown. Default true. */
  sortSelector?: boolean;
  /** Extra content pinned to the toolbar's right edge. */
  actions?: React.ReactNode;
}

export interface SmartDataGridProps<T> {
  rows: T[];
  columns: SmartDataGridColumn<T>[];
  getRowId: (row: T) => string;
  onRowClick?: (row: T) => void;
  selectedId?: string | null;
  loading?: boolean;
  emptyMessage?: string;
  initialSort?: { key: string; dir: SortDir };
  toolbar?: ToolbarOptions;
  kpis?: KpiTile[];
  filterChips?: FilterChipDef<T>[];
  bulkActions?: BulkAction<T>[];
  /** Called after a bulk action succeeds so the parent can refresh its data. */
  onBulkComplete?: () => void;
  className?: string;
}

// ── Utilities ───────────────────────────────────────────────────────────────

const cmp = (a: unknown, b: unknown): number => {
  const an = a == null || a === '';
  const bn = b == null || b === '';
  if (an && bn) return 0;
  if (an) return 1;   // nulls last
  if (bn) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
};

const KPI_ACCENTS: Record<KpiAccent, { bg: string; text: string }> = {
  default: { bg: 'bg-slate-500/15',   text: 'text-slate-200'   },
  violet:  { bg: 'bg-violet-500/15',  text: 'text-violet-300'  },
  emerald: { bg: 'bg-emerald-500/15', text: 'text-emerald-300' },
  sky:     { bg: 'bg-sky-500/15',     text: 'text-sky-300'     },
  amber:   { bg: 'bg-amber-500/15',   text: 'text-amber-300'   },
  rose:    { bg: 'bg-rose-500/15',    text: 'text-rose-300'    },
  slate:   { bg: 'bg-slate-500/15',   text: 'text-slate-400'   },
};

// ── Main component ─────────────────────────────────────────────────────────

export default function SmartDataGrid<T>({
  rows, columns, getRowId, onRowClick, selectedId, loading, emptyMessage = 'No rows',
  initialSort, toolbar = {}, kpis, filterChips, bulkActions, onBulkComplete,
  className = '',
}: SmartDataGridProps<T>) {
  const tb = {
    search: true, columns: true, density: true, filters: true, exportCsv: true,
    sortSelector: true,
    ...toolbar,
  };

  const [sort, setSort] = useState<{ key: string; dir: SortDir } | null>(initialSort ?? null);
  const [colFilters, setColFilters] = useState<Record<string, string>>({});
  const [globalSearch, setGlobalSearch] = useState('');
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [dense, setDense] = useState(false);
  const [showFilters, setShowFilters] = useState(true);
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  /** Multi-value for chips: key -> set of active values. */
  const [chipValues, setChipValues] = useState<Record<string, Set<string>>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState<string | null>(null);

  const gridRef = useRef<HTMLDivElement>(null);

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

  // ── Filter, sort, group pipeline ─────────────────────────────────────────

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
      // per-column filters (text or select)
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
      // filter chips — within a group: OR-combine; across groups: AND-combine.
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

  // ── Toolbar counters + selection helpers ─────────────────────────────────

  const activeFilterCount =
    Object.values(colFilters).filter(v => v.trim() !== '').length +
    (globalSearch.trim() ? 1 : 0) +
    Object.values(chipValues).reduce((n, s) => n + s.size, 0);

  const processedIds = useMemo(() => processed.map(getRowId), [processed, getRowId]);
  const allSelected = processedIds.length > 0 && processedIds.every(id => selected.has(id));
  const someSelected = !allSelected && processedIds.some(id => selected.has(id));
  const selectedRows = useMemo(() => processed.filter(r => selected.has(getRowId(r))), [processed, selected, getRowId]);

  // Drop selected ids that no longer appear in the underlying rows (e.g. after a delete).
  useEffect(() => {
    const alive = new Set(rows.map(getRowId));
    setSelected(prev => {
      let changed = false;
      const next = new Set<string>();
      prev.forEach(id => { if (alive.has(id)) next.add(id); else changed = true; });
      return changed ? next : prev;
    });
  }, [rows, getRowId]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const toggleSort = (key: string) => {
    setSort(prev => {
      if (!prev || prev.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return null; // third click clears
    });
  };

  const clearAll = () => {
    setColFilters({});
    setGlobalSearch('');
    setChipValues({});
  };

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

  const toggleRow = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelected(prev => {
        const next = new Set(prev);
        processedIds.forEach(id => next.delete(id));
        return next;
      });
    } else {
      setSelected(prev => new Set([...prev, ...processedIds]));
    }
  };

  const runBulk = async (action: BulkAction<T>) => {
    if (selectedRows.length === 0) return;
    if (action.confirm) {
      const msg = action.confirm(selectedRows);
      if (!window.confirm(msg)) return;
    }
    setBulkRunning(action.key);
    try {
      await action.run(selectedRows);
      setSelected(new Set());
      onBulkComplete?.();
    } catch (e) {
      console.error(`[SmartDataGrid] bulk action ${action.key} failed:`, e);
      window.alert(e instanceof Error ? e.message : `Bulk ${action.label} failed`);
    } finally {
      setBulkRunning(null);
    }
  };

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
    a.href = url; a.download = `${tb.exportName ?? 'export'}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  // ── Rendering helpers ────────────────────────────────────────────────────

  const pad = dense ? 'py-1.5' : 'py-3';
  const alignClass = (a?: string) => a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left';
  const bulkEnabled = !!bulkActions && bulkActions.length > 0;

  const renderRow = (row: T, idx: number) => {
    const id = getRowId(row);
    const isSelected = selected.has(id);
    const isRowActive = selectedId === id;
    return (
      <tr key={id}
        onClick={onRowClick ? () => onRowClick(row) : undefined}
        className={`${onRowClick ? 'cursor-pointer' : ''} transition-colors ${isRowActive ? 'bg-emerald-500/10' : isSelected ? 'bg-violet-500/5' : idx % 2 ? 'bg-white/[0.015]' : ''} hover:bg-white/[0.04]`}
      >
        {bulkEnabled && (
          <td className="w-10 px-3" onClick={e => e.stopPropagation()}>
            <input type="checkbox" checked={isSelected} onChange={() => toggleRow(id)}
              className="accent-violet-500 w-3.5 h-3.5 align-middle" />
          </td>
        )}
        {visibleColumns.map(c => (
          <td key={c.key} className={`px-3 ${pad} ${alignClass(c.align)} ${c.cellClassName ?? 'text-slate-300'}`}>
            {c.render ? c.render(row) : (() => { const v = c.accessor?.(row); return v == null || v === '' ? '—' : String(v); })()}
          </td>
        ))}
      </tr>
    );
  };

  return (
    <div ref={gridRef} className={`space-y-4 ${className}`}>
      {/* KPI tiles */}
      {kpis && kpis.length > 0 && (
        <div className={`grid gap-3 grid-cols-2 md:grid-cols-${Math.min(6, kpis.length)}`}>
          {kpis.map((k, i) => {
            const a = KPI_ACCENTS[k.accent ?? 'default'];
            const Icon = k.icon;
            return (
              <div key={i} className="rounded-2xl bg-slate-900/60 border border-white/10 p-4 hover:border-white/20 transition-colors">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">{k.label}</span>
                  {Icon && (
                    <div className={`w-7 h-7 rounded-lg ${a.bg} flex items-center justify-center`}>
                      <Icon className={`w-3.5 h-3.5 ${a.text}`} strokeWidth={2} />
                    </div>
                  )}
                </div>
                <div className={`text-3xl font-bold ${a.text}`}>{k.value}</div>
                {k.sub && <div className="text-xs text-slate-500 mt-1">{k.sub}</div>}
              </div>
            );
          })}
        </div>
      )}

      {/* Filter chips */}
      {filterChips && filterChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {filterChips.map(chip => (
            <div key={chip.key} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-slate-900/50 px-2 py-1">
              <span className="text-[11px] uppercase tracking-wider text-slate-500 font-medium mr-0.5">{chip.label}</span>
              {chip.options.map(opt => {
                const active = chipValues[chip.key]?.has(opt.value) ?? false;
                return (
                  <button key={opt.value} type="button" onClick={() => toggleChip(chip.key, opt.value, chip.multi ?? false)}
                    className={`px-2 py-0.5 rounded-md text-xs transition-colors ${
                      active
                        ? 'bg-violet-500/25 text-violet-100 border border-violet-500/60'
                        : 'bg-slate-800/50 text-slate-300 border border-white/10 hover:bg-slate-800'
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

      {/* Grid container: toolbar + table */}
      <div className="rounded-2xl border border-white/10 bg-slate-900/50 overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-2 flex-wrap px-3 py-2.5 border-b border-white/10 bg-slate-900/60">
          {tb.title && <span className="text-sm font-semibold text-white mr-1">{tb.title}</span>}
          <span className="text-xs text-slate-500">{processed.length} of {rows.length}</span>

          {bulkEnabled && selected.size > 0 && (
            <>
              <span className="text-xs text-violet-300 font-medium">· {selected.size} selected</span>
              {bulkActions!.map(action => {
                const Icon = action.icon;
                const destructive = action.variant === 'destructive';
                const running = bulkRunning === action.key;
                return (
                  <button key={action.key} type="button" onClick={() => runBulk(action)} disabled={running || bulkRunning !== null}
                    className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs transition-colors disabled:opacity-40 ${
                      destructive
                        ? 'border-rose-500/40 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20'
                        : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20'
                    }`}
                  >
                    {Icon && <Icon className="w-3.5 h-3.5" />}
                    {running ? `${action.label}…` : action.label}
                  </button>
                );
              })}
              <button type="button" onClick={() => setSelected(new Set())}
                className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white px-2 py-1.5">
                <X className="w-3.5 h-3.5" /> Clear selection
              </button>
            </>
          )}

          <div className="flex-1" />

          {tb.search && (
            <div className="flex items-center gap-1.5 bg-slate-950/60 border border-white/10 rounded-lg px-2.5 py-1.5 focus-within:border-violet-500/40 w-44">
              <SearchIcon className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <input value={globalSearch} onChange={e => setGlobalSearch(e.target.value)} placeholder="Search…"
                className="flex-1 min-w-0 bg-transparent border-0 outline-none p-0 text-sm text-white placeholder-slate-600" />
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
                  <div className="absolute right-0 mt-1 z-20 w-56 rounded-xl border border-white/10 bg-slate-900 shadow-xl p-1.5">
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 px-2 py-1">Sort by</div>
                    {sortableColumns.map(c => {
                      const isThisCol = sort?.key === c.key;
                      return (
                        <div key={c.key} className="flex items-center gap-1">
                          <button type="button"
                            onClick={() => { setSort({ key: c.key, dir: 'asc' }); setSortMenuOpen(false); }}
                            className={`flex-1 text-left px-2 py-1.5 rounded-lg text-sm hover:bg-white/5 ${isThisCol && sort!.dir === 'asc' ? 'text-violet-200' : 'text-slate-300'}`}
                          >
                            <ArrowUp className="inline w-3 h-3 mr-1" />{c.header}
                          </button>
                          <button type="button"
                            onClick={() => { setSort({ key: c.key, dir: 'desc' }); setSortMenuOpen(false); }}
                            className={`px-2 py-1.5 rounded-lg text-sm hover:bg-white/5 ${isThisCol && sort!.dir === 'desc' ? 'text-violet-200' : 'text-slate-400'}`}
                            title={`Sort ${c.header} descending`}
                          >
                            <ArrowDown className="w-3 h-3" />
                          </button>
                        </div>
                      );
                    })}
                    {sort && (
                      <button type="button" onClick={() => { setSort(null); setSortMenuOpen(false); }}
                        className="w-full mt-1 text-xs text-slate-400 hover:text-white px-2 py-1.5 rounded-lg hover:bg-white/5 border-t border-white/5">
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
                  <div className="absolute right-0 mt-1 z-20 w-52 rounded-xl border border-white/10 bg-slate-900 shadow-xl p-1.5">
                    {columns.map(c => (
                      <label key={c.key} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5 cursor-pointer text-sm text-slate-300">
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
            <button type="button" onClick={clearAll} className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white px-2 py-1.5">
              <X className="w-3.5 h-3.5" /> Clear
            </button>
          )}

          {tb.actions}
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ tableLayout: 'auto' }}>
            <thead>
              <tr className="border-b border-white/10 text-slate-500 text-[11px] uppercase tracking-wider bg-slate-900/40">
                {bulkEnabled && (
                  <th className="w-10 px-3 py-2.5">
                    <button type="button" onClick={toggleAll} title={allSelected ? 'Clear selection' : 'Select all visible'}
                      className="text-slate-400 hover:text-white align-middle">
                      {allSelected
                        ? <CheckSquare className="w-4 h-4 text-violet-400" />
                        : someSelected
                          ? <CheckSquare className="w-4 h-4 text-violet-400/60" />
                          : <Square className="w-4 h-4" />}
                    </button>
                  </th>
                )}
                {visibleColumns.map(c => {
                  const sortable = c.sortable ?? !!c.accessor;
                  const isSorted = sort?.key === c.key;
                  return (
                    <th key={c.key} style={c.width ? { width: c.width } : undefined}
                      className={`${alignClass(c.align)} px-3 py-2.5 font-medium select-none ${c.headerClassName ?? ''} ${sortable ? 'cursor-pointer hover:text-slate-300' : ''}`}
                      onClick={sortable ? () => toggleSort(c.key) : undefined}>
                      <span className="inline-flex items-center gap-1">
                        {c.header}
                        {sortable && (
                          isSorted
                            ? (sort!.dir === 'asc' ? <ArrowUp className="w-3 h-3 text-violet-300" /> : <ArrowDown className="w-3 h-3 text-violet-300" />)
                            : <ChevronsUpDown className="w-3 h-3 text-slate-600" />
                        )}
                      </span>
                    </th>
                  );
                })}
              </tr>

              {showFilters && (
                <tr className="border-b border-white/10 bg-slate-950/40">
                  {bulkEnabled && <th />}
                  {visibleColumns.map(c => {
                    const filterable = c.filter !== false && (c.filter !== undefined || !!c.accessor);
                    return (
                      <th key={c.key} className="px-2 py-1.5">
                        {!filterable ? null : c.filter === 'select' ? (
                          <select value={colFilters[c.key] ?? ''} onChange={e => setColFilters(f => ({ ...f, [c.key]: e.target.value }))}
                            className="w-full bg-slate-900/70 border border-white/10 rounded-md px-2 py-1 text-xs text-slate-200 font-normal normal-case focus:outline-none focus:border-violet-500/40">
                            <option value="">All</option>
                            {(selectValues[c.key] ?? []).map(v => <option key={v} value={v}>{v}</option>)}
                          </select>
                        ) : (
                          <input value={colFilters[c.key] ?? ''} onChange={e => setColFilters(f => ({ ...f, [c.key]: e.target.value }))}
                            placeholder="Filter…"
                            className="w-full bg-slate-900/70 border border-white/10 rounded-md px-2 py-1 text-xs text-slate-200 font-normal normal-case placeholder-slate-600 focus:outline-none focus:border-violet-500/40" />
                        )}
                      </th>
                    );
                  })}
                </tr>
              )}
            </thead>

            <tbody className="divide-y divide-white/5">
              {loading ? (
                [...Array(6)].map((_, i) => (
                  <tr key={i}><td colSpan={visibleColumns.length + (bulkEnabled ? 1 : 0)} className="px-3 py-2">
                    <div className="h-6 bg-slate-800/50 rounded animate-pulse" />
                  </td></tr>
                ))
              ) : processed.length === 0 ? (
                <tr><td colSpan={visibleColumns.length + (bulkEnabled ? 1 : 0)} className="text-center text-slate-500 py-12">{emptyMessage}</td></tr>
              ) : (
                processed.map((r, i) => renderRow(r, i))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Toolbar button primitive ────────────────────────────────────────────────

function ToolbarButton({ active, onClick, title, children }: {
  active?: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} title={title}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
        active ? 'border-violet-500/40 bg-violet-500/10 text-violet-200' : 'border-white/10 text-slate-300 hover:bg-white/5'
      }`}>
      {children}
    </button>
  );
}
