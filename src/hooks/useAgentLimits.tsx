import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAgentContext } from './useAgentContext';

export interface ResourceLimit {
  used: number;
  planLimit: number | null;     // NULL = unlimited on plan column
  addonQuantity: number;         // sum of active matching addons
  effective: number | null;      // planLimit + addonQuantity (NULL if unlimited)
  remaining: number | null;      // effective - used (NULL if unlimited)
  exceeded: boolean;
}

export interface AgentLimits {
  loading: boolean;
  users: ResourceLimit;
  branches: ResourceLimit;
  policies: ResourceLimit;        // current period
  sms: ResourceLimit;             // current period
  marketingSms: ResourceLimit;    // current period
  ai: ResourceLimit;              // current period
  policyPeriod: 'monthly' | 'yearly' | 'lifetime';
  refetch: () => void;
}

const EMPTY: ResourceLimit = {
  used: 0,
  planLimit: null,
  addonQuantity: 0,
  effective: null,
  remaining: null,
  exceeded: false,
};

type AddonType =
  | 'extra_user'
  | 'extra_branch'
  | 'extra_sms'
  | 'extra_marketing_sms'
  | 'extra_ai';

function buildLimit(
  used: number,
  planLimit: number | null,
  addonQuantity: number,
): ResourceLimit {
  if (planLimit === null) {
    return { used, planLimit: null, addonQuantity, effective: null, remaining: null, exceeded: false };
  }
  const effective = planLimit + addonQuantity;
  return {
    used,
    planLimit,
    addonQuantity,
    effective,
    remaining: Math.max(0, effective - used),
    exceeded: used >= effective,
  };
}

/**
 * Resolves every quota (users/branches/policies/sms/marketing_sms/ai)
 * for the current agent. Drives the usage UI on /subscription and the
 * pre-flight check that opens the UpgradePromptDialog before an
 * action hits the DB trigger.
 */
export function useAgentLimits(): AgentLimits {
  const { agentId, planInfo } = useAgentContext();
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<ResourceLimit>(EMPTY);
  const [branches, setBranches] = useState<ResourceLimit>(EMPTY);
  const [policies, setPolicies] = useState<ResourceLimit>(EMPTY);
  const [sms, setSms] = useState<ResourceLimit>(EMPTY);
  const [marketingSms, setMarketingSms] = useState<ResourceLimit>(EMPTY);
  const [ai, setAi] = useState<ResourceLimit>(EMPTY);
  const [policyPeriod, setPolicyPeriod] =
    useState<'monthly' | 'yearly' | 'lifetime'>('monthly');
  const [refetchTick, setRefetchTick] = useState(0);

  useEffect(() => {
    if (!agentId || !planInfo) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    const run = async () => {
      setLoading(true);
      try {
        // 1. Active addon quantities, grouped by type
        const { data: addonRows } = await supabase
          .from('agent_addons')
          .select('addon_type, quantity')
          .eq('agent_id', agentId)
          .eq('status', 'active')
          .eq('billing_cycle', 'monthly')
          .lte('starts_at', new Date().toISOString().slice(0, 10))
          .or(`ends_at.is.null,ends_at.gte.${new Date().toISOString().slice(0, 10)}`);

        const addonQty: Record<AddonType, number> = {
          extra_user: 0,
          extra_branch: 0,
          extra_sms: 0,
          extra_marketing_sms: 0,
          extra_ai: 0,
        };
        (addonRows ?? []).forEach((r) => {
          const t = r.addon_type as AddonType;
          if (t in addonQty) addonQty[t] += r.quantity;
        });

        // 2. User count (profiles active/pending scoped to this agent)
        const { count: userCount } = await supabase
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('agent_id', agentId)
          .in('status', ['active', 'pending']);

        // 3. Branch count — only active consumes a seat; plan_locked
        // branches are parked over-limit rows, same treatment as
        // plan_locked profiles in the user count above.
        const { count: branchCount } = await supabase
          .from('branches')
          .select('id', { count: 'exact', head: true })
          .eq('agent_id', agentId)
          .eq('status', 'active');

        // 4. Policy period source + window
        const { data: periodRow } = await supabase
          .from('thiqa_platform_settings')
          .select('setting_value')
          .eq('setting_key', 'policy_limit_period')
          .maybeSingle();
        const period = (periodRow?.setting_value ?? 'monthly') as
          | 'monthly'
          | 'yearly'
          | 'lifetime';

        const periodStart =
          period === 'monthly'
            ? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
            : period === 'yearly'
            ? new Date(new Date().getFullYear(), 0, 1).toISOString()
            : new Date(0).toISOString();

        // 5. Policies count — COUNT DISTINCT COALESCE(group_id, id)
        // over the current period. Done client-side by fetching the
        // pair and counting distinct, which is cheap for any realistic
        // agent volume (caps at a few thousand rows).
        const { data: policyRows } = await supabase
          .from('policies')
          .select('id, group_id')
          .eq('agent_id', agentId)
          .gte('created_at', periodStart);

        const distinctTransactions = new Set(
          (policyRows ?? []).map((p) => p.group_id ?? p.id),
        );

        // 6. Usage log counts — sms/ai/marketing_sms for current month
        const thisMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
        const { data: usageRows } = await supabase
          .from('agent_usage_log')
          .select('usage_type, count')
          .eq('agent_id', agentId)
          .eq('period', thisMonth);

        const usageMap: Record<string, number> = {};
        (usageRows ?? []).forEach((u) => {
          usageMap[u.usage_type] = u.count;
        });

        if (cancelled) return;

        setPolicyPeriod(period);
        setUsers(buildLimit(userCount ?? 0, planInfo.users_limit, addonQty.extra_user));
        setBranches(
          buildLimit(branchCount ?? 0, planInfo.branches_limit, addonQty.extra_branch),
        );
        setPolicies(
          buildLimit(distinctTransactions.size, planInfo.policies_limit, 0),
        );
        setSms(buildLimit(usageMap.sms ?? 0, planInfo.sms_limit, addonQty.extra_sms));
        setMarketingSms(
          buildLimit(
            usageMap.marketing_sms ?? 0,
            planInfo.marketing_sms_limit,
            addonQty.extra_marketing_sms,
          ),
        );
        setAi(buildLimit(usageMap.ai_chat ?? 0, planInfo.ai_limit, addonQty.extra_ai));
      } catch (error) {
        console.error('Error loading agent limits:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [agentId, planInfo, refetchTick]);

  return {
    loading,
    users,
    branches,
    policies,
    sms,
    marketingSms,
    ai,
    policyPeriod,
    refetch: () => setRefetchTick((t) => t + 1),
  };
}
