import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from './useAuth';
import { supabase } from '@/integrations/supabase/client';

// Parse User-Agent to extract browser/OS info
function parseUserAgent(ua: string) {
  // Browser detection
  let browserName = 'Unknown';
  let browserVersion = '';
  
  if (ua.includes('Edg/')) {
    browserName = 'Edge';
    browserVersion = ua.match(/Edg\/(\d+)/)?.[1] || '';
  } else if (ua.includes('Chrome/')) {
    browserName = 'Chrome';
    browserVersion = ua.match(/Chrome\/(\d+)/)?.[1] || '';
  } else if (ua.includes('Firefox/')) {
    browserName = 'Firefox';
    browserVersion = ua.match(/Firefox\/(\d+)/)?.[1] || '';
  } else if (ua.includes('Safari/') && !ua.includes('Chrome')) {
    browserName = 'Safari';
    browserVersion = ua.match(/Version\/(\d+)/)?.[1] || '';
  }

  // OS detection
  let osName = 'Unknown';
  if (ua.includes('Windows NT')) osName = 'Windows';
  else if (ua.includes('Mac OS')) osName = 'macOS';
  else if (ua.includes('Linux')) osName = 'Linux';
  else if (ua.includes('Android')) osName = 'Android';
  else if (ua.includes('iPhone') || ua.includes('iPad')) osName = 'iOS';

  // Device type
  let deviceType = 'desktop';
  if (ua.includes('Mobile') || ua.includes('Android')) deviceType = 'mobile';
  else if (ua.includes('iPad') || ua.includes('Tablet')) deviceType = 'tablet';

  return { browserName, browserVersion, osName, deviceType };
}

// Fetch client's public IP address
async function getClientIP(): Promise<string | null> {
  try {
    const response = await fetch('https://api.ipify.org?format=json');
    const data = await response.json();
    return data.ip || null;
  } catch {
    return null;
  }
}

const HEARTBEAT_INTERVAL_MS = 30_000;

export function useSessionTracker() {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const sessionIdRef = useRef<string | null>(null);
  const startedRef = useRef(false);
  const heartbeatRef = useRef<number | null>(null);
  const lastPathRef = useRef<string | null>(null);

  useEffect(() => {
    if (!user) {
      // Signed out — reset so the next sign-in spawns a new session
      // row instead of being skipped by the startedRef guard.
      startedRef.current = false;
      sessionIdRef.current = null;
      if (heartbeatRef.current) {
        window.clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      return;
    }
    if (startedRef.current) return;

    const startSession = async () => {
      try {
        startedRef.current = true;
        const ua = navigator.userAgent;
        const { browserName, browserVersion, osName, deviceType } = parseUserAgent(ua);

        // Fetch IP address
        const ipAddress = await getClientIP();

        // Delegate the insert to an edge function so RLS can't silently
        // drop the row and any agent_id / constraint failures surface as
        // real errors instead of being swallowed.
        const initialPath = `${location.pathname}${location.search || ''}`;
        const { data, error } = await supabase.functions.invoke('start-user-session', {
          body: {
            user_agent: ua,
            browser_name: browserName,
            browser_version: browserVersion,
            os_name: osName,
            device_type: deviceType,
            ip_address: ipAddress,
            current_path: initialPath,
          },
        });

        if (error) {
          console.error('Failed to start session:', error);
          return;
        }

        if (data?.id) {
          sessionIdRef.current = data.id;
          sessionStorage.setItem('current_session_id', data.id);
        }
      } catch (err) {
        console.error('Session start error:', err);
      }
    };

    // Ping last_seen_at so the UI can tell this tab is still alive.
    // Admins viewing /admin/users treat any session without a recent
    // heartbeat as stale and hide the "نشط حالياً" badge.
    //
    // The same call also reads back kicked_at. When an admin has hit
    // the "طرد" button on this session, that column is non-null and we
    // sign the user out on the next tick (≤30s lag) — no realtime
    // subscription required.
    const startHeartbeat = () => {
      if (heartbeatRef.current) window.clearInterval(heartbeatRef.current);
      heartbeatRef.current = window.setInterval(async () => {
        const id = sessionIdRef.current || sessionStorage.getItem('current_session_id');
        if (!id) return;
        try {
          const { data } = await (supabase.from('user_sessions') as any)
            .update({ last_seen_at: new Date().toISOString() })
            .eq('id', id)
            .select('kicked_at')
            .maybeSingle();
          if (data?.kicked_at) {
            if (heartbeatRef.current) {
              window.clearInterval(heartbeatRef.current);
              heartbeatRef.current = null;
            }
            sessionStorage.removeItem('current_session_id');
            await signOut();
          }
        } catch {
          // swallow — next tick will retry
        }
      }, HEARTBEAT_INTERVAL_MS);
    };

    // Check if there's an orphaned session from previous tab/window
    const orphanedSessionId = sessionStorage.getItem('current_session_id');
    if (orphanedSessionId) {
      sessionIdRef.current = orphanedSessionId;
      startedRef.current = true;
      startHeartbeat();
    } else {
      startSession().then(() => {
        if (sessionIdRef.current) startHeartbeat();
      });
    }

    // End session on page close/unload
    const endSession = () => {
      const sessionId = sessionIdRef.current || sessionStorage.getItem('current_session_id');
      if (!sessionId) return;

      // Use sendBeacon for reliable delivery on page unload
      const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/user_sessions?id=eq.${sessionId}`;
      const body = JSON.stringify({
        ended_at: new Date().toISOString(),
        is_active: false,
      });

      navigator.sendBeacon(
        url,
        new Blob([body], { type: 'application/json' })
      );

      sessionStorage.removeItem('current_session_id');
    };

    // Handle visibility change (for mobile browsers)
    const handleVisibilityChange = () => {
      // Just track visibility changes - no action needed since
      // we use beforeunload for ending sessions
    };

    window.addEventListener('beforeunload', endSession);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload', endSession);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (heartbeatRef.current) {
        window.clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
    };
  }, [user, signOut]);

  // Track the current route so admins can see "this worker is on /tasks".
  // Debounced-ish: we only PATCH when the path actually changes.
  useEffect(() => {
    if (!user) return;
    const path = `${location.pathname}${location.search || ''}`;
    if (lastPathRef.current === path) return;
    lastPathRef.current = path;

    const id = sessionIdRef.current || sessionStorage.getItem('current_session_id');
    if (!id) return;

    (async () => {
      try {
        await (supabase.from('user_sessions') as any)
          .update({ current_path: path })
          .eq('id', id);
      } catch {
        // non-critical — admin's next view will reflect the prior path
      }
    })();
  }, [user, location.pathname, location.search]);

  return sessionIdRef.current;
}
