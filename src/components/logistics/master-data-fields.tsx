'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';

export type LogisticsMasterDataType =
  | 'SHIPPER'
  | 'CUSTOMER'
  | 'PICKUP_LOCATION'
  | 'COUNTRY'
  | 'AIRPORT'
  | 'AIRLINE'
  | 'AGENT'
  | 'SERVICE_TYPE'
  | string;

export type LogisticsMasterDataItem = {
  id: string;
  type: LogisticsMasterDataType;
  code: string;
  label: string;
  description?: string | null;
  status: string;
  sortOrder?: number | null;
  metadata?: Record<string, unknown>;
};

export type ShipmentValidationResult = {
  ok: boolean;
  issues: string[];
  warnings: string[];
};

export type LogisticsComplianceBlocker = {
  code: string;
  label: string;
  severity?: 'ERROR' | 'WARNING' | string;
  subjectType?: string;
  subjectId?: string | null;
  expiresAt?: string | null;
};

export type LogisticsApiError = {
  message: string;
  code?: string;
  issues: string[];
  warnings: string[];
  blockers: LogisticsComplianceBlocker[];
  approvalRequest?: {
    id?: string;
    status?: string;
    requiredApprovals?: number;
    approvals?: number;
  } | null;
};

type SessionMe = {
  tenantId?: string | null;
  userId?: string | null;
};

function query(path: string, tenantId?: string | null, extra?: Record<string, string | number | null | undefined>) {
  const params = new URLSearchParams();
  if (tenantId) params.set('tenantId', tenantId);
  Object.entries(extra ?? {}).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') params.set(key, String(value));
  });
  const qs = params.toString();
  return `${path}${qs ? `?${qs}` : ''}`;
}

export function useLogisticsMasterData(types: LogisticsMasterDataType[] = []) {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [items, setItems] = useState<LogisticsMasterDataItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const typeKey = types.map(type => String(type).toUpperCase()).sort().join('|');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      let nextTenantId = tenantId;
      if (!nextTenantId) {
        const sessionRes = await fetch('/api/auth/me', { cache: 'no-store' });
        if (!sessionRes.ok) throw new Error('Please sign in to load Logistics master data.');
        const me = await sessionRes.json() as SessionMe;
        nextTenantId = me.tenantId ?? null;
        setTenantId(nextTenantId);
      }
      if (!nextTenantId) throw new Error('Tenant context is required for Logistics master data.');

      const res = await fetch(query('/api/logistics/master-data', nextTenantId, { status: 'ACTIVE' }), { cache: 'no-store' });
      if (!res.ok) throw new Error(await res.text());
      const payload = await res.json();
      const rows = Array.isArray(payload.data) ? payload.data : [];
      const typeSet = new Set(typeKey ? typeKey.split('|') : []);
      setItems(typeSet.size ? rows.filter((row: LogisticsMasterDataItem) => typeSet.has(String(row.type).toUpperCase())) : rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Logistics master data');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [tenantId, typeKey]);

  useEffect(() => {
    load();
  }, [load]);

  const byType = useMemo(() => {
    return items.reduce<Record<string, LogisticsMasterDataItem[]>>((acc, item) => {
      const key = String(item.type).toUpperCase();
      acc[key] = acc[key] ?? [];
      acc[key].push(item);
      return acc;
    }, {});
  }, [items]);

  const optionsFor = useCallback((type: LogisticsMasterDataType) => {
    return byType[String(type).toUpperCase()] ?? [];
  }, [byType]);

  return { tenantId, items, loading, error, reload: load, optionsFor };
}

export function combineMasterOptions(...groups: LogisticsMasterDataItem[][]) {
  const byCode = new Map<string, LogisticsMasterDataItem>();
  for (const item of groups.flat()) {
    const key = `${item.type}:${item.code}`;
    if (!byCode.has(key)) byCode.set(key, item);
  }
  return Array.from(byCode.values());
}

export function masterLabel(item: LogisticsMasterDataItem) {
  return item.code === item.label ? item.label : `${item.label} (${item.code})`;
}

export function masterValue(item: LogisticsMasterDataItem) {
  return item.label || item.code;
}

export function LogisticsMasterSelect({
  label,
  value,
  onChange,
  options,
  placeholder = 'Select value',
  disabled,
  required,
  className = '',
  optionPrefix,
}: {
  label?: string;
  value: string;
  onChange: (value: string, item?: LogisticsMasterDataItem) => void;
  options: LogisticsMasterDataItem[];
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  optionPrefix?: string;
}) {
  const select = (
    <select
      value={value}
      onChange={event => {
        const next = event.target.value;
        onChange(next, options.find(item => masterValue(item) === next || item.code === next || item.id === next));
      }}
      disabled={disabled}
      required={required}
      className={`w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2.5 text-sm font-semibold text-white outline-none transition focus:border-emerald-400 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    >
      <option value="">{placeholder}</option>
      {options.map(item => (
        <option key={`${optionPrefix ?? item.type}:${item.id}:${item.code}`} value={masterValue(item)}>
          {masterLabel(item)}
        </option>
      ))}
    </select>
  );

  if (!label) return select;
  return (
    <label className="space-y-1.5">
      <span className="text-xs font-bold uppercase tracking-wider text-slate-500">{label}</span>
      {select}
    </label>
  );
}

export function useLogisticsPolling(callback: () => void | Promise<void>, enabled: boolean, intervalMs = 20000) {
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let running = false;

    const tick = async () => {
      if (!active || running || document.visibilityState === 'hidden') return;
      running = true;
      try {
        await callback();
      } finally {
        running = false;
      }
    };

    const timer = window.setInterval(tick, intervalMs);
    const onFocus = () => { void tick(); };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void tick();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [callback, enabled, intervalMs]);
}

export async function readLogisticsApiError(res: Response): Promise<LogisticsApiError> {
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? JSON.parse(text) as Record<string, unknown> : {};
  } catch {
    return {
      message: text || res.statusText || 'Request failed',
      issues: [],
      warnings: [],
      blockers: [],
      approvalRequest: null,
    };
  }
  return {
    message: String(json.message ?? json.error ?? text ?? res.statusText ?? 'Request failed'),
    code: json.code ? String(json.code) : undefined,
    issues: Array.isArray(json.issues) ? json.issues.map(String) : [],
    warnings: Array.isArray(json.warnings) ? json.warnings.map(String) : [],
    blockers: Array.isArray(json.blockers) ? json.blockers as LogisticsComplianceBlocker[] : [],
    approvalRequest: json.approvalRequest && typeof json.approvalRequest === 'object'
      ? json.approvalRequest as LogisticsApiError['approvalRequest']
      : null,
  };
}

export function LogisticsMessage({
  type,
  title,
  message,
  issues = [],
  warnings = [],
  blockers = [],
  approvalRequest,
}: {
  type: 'error' | 'success' | 'warning' | 'info';
  title?: string;
  message?: string;
  issues?: string[];
  warnings?: string[];
  blockers?: LogisticsComplianceBlocker[];
  approvalRequest?: LogisticsApiError['approvalRequest'];
}) {
  const tone = {
    error: 'border-rose-300 bg-rose-50 text-rose-950',
    success: 'border-emerald-300 bg-emerald-50 text-emerald-950',
    warning: 'border-amber-300 bg-amber-50 text-amber-950',
    info: 'border-sky-300 bg-sky-50 text-sky-950',
  }[type];
  const items = issues.length > 0
    ? issues
    : blockers.length > 0
      ? blockers.map(blocker => blocker.label)
      : warnings;

  return (
    <div className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${tone}`}>
      {title && <p className="font-bold">{title}</p>}
      {message && <p className={title ? 'mt-1' : ''}>{message}</p>}
      {items.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
          {items.map(item => <li key={item}>{item}</li>)}
        </ul>
      )}
      {approvalRequest?.id && (
        <p className="mt-2 rounded-xl bg-white/70 px-3 py-2 text-xs">
          Approval request queued: <span className="font-mono">{approvalRequest.id}</span>
        </p>
      )}
    </div>
  );
}

