import { useEffect, useRef } from 'react';
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
  const { user } = useAuth();
  const sessionIdRef = useRef<string | null>(null);
  const startedRef = useRef(false);
  const heartbeatRef = useRef<number | null>(null);

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

        const { data, error } = await (supabase
          .from('user_sessions') as any)
          .insert({
            user_id: user.id,
            user_agent: ua,
            browser_name: browserName,
            browser_version: browserVersion,
            os_name: osName,
            device_type: deviceType,
            ip_address: ipAddress,
            is_active: true,
          })
          .select('id')
          .single();

        if (error) {
          console.error('Failed to start session:', error);
          return;
        }

        if (data) {
          sessionIdRef.current = data.id;
          // Store in sessionStorage for recovery
          sessionStorage.setItem('current_session_id', data.id);
        }
      } catch (err) {
        console.error('Session start error:', err);
      }
    };

    // Ping last_seen_at so the UI can tell this tab is still alive.
    // Admins viewing /admin/users treat any session without a recent
    // heartbeat as stale and hide the "نشط حالياً" badge.
    const startHeartbeat = () => {
      if (heartbeatRef.current) window.clearInterval(heartbeatRef.current);
      heartbeatRef.current = window.setInterval(async () => {
        const id = sessionIdRef.current || sessionStorage.getItem('current_session_id');
        if (!id) return;
        try {
          await (supabase.from('user_sessions') as any)
            .update({ last_seen_at: new Date().toISOString() })
            .eq('id', id);
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
  }, [user]);

  return sessionIdRef.current;
}
