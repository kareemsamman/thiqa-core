import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  status: 'pending' | 'active' | 'blocked' | 'plan_locked';
  avatar_url: string | null;
  branch_id: string | null;
  agent_id: string | null;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  loading: boolean;
  profileLoading: boolean;
  isActive: boolean;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  branchId: string | null;
  branchName: string | null;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const SESSION_KEY = 'admin_session_active';
const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [branchName, setBranchName] = useState<string | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  const fetchUserProfile = async (userId: string, userEmail: string | undefined) => {
    setProfileLoading(true);
    try {
      // Check super admin FIRST — before profile, so it works even if profile doesn't exist
      const { data: saData } = await supabase
        .from('thiqa_super_admins')
        .select('email')
        .eq('email', (userEmail || '').toLowerCase())
        .maybeSingle();
      const isSuperAdminUser = !!saData;
      setIsSuperAdmin(isSuperAdminUser);

      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (profileError) {
        console.error('Error fetching profile:', profileError);
        // Even without a profile, super admin should still work
        if (isSuperAdminUser) {
          setIsAdmin(true);
        }
        setProfileLoading(false);
        return null;
      }

      if (isSuperAdminUser) {
        // Super admin is always admin
        setIsAdmin(true);
      } else {
        // Check role in database for other users
        const { data: roleData } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', userId)
          .eq('role', 'admin')
          .limit(1)
          .maybeSingle();

        setIsAdmin(!!roleData);
      }

      // Fetch branch name if user has a branch
      if (profileData.branch_id) {
        const { data: branchData } = await supabase
          .from('branches')
          .select('name_ar, name')
          .eq('id', profileData.branch_id)
          .single();
        
        if (branchData) {
          setBranchName(branchData.name_ar || branchData.name);
        }
      } else {
        setBranchName(null);
      }

      setProfileLoading(false);
      return profileData as UserProfile;
    } catch (error) {
      console.error('Error in fetchUserProfile:', error);
      setProfileLoading(false);
      return null;
    }
  };

  const signOut = async () => {
    // Close the active user_sessions row before auth clears, so the
    // Sessions tab doesn't keep showing the user as active. Must run
    // while the JWT is still valid (UPDATE policy keys on auth.uid()).
    const sessionId = sessionStorage.getItem("current_session_id");
    if (sessionId) {
      try {
        await supabase
          .from("user_sessions")
          .update({ ended_at: new Date().toISOString(), is_active: false })
          .eq("id", sessionId);
      } catch (e) {
        console.warn("failed to end user_session on sign out", e);
      }
      sessionStorage.removeItem("current_session_id");
    }

    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
    setIsAdmin(false);
    setIsSuperAdmin(false);
    setBranchName(null);
  };

  const refreshProfile = async () => {
    if (!user) {
      setProfile(null);
      setIsAdmin(false);
      setIsSuperAdmin(false);
      setBranchName(null);
      return;
    }

    const p = await fetchUserProfile(user.id, user.email);
    setProfile(p);
  };

  useEffect(() => {
    let isMounted = true;
    // Track which auth user we've already loaded the profile for. Used
    // to suppress the redundant profile refetch that supabase fires on
    // every TOKEN_REFRESHED — those events arrive whenever the tab
    // regains visibility (or every ~1h on a long-lived tab) and have
    // the same user.id we already have in state. Without this guard,
    // every Alt-Tab back into the app sets profileLoading=true, every
    // dependent useEffect re-runs, in-flight forms get unmounted, and
    // the app flashes its loading screen while the user's local state
    // disappears.
    let loadedUserId: string | null = null;

    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!isMounted) return;

        const nextUser = session?.user ?? null;
        const sameUser = nextUser?.id && nextUser.id === loadedUserId;

        // Always keep session fresh (the access_token rotated) but
        // only swap out the user object reference when identity
        // actually changed. Holding a stable reference keeps every
        // downstream useEffect that depends on `user` from re-running
        // on token refreshes.
        setSession(session);
        if (!sameUser) {
          setUser(nextUser);
        }

        if (nextUser && (event === 'SIGNED_IN' || event === 'PASSWORD_RECOVERY')) {
          sessionStorage.setItem(SESSION_KEY, 'true');
        }

        // Same user re-entering via any auth event: profile, role,
        // branch, etc. are already in state. Skip the refetch.
        //
        // Supabase fires SIGNED_IN, TOKEN_REFRESHED, INITIAL_SESSION,
        // and USER_UPDATED whenever the tab regains visibility or the
        // access token rotates — all carrying the user we already
        // have. The previous guard only short-circuited TOKEN_REFRESHED,
        // so a SIGNED_IN on tab return still flipped profileLoading=true,
        // which made ThiqaAdminRoute / ProtectedRoute swap the current
        // page out for a Loader2 spinner. That unmount-remount cycle
        // re-ran every page's fetchAll() and silently wiped any form
        // input the user hadn't saved yet. PASSWORD_RECOVERY is left
        // out of the skip on purpose so the recovery flow can still
        // refresh the profile if needed.
        if (sameUser && event !== 'PASSWORD_RECOVERY') {
          setLoading(false);
          return;
        }

        if (nextUser) {
          loadedUserId = nextUser.id;
          // Defer profile fetch with setTimeout to avoid deadlock
          setTimeout(() => {
            if (isMounted) {
              fetchUserProfile(nextUser.id, nextUser.email).then(p => {
                if (isMounted) setProfile(p);
              });
            }
          }, 0);
        } else {
          loadedUserId = null;
          setProfile(null);
          setIsAdmin(false);
          setIsSuperAdmin(false);
          setBranchName(null);
          setProfileLoading(false);
        }

        setLoading(false);
      }
    );

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!isMounted) return;

      setSession(session);
      setUser(session?.user ?? null);

      if (session?.user) {
        loadedUserId = session.user.id;
        fetchUserProfile(session.user.id, session.user.email).then(p => {
          if (isMounted) setProfile(p);
        });
      } else {
        setProfileLoading(false);
      }

      setLoading(false);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // Admin session guard - force logout for non-super admins on new browser session
  useEffect(() => {
    const isNonSuperAdmin = !isSuperAdmin && isAdmin;
    
    if (!user || !isNonSuperAdmin) {
      return;
    }

    const wasActive = sessionStorage.getItem(SESSION_KEY);
    
    if (!wasActive) {
      // This is a new browser session after browser was closed - force logout
      console.log('[AdminSessionGuard] New browser session detected for admin, forcing logout');
      supabase.auth.signOut().then(() => {
        window.location.href = '/login';
      });
      return;
    }

    // Keep session flag active
    sessionStorage.setItem(SESSION_KEY, 'true');
  }, [user, isAdmin, isSuperAdmin]);

  // CRITICAL: Super admin and admins bypass status checks entirely
  // Order: super admin → admin → active status
  const isActive = isSuperAdmin || isAdmin || profile?.status === 'active';

  // User's branch - admins can see all, workers only their branch
  const branchId = profile?.branch_id || null;

  return (
    <AuthContext.Provider value={{
      user,
      session,
      profile,
      loading,
      profileLoading,
      isActive,
      isAdmin: isAdmin || isSuperAdmin,
      isSuperAdmin,
      branchId,
      branchName,
      signOut,
      refreshProfile,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