export function LogisticsConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  tone = 'danger',
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  tone?: 'danger' | 'warning' | 'primary';
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const buttonTone = tone === 'danger'
    ? 'bg-rose-100 text-rose-950 hover:bg-rose-200'
    : tone === 'warning'
      ? 'bg-amber-100 text-amber-950 hover:bg-amber-200'
      : 'bg-sky-100 text-sky-950 hover:bg-sky-200';
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-white/15 bg-slate-900 p-5 shadow-2xl">
        <h3 className="text-lg font-bold text-white">{title}</h3>
        <p className="mt-2 text-sm font-medium text-slate-300">{message}</p>
        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-xl border border-white/10 bg-slate-800 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-700 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`rounded-xl px-4 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-60 ${buttonTone}`}
          >
            {busy ? 'Working...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export async function validateShipmentPayload(payload: Record<string, unknown>, tenantId?: string | null): Promise<ShipmentValidationResult> {
  const res = await fetch(query('/api/logistics/shipments/validate', tenantId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  const result = {
    ok: Boolean(data.ok ?? res.ok),
    issues: Array.isArray(data.issues) ? data.issues : data.error ? [String(data.error)] : [],
    warnings: Array.isArray(data.warnings) ? data.warnings : [],
  };
  if (!res.ok && result.issues.length === 0) result.issues = [res.statusText || 'Shipment validation failed'];
  return result;
}

export function useShipmentValidation(payload: Record<string, unknown> | null, tenantId?: string | null) {
  const [result, setResult] = useState<ShipmentValidationResult>({ ok: true, issues: [], warnings: [] });
  const [validating, setValidating] = useState(false);

  useEffect(() => {
    if (!payload || !tenantId) {
      setResult({ ok: true, issues: [], warnings: [] });
      return;
    }
    const timeout = window.setTimeout(() => {
      setValidating(true);
      validateShipmentPayload(payload, tenantId)
        .then(setResult)
        .catch(err => setResult({ ok: false, issues: [err instanceof Error ? err.message : 'Shipment validation failed'], warnings: [] }))
        .finally(() => setValidating(false));
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [payload, tenantId]);

  return { result, validating };
}

export function ShipmentValidationSummary({
  result,
  validating,
}: {
  result: ShipmentValidationResult;
  validating?: boolean;
}) {
  if (validating) {
    return (
      <div className="rounded-xl border border-sky-300 bg-sky-50 px-4 py-2.5 text-xs font-semibold text-sky-950">
        Checking shipment timeline...
      </div>
    );
  }
  if (result.ok && result.warnings.length === 0) {
    return (
      <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-xs font-semibold text-emerald-950">
        Shipment timeline looks valid.
      </div>
    );
  }
  return (
    <div className={`rounded-xl border px-4 py-3 text-xs font-semibold ${result.ok ? 'border-amber-300 bg-amber-50 text-amber-950' : 'border-rose-300 bg-rose-50 text-rose-950'}`}>
      {result.issues.length > 0 && (
        <div>
          <p className="font-bold">Fix before saving</p>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {result.issues.map(issue => <li key={issue}>{issue}</li>)}
          </ul>
        </div>
      )}
      {result.warnings.length > 0 && (
        <div className={result.issues.length > 0 ? 'mt-3' : ''}>
          <p className="font-bold">Warnings</p>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {result.warnings.map(warning => <li key={warning}>{warning}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
