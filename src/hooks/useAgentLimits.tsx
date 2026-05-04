import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAgentContext } from './useAgentContext';

export interface ResourceLimit {
  used: number;
  planLimit: number | null;     // NULL = unlimited on plan column
  addonQuantity: number;         // sum of active matching addons (includes credit wallet balance for SMS/AI)
  effective: number | null;      // planLimit + addonQuantity (NULL if unlimited)
  remaining: number | null;      // effective - used (NULL if unlimited)
  exceeded: boolean;
  /** Never-expiring credit balance from agent_credit_wallet (SMS/AI/marketing SMS only; 0 elsewhere). */
  creditBalance: number;
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
  creditBalance: 0,
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
  creditBalance: number = 0,
): ResourceLimit {
  if (planLimit === null) {
    return {
      used,
      planLimit: null,
      addonQuantity,
      effective: null,
      remaining: null,
      exceeded: false,
      creditBalance,
    };
  }
  const effective = planLimit + addonQuantity;
  // Mirror the server's `allowed = used < baseLimit || creditBalance > 0`
  // from _shared/usage-limits.ts: if the agent has any never-expiring
  // credit in the wallet, sending is allowed even while the monthly
  // bucket is drained. The client's `exceeded` drives the UI lock, so
  // it has to agree with the server or the bell/send buttons stay
  // locked after a top-up that would actually go through.
  const baseLimit = planLimit + Math.max(0, addonQuantity - creditBalance);
  const exceeded = used >= baseLimit && creditBalance <= 0;
  return {
    used,
    planLimit,
    addonQuantity,
    effective,
    remaining: Math.max(0, effective - used),
    exceeded,
    creditBalance,
  };
}

function applyOverride(
  override: number | null | undefined,
  planValue: number | null,
): number | null {
  if (override == null) return planValue;
  if (override === -1) return null;
  return override;
}

const AgentLimitsContext = createContext<AgentLimits | undefined>(undefined);

/**
 * Resolves every quota (users/branches/policies/sms/marketing_sms/ai)
 * for the current agent ONCE per session and shares the result via
 * context. Drives the usage UI on /subscription and the pre-flight
 * check that opens the UpgradePromptDialog before an action hits the
 * DB trigger.
 *
 * Hoisted into a provider so the 13+ consumer components (Header,
 * BottomToolbar, dashboard tiles, every page that surfaces a "new
 * transaction" button, etc.) share a single fetch instead of each
 * mounting and firing the full quota waterfall independently.
 */
