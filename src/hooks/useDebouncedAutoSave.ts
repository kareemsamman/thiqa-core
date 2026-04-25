import { useCallback, useEffect, useRef } from 'react';

/**
 * Debounced auto-save. Pass a function `(rowId, patch) => Promise<void>`.
 * Call `schedule(rowId, patch)` and the patch will be merged with any
 * pending patch for the same row, then flushed after `delayMs`.
 */
export function useDebouncedAutoSave<T extends Record<string, unknown>>(
  save: (rowId: string, patch: Partial<T>) => Promise<void> | void,
  delayMs = 500,
) {
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const pendingRef = useRef<Map<string, Partial<T>>>(new Map());

  const flush = useCallback(
    async (rowId: string) => {
      const patch = pendingRef.current.get(rowId);
      pendingRef.current.delete(rowId);
      const timer = timersRef.current.get(rowId);
      if (timer) clearTimeout(timer);
      timersRef.current.delete(rowId);
      if (patch) {
        await save(rowId, patch);
      }
    },
    [save],
  );

  const schedule = useCallback(
    (rowId: string, patch: Partial<T>) => {
      const merged = { ...(pendingRef.current.get(rowId) ?? {}), ...patch };
      pendingRef.current.set(rowId, merged);
      const existing = timersRef.current.get(rowId);
      if (existing) clearTimeout(existing);
      const t = setTimeout(() => {
        flush(rowId);
      }, delayMs);
      timersRef.current.set(rowId, t);
    },
    [flush, delayMs],
  );

  useEffect(() => {
    // Capture the maps on mount; React's refs survive unmount cleanup,
    // and we want to drain whatever is still pending when this hook is
    // torn down. The lint rule wants this snapshot, not the .current.
    const timers = timersRef.current;
    const pendingMap = pendingRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      const pending = Array.from(pendingMap.entries());
      pendingMap.clear();
      timers.clear();
      pending.forEach(([rowId, patch]) => {
        // Fire-and-forget; React is tearing down the component anyway.
        void save(rowId, patch);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { schedule, flush };
}
