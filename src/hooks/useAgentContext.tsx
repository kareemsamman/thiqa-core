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
  billing_cycle: 'monthly' | 'yearly' | null;
  pending_plan: string | null;
  cancelled_at: string | null;
  default_employee_permissions: Record<string, boolean> | null;
}

// Plan limits + metadata for the agent's current plan. Loaded from
// subscription_plans row keyed by agents.plan. A NULL limit column
// means unlimited.
export interface PlanInfo {
  plan_key: string;
  name: string;
  name_ar: string | null;
  badge: string | null;
  monthly_price: number;
  yearly_price: number | null;
  users_limit: number | null;
  branches_limit: number | null;
  policies_limit: number | null;
  sms_limit: number;
  marketing_sms_limit: number;
  ai_limit: number;
  support_sla_hours: number;
  default_features: Record<string, boolean>;
}

interface AgentContextType {
  agentId: string | null;
  agent: AgentInfo | null;
  planInfo: PlanInfo | null;
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
  /** Force a refetch of agent + plan + feature flags. Realtime channels
   *  pick up UPDATEs automatically, but flows that *insert* the agent
   *  (e.g. fresh OAuth signup) need to call this manually so the
   *  PermissionRoute / Sidebar see the new tenant without a hard
   *  refresh. */
  refetchAgentContext: () => Promise<void>;
}

const AgentContext = createContext<AgentContextType | undefined>(undefined);

// Features that require explicit enablement by Thiqa admin (default: off).
// These bypass every permissive shortcut — trial, impersonation,
// plan defaults — so the Thiqa team has to flip the bit manually.
const ADMIN_ONLY_FEATURES = ['visa_payment'];

const IMPERSONATION_KEY = 'thiqa_impersonate_agent_id';

