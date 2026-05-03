import { useEffect } from "react";
import { useIsFetching } from "@tanstack/react-query";

declare global {
  interface Window {
    __PRERENDER_READY__?: boolean;
    __HYDRATING_PRERENDER__?: boolean;
  }
}

// Beacon Puppeteer waits on during the build-time prerender pass. Flips
// window.__PRERENDER_READY__ to true once the React Query cache has
// settled (no in-flight queries) AND a short debounce has elapsed so
// react-helmet-async has a chance to commit head mutations.
//
// In the running browser this just sets a window flag and otherwise
// does nothing — it has no visible effect on real users.
export function PrerenderReadyBeacon() {
  const isFetching = useIsFetching();

  // Clear the prerender-hydration flag once React commits the first
  // render. main.tsx sets it to true synchronously before hydrateRoot
  // so prerender-aware components (ThiqaLogoAnimation et al.) start
  // at their END state on first render. After commit, in-app
  // navigation should animate normally — so we drop the flag here.
  useEffect(() => {
    if (window.__HYDRATING_PRERENDER__) {
      window.__HYDRATING_PRERENDER__ = false;
    }
  }, []);

  useEffect(() => {
    if (isFetching > 0) return;
    const t = setTimeout(() => {
      window.__PRERENDER_READY__ = true;
    }, 250);
    return () => clearTimeout(t);
  }, [isFetching]);
  return null;
}
