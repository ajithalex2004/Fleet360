'use client';

import { useEffect, useMemo, useState } from 'react';

export type DataTableColumn<Key extends string> = {
  key: Key;
  label: string;
  visible: boolean;
  width?: number;
};

const DEFAULT_COLUMN_WIDTH = 180;
const MIN_COLUMN_WIDTH = 120;
const MAX_COLUMN_WIDTH = 420;

export function useDataTableColumns<Key extends string>(
  storageKey: string,
  defaults: DataTableColumn<Key>[],
) {
  const [columns, setColumns] = useState<DataTableColumn<Key>[]>(defaults);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Array<{ key: Key; visible: boolean; width?: number }>;
      if (!Array.isArray(parsed)) return;

      const next = parsed.reduce<DataTableColumn<Key>[]>((acc, saved) => {
          const match = defaults.find((column) => column.key === saved.key);
          if (match) {
            acc.push({
                ...match,
                visible: saved.visible,
                width:
                  typeof saved.width === 'number' && Number.isFinite(saved.width)
                    ? Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, saved.width))
                    : (match.width ?? DEFAULT_COLUMN_WIDTH),
              });
          }
          return acc;
        }, []);

      const missing = defaults
        .filter((column) => !next.some((savedColumn) => savedColumn.key === column.key))
        .map((column) => ({ ...column, width: column.width ?? DEFAULT_COLUMN_WIDTH }));
      if (next.length) {
        setColumns([...next, ...missing]);
      }
    } catch {
      // Ignore bad local state and keep defaults.
    }
  }, [defaults, storageKey]);

  useEffect(() => {
    try {
        window.localStorage.setItem(
        storageKey,
        JSON.stringify(
          columns.map((column) => ({
            key: column.key,
            visible: column.visible,
            width: column.width ?? DEFAULT_COLUMN_WIDTH,
          })),
        ),
      );
    } catch {
      // Ignore storage failures.
    }
  }, [columns, storageKey]);

  const visibleColumns = useMemo(
    () => columns.filter((column) => column.visible),
    [columns],
  );

  const toggleColumn = (key: Key) => {
    setColumns((prev) =>
      prev.map((column) =>
        column.key === key ? { ...column, visible: !column.visible, width: column.width ?? DEFAULT_COLUMN_WIDTH } : column,
      ),
    );
  };

  const moveColumn = (key: Key, direction: 'up' | 'down') => {
    setColumns((prev) => {
      const index = prev.findIndex((column) => column.key === key);
      if (index < 0) return prev;

      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;

      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  };

  const resizeColumn = (key: Key, delta: number) => {
    setColumns((prev) =>
      prev.map((column) =>
        column.key === key
          ? {
              ...column,
              width: Math.max(
                MIN_COLUMN_WIDTH,
                Math.min(MAX_COLUMN_WIDTH, (column.width ?? DEFAULT_COLUMN_WIDTH) + delta),
              ),
            }
          : column,
      ),
    );
  };

  const setColumnWidth = (key: Key, width: number) => {
    setColumns((prev) =>
      prev.map((column) =>
        column.key === key
          ? {
              ...column,
              width: Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, width)),
            }
          : column,
      ),
    );
  };

  const resetColumns = () =>
    setColumns(defaults.map((column) => ({ ...column, width: column.width ?? DEFAULT_COLUMN_WIDTH })));

  return {
    columns,
    visibleColumns,
    setColumns,
    toggleColumn,
    moveColumn,
    resizeColumn,
    setColumnWidth,
    resetColumns,
  };
}
