// Suspense fallback for lazy-loaded routes. Used by App.tsx's
// `lazyWithSuspense` wrapper so each code-split route renders this
// placeholder during the brief network fetch instead of a blank gap
// (which would cause CLS / layout jank).
//
// Why this and not a global <Suspense fallback={null}> around <Routes>:
// React 19 hydration is incompatible with a Suspense boundary that
// surrounds prerendered content — the boundary suspends on first
// render and produces the fallback even when the children are already
// in the DOM, triggering React error #418. Per-route Suspense lives
// INSIDE the lazy component itself, so eager prerendered routes don't
// have a Suspense boundary in their hydration path at all.
//
// The placeholder is intentionally minimal: a softly pulsing rounded
// rectangle that fills the available height and matches the muted
// surface color so the user sees an "in progress" hint rather than a
// hard blank flash. AppChrome (sidebar, top nav) stays mounted during
// the swap because it lives outside <Routes>, so the chrome doesn't
// flicker either.
export function RouteSkeleton() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6" dir="rtl">
      <div className="w-full max-w-3xl space-y-4">
        <div className="h-8 w-1/3 animate-pulse rounded-md bg-muted" />
        <div className="h-32 w-full animate-pulse rounded-xl bg-muted" />
        <div className="h-32 w-full animate-pulse rounded-xl bg-muted" />
      </div>
    </div>
  );
}
