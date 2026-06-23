/**
 * Stub for the missing master-data-fields module referenced from
 * src/app/logistics/quotes/page.tsx. The original implementation was
 * either never committed or deleted in a cleanup pass; this stub
 * exports placeholder versions of the 8 symbols the page imports so
 * the production Next.js build compiles.
 *
 * Behaviour: the hook returns empty option lists, so the quote form's
 * customer / location / vehicle-type pickers render with no choices.
 * That's deliberate — the stub doesn't fake data; it surfaces "this
 * page needs its real master-data module restored" by being visibly
 * empty rather than erroring at build time.
 *
 * Replace this file with the real implementation when the deleted
 * module is restored from history.
 */
'use client';

import React, { useMemo } from 'react';

// ── Types ──────────────────────────────────────────────────────────────

export type LogisticsMasterDataType =
  | 'CUSTOMER'
  | 'SHIPPER'
  | 'PICKUP_LOCATION'
  | 'AIRPORT'
  | 'COUNTRY'
  | 'SERVICE_TYPE'
  | 'VEHICLE_TYPE'
  | string;

export interface LogisticsMasterDataItem {
  id?: string;
  code: string;
  name?: string;
  type: LogisticsMasterDataType;
}

export interface LogisticsApiError {
  status: number;
  message: string;
  detail?: unknown;
}

// ── Hook ───────────────────────────────────────────────────────────────

interface LogisticsMasterDataState {
  optionsFor(type: LogisticsMasterDataType): LogisticsMasterDataItem[];
  loading: boolean;
  error: string | null;
}

/**
 * Stubbed: returns empty option arrays for every requested type. The
 * real hook fetched from /api/logistics/master-data; restore the
 * original file to bring that back.
 */
export function useLogisticsMasterData(
  _types: LogisticsMasterDataType[],
): LogisticsMasterDataState {
  return useMemo<LogisticsMasterDataState>(
    () => ({
      optionsFor: () => [],
      loading: false,
      error: null,
    }),
    [],
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

export function combineMasterOptions(
  ...lists: LogisticsMasterDataItem[][]
): LogisticsMasterDataItem[] {
  const seen = new Set<string>();
  const out: LogisticsMasterDataItem[] = [];
  for (const list of lists) {
    for (const item of list) {
      const key = `${item.type}|${item.code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

export function masterLabel(item: LogisticsMasterDataItem): string {
  return item.name?.trim() || item.code;
}

export function masterValue(item: LogisticsMasterDataItem): string {
  return item.id || item.code;
}

export async function readLogisticsApiError(
  res: Response,
): Promise<LogisticsApiError> {
  let detail: unknown;
  let message = `HTTP ${res.status}`;
  try {
    const body = await res.clone().json();
    detail = body;
    if (typeof body?.message === 'string') message = body.message;
    else if (typeof body?.error === 'string') message = body.error;
  } catch {
    try {
      message = (await res.text()) || message;
    } catch {
      /* keep default */
    }
  }
  return { status: res.status, message, detail };
}

// ── Component ──────────────────────────────────────────────────────────

interface LogisticsMessageProps {
  type?: 'info' | 'success' | 'warning' | 'error';
  title?: string;
  message?: string | null;
  children?: React.ReactNode;
}

/**
 * Minimal inline-message component. The original was probably more
 * elaborate (icons, dismiss button); this is a typography-only stub.
 */
export function LogisticsMessage({
  type = 'info',
  title,
  message,
  children,
}: LogisticsMessageProps) {
  if (!title && !message && !children) return null;
  const styles: Record<string, string> = {
    info: 'border-sky-400/30 bg-sky-500/10 text-sky-200',
    success: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200',
    warning: 'border-amber-400/30 bg-amber-500/10 text-amber-200',
    error: 'border-red-400/30 bg-red-500/10 text-red-200',
  };
  return (
    <div className={`rounded-lg border p-3 text-sm ${styles[type] ?? styles.info}`}>
      {title && <p className="font-semibold mb-0.5">{title}</p>}
      {message && <p>{message}</p>}
      {children}
    </div>
  );
}
