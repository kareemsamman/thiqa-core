import { useEffect } from "react";
import { useLocation } from "react-router-dom";

// Google Analytics for public marketing / auth / legal pages.
//
// Mounted inside <PublicSEO> so every page that opts into "I'm
// public" automatically gets gtag — and the CRM (which never mounts
// PublicSEO) never loads the analytics script. The first mount
// injects gtag.js into <head> exactly once; subsequent navigations
// only fire a page_view event.
//
// `send_page_view: false` on the initial config disables gtag's
// auto-pageview, so we control all tracking from React. On every
// pathname change while a public page is mounted, we fire a manual
// `page_view` event with the new path. Going CRM → public → CRM →
// public produces correct page_view events on each public arrival.

const GA_MEASUREMENT_ID = "G-RSBZKVXEDG";
const SCRIPT_ID = "gtag-loader";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

function ensureGtagInstalled() {
  if (typeof window === "undefined") return;
  if (window.gtag) return;
  if (document.getElementById(SCRIPT_ID)) return;

  const loader = document.createElement("script");
  loader.id = SCRIPT_ID;
  loader.async = true;
  loader.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  document.head.appendChild(loader);

  window.dataLayer = window.dataLayer || [];
  // Standard GA bootstrap. Note `arguments` is required (not rest
  // params) because gtag's queue protocol relies on the
  // arguments-array shape.
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  window.gtag("js", new Date());
  window.gtag("config", GA_MEASUREMENT_ID, { send_page_view: false });
}

export function PublicAnalytics() {
  const location = useLocation();

  useEffect(() => {
    ensureGtagInstalled();
  }, []);

  useEffect(() => {
    if (!window.gtag) return;
    const path = location.pathname + (location.search || "");
    window.gtag("event", "page_view", {
      page_path: path,
      page_location: window.location.href,
      page_title: document.title,
    });
  }, [location.pathname, location.search]);

  return null;
}
