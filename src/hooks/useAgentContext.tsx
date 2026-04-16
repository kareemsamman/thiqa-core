import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

interface AgentInfo {
  id: string;
  name: string;
  name_ar: string | null;
  email: string;
  phone: string | null;
  logo_url: string | null;
  plan: string;
  subscription_status: string;
  subscription_expires_at: string | null;
  monthly_price: number | null;
  trial_ends_at: string | null;
  subscription_started_at: string | null;
  billing_cycle_day: number | null;
  pending_plan: string | null;
  cancelled_at: string | null;
}

interface AgentContextType {
  agentId: string | null;
  agent: AgentInfo | null;
  agentFeatures: Record<string, boolean>;
  loading: boolean;
  isSubscriptionActive: boolean;
  isSubscriptionPaused: boolean;
  isThiqaSuperAdmin: boolean;
  isImpersonating: boolean;
  impersonatedAgent: AgentInfo | null;
  hasFeature: (featureKey: string) => boolean;
  startImpersonation: (agentId: string) => void;
  stopImpersonation: () => void;
}

const AgentContext = createContext<AgentContextType | undefined>(undefined);

// Features that require explicit enablement by Thiqa admin (default: off)
const ADMIN_ONLY_FEATURES = ['visa_payment'];

const BASIC_BLOCKED_FEATURES = [
  'sms',
  'financial_reports',
  'broker_wallet',
  'company_settlement',
  'cheques',
];

const IMPERSONATION_KEY = 'thiqa_impersonate_agent_id';

