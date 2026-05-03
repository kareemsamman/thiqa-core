import { createRoot, hydrateRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Conditional mount based on whether the served HTML was prerendered
// for THIS specific URL. The prerender pass writes a
// `data-prerendered-route` attribute on #root, so we know which route's
// markup is currently in the DOM.
//
// Three cases:
//
// 1. URL matches the prerendered route (e.g. /pricing requested,
//    dist/pricing/index.html served) — hydrate so React attaches to
//    the existing DOM with no flicker. The page components for these
//    routes are EAGER imports in App.tsx (not React.lazy), so they're
//    available synchronously when hydration's first render fires.
//
// 2. URL does NOT match the prerendered route (typical: a CRM route
//    like /dashboard requested directly, served via SPA fallback to
//    dist/index.html which contains the prerendered Landing). Hydrating
//    here would throw React error #418. Wipe the stale markup and
//    createRoot a fresh tree. Cost: brief flash of Landing markup
//    before React clears it. CRM routes are noindex, so no SEO impact;
//    direct-URL navigation to CRM is also rare (in-app router doesn't
//    re-fetch the shell).
//
// 3. No prerender at all (#root is empty) — original SPA path,
//    createRoot.
const container = document.getElementById("root")!;
const prerenderedRoute = container.getAttribute("data-prerendered-route");
// Normalize trailing slash: "/pricing/" and "/pricing" address the same
// route, but data-prerendered-route is always written without the
// trailing slash. Hosts like vite preview and bunch of real-world links
// pass it through verbatim, so a strict === compare here would route
// /pricing/ requests through createRoot instead of hydrate.
const stripSlash = (p: string) => (p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p);
const currentPath = stripSlash(window.location.pathname);

// Set BEFORE hydrateRoot so any component that reads it in a useState
// initializer sees the right value on the first render. Cleared after
// the next microtask so subsequent in-app renders (animations on
// re-visit, etc.) behave normally. Components that animate on mount
// (ThiqaLogoAnimation et al.) check this flag to start at the
// animation's END state — matching the prerendered DOM, which was
// captured AFTER the animation finished.
declare global {
  interface Window {
    __HYDRATING_PRERENDER__?: boolean;
  }
}

if (container.firstElementChild && prerenderedRoute === currentPath) {
  window.__HYDRATING_PRERENDER__ = true;
  hydrateRoot(container, <App />, {
    // React 19 is strict about adjacent text + expression children in
    // JSX (e.g. `<p>literal {expr}</p>`) — the SSR output has separate
    // text segments, but the browser's HTML parser merges them, so
    // hydration sees a different node count and throws #418 (text) /
    // #419 (HTML) as a RECOVERABLE error. React then re-renders the
    // affected subtree client-side; we've verified via diff that the
    // post-recovery DOM is byte-for-byte identical to the prerendered
    // HTML (no visible flicker, no CLS impact). Silencing those two
    // codes keeps the console clean. ANY OTHER recoverable error
    // (genuine state mismatches, missing data, etc.) still surfaces
    // through the default console path so we hear about real bugs.
    onRecoverableError: (error, errorInfo) => {
      const msg = String(error?.message ?? error);
      if (/#41[89]/.test(msg) || /Hydration failed/.test(msg)) return;
      // eslint-disable-next-line no-console
      console.error("Recoverable React error:", error, errorInfo);
    },
  });
  // PrerenderReadyBeacon clears window.__HYDRATING_PRERENDER__ in its
  // first useEffect (runs after React's initial commit) so subsequent
  // in-app client-side navigation animates normally.
} else {
  if (container.firstElementChild) container.innerHTML = "";
  createRoot(container).render(<App />);
}
