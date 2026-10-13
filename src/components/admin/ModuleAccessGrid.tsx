'use client';
/**
 * The module access grid: View / Create–Add / Update–Edit / Remove–Delete
 * per module, narrowing what the role grants (src/lib/authz/access-mask.ts).
 * Levels the role does not grant, and modules the company does not have,
 * are greyed out with the reason. Used by the Module Access dialog and the
 * New User form.
 */
import React from 'react';

export type AccessLevel = 'view' | 'create' | 'edit' | 'delete';
export const ACCESS_LEVEL_LABELS: { key: AccessLevel; label: string }[] = [
  { key: 'view', label: 'View' },
  { key: 'create', label: 'Create / Add' },
  { key: 'edit', label: 'Update / Edit' },
  { key: 'delete', label: 'Remove / Delete' },
];

export interface AccessModuleRow { key: string; label: string; enabledForTenant: boolean; roleAccess: AccessLevel[] }

/** The selection after toggling `level`: create, edit and delete need view; removing view removes all. */
export function toggleLevel(current: AccessLevel[], level: AccessLevel, row: AccessModuleRow): AccessLevel[] {
  const next = new Set(current);
  if (next.has(level)) {
    next.delete(level);
    if (level === 'view') next.clear();
  } else {
    next.add(level);
    next.add('view');
  }
  return ACCESS_LEVEL_LABELS.map((l) => l.key).filter((l) => next.has(l) && row.roleAccess.includes(l));
}

/** What to send: only the modules narrowed below the role; null when none is. */
export function maskFromSelection(
  rows: AccessModuleRow[],
  selectionOf: (key: string) => AccessLevel[],
): Record<string, AccessLevel[]> | null {
  let mask: Record<string, AccessLevel[]> | null = null;
  for (const m of rows) {
    const selected = selectionOf(m.key);
    if (selected.length !== m.roleAccess.length) (mask ??= {})[m.key] = selected;
  }
  return mask;
}

interface Props {
  rows: AccessModuleRow[];
  tenantName: string;
  roleName: string;
  selectionOf: (key: string) => AccessLevel[];
  onToggle: (row: AccessModuleRow, level: AccessLevel) => void;
}

export default function ModuleAccessGrid({ rows, tenantName, roleName, selectionOf, onToggle }: Props) {
  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)]">
      <table className="w-full text-sm">
        <thead className="bg-[var(--bg-surface-hover)]">
          <tr>
            <th className="px-4 py-2.5 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Module</th>
            {ACCESS_LEVEL_LABELS.map((l) => (
              <th key={l.key} className="px-3 py-2.5 text-center text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide whitespace-nowrap">{l.label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border-subtle)]">
          {rows.map((m) => {
            const selected = selectionOf(m.key);
            const why = !m.enabledForTenant
              ? `${tenantName} does not have this module`
              : m.roleAccess.length === 0
                ? `The ${roleName} role does not include ${m.label}`
                : null;
            return (
              <tr key={m.key}>
                <td className="px-4 py-2.5">
                  <div className={`font-medium ${m.roleAccess.length && m.enabledForTenant ? 'text-[var(--text-main)]' : 'text-[var(--text-muted)]'}`}>{m.label}</div>
                  {why && <div className="text-xs text-amber-500 mt-0.5">{why}</div>}
                </td>
                {ACCESS_LEVEL_LABELS.map((l) => {
                  const granted = m.enabledForTenant && m.roleAccess.includes(l.key);
                  return (
                    <td key={l.key} className="px-3 py-2.5 text-center">
                      <input
                        type="checkbox"
                        aria-label={`${m.label}: ${l.label}`}
                        className="w-4 h-4 accent-violet-600 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                        disabled={!granted}
                        checked={granted && selected.includes(l.key)}
                        onChange={() => onToggle(m, l.key)}
                        title={granted ? undefined : (why ?? `The role does not allow ${l.label.toLowerCase()} in ${m.label}`)}
                      />
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
