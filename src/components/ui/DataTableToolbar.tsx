'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Download, Eye, EyeOff, FileSpreadsheet, FileText, Search, Settings2, ChevronUp, ChevronDown, Minus, Plus } from 'lucide-react';
import type { DataTableColumn } from '@/hooks/useDataTableColumns';

export default function DataTableToolbar<Key extends string>({
  filtersOpen,
  onToggleFilters,
  onExportExcel,
  onExportPdf,
  columns,
  onToggleColumn,
  onMoveColumn,
  onResizeColumn,
  leftSlot,
}: {
  filtersOpen: boolean;
  onToggleFilters: () => void;
  onExportExcel: () => void | Promise<void>;
  onExportPdf: () => void | Promise<void>;
  columns: DataTableColumn<Key>[];
  onToggleColumn: (key: Key) => void;
  onMoveColumn: (key: Key, direction: 'up' | 'down') => void;
  onResizeColumn: (key: Key, direction: 'narrower' | 'wider') => void;
  leftSlot?: React.ReactNode;
}) {
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const exportRef = useRef<HTMLDivElement | null>(null);
  const settingsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!exportRef.current?.contains(target)) setShowExportMenu(false);
      if (!settingsRef.current?.contains(target)) setShowSettingsMenu(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  return (
    <div className="data-grid-toolbar relative inline-flex max-w-full overflow-visible rounded-2xl border border-white/15 bg-[linear-gradient(135deg,rgba(15,23,42,0.98),rgba(30,41,59,0.96),rgba(37,99,235,0.14))] px-3 py-2 shadow-[0_18px_45px_rgba(15,23,42,0.36)] backdrop-blur-xl">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.18),transparent_36%),radial-gradient(circle_at_top_right,rgba(168,85,247,0.14),transparent_28%)]" />
      <div className="relative flex flex-wrap items-center gap-2.5">
        <div className="data-grid-toolbar-leftslot flex shrink-0 items-center gap-2 text-slate-100">
          {leftSlot}
        </div>
        <div className="flex items-center gap-2 md:ml-auto">
          <button
            type="button"
            onClick={onToggleFilters}
            className={`inline-flex h-10 items-center justify-center gap-2 rounded-full border px-3.5 transition-all duration-200 ${
              filtersOpen
                ? 'border-sky-300 bg-sky-100 text-sky-900 shadow-[0_0_0_4px_rgba(59,130,246,0.12)]'
                : 'border-slate-300 bg-white text-slate-800 hover:border-sky-300 hover:bg-sky-50 hover:text-sky-900'
            }`}
            title="Search & Filter"
          >
            <Search className="h-4 w-4" />
            <span className="data-grid-toolbar-label text-xs font-semibold">Filters</span>
          </button>

          <div ref={exportRef} className="relative">
            <button
              type="button"
              onClick={() => {
                setShowExportMenu((current) => !current);
                setShowSettingsMenu(false);
              }}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-emerald-300 bg-emerald-50 px-3.5 text-emerald-800 transition-all duration-200 hover:border-emerald-400 hover:bg-emerald-100 hover:text-emerald-900 hover:shadow-[0_0_0_4px_rgba(16,185,129,0.10)]"
              title="Export"
            >
              <Download className="h-4 w-4" />
              <span className="data-grid-toolbar-label text-xs font-semibold">Export</span>
            </button>
            {showExportMenu && (
              <div className="absolute right-0 top-12 z-[1000] min-w-[208px] rounded-3xl border border-white/10 bg-slate-950/95 p-2.5 shadow-[0_24px_60px_rgba(15,23,42,0.42)] backdrop-blur-xl">
                <p className="mb-3 px-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Export filtered data</p>
                <button
                  type="button"
                  onClick={() => {
                    setShowExportMenu(false);
                    onExportExcel();
                  }}
                  className="mb-2 flex min-h-8 w-full items-center gap-2.5 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 transition hover:border-emerald-400 hover:bg-emerald-100 hover:text-emerald-900"
                >
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                    <FileSpreadsheet className="h-3.5 w-3.5" />
                  </span>
                  Export Excel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowExportMenu(false);
                    onExportPdf();
                  }}
                  className="flex min-h-8 w-full items-center gap-2.5 rounded-full border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-800 transition hover:border-sky-400 hover:bg-sky-100 hover:text-sky-900"
                >
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-sky-100 text-sky-700">
                    <FileText className="h-3.5 w-3.5" />
                  </span>
                  Export PDF
                </button>
              </div>
            )}
          </div>

          <div ref={settingsRef} className="relative">
            <button
              type="button"
              onClick={() => {
                setShowSettingsMenu((current) => !current);
                setShowExportMenu(false);
              }}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-violet-300 bg-violet-50 px-3.5 text-violet-800 transition-all duration-200 hover:border-violet-400 hover:bg-violet-100 hover:text-violet-900 hover:shadow-[0_0_0_4px_rgba(168,85,247,0.10)]"
              title="Column Settings"
            >
              <Settings2 className="h-4 w-4" />
              <span className="data-grid-toolbar-label text-xs font-semibold">Columns</span>
            </button>
            {showSettingsMenu && (
              <div className="absolute right-0 top-14 z-[1000] min-w-[280px] rounded-3xl border border-white/10 bg-slate-950/95 p-3 shadow-[0_24px_60px_rgba(15,23,42,0.42)] backdrop-blur-xl">
                <p className="mb-3 px-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Columns</p>
                <div className="space-y-2">
                  {columns.map((column, index) => (
                    <div key={column.key} className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
                      <div className="flex items-center justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => onToggleColumn(column.key)}
                          className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-100"
                        >
                          <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full ${
                            column.visible
                              ? 'bg-emerald-500/16 text-emerald-200'
                              : 'bg-slate-800 text-slate-500'
                          }`}>
                            {column.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                          </span>
                          <span className="truncate">{column.label}</span>
                        </button>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            disabled={index === 0}
                            onClick={() => onMoveColumn(column.key, 'up')}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 bg-slate-100 text-slate-700 transition hover:border-slate-400 hover:bg-slate-200 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            <ChevronUp className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            disabled={index === columns.length - 1}
                            onClick={() => onMoveColumn(column.key, 'down')}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 bg-slate-100 text-slate-700 transition hover:border-slate-400 hover:bg-slate-200 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            <ChevronDown className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      <div className="mt-2.5 flex items-center justify-between gap-2">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                          Width {column.width ?? 180}px
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onResizeColumn(column.key, 'narrower')}
                            className="inline-flex h-7 min-w-7 items-center justify-center rounded-full border border-slate-300 bg-slate-100 px-2 text-slate-700 transition hover:border-slate-400 hover:bg-slate-200 hover:text-slate-900"
                            title="Narrower"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onResizeColumn(column.key, 'wider')}
                            className="inline-flex h-7 min-w-7 items-center justify-center rounded-full border border-slate-300 bg-slate-100 px-2 text-slate-700 transition hover:border-slate-400 hover:bg-slate-200 hover:text-slate-900"
                            title="Wider"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
