/**
 * Shared SMS settings resolver.
 *
 * Resolution order (first hit wins, field by field):
 *   1. The agent's sms_settings row (provider + credentials).
 *   2. The Thiqa platform defaults in thiqa_platform_settings
 *      (default_sms_provider + default_sms_{019,htd}_* keys).
 *
 * If the agent row has `provider` set, it picks the provider regardless
 * of what the platform default is — the agent explicitly chose a path.
 * If the agent row is empty or credentials are missing, we fall back
 * field-by-field to the platform default. This keeps existing agents on
 * 019 working without any data migration.
 */

export type SmsProvider = '019' | 'htd';

export interface ResolvedSmsSettings {
  provider: SmsProvider;
  is_enabled: boolean;
  // 019sms fields (filled when provider === '019')
  sms_user: string;
  sms_token: string;
  sms_source: string;
  // HTD fields (filled when provider === 'htd')
  htd_id: string;
  htd_sender: string;
}

function normalizeProvider(raw: unknown): SmsProvider {
  const v = String(raw ?? '').toLowerCase().trim();
  if (v === 'htd') return 'htd';
  // '019' / '019sms' → 019. Any other non-empty string falls through too.
  return '019';
}

/** True if the stored value should be treated as "no explicit choice". */
function isInheritProvider(raw: unknown): boolean {
  const v = String(raw ?? '').toLowerCase().trim();
  return v === '' || v === 'inherit' || v === 'default';
}

export async function resolveSmsSettings(
  supabase: any,
  agentId: string,
): Promise<ResolvedSmsSettings | null> {
  // 1. Agent row
  const { data: agentRow } = await supabase
    .from('sms_settings')
    .select('*')
    .eq('agent_id', agentId)
    .maybeSingle();

  // 2. Platform defaults (one query, all keys we care about)
  const { data: platformRows } = await supabase
    .from('thiqa_platform_settings')
    .select('setting_key, setting_value')
    .in('setting_key', [
      'default_sms_provider',
      'default_sms_019_user',
      'default_sms_019_token',
      'default_sms_019_source',
      'default_sms_htd_id',
      'default_sms_htd_sender',
    ]);
  const platform: Record<string, string> = {};
  (platformRows ?? []).forEach((r: any) => {
    platform[r.setting_key] = r.setting_value ?? '';
  });

  // Pick provider:
  //   1. Agent's row, if it names a concrete provider (not NULL/empty).
  //   2. Otherwise inherit the platform default.
  //   3. Otherwise '019' as the absolute last resort.
  const agentProviderRaw = agentRow?.provider;
  const provider: SmsProvider = agentProviderRaw && !isInheritProvider(agentProviderRaw)
    ? normalizeProvider(agentProviderRaw)
    : normalizeProvider(platform.default_sms_provider);

  const is_enabled = agentRow?.is_enabled ?? true;

  // Field-by-field fallback so an agent can override just the parts they
  // care about (e.g. sender name) and inherit the rest.
  const sms_user = agentRow?.sms_user || platform.default_sms_019_user || '';
  const sms_token = agentRow?.sms_token || platform.default_sms_019_token || '';
  const sms_source = agentRow?.sms_source || platform.default_sms_019_source || '';
  const htd_id = agentRow?.htd_id || platform.default_sms_htd_id || '';
  const htd_sender = agentRow?.htd_sender || platform.default_sms_htd_sender || '';

  // Validate that the chosen provider actually has the credentials it needs.
  if (provider === 'htd') {
    if (!htd_id || !htd_sender) return null;
  } else {
    if (!sms_user || !sms_token || !sms_source) return null;
  }

  return {
    provider,
    is_enabled,
    sms_user,
    sms_token,
    sms_source,
    htd_id,
    htd_sender,
  };
}
