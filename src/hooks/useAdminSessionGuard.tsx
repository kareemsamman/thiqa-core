import { useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

const SUPER_ADMIN_EMAIL = 'morshed500@gmail.com';
const SESSION_KEY = 'admin_session_active';

interface UseAdminSessionGuardProps {
  userEmail: string | null | undefined;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  isAuthenticated: boolean;
}

/**
 * Hook that enforces session expiration for admins (except super admin)
 * when the browser is closed.
 * 
 * Uses sessionStorage which is automatically cleared when browser closes,
 * while localStorage (where Supabase stores auth) persists.
 */
export function useAdminSessionGuard({
  userEmail,
  isAdmin,
  isSuperAdmin,
  isAuthenticated,
}: UseAdminSessionGuardProps) {
  
  const shouldEnforceSessionTimeout = useCallback(() => {
    // Only enforce for admins who are NOT super admin
    return isAuthenticated && isAdmin && !isSuperAdmin && userEmail !== SUPER_ADMIN_EMAIL;
  }, [isAuthenticated, isAdmin, isSuperAdmin, userEmail]);

  useEffect(() => {
    // Only run for non-super admins
    if (!shouldEnforceSessionTimeout()) {
      return;
    }

    // Check if this is a new browser session (sessionStorage was cleared)
    const wasActive = sessionStorage.getItem(SESSION_KEY);
    
    if (!wasActive) {
      // This is a new browser session after browser was closed
      // Force logout
      console.log('[AdminSessionGuard] New browser session detected for admin, forcing logout');
      (supabase.auth as any).signOut().then(() => {
        window.location.href = '/login';
      });
      return;
    }

    // Set flag to indicate active session
    sessionStorage.setItem(SESSION_KEY, 'true');

    // No need for beforeunload handler - sessionStorage is automatically
    // cleared when the browser closes

  }, [shouldEnforceSessionTimeout]);

  // Function to mark session as active (called after successful login)
  const markSessionActive = useCallback(() => {
    if (shouldEnforceSessionTimeout()) {
      sessionStorage.setItem(SESSION_KEY, 'true');
    }
  }, [shouldEnforceSessionTimeout]);

  return { markSessionActive };
}

/**
 * Call this after successful admin login to set the session flag
 */
export function setAdminSessionActive() {
  sessionStorage.setItem(SESSION_KEY, 'true');
}
