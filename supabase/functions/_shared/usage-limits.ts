/**
 * Shared usage-limits helper for SMS and AI chat.
 *
 * Precedence when resolving a limit:
 *   1. row in `agent_usage_limits` for the agent (super-admin override)
 *   2. platform defaults in `thiqa_platform_settings` (default_sms_limit_*, default_ai_limit_*)
 *   3. hardcoded fallback: 100 / monthly
 *
 * Agents without an explicit row still get enforced at the platform default —
 * that way super-admins can leave defaults in place and only create per-agent
 * overrides when raising limits.
 */

export type UsageType = "sms" | "ai_chat";
export type LimitType = "monthly" | "yearly" | "unlimited";

export interface LimitConfig {
  limit_type: LimitType;
  limit_count: number;
}

export interface LimitCheck {
  allowed: boolean;
  used: number;
  /** Base monthly allowance for this usage type. */
  limit: number;
  /** Persistent credit balance (never expires). */
  credit_balance: number;
  /** base_limit + credit_balance — how many more calls the agent can make right now. */
  effective_limit: number;
  limit_type: LimitType;
  period: string;
  /** Arabic label for the period, e.g. "شهرياً" / "سنوياً". */
  period_label: string;
}

const HARDCODED_DEFAULT: LimitConfig = { limit_type: "monthly", limit_count: 100 };

