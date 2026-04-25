import { useCallback, useEffect, useState } from 'react';

const STORAGE_PREFIX = 'thiqa-table-cols:';

export function useTableColumnVisibility(tableId: string, defaultVisible: string[]) {
  const storageKey = `${STORAGE_PREFIX}${tableId}`;

  const [visible, setVisible] = useState<string[]>(() => {
    if (typeof window === 'undefined') return defaultVisible;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return defaultVisible;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : defaultVisible;
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
