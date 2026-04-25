import { useCallback, useEffect, useMemo, useState } from 'react';

const STORAGE_PREFIX = 'thiqa-table-cols:';

/**
 * localStorage-backed visible-column set for a table.
 *
 * `allKeys` (when provided) is the full list of keys the current
 * schema recognizes. We strip unknown keys from the saved set so a
 * column rename doesn't leave dead entries floating around. We never
 * auto-add keys back, which means an explicit uncheck always survives
 * reload — to add a brand-new column to existing users without
 * silently hiding it, the caller should bump the table id (e.g. v1 →
 * v2) so localStorage starts from defaults.
 */
export function useTableColumnVisibility(
  tableId: string,
  defaultVisible: string[],
  allKeys?: string[],
) {
  const storageKey = `${STORAGE_PREFIX}${tableId}`;
  const knownKeys = useMemo(
    () => new Set(allKeys ?? defaultVisible),
    [allKeys, defaultVisible],
  );

  const [visible, setVisible] = useState<string[]>(() => {
    if (typeof window === 'undefined') return defaultVisible;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return defaultVisible;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return defaultVisible;
      const cleaned = parsed.filter((k: unknown): k is string =>
        typeof k === 'string' && knownKeys.has(k),
      );
      // If saving stripped everything (very stale entry), fall back to
      // the defaults so the user isn't staring at an empty table.
      return cleaned.length > 0 ? cleaned : defaultVisible;
    } catch {
      return defaultVisible;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(visible));
    } catch {
      // ignore
    }
  }, [storageKey, visible]);

  const toggle = useCallback((col: string) => {
    setVisible((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col],
    );
  }, []);

  const isVisible = useCallback((col: string) => visible.includes(col), [visible]);

  const reset = useCallback(() => setVisible(defaultVisible), [defaultVisible]);

  return { visible, toggle, isVisible, reset, setVisible };
}