export function AgentProvider({ children }: { children: ReactNode }) {
  const { user, isSuperAdmin, loading: authLoading } = useAuth();
  const [agentId, setAgentId] = useState<string | null>(null);
  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [agentFeatures, setAgentFeatures] = useState<Record<string, boolean>>({});
  const [planDefaults, setPlanDefaults] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [impersonatedAgentId, setImpersonatedAgentId] = useState<string | null>(
    () => sessionStorage.getItem(IMPERSONATION_KEY)
  );
  const [impersonatedAgent, setImpersonatedAgent] = useState<AgentInfo | null>(null);

  const isThiqaSuperAdmin = isSuperAdmin && !impersonatedAgentId;
  const isImpersonating = isSuperAdmin && !!impersonatedAgentId;

  const startImpersonation = useCallback((id: string) => {
    sessionStorage.setItem(IMPERSONATION_KEY, id);
    setImpersonatedAgentId(id);
  }, []);

  const stopImpersonation = useCallback(() => {
    sessionStorage.removeItem(IMPERSONATION_KEY);
    setImpersonatedAgentId(null);
    setImpersonatedAgent(null);
    setAgentId(null);
    setAgent(null);
    setAgentFeatures({});
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setAgentId(null);
      setAgent(null);
      setAgentFeatures({});
      setImpersonatedAgent(null);
      setLoading(false);
      return;
    }

    // Super admin impersonating an agent
    if (isSuperAdmin && impersonatedAgentId) {
      const fetchImpersonatedAgent = async () => {
        setLoading(true);
        try {
          const { data: agentData } = await supabase
            .from('agents')
            .select('*')
            .eq('id', impersonatedAgentId)
            .single();

          if (agentData) {
            setAgent(agentData as AgentInfo);
            setImpersonatedAgent(agentData as AgentInfo);
            setAgentId(impersonatedAgentId);
          }

          const { data: flags } = await supabase
            .from('agent_feature_flags')
            .select('feature_key, enabled')
            .eq('agent_id', impersonatedAgentId);

          const featureMap: Record<string, boolean> = {};
          if (flags) {
            flags.forEach((f: any) => {
              featureMap[f.feature_key] = f.enabled;
            });
          }
          setAgentFeatures(featureMap);
        } catch (error) {
          console.error('Error fetching impersonated agent:', error);
        } finally {
          setLoading(false);
        }
      };
      fetchImpersonatedAgent();
      return;
    }

    // Super admin without impersonation
    if (isSuperAdmin) {
      setLoading(false);
      return;
    }

    const fetchAgentContext = async () => {
      try {
        const { data: agentUser } = await supabase
          .from('agent_users')
          .select('agent_id')
          .eq('user_id', user.id)
          .single();

        if (!agentUser) {
          setLoading(false);
          return;
        }

        setAgentId(agentUser.agent_id);

        const { data: agentData } = await supabase
          .from('agents')
          .select('*')
          .eq('id', agentUser.agent_id)
          .single();

        if (agentData) {
          setAgent(agentData as AgentInfo);

          // Fetch plan default features
          const { data: planData } = await supabase
            .from('subscription_plans')
            .select('features')
            .eq('plan_key', agentData.plan)
            .eq('is_active', true)
            .maybeSingle();

          if (planData?.features) {
            const df = typeof planData.features === 'string'
              ? JSON.parse(planData.features)
              : planData.features;
            setPlanDefaults(df || {});
          }
        }

        const { data: flags } = await supabase
          .from('agent_feature_flags')
          .select('feature_key, enabled')
          .eq('agent_id', agentUser.agent_id);

        const featureMap: Record<string, boolean> = {};
        if (flags) {
          flags.forEach((f: any) => {
            featureMap[f.feature_key] = f.enabled;
          });
        }
        setAgentFeatures(featureMap);
      } catch (error) {
        console.error('Error fetching agent context:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchAgentContext();
  }, [user, authLoading, isSuperAdmin, impersonatedAgentId]);

  const subscriptionStatus = agent?.subscription_status;
  const isTrial = subscriptionStatus === 'trial';
  const trialEndsAt = agent?.trial_ends_at ? new Date(agent.trial_ends_at) : null;
  const expiresAt = agent?.subscription_expires_at ? new Date(agent.subscription_expires_at) : null;
  const now = new Date();

  const isSubscriptionActive = isThiqaSuperAdmin || isImpersonating || !agent ||
    (subscriptionStatus === 'trial' && trialEndsAt && trialEndsAt > now) ||
    (subscriptionStatus === 'active' && (!expiresAt || expiresAt > now));
  const isSubscriptionPaused = subscriptionStatus === 'paused' || subscriptionStatus === 'suspended';

  const hasFeature = (featureKey: string): boolean => {
    // Admin-gated features (e.g. visa_payment) are never auto-unlocked by
    // super-admin, impersonation, trial, or plan defaults — the Thiqa
    // admin has to explicitly flip the bit for the agent in
    // agent_features. Check this FIRST so every other shortcut below
    // can't bypass it.
    if (ADMIN_ONLY_FEATURES.includes(featureKey)) {
      if (featureKey in agentFeatures) return agentFeatures[featureKey];
      return false;
    }

    if (isThiqaSuperAdmin || isImpersonating) return true;
    if (!agent) return true;

    // Trial: all non-admin-gated features enabled
    if (isTrial) return true;

    // Explicit agent-level override from Thiqa admin takes priority
    if (featureKey in agentFeatures) return agentFeatures[featureKey];

    // Use plan default features if available
    if (featureKey in planDefaults) return planDefaults[featureKey];

    // Legacy fallback
    if (agent.plan === 'pro') return true;
    if (BASIC_BLOCKED_FEATURES.includes(featureKey)) return false;
    return true;
  };

  return (
    <AgentContext.Provider value={{
      agentId,
      agent,
      agentFeatures,
      loading,
      isSubscriptionActive,
      isSubscriptionPaused,
      isThiqaSuperAdmin,
      isImpersonating,
      impersonatedAgent,
      hasFeature,
      startImpersonation,
      stopImpersonation,
    }}>
      {children}
    </AgentContext.Provider>
  );
}

export function useAgentContext() {
  const context = useContext(AgentContext);
  if (context === undefined) {
    throw new Error('useAgentContext must be used within an AgentProvider');
  }
  return context;
}