function currentPeriod(limitType: LimitType): string {
  const now = new Date();
  if (limitType === "yearly") return String(now.getFullYear());
  // monthly (or unlimited — still return monthly for logging purposes)
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function periodLabel(limitType: LimitType): string {
  if (limitType === "yearly") return "سنوياً";
  if (limitType === "unlimited") return "غير محدود";
  return "شهرياً";
}

/**
 * Resolve the effective limit config for a given agent + usage type.
 * Never throws — falls through to hardcoded defaults on any failure.
 */
export async function resolveLimitConfig(
  supabase: any,
  agentId: string,
  usageType: UsageType,
): Promise<LimitConfig> {
  // 1. Per-agent override
  try {
    const { data: agentLimits } = await supabase
      .from("agent_usage_limits")
      .select("sms_limit_type, sms_limit_count, ai_limit_type, ai_limit_count")
      .eq("agent_id", agentId)
      .maybeSingle();

    if (agentLimits) {
      if (usageType === "sms" && agentLimits.sms_limit_type) {
        return {
          limit_type: agentLimits.sms_limit_type as LimitType,
          limit_count: agentLimits.sms_limit_count ?? 0,
        };
      }
      if (usageType === "ai_chat" && agentLimits.ai_limit_type) {
        return {
          limit_type: agentLimits.ai_limit_type as LimitType,
          limit_count: agentLimits.ai_limit_count ?? 0,
        };
      }
    }
  } catch (err) {
    console.warn("[usage-limits] agent_usage_limits lookup failed:", err);
  }

  // 2. Platform defaults
  try {
    const typeKey = usageType === "sms" ? "default_sms_limit_type" : "default_ai_limit_type";
    const countKey = usageType === "sms" ? "default_sms_limit_count" : "default_ai_limit_count";
    const { data: rows } = await supabase
      .from("thiqa_platform_settings")
      .select("setting_key, setting_value")
      .in("setting_key", [typeKey, countKey]);

    const map: Record<string, string> = {};
    (rows || []).forEach((r: any) => {
      map[r.setting_key] = r.setting_value || "";
    });

    const limit_type = (map[typeKey] || HARDCODED_DEFAULT.limit_type) as LimitType;
    const limit_count = parseInt(map[countKey] || String(HARDCODED_DEFAULT.limit_count), 10);
    if (!Number.isFinite(limit_count)) {
      return HARDCODED_DEFAULT;
    }
    return { limit_type, limit_count };
  } catch (err) {
    console.warn("[usage-limits] thiqa_platform_settings lookup failed:", err);
  }

  // 3. Hardcoded fallback
  return HARDCODED_DEFAULT;
}

/**
 * Read the persistent credit balance for an agent + usage type from the
 * credit wallet. Falls back to 0 on any error so a failed lookup doesn't
 * erroneously over-charge the agent's quota.
 */
async function getCreditBalance(
  supabase: any,
  agentId: string,
  usageType: UsageType,
): Promise<number> {
  try {
    const { data } = await supabase
      .from("agent_credit_wallet")
      .select("sms_credit_balance, ai_credit_balance")
      .eq("agent_id", agentId)
      .maybeSingle();
    if (!data) return 0;
    return usageType === "sms"
      ? (data.sms_credit_balance ?? 0)
      : (data.ai_credit_balance ?? 0);
  } catch (err) {
    console.warn("[usage-limits] agent_credit_wallet lookup failed:", err);
    return 0;
  }
}

/**
 * Check whether the given agent is within their quota. The agent is allowed
 * if they haven't exhausted the base monthly allowance OR if they have any
 * credit balance left in the wallet. Credits are persistent — they only
 * decrement when the base allowance for the current period is already spent.
 * If the agent has `unlimited`, always returns allowed with used=0.
 */
export async function checkUsageLimit(
  supabase: any,
  agentId: string,
  usageType: UsageType,
): Promise<LimitCheck> {
  const config = await resolveLimitConfig(supabase, agentId, usageType);

  if (config.limit_type === "unlimited") {
    return {
      allowed: true,
      used: 0,
      limit: 0,
      credit_balance: 0,
      effective_limit: 0,
      limit_type: "unlimited",
      period: currentPeriod("monthly"),
      period_label: periodLabel("unlimited"),
    };
  }

  const period = currentPeriod(config.limit_type);

  let used = 0;
  try {
    const { data } = await supabase
      .from("agent_usage_log")
      .select("count")
      .eq("agent_id", agentId)
      .eq("usage_type", usageType)
      .eq("period", period)
      .maybeSingle();
    used = data?.count ?? 0;
  } catch (err) {
    console.warn("[usage-limits] agent_usage_log lookup failed:", err);
  }

  const creditBalance = await getCreditBalance(supabase, agentId, usageType);
  const baseLimit = config.limit_count;
  const effectiveLimit = baseLimit + creditBalance;

  // Allowed if we still have room in the base allowance OR credits to spend.
  const allowed = used < baseLimit || creditBalance > 0;

  return {
    allowed,
    used,
    limit: baseLimit,
    credit_balance: creditBalance,
    effective_limit: effectiveLimit,
    limit_type: config.limit_type,
    period,
    period_label: periodLabel(config.limit_type),
  };
}

/**
 * Increment the usage counter for this agent + type and, if the base monthly
 * allowance is already exhausted, consume one credit from the wallet. Uses
 * the `log_usage_with_credit` RPC for atomicity. Falls back to the simple
 * `increment_usage_log` RPC (and then a raw upsert) so a failed bookkeeping
 * write never blocks a successful send.
 */
export async function logUsage(
  supabase: any,
  agentId: string,
  usageType: UsageType,
): Promise<void> {
  const config = await resolveLimitConfig(supabase, agentId, usageType);
  const effectiveType: LimitType = config.limit_type === "unlimited" ? "monthly" : config.limit_type;
  const period = currentPeriod(effectiveType);

  // Unlimited agents skip the credit plumbing entirely.
  if (config.limit_type === "unlimited") {
    try {
      await supabase.rpc("increment_usage_log", {
        p_agent_id: agentId,
        p_usage_type: usageType,
        p_period: period,
      });
    } catch (err) {
      console.warn("[usage-limits] increment_usage_log failed for unlimited agent:", err);
    }
    return;
  }

  try {
    const { error } = await supabase.rpc("log_usage_with_credit", {
      p_agent_id: agentId,
      p_usage_type: usageType,
      p_period: period,
      p_base_limit: config.limit_count,
    });
    if (error) throw error;
  } catch (err: any) {
    const msg = String(err?.message ?? err ?? "");
    // `insufficient_credits` shouldn't normally happen because checkUsageLimit
    // is called before the send, but log it just in case.
    if (msg.includes("insufficient_credits")) {
      console.warn("[usage-limits] log_usage_with_credit reported insufficient credits");
      return;
    }
    console.warn("[usage-limits] log_usage_with_credit failed, falling back to increment_usage_log:", msg);
    try {
      await supabase.rpc("increment_usage_log", {
        p_agent_id: agentId,
        p_usage_type: usageType,
        p_period: period,
      });
    } catch (rpcErr) {
      console.warn("[usage-limits] increment_usage_log fallback failed, upserting directly:", rpcErr);
      try {
        await supabase.from("agent_usage_log").upsert(
          {
            agent_id: agentId,
            usage_type: usageType,
            period,
            count: 1,
          },
          { onConflict: "agent_id,usage_type,period" },
        );
      } catch (upsertErr) {
        console.error("[usage-limits] upsert fallback also failed:", upsertErr);
      }
    }
  }
}

/**
 * Build a consistent 429 JSON response when the limit is reached.
 */
export function limitReachedResponse(
  usageType: UsageType,
  check: LimitCheck,
  corsHeaders: Record<string, string>,
): Response {
  const resource = usageType === "sms" ? "إرسال الرسائل النصية" : "المساعد الذكي";
  const body = {
    error: `لقد وصلت للحد الأقصى لـ${resource} (${check.limit} ${check.period_label}). تواصل مع إدارة ثقة لزيادة الحد.`,
    error_code: usageType === "sms" ? "sms_limit_reached" : "ai_limit_reached",
    used: check.used,
    limit: check.limit,
    limit_type: check.limit_type,
    period: check.period,
  };
  return new Response(JSON.stringify(body), {
    status: 429,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
