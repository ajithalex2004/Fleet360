'use client';

/**
 * Shared load/save hook for the rule tabs.
 *
 * Each tab calls useRuleTab<Shape>(typeId, category, defaults, scopeId) and
 * gets:
 *   - rules:    current (mutable) form state
 *   - patch:    partial merge helper
 *   - loading / saving / error / configured
 *   - ownedScope: scope_id whose row backed this load (== scopeId when
 *     overridden here, an ancestor when inherited, null on defaults)
 *   - save():   PUT the current state at scopeId
 *   - reset():  drop unsaved edits and re-fetch
 *
 * Phase 2E — scopeId is optional on the URL (server defaults to root).
 */

import { useCallback, useEffect, useState } from 'react';
import type { RuleCategory } from '@/types/service-rules';

export function useRuleTab<T extends object>(
  typeId: string,
  category: RuleCategory,
  defaults: T,
  scopeId?: string,
) {
  const [rules, setRules]           = useState<T>(defaults);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [savedMsg, setSavedMsg]     = useState<string | null>(null);
  const [configured, setConfigured] = useState(false);
  const [ownedScope, setOwnedScope] = useState<string | null>(null);

  const url = scopeId
    ? `/api/admin/service-config/types/${typeId}/rules/${category}?scopeId=${scopeId}`
    : `/api/admin/service-config/types/${typeId}/rules/${category}`;

  const load = useCallback(async () => {
    setLoading(true); setError(null); setSavedMsg(null);
    try {
      const res = await fetch(url);
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? 'Load failed');
      setRules({ ...defaults, ...(d.rules as object) } as T);
      setConfigured(!!d.configured);
      setOwnedScope(d.ownedScope ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  useEffect(() => { void load(); }, [load]);

  const patch = useCallback((p: Partial<T>) => {
    setRules(prev => ({ ...prev, ...p }));
  }, []);

  const save = useCallback(async () => {
    setSaving(true); setError(null); setSavedMsg(null);
    try {
      const res = await fetch(url, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rules),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? 'Save failed');
      setRules({ ...defaults, ...(d.rules as object) } as T);
      setConfigured(true);
      setOwnedScope(d.ownedScope ?? null);
      setSavedMsg('Saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, rules]);

  return {
    rules, setRules, patch,
    loading, saving, error, savedMsg,
    configured, ownedScope, save, reload: load,
  };
}
