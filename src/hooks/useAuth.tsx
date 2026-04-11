import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  status: 'pending' | 'active' | 'blocked';
  avatar_url: string | null;
  branch_id: string | null;
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
    
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!isMounted) return;

        setSession(session);
        setUser(session?.user ?? null);

        // Defer profile fetch with setTimeout to avoid deadlock
        if (session?.user) {
          setTimeout(() => {
            if (isMounted) {
              fetchUserProfile(session.user.id, session.user.email).then(p => {
                if (isMounted) setProfile(p);
              });
            }
          }, 0);
        } else {
          setProfile(null);
          setIsAdmin(false);
          setIsSuperAdmin(false);
          setBranchName(null);
          setProfileLoading(false);

          // Force redirect to login on sign-out (handles cross-tab logout)
          if (event === 'SIGNED_OUT' && window.location.pathname !== '/login' && window.location.pathname !== '/verify-email' && window.location.pathname !== '/forgot-password') {
            window.location.href = '/login';
          }
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
