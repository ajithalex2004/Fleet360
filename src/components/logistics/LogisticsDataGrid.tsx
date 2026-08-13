'use client';
/**
 * LogisticsDataGrid — a reusable, dependency-free data grid for the Logistics
 * module.
 *
 *   • Sortable column headers (click cycles asc → desc → none, with indicators)
 *   • Inline filter row (per-column text or select filters)
 *   • Smart toolbar: global search, column show/hide, density, CSV export,
 *     a live "X of Y" count, and a one-click clear-all
 *
 * Generic over the row type. Columns declare an `accessor` (used for sorting,
 * filtering, search and CSV) and an optional `render` for the cell. Pure client
 * state — no server round-trips, no external grid library. Dark-themed to match
 * the rest of Logistics.
 */
import React, { useMemo, useState } from 'react';
import {
  ArrowUp, ArrowDown, ChevronsUpDown, Search as SearchIcon, Columns3, Download,
  Rows3, Filter, X,
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
  className?: string;
}

const cmp = (a: unknown, b: unknown): number => {
  const an = a == null || a === '';
  const bn = b == null || b === '';
  if (an && bn) return 0;
  if (an) return 1;   // nulls last
  if (bn) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
};

export default function LogisticsDataGrid<T>({
  rows, columns, getRowId, onRowClick, selectedId, loading, emptyMessage = 'No rows',
  initialSort, toolbar = {}, className = '',
}: DataGridProps<T>) {
  const tb = { search: true, columns: true, density: true, filters: true, exportCsv: true, ...toolbar };

  const [sort, setSort] = useState<{ key: string; dir: SortDir } | null>(initialSort ?? null);
  const [colFilters, setColFilters] = useState<Record<string, string>>({});
  const [globalSearch, setGlobalSearch] = useState('');
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [dense, setDense] = useState(false);
  const [showFilters, setShowFilters] = useState(true);
  const [colMenuOpen, setColMenuOpen] = useState(false);

  const visibleColumns = useMemo(() => columns.filter(c => !hidden.has(c.key)), [columns, hidden]);

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
  }, [rows, columns, globalSearch, colFilters, sort]);

  const activeFilterCount = Object.values(colFilters).filter(v => v.trim() !== '').length + (globalSearch.trim() ? 1 : 0);

  const toggleSort = (key: string) => {
    setSort(prev => {
      if (!prev || prev.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return null; // third click clears
    });
  };

  const clearAll = () => { setColFilters({}); setGlobalSearch(''); };

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
    a.href = url; a.download = `${tb.exportName ?? 'logistics-export'}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const pad = dense ? 'py-1.5' : 'py-3';
  const alignClass = (a?: string) => a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left';

  return (
    <div className={`rounded-2xl border border-white/10 bg-slate-900/50 overflow-hidden ${className}`}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap px-3 py-2.5 border-b border-white/10 bg-slate-900/60">
        {tb.title && <span className="text-sm font-semibold text-white mr-1">{tb.title}</span>}
        <span className="text-xs text-slate-500">{processed.length} of {rows.length}</span>

        <div className="flex-1" />

        {tb.search && (
          <div className="flex items-center gap-1.5 bg-slate-950/60 border border-white/10 rounded-lg px-2.5 py-1.5 focus-within:border-emerald-500/40 w-44">
            <SearchIcon className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <input value={globalSearch} onChange={e => setGlobalSearch(e.target.value)} placeholder="Search…"
              className="flex-1 min-w-0 bg-transparent border-0 outline-none p-0 text-sm text-white placeholder-slate-600" />
          </div>
        )}

        {tb.filters && (
          <ToolbarButton active={showFilters} onClick={() => setShowFilters(v => !v)} title="Toggle filter row">
            <Filter className="w-3.5 h-3.5" /> Filters
            {activeFilterCount > 0 && <span className="ml-0.5 rounded-full bg-emerald-500/20 text-emerald-300 px-1.5 text-[10px]">{activeFilterCount}</span>}
          </ToolbarButton>
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
                      })} className="accent-emerald-500 w-3.5 h-3.5" />
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
                          ? (sort!.dir === 'asc' ? <ArrowUp className="w-3 h-3 text-emerald-300" /> : <ArrowDown className="w-3 h-3 text-emerald-300" />)
                          : <ChevronsUpDown className="w-3 h-3 text-slate-600" />
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>

            {showFilters && (
              <tr className="border-b border-white/10 bg-slate-950/40">
                {visibleColumns.map(c => {
                  const filterable = c.filter !== false && (c.filter !== undefined || !!c.accessor);
                  return (
                    <th key={c.key} className="px-2 py-1.5">
                      {!filterable ? null : c.filter === 'select' ? (
                        <select value={colFilters[c.key] ?? ''} onChange={e => setColFilters(f => ({ ...f, [c.key]: e.target.value }))}
                          className="w-full bg-slate-900/70 border border-white/10 rounded-md px-2 py-1 text-xs text-slate-200 font-normal normal-case focus:outline-none focus:border-emerald-500/40">
                          <option value="">All</option>
                          {(selectValues[c.key] ?? []).map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                      ) : (
                        <input value={colFilters[c.key] ?? ''} onChange={e => setColFilters(f => ({ ...f, [c.key]: e.target.value }))}
                          placeholder="Filter…"
                          className="w-full bg-slate-900/70 border border-white/10 rounded-md px-2 py-1 text-xs text-slate-200 font-normal normal-case placeholder-slate-600 focus:outline-none focus:border-emerald-500/40" />
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
                <tr key={i}><td colSpan={visibleColumns.length} className="px-3 py-2"><div className="h-6 bg-slate-800/50 rounded animate-pulse" /></td></tr>
              ))
            ) : processed.length === 0 ? (
              <tr><td colSpan={visibleColumns.length} className="text-center text-slate-500 py-12">{emptyMessage}</td></tr>
            ) : processed.map(row => {
              const id = getRowId(row);
              return (
                <tr key={id} onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={`${onRowClick ? 'cursor-pointer' : ''} transition-colors ${selectedId === id ? 'bg-emerald-500/10' : 'hover:bg-white/[0.03]'}`}>
                  {visibleColumns.map(c => (
                    <td key={c.key} className={`px-3 ${pad} ${alignClass(c.align)} ${c.cellClassName ?? 'text-slate-300'}`}>
                      {c.render ? c.render(row) : (() => { const v = c.accessor?.(row); return v == null || v === '' ? '—' : String(v); })()}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ToolbarButton({ active, onClick, title, children }: { active?: boolean; onClick: () => void; title?: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} title={title}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
        active ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border-white/10 text-slate-300 hover:bg-white/5'
      }`}>
      {children}
    </button>
  );
}