export function AgentProvider({ children }: { children: ReactNode }) {
  const { user, isSuperAdmin, loading: authLoading } = useAuth();
  const [agentId, setAgentId] = useState<string | null>(null);
  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [agentFeatures, setAgentFeatures] = useState<Record<string, boolean>>({});
  const [planInfo, setPlanInfo] = useState<PlanInfo | null>(null);
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
    setPlanInfo(null);
  }, []);

  // Shared loader — fetches agent + plan + feature flags for a given
  // agent_id. Used by both the "I'm an agent user" path and the
  // "I'm a super admin impersonating an agent" path so the behavior
  // lines up between them. Hoisted out of the effect so the realtime
  // subscription below can re-invoke it when Thiqa admin edits the
  // agent's plan or toggles feature flags.
  const loadAgentContext = useCallback(
    async (loadAgentId: string, isImpersonation: boolean) => {
      try {
        const { data: agentData } = await supabase
          .from('agents')
          .select('*')
          .eq('id', loadAgentId)
          .single();

        if (agentData) {
          setAgent(agentData as AgentInfo);
          if (isImpersonation) {
            setImpersonatedAgent(agentData as AgentInfo);
          }
          setAgentId(loadAgentId);

          // Pull the plan row with every pricing-related field so the
          // agent-side UI can show limits, show the Arabic name in the
          // badge, and the upgrade popup has everything it needs.
          const { data: planRow } = await supabase
            .from('subscription_plans')
            .select('plan_key, name, name_ar, badge, monthly_price, yearly_price, users_limit, branches_limit, policies_limit, sms_limit, marketing_sms_limit, ai_limit, support_sla_hours, default_features')
            .eq('plan_key', agentData.plan)
            .eq('is_active', true)
            .maybeSingle();

          if (planRow) {
            const rawDefaults = planRow.default_features as unknown;
            const defaults =
              typeof rawDefaults === 'string'
                ? JSON.parse(rawDefaults)
                : (rawDefaults as Record<string, boolean> | null) ?? {};
            setPlanInfo({
              plan_key: planRow.plan_key,
              name: planRow.name,
              name_ar: planRow.name_ar,
              badge: planRow.badge,
              monthly_price: Number(planRow.monthly_price),
              yearly_price: planRow.yearly_price !== null ? Number(planRow.yearly_price) : null,
              users_limit: planRow.users_limit,
              branches_limit: planRow.branches_limit,
              policies_limit: planRow.policies_limit,
              sms_limit: planRow.sms_limit,
              marketing_sms_limit: planRow.marketing_sms_limit,
              ai_limit: planRow.ai_limit,
              support_sla_hours: planRow.support_sla_hours,
              default_features: defaults,
            });
          } else {
            setPlanInfo(null);
          }
        }

        const { data: flags } = await supabase
          .from('agent_feature_flags')
          .select('feature_key, enabled')
          .eq('agent_id', loadAgentId);

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
    },
    [],
  );

  // Resolves the current user's agent_id then primes the full agent
  // context. Exposed via `refetchAgentContext` below so signup flows
  // that *insert* the tenant (Google OAuth) can prime React state
  // instead of waiting for the realtime channels (UPDATE-only) or a
  // hard refresh.
  const fetchForAgentUser = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data: agentUser } = await supabase
      .from('agent_users')
      .select('agent_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!agentUser) {
      setLoading(false);
      return;
    }
    await loadAgentContext(agentUser.agent_id, false);
  }, [user, loadAgentContext]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setAgentId(null);
      setAgent(null);
      setAgentFeatures({});
      setPlanInfo(null);
      setImpersonatedAgent(null);
      setLoading(false);
      return;
    }

    // Super admin impersonating an agent
    if (isSuperAdmin && impersonatedAgentId) {
      setLoading(true);
      loadAgentContext(impersonatedAgentId, true);
      return;
    }

    // Super admin without impersonation — no agent context
    if (isSuperAdmin) {
      setLoading(false);
      return;
    }

    // Regular agent user
    fetchForAgentUser();
  }, [user, authLoading, isSuperAdmin, impersonatedAgentId, loadAgentContext, fetchForAgentUser]);

  // Live-refresh agent context whenever Thiqa admin edits the plan,
  // the agent's row, or the agent's per-feature overrides. Without
  // this the browser caches planInfo.default_features at login and
  // toggles in /thiqa/settings don't take effect until a hard refresh.
  useEffect(() => {
    if (!agentId || !agent?.plan) return;
    const isImpersonation = isSuperAdmin && !!impersonatedAgentId;
    const refetch = () => { loadAgentContext(agentId, isImpersonation); };
    const channel = supabase
      .channel(`agent-context-${agentId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'subscription_plans', filter: `plan_key=eq.${agent.plan}` },
        refetch,
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'agents', filter: `id=eq.${agentId}` },
        refetch,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'agent_feature_flags', filter: `agent_id=eq.${agentId}` },
        refetch,
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [agentId, agent?.plan, isSuperAdmin, impersonatedAgentId, loadAgentContext]);

  const subscriptionStatus = agent?.subscription_status;
  const isTrial = subscriptionStatus === 'trial';
  const trialEndsAt = agent?.trial_ends_at ? new Date(agent.trial_ends_at) : null;
  const expiresAt = agent?.subscription_expires_at ? new Date(agent.subscription_expires_at) : null;
  const now = new Date();

  // Super admin bypass is gated by `!isImpersonating` so that when a
  // Thiqa super admin enters impersonation mode this flag reflects the
  // AGENT's real state — that's what makes the trial-expired / unpaid
  // lockout testable from the Thiqa admin without logging in as the
  // agent in a separate browser. Outside impersonation the super admin
  // still bypasses (they live in /thiqa anyway).
  const isSubscriptionActive = (isThiqaSuperAdmin && !isImpersonating) || !agent ||
    (subscriptionStatus === 'trial' && trialEndsAt && trialEndsAt > now) ||
    (subscriptionStatus === 'active' && (!expiresAt || expiresAt > now));
  const isSubscriptionPaused = subscriptionStatus === 'paused' || subscriptionStatus === 'suspended';

  const hasFeature = (featureKey: string): boolean => {
    // Admin-gated features (e.g. visa_payment) are never auto-unlocked
    // by super-admin, impersonation, trial, or plan defaults — Thiqa
    // has to flip the bit manually in agent_feature_flags. Check this
    // FIRST so every other shortcut below can't bypass it.
    if (ADMIN_ONLY_FEATURES.includes(featureKey)) {
      if (featureKey in agentFeatures) return agentFeatures[featureKey];
      return false;
    }

    // Treat the loading window as "feature unknown → locked" so the
    // sidebar, notifications bell, etc. don't render briefly as
    // unlocked before the real plan data arrives. Without this gate
    // the agent row below hasn't loaded yet, !agent shortcut kicks in
    // and every feature reads as available for a frame or two.
    if (loading) return false;

    if (isThiqaSuperAdmin || isImpersonating) return true;
    if (!agent) return true;

    // NB: trial no longer auto-unlocks every feature. Trial is now its
    // own plan (`free_trial`) with explicit default_features set by
    // Thiqa admin, so trial agents honor the same default_features →
    // agent_feature_flags pipeline as paid agents.

    // Explicit agent-level override takes priority over plan defaults.
    if (featureKey in agentFeatures) return agentFeatures[featureKey];

    // Plan defaults (Ultimate enables everything, Entry enables
    // nothing, Basic/Professional are in between).
    const defaults = planInfo?.default_features ?? {};
    if (featureKey in defaults) return defaults[featureKey];

    // Fall through: feature not declared by any plan → treat as off.
    // The sidebar / route guard will hide it.
    return false;
  };

  return (
    <AgentContext.Provider value={{
      agentId,
      agent,
      planInfo,
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
      refetchAgentContext: fetchForAgentUser,
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
