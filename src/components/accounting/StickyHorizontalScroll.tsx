import { forwardRef, ReactNode, useEffect, useRef, useState } from 'react';

/**
 * Wraps a horizontally-scrolling block with a *second* scrollbar
 * mounted directly above the content. The two scrollbars stay in
 * sync, so the user can drag either one to pan the table — useful
 * when a table is taller than the viewport and the bottom scrollbar
 * would otherwise be off-screen.
 *
 * The forwarded ref points at the bottom (real) scroll container so
 * the parent can drive `scrollBy` from external prev/next arrows and
 * read `scrollLeft / scrollWidth / clientWidth` for edge-state.
 */
export const StickyHorizontalScroll = forwardRef<HTMLDivElement, { children: ReactNode }>(
  function StickyHorizontalScroll({ children }, forwardedRef) {
    const topRef = useRef<HTMLDivElement>(null);
    const bottomRef = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);
    // Block the inverse-update echo when one scrollbar drives the other.
    const syncing = useRef(false);

    const setBottom = (el: HTMLDivElement | null) => {
      bottomRef.current = el;
      if (typeof forwardedRef === 'function') forwardedRef(el);
      else if (forwardedRef) forwardedRef.current = el;
    };

    useEffect(() => {
      const el = bottomRef.current;
      if (!el) return;
      const update = () => setWidth(el.scrollWidth);
      update();
      const obs = new ResizeObserver(update);
      obs.observe(el);
      // Also catch table-content changes (rows in / out, column toggles)
      // by observing direct children. cheap because the children change
      // infrequently relative to scroll events.
      Array.from(el.children).forEach((child) => obs.observe(child));
      return () => obs.disconnect();
    }, [children]);

    const syncFromTop = () => {
      if (syncing.current) return;
      syncing.current = true;
      if (bottomRef.current && topRef.current) {
        bottomRef.current.scrollLeft = topRef.current.scrollLeft;
      }
      requestAnimationFrame(() => {
        syncing.current = false;
      });
    };

    const syncFromBottom = () => {
      if (syncing.current) return;
      syncing.current = true;
      if (bottomRef.current && topRef.current) {
        topRef.current.scrollLeft = bottomRef.current.scrollLeft;
      }
      requestAnimationFrame(() => {
        syncing.current = false;
      });
    };

    return (
      <div className="relative">
        <div
          ref={topRef}
          onScroll={syncFromTop}
          className="overflow-x-auto overflow-y-hidden h-3 border-b bg-muted/30"
          aria-hidden
        >
          <div style={{ width, height: 1 }} />
        </div>
        <div ref={setBottom} onScroll={syncFromBottom} className="overflow-x-auto">
          {children}
        </div>
      </div>
    );
  },
);