export function AgentLimitsProvider({ children }: { children: ReactNode }) {
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
  // Track whether the first fetch has finished. Subsequent refetches
  // (refetchTick bumps, e.g. after a credit top-up) must not re-flip
  // loading to true — useSmsLock treats loading as "locked", and the
  // flip causes a visible lock flicker on the SMS send button even
  // though the cached sms state is still accurate.
  const hasLoadedOnce = useRef(false);

  useEffect(() => {
    if (!agentId || !planInfo) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    const run = async () => {
      if (!hasLoadedOnce.current) setLoading(true);
      try {
        const today = new Date().toISOString().slice(0, 10);
        const thisMonth = new Date().toISOString().slice(0, 7); // YYYY-MM

        // Phase 1 — fire every period-independent query in parallel.
        // The hook used to await each one in sequence, which made the
        // total time = sum of all latencies. With Promise.all the
        // total time = max latency, ~5x faster on a cold path.
        const [
          overrideResult,
          addonResult,
          userCountResult,
          branchCountResult,
          periodResult,
          usageResult,
          walletResult,
        ] = await Promise.all([
          // 0. Per-agent overrides from the agents row. NULL means
          // inherit the plan column; -1 means "unlimited" (return null
          // so the bar shows uncapped); >=0 replaces the plan value.
          supabase
            .from('agents')
            .select(
              'users_limit_override, branches_limit_override, policies_limit_override, sms_limit_override, marketing_sms_limit_override, ai_limit_override, policies_usage_offset',
            )
            .eq('id', agentId)
            .maybeSingle(),
          // 1. Active addon quantities, grouped by type.
          supabase
            .from('agent_addons')
            .select('addon_type, quantity')
            .eq('agent_id', agentId)
            .eq('status', 'active')
            .eq('billing_cycle', 'monthly')
            .lte('starts_at', today)
            .or(`ends_at.is.null,ends_at.gte.${today}`),
          // 2. User count (profiles active/pending scoped to this agent).
          supabase
            .from('profiles')
            .select('id', { count: 'exact', head: true })
            .eq('agent_id', agentId)
            .in('status', ['active', 'pending']),
          // 3. Branch count — only active consumes a seat;
          // plan_locked branches are parked over-limit rows, same
          // treatment as plan_locked profiles in the user count above.
          supabase
            .from('branches')
            .select('id', { count: 'exact', head: true })
            .eq('agent_id', agentId)
            .eq('status', 'active'),
          // 4. Policy period source (sets the window for the
          // policies count fired in phase 2).
          supabase
            .from('thiqa_platform_settings')
            .select('setting_value')
            .eq('setting_key', 'policy_limit_period')
            .maybeSingle(),
          // 5. Usage log counts — sms / ai / marketing_sms for the
          // current month. Period-independent (uses YYYY-MM).
          supabase
            .from('agent_usage_log')
            .select('usage_type, count')
            .eq('agent_id', agentId)
            .eq('period', thisMonth),
          // 6. Credit wallet — never-expiring balances topped up by
          // purchase-usage-overage. Treated as extra headroom on the
          // effective SMS / AI limits so the bar reflects what the
          // server actually allows (checkUsageLimit adds credits to
          // the base allowance the same way).
          supabase
            .from('agent_credit_wallet')
            .select(
              'sms_credit_balance, ai_credit_balance, marketing_sms_credit_balance',
            )
            .eq('agent_id', agentId)
            .maybeSingle(),
        ]);

        const overrideRow = overrideResult.data;
        const addonRows = addonResult.data;
        const userCount = userCountResult.count;
        const branchCount = branchCountResult.count;
        const periodRow = periodResult.data;
        const usageRows = usageResult.data;
        const walletRow = walletResult.data;

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

        // Phase 2 — server-side COUNT DISTINCT for the policies count.
        // Replaces the old "fetch every in-period row to JS" path so
        // an agent with thousands of policies doesn't pay the row-
        // transfer cost on every page load. Backed by the partial
        // composite index (agent_id, created_at) WHERE deleted_at IS
        // NULL added in 20260504180000.
        const { data: policyCountRaw } = await supabase.rpc(
          'count_agent_policies_in_period',
          { p_agent_id: agentId, p_period_start: periodStart },
        );
        const distinctPolicies = (policyCountRaw as number | null) ?? 0;

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

        const usageMap: Record<string, number> = {};
        (usageRows ?? []).forEach((u) => {
          usageMap[u.usage_type] = u.count;
        });

        const smsCredit = (walletRow as any)?.sms_credit_balance ?? 0;
        const aiCredit = (walletRow as any)?.ai_credit_balance ?? 0;
        const marketingSmsCredit =
          (walletRow as any)?.marketing_sms_credit_balance ?? 0;

        if (cancelled) return;

        setPolicyPeriod(period);
        setUsers(
          buildLimit(
            userCount ?? 0,
            applyOverride(
              overrideRow?.users_limit_override as number | null,
              planInfo.users_limit,
            ),
            addonQty.extra_user,
          ),
        );
        setBranches(
          buildLimit(
            branchCount ?? 0,
            applyOverride(
              overrideRow?.branches_limit_override as number | null,
              planInfo.branches_limit,
            ),
            addonQty.extra_branch,
          ),
        );
        // Subtract the per-agent offset so seed/imported policies
        // don't consume quota. Offset stays fixed; as the agent
        // creates new policies the displayed count climbs from 0.
        const policiesOffset = (overrideRow as any)?.policies_usage_offset ?? 0;
        const policiesUsed = Math.max(0, distinctPolicies - policiesOffset);
        setPolicies(
          buildLimit(
            policiesUsed,
            applyOverride(
              overrideRow?.policies_limit_override as number | null,
              planInfo.policies_limit,
            ),
            0,
          ),
        );
        setSms(
          buildLimit(
            usageMap.sms ?? 0,
            applyOverride(
              overrideRow?.sms_limit_override as number | null,
              planInfo.sms_limit,
            ),
            addonQty.extra_sms + smsCredit,
            smsCredit,
          ),
        );
        setMarketingSms(
          buildLimit(
            usageMap.marketing_sms ?? 0,
            applyOverride(
              overrideRow?.marketing_sms_limit_override as number | null,
              planInfo.marketing_sms_limit,
            ),
            addonQty.extra_marketing_sms + marketingSmsCredit,
            marketingSmsCredit,
          ),
        );
        setAi(
          buildLimit(
            usageMap.ai_chat ?? 0,
            applyOverride(
              overrideRow?.ai_limit_override as number | null,
              planInfo.ai_limit,
            ),
            addonQty.extra_ai + aiCredit,
            aiCredit,
          ),
        );
      } catch (error) {
        console.error('Error loading agent limits:', error);
      } finally {
        if (!cancelled) {
          hasLoadedOnce.current = true;
          setLoading(false);
        }
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [agentId, planInfo, refetchTick]);

  const refetch = useCallback(() => {
    setRefetchTick((t) => t + 1);
  }, []);

  // Keep the cached counts in sync with the server in real time so the
  // SMS / AI send buttons flip to locked the moment an edge function
  // decrements the wallet or bumps the usage log. Without this the
  // client runs on the initial fetch until the next mount, which lets
  // e.g. an agent who burns through their last 5 credits in one session
  // keep clicking send after the server has already zero'd the wallet —
  // the client still thinks credit=5 and renders the button unlocked.
  //
  // Debounced so a burst of writes (e.g. a marketing campaign that
  // increments the usage log once per recipient) collapses into a
  // single refetch instead of N parallel reloads of every quota query.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!agentId) return;
    const scheduleRefetch = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setRefetchTick((t) => t + 1);
      }, 500);
    };
    const channel = supabase
      .channel(`agent-limits-${agentId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'agent_credit_wallet', filter: `agent_id=eq.${agentId}` },
        scheduleRefetch,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'agent_usage_log', filter: `agent_id=eq.${agentId}` },
        scheduleRefetch,
      )
      .subscribe();
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabase.removeChannel(channel);
    };
  }, [agentId]);

  const value = useMemo<AgentLimits>(
    () => ({
      loading,
      users,
      branches,
      policies,
      sms,
      marketingSms,
      ai,
      policyPeriod,
      refetch,
    }),
    [loading, users, branches, policies, sms, marketingSms, ai, policyPeriod, refetch],
  );

  return (
    <AgentLimitsContext.Provider value={value}>
      {children}
    </AgentLimitsContext.Provider>
  );
}

export function useAgentLimits(): AgentLimits {
  const ctx = useContext(AgentLimitsContext);
  if (ctx === undefined) {
    throw new Error('useAgentLimits must be used within an AgentLimitsProvider');
  }
  return ctx;
}
