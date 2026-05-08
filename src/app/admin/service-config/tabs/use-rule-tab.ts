'use client';

/**
 * Shared load/save hook for the 8 rule tabs.
 *
 * Each tab calls useRuleTab<Shape>(typeId, category, defaults) and gets:
 *   - rules:    current (mutable) form state
 *   - setRules: full replace
 *   - patch:    partial merge helper
 *   - loading / saving / error / configured
 *   - save():   PUT the current state
 *   - reset():  drop unsaved edits and re-fetch
 */

import { useCallback, useEffect, useState } from 'react';
import type { RuleCategory } from '@/types/service-rules';

export function useRuleTab<T extends object>(
  typeId: string,
  category: RuleCategory,
  defaults: T,
) {
  const [rules, setRules]         = useState<T>(defaults);
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [savedMsg, setSavedMsg]   = useState<string | null>(null);
  const [configured, setConfigured] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null); setSavedMsg(null);
    try {
      const res = await fetch(`/api/admin/service-config/types/${typeId}/rules/${category}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? 'Load failed');
      setRules({ ...defaults, ...(d.rules as object) } as T);
      setConfigured(!!d.configured);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
    // We intentionally exclude `defaults` from deps — it's a stable
    // module-scope constant per call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeId, category]);

  useEffect(() => { void load(); }, [load]);

  const patch = useCallback((p: Partial<T>) => {
    setRules(prev => ({ ...prev, ...p }));
  }, []);

  const save = useCallback(async () => {
    setSaving(true); setError(null); setSavedMsg(null);
    try {
      const res = await fetch(`/api/admin/service-config/types/${typeId}/rules/${category}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rules),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? 'Save failed');
      setRules({ ...defaults, ...(d.rules as object) } as T);
      setConfigured(true);
      setSavedMsg('Saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeId, category, rules]);

  return { rules, setRules, patch, loading, saving, error, savedMsg, configured, save, reload: load };
}
