import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

// Unique session ID per browser tab
const SESSION_ID = crypto.randomUUID();

export function trackEvent(
  eventType: string,
  page?: string,
  metadata?: Record<string, string | number | boolean>
) {
  supabase
    .from("site_analytics_events")
    .insert([{
      event_type: eventType,
      page: page || window.location.pathname,
      referrer: document.referrer || null,
      user_agent: navigator.userAgent,
      session_id: SESSION_ID,
      metadata: metadata || {},
    }])
    .then(() => {});
}

/** Track a page view once on mount */
export function usePageView(page: string) {
  const tracked = useRef(false);
  useEffect(() => {
    if (tracked.current) return;
    tracked.current = true;
    trackEvent("page_view", page);
  }, [page]);
}
