/**
 * Shared SMS settings resolver.
 * Falls back to Thiqa platform defaults when agent has no SMS credentials.
 */
export interface ResolvedSmsSettings {
  sms_user: string;
  sms_token: string;
  sms_source: string;
  is_enabled: boolean;
}

export async function resolveSmsSettings(
  supabase: any,
  agentId: string
): Promise<ResolvedSmsSettings | null> {
  // 1. Try agent-level settings
  const { data: agentSettings } = await supabase
    .from("sms_settings")
    .select("*")
    .eq("agent_id", agentId)
    .maybeSingle();

  let sms_user = agentSettings?.sms_user || "";
  let sms_token = agentSettings?.sms_token || "";
  let sms_source = agentSettings?.sms_source || "";
  const is_enabled = agentSettings?.is_enabled ?? true;

  // 2. Fallback to Thiqa platform defaults if agent has no credentials
  if (!sms_user || !sms_token) {
    const { data: platformRows } = await supabase
      .from("thiqa_platform_settings")
      .select("setting_key, setting_value")
      .in("setting_key", ["default_sms_019_user", "default_sms_019_token", "default_sms_019_source"]);
    const platform: Record<string, string> = {};
    (platformRows || []).forEach((r: any) => { platform[r.setting_key] = r.setting_value || ""; });
    sms_user = sms_user || platform.default_sms_019_user || "";
    sms_token = sms_token || platform.default_sms_019_token || "";
    sms_source = sms_source || platform.default_sms_019_source || "";
  }

  if (!sms_user || !sms_token || !sms_source) {
    return null;
  }

  return { sms_user, sms_token, sms_source, is_enabled };
}
