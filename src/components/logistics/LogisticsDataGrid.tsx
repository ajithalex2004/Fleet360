'use client';
/**
 * LogisticsDataGrid — a reusable, dependency-free data grid for the Logistics
 * module.
 *
 *   • Sortable column headers (click cycles asc → desc → none, with indicators)
 *   • Inline filter row (per-column text or select filters)
 *   • Smart toolbar: global search, column show/hide & custom ordering,
 *     density, CSV export, a live "X of Y" count, and a one-click clear-all
 *
 * Generic over the row type. Columns declare an `accessor` (used for sorting,
 * filtering, search and CSV) and an optional `render` for the cell. Pure client
 * state — no server round-trips, no external grid library. Dark-themed to match
 * the rest of Logistics.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowUp, ArrowDown, ChevronsUpDown, Search as SearchIcon, Columns3, Download,
  Rows3, Filter, X, GripVertical, RotateCcw,
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
  const storageKey = useMemo(
    () => `fleet360_logisticsgrid_cols_${(tb.title || tb.exportName || 'default').replace(/[^a-zA-Z0-9_-]/g, '_')}`,
    [tb.title, tb.exportName],
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
  const isCustomColumnOrder = useMemo(() => {
    const def = columns.map((c) => c.key);
    return def.length === columnOrder.length && def.some((k, idx) => columnOrder[idx] !== k);
  }, [columns, columnOrder]);

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
    <div className={`rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/50 overflow-hidden ${className}`}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap px-3 py-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/60">
        {tb.title && <span className="text-sm font-semibold text-[var(--text-main)] mr-1">{tb.title}</span>}
        <span className="text-xs text-[var(--text-faint)]">{processed.length} of {rows.length}</span>

        <div className="flex-1" />

        {tb.search && (
          <div className="flex items-center gap-1.5 bg-[var(--bg-canvas)]/60 border border-[var(--border-subtle)] rounded-lg px-2.5 py-1.5 focus-within:border-emerald-500/40 w-44">
            <SearchIcon className="w-3.5 h-3.5 text-[var(--text-faint)] shrink-0" />
            <input value={globalSearch} onChange={e => setGlobalSearch(e.target.value)} placeholder="Search…"
              className="flex-1 min-w-0 bg-transparent border-0 outline-none p-0 text-sm text-[var(--text-main)] placeholder-[var(--text-faint)]" />
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
            <ToolbarButton active={colMenuOpen || isCustomColumnOrder || hidden.size > 0} onClick={() => setColMenuOpen(v => !v)} title="Show / hide & reorder columns">
              <Columns3 className="w-3.5 h-3.5" /> Columns
              {(isCustomColumnOrder || hidden.size > 0) && (
                <span className="ml-0.5 rounded-full bg-emerald-500/20 text-emerald-300 px-1.5 text-[10px]">
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
                              ? 'opacity-50 bg-emerald-500/15'
                              : isDragOverThis
                              ? 'border border-emerald-500 bg-emerald-500/10'
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
                                className="accent-emerald-500 w-3.5 h-3.5 shrink-0"
                              />
                              <span className={`truncate ${isVisible ? 'text-[var(--text-main)] font-medium' : 'text-[var(--text-faint)] line-through'}`}>
                                {c.header}
                              </span>
                            </label>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <select
                              value={idx}
                              onChange={(e) => moveColumnToIndex(c.key, Number(e.target.value))}
                              title={`Move "${c.header}" to column position`}
                              className="bg-[var(--bg-main)] border border-[var(--border-subtle)] rounded px-1.5 py-0.5 text-[10px] font-mono font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] focus:outline-none focus:border-emerald-500 cursor-pointer"
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
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ tableLayout: 'auto' }}>
          <thead>
            <tr className="border-b border-[var(--border-subtle)] text-[var(--text-faint)] text-[11px] uppercase tracking-wider bg-[var(--bg-surface)]/40">
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
                    className={`${alignClass(c.align)} px-3 py-2.5 font-medium select-none ${c.headerClassName ?? ''} ${sortable ? 'cursor-pointer hover:text-[var(--text-muted)]' : 'cursor-grab'} ${isDragOverHeader ? 'bg-emerald-500/15 border-l-2 border-emerald-500' : ''}`}
                    onClick={sortable ? () => toggleSort(c.key) : undefined}
                  >
                    <span className="inline-flex items-center gap-1">
                      {c.header}
                      {sortable && (
                        isSorted
                          ? (sort!.dir === 'asc' ? <ArrowUp className="w-3 h-3 text-emerald-300" /> : <ArrowDown className="w-3 h-3 text-emerald-300" />)
                          : <ChevronsUpDown className="w-3 h-3 text-[var(--text-faint)]" />
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>

            {showFilters && (
              <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)]/40">
                {visibleColumns.map(c => {
                  const filterable = c.filter !== false && (c.filter !== undefined || !!c.accessor);
                  return (
                    <th key={c.key} className="px-2 py-1.5">
                      {!filterable ? null : c.filter === 'select' ? (
                        <select value={colFilters[c.key] ?? ''} onChange={e => setColFilters(f => ({ ...f, [c.key]: e.target.value }))}
                          className="w-full bg-[var(--bg-surface)]/70 border border-[var(--border-subtle)] rounded-md px-2 py-1 text-xs text-[var(--text-main)] font-normal normal-case focus:outline-none focus:border-emerald-500/40">
                          <option value="">All</option>
                          {(selectValues[c.key] ?? []).map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                      ) : (
                        <input value={colFilters[c.key] ?? ''} onChange={e => setColFilters(f => ({ ...f, [c.key]: e.target.value }))}
                          placeholder="Filter…"
                          className="w-full bg-[var(--bg-surface)]/70 border border-[var(--border-subtle)] rounded-md px-2 py-1 text-xs text-[var(--text-main)] font-normal normal-case placeholder-[var(--text-faint)] focus:outline-none focus:border-emerald-500/40" />
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
                <tr key={i}><td colSpan={visibleColumns.length} className="px-3 py-2"><div className="h-6 bg-[var(--bg-surface)]/50 rounded animate-pulse" /></td></tr>
              ))
            ) : processed.length === 0 ? (
              <tr><td colSpan={visibleColumns.length} className="text-center text-[var(--text-faint)] py-12">{emptyMessage}</td></tr>
            ) : processed.map(row => {
              const id = getRowId(row);
              return (
                <tr key={id} onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={`${onRowClick ? 'cursor-pointer' : ''} transition-colors ${selectedId === id ? 'bg-emerald-500/10' : 'hover:bg-[var(--bg-surface-hover)]'}`}>
                  {visibleColumns.map(c => (
                    <td key={c.key} className={`px-3 ${pad} ${alignClass(c.align)} ${c.cellClassName ?? 'text-[var(--text-muted)]'}`}>
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
        active ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border-[var(--border-subtle)] text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)]'
      }`}>
      {children}
    </button>
  );
}
