import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type CallResult = {
  ok: boolean;
  status: string;
  message: string;
  raw?: unknown;
};

// Talkchief: https://api.talkchief.io/publish_api/calls/click2call.php
// expects { api_key, extension, destination } and replies with a JSON
// body whose shape varies between success/failure. We just surface
// the HTTP-level outcome and let the body fall through as `raw`.
async function placeTalkchiefCall(opts: {
  apiKey: string;
  extension: string;
  destination: string;
}): Promise<CallResult> {
  const res = await fetch(
    'https://api.talkchief.io/publish_api/calls/click2call.php',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: opts.apiKey,
        extension: opts.extension,
        destination: opts.destination,
      }),
    }
  );
  const raw = await res.json().catch(() => ({}));
  if (res.ok) {
    return { ok: true, status: 'SUCCESS', message: 'تم بدء الاتصال بنجاح', raw };
  }
  return {
    ok: false,
    status: 'FAILED',
    message: (raw && typeof raw === 'object' && 'message' in raw && typeof raw.message === 'string')
      ? raw.message
      : 'فشل في بدء الاتصال',
    raw,
  };
}

// Legacy IPPBX flow — kept around so tenants that configured the old
// global Click2Call (auth_settings + pbx_extensions, no per-user row)
// keep working. New tenants land on the per-user flow above.
async function placeIppbxCall(supabase: any, opts: {
  extensionId?: string;
  legacyExtensionNumber?: string;
}): Promise<CallResult> {
  const { data: authSettings, error: authSettingsError } = await supabase
    .from('auth_settings')
    .select('ippbx_enabled, ippbx_token_id')
    .limit(1)
    .single();

  if (authSettingsError || !authSettings?.ippbx_enabled) {
    return { ok: false, status: 'NOT_CONFIGURED', message: 'خاصية الاتصال السريع غير مفعلة' };
  }
  if (!authSettings.ippbx_token_id) {
    return { ok: false, status: 'NOT_CONFIGURED', message: 'لم يتم تكوين رمز التوثيق (Token ID)' };
  }

  let extensionNumber: string | undefined;
  let extensionPassword: string | undefined;

  if (opts.extensionId) {
    const { data: extension } = await supabase
      .from('pbx_extensions')
      .select('extension_number, password_md5')
      .eq('id', opts.extensionId)
      .single();
    extensionNumber = extension?.extension_number;
    extensionPassword = extension?.password_md5;
  } else if (opts.legacyExtensionNumber) {
    extensionNumber = opts.legacyExtensionNumber;
    const { data: extension } = await supabase
      .from('pbx_extensions')
      .select('password_md5')
      .eq('extension_number', opts.legacyExtensionNumber)
      .single();
    if (extension) {
      extensionPassword = extension.password_md5;
    } else {
      const { data: oldSettings } = await supabase
        .from('auth_settings')
        .select('ippbx_extension_password')
        .limit(1)
        .single();
      extensionPassword = oldSettings?.ippbx_extension_password || '';
    }
  } else {
    const { data: defaultExt } = await supabase
      .from('pbx_extensions')
      .select('extension_number, password_md5')
      .eq('is_default', true)
      .single();
    extensionNumber = defaultExt?.extension_number;
    extensionPassword = defaultExt?.password_md5;
  }

  if (!extensionNumber || !extensionPassword) {
    return { ok: false, status: 'NO_EXTENSION', message: 'بيانات التحويلة غير مكتملة' };
  }

  return { ok: true, status: 'PENDING', message: '', raw: { extensionNumber, extensionPassword, tokenId: authSettings.ippbx_token_id } };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, message: 'غير مصرح' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, message: 'جلسة غير صالحة' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json();
    const {
      phone_number,
      extension_id,
      extension_number: legacyExtensionNumber,
      agent_id: overrideAgentId,
    } = body as {
      phone_number?: string;
      extension_id?: string;
      extension_number?: string;
      agent_id?: string;
    };

    if (!phone_number) {
      return new Response(
        JSON.stringify({ success: false, message: 'رقم الهاتف مطلوب' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const cleanPhone = phone_number.replace(/[-\s]/g, '');

    // Resolve the agent we're dialing on behalf of:
    //   - Thiqa super-admin testing from the agent detail page passes
    //     `agent_id` explicitly so they can verify the config without
    //     belonging to that agency themselves. We accept it ONLY when
    //     the caller is a super-admin (the thiqa_super_admins table is
    //     the source of truth for that gate).
    //   - Everyone else: derive from user_roles — the same join every
    //     RLS policy in the schema uses, so this matches what the
    //     employee would see in the call dialog.
    let agentId: string | null = null;
    if (overrideAgentId) {
      const { data: superRow } = await supabase
        .from('thiqa_super_admins')
        .select('email')
        .eq('email', (user.email ?? '').toLowerCase())
        .maybeSingle();
      if (!superRow) {
        return new Response(
          JSON.stringify({ success: false, message: 'غير مصرح بتحديد وكيل آخر' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      agentId = overrideAgentId;
    } else {
      const { data: roleRow } = await supabase
        .from('user_roles')
        .select('agent_id')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle();
      agentId = roleRow?.agent_id ?? null;
    }

    // ── per-agent config (Talkchief, future vendors) ─────────────────
    // Service role bypasses RLS so this works even though the worker
    // doesn't have direct SELECT on click2call_agent_settings.
    const { data: agentSettings } = agentId
      ? await supabase
          .from('click2call_agent_settings')
          .select('provider, api_key, is_enabled, agent_id')
          .eq('agent_id', agentId)
          .maybeSingle()
      : { data: null };

    if (agentSettings) {
      if (!agentSettings.is_enabled) {
        return new Response(
          JSON.stringify({ success: false, message: 'خاصية الاتصال السريع غير مفعلة لهذا الوكيل' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Resolve which extension to use. Caller passes extension_id
      // (the row's UUID in click2call_agent_extensions) when the
      // user actively picked one in the dialog; otherwise we fall
      // back to the agent's default row.
      let chosenExtension: string | null = null;
      if (extension_id) {
        const { data: ext } = await supabase
          .from('click2call_agent_extensions')
          .select('extension')
          .eq('id', extension_id)
          .eq('agent_id', agentSettings.agent_id)
          .maybeSingle();
        chosenExtension = ext?.extension ?? null;
      } else if (legacyExtensionNumber) {
        chosenExtension = legacyExtensionNumber;
      } else {
        const { data: defaultExt } = await supabase
          .from('click2call_agent_extensions')
          .select('extension')
          .eq('agent_id', agentSettings.agent_id)
          .eq('is_default', true)
          .maybeSingle();
        chosenExtension = defaultExt?.extension ?? null;
        if (!chosenExtension) {
          // No explicit default — fall back to the first row, ordered
          // deterministically so calls aren't routed by row creation
          // race conditions.
          const { data: firstExt } = await supabase
            .from('click2call_agent_extensions')
            .select('extension')
            .eq('agent_id', agentSettings.agent_id)
            .order('extension', { ascending: true })
            .limit(1)
            .maybeSingle();
          chosenExtension = firstExt?.extension ?? null;
        }
      }

      if (!chosenExtension) {
        return new Response(
          JSON.stringify({ success: false, message: 'لا توجد تحويلة مهيّأة لهذا الوكيل' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      let result: CallResult;
      if (agentSettings.provider === 'talkchief') {
        result = await placeTalkchiefCall({
          apiKey: agentSettings.api_key,
          extension: chosenExtension,
          destination: cleanPhone,
        });
      } else {
        return new Response(
          JSON.stringify({ success: false, message: `مزود الاتصال غير مدعوم: ${agentSettings.provider}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({
          success: result.ok,
          status: result.status,
          message: result.message,
        }),
        { status: result.ok ? 200 : 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── legacy IPPBX fallback ────────────────────────────────────────
    const legacy = await placeIppbxCall(supabase, { extensionId: extension_id, legacyExtensionNumber });
    if (!legacy.ok) {
      return new Response(
        JSON.stringify({ success: false, message: legacy.message, status: legacy.status }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { extensionNumber, extensionPassword, tokenId } = legacy.raw as {
      extensionNumber: string;
      extensionPassword: string;
      tokenId: string;
    };

    const pbxResponse = await fetch(
      'https://master.ippbx.co.il/ippbx_api/v1.4/api/info/click2call',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token_id: tokenId,
          phone_number: cleanPhone,
          extension_number: extensionNumber,
          extension_password: extensionPassword,
        }),
      }
    );

    const pbxData = await pbxResponse.json().catch(() => ({}));
    if (pbxResponse.ok && pbxData?.status === 'SUCCESS') {
      return new Response(
        JSON.stringify({ success: true, status: 'SUCCESS', message: 'تم بدء الاتصال بنجاح' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    return new Response(
      JSON.stringify({
        success: false,
        status: pbxData?.status || 'FAILED',
        message: pbxData?.message || 'فشل في بدء الاتصال',
      }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Click2Call error:', error);
    return new Response(
      JSON.stringify({ success: false, message: 'حدث خطأ في الخادم' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
