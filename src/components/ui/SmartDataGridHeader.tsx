'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowUpDown, ChevronDown, ChevronUp, Minus, Plus } from 'lucide-react';

type SortDirection = 'asc' | 'desc';

const DEFAULT_COLUMN_WIDTH = 180;
const MIN_COLUMN_WIDTH = 120;
const MAX_COLUMN_WIDTH = 420;
const RESIZE_STEP = 24;

export type SmartDataGridHeaderColumn = {
  key: string;
  label: string;
  sortable?: boolean;
  filter?: React.ReactNode;
  headerClassName?: string;
  filterClassName?: string;
  width?: number;
};

export default function SmartDataGridHeader({
  columns,
  sortKey,
  sortDirection,
  onSort,
  actionHeader,
  actionFilter,
  columnResizeStorageKey,
}: {
  columns: SmartDataGridHeaderColumn[];
  sortKey?: string;
  sortDirection?: SortDirection;
  onSort?: (key: string) => void;
  actionHeader?: React.ReactNode;
  actionFilter?: React.ReactNode;
  columnResizeStorageKey?: string;
}) {
  const hasFilters = columns.some((column) => column.filter) || Boolean(actionFilter);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!columnResizeStorageKey) return;
    try {
      const raw = window.localStorage.getItem(columnResizeStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, number>;
      if (!parsed || typeof parsed !== 'object') return;
      const sanitized = Object.fromEntries(
        Object.entries(parsed)
          .filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
          .map(([key, value]) => [key, Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, value))]),
      );
      setColumnWidths(sanitized);
    } catch {
      // Ignore invalid saved widths and continue with defaults.
    }
  }, [columnResizeStorageKey]);

  useEffect(() => {
    if (!columnResizeStorageKey) return;
    try {
      window.localStorage.setItem(columnResizeStorageKey, JSON.stringify(columnWidths));
    } catch {
      // Ignore storage failures.
    }
  }, [columnResizeStorageKey, columnWidths]);

  const effectiveColumns = useMemo(
    () =>
      columns.map((column) => ({
        ...column,
        width:
          typeof columnWidths[column.key] === 'number'
            ? columnWidths[column.key]
            : column.width,
      })),
    [columnWidths, columns],
  );

  const resizeColumn = (key: string, delta: number) => {
    setColumnWidths((prev) => {
      const baseWidth =
        prev[key] ??
        effectiveColumns.find((column) => column.key === key)?.width ??
        DEFAULT_COLUMN_WIDTH;
      return {
        ...prev,
        [key]: Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, baseWidth + delta)),
      };
    });
  };

  return (
    <thead className="smart-data-grid-head">
      <tr className="smart-data-grid-header-row">
        {effectiveColumns.map((column) => (
          <th
            key={column.key}
            className={`group px-6 py-4 text-left whitespace-nowrap align-middle text-[15px] font-semibold tracking-[0.04em] text-[color:var(--text-primary)] ${column.headerClassName ?? ''}`}
            style={column.width ? { width: `${column.width}px`, minWidth: `${column.width}px` } : undefined}
          >
            <div className="flex items-center justify-between gap-2">
              {column.sortable && onSort ? (
                <button
                  type="button"
                  onClick={() => onSort(column.key)}
                  className="inline-flex items-center gap-2.5 transition hover:opacity-90"
                >
                  <span>{column.label}</span>
                  <span
                    className={`smart-data-grid-sort-chip inline-flex items-center justify-center rounded-xl border p-1.5 ${
                      sortKey === column.key
                        ? 'smart-data-grid-sort-chip--active'
                        : 'smart-data-grid-sort-chip--idle'
                    }`}
                    aria-hidden="true"
                  >
                    {sortKey === column.key ? (
                      sortDirection === 'asc' ? (
                        <ChevronUp className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      )
                    ) : (
                      <ArrowUpDown className="h-3.5 w-3.5" />
                    )}
                  </span>
                </button>
              ) : (
                <span>{column.label}</span>
              )}
              {columnResizeStorageKey ? (
                <div className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white/90 px-1 py-1 opacity-0 shadow-sm transition group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      resizeColumn(column.key, -RESIZE_STEP);
                    }}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                    title={`Make ${column.label} narrower`}
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      resizeColumn(column.key, RESIZE_STEP);
                    }}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                    title={`Make ${column.label} wider`}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : null}
            </div>
          </th>
        ))}
        {actionHeader !== undefined && (
          <th className="px-6 py-4 text-left whitespace-nowrap align-middle text-[15px] font-semibold tracking-[0.04em] text-[color:var(--text-primary)]">
            {actionHeader}
          </th>
        )}
      </tr>
      {hasFilters && (
        <tr className="smart-data-grid-filter-row">
          {effectiveColumns.map((column) => (
            <th
              key={`${column.key}-filter`}
              className={`px-6 py-4 align-middle ${column.filterClassName ?? ''}`}
              style={column.width ? { width: `${column.width}px`, minWidth: `${column.width}px` } : undefined}
            >
              {column.filter ?? <div className="h-12" />}
            </th>
          ))}
          {actionHeader !== undefined && (
            <th className="px-6 py-4 align-middle">
              {actionFilter ?? <div className="h-12" />}
            </th>
          )}
        </tr>
      )}
    </thead>
  );
}
