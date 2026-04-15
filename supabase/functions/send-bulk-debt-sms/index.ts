import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import { getAgentBranding, resolveAgentId } from "../_shared/agent-branding.ts";
import { resolveSmsSettings } from "../_shared/sms-settings.ts";
import { checkUsageLimit, limitReachedResponse, logUsage } from "../_shared/usage-limits.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Helper to escape XML special characters
const escapeXml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");

// Helper to extract XML tag content
const extractTag = (xml: string, tag: string) => {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
  return match?.[1]?.trim() ?? null;
};

// Helper to get policy type label in Arabic
const POLICY_TYPE_LABELS: Record<string, string> = {
  'ELZAMI': 'إلزامي',
  'THIRD_FULL': 'ثالث/شامل',
  'THIRD_ONLY': 'طرف ثالث',
  'ROAD_SERVICE': 'خدمات طريق',
  'ACCIDENT_FEE_EXEMPTION': 'إعفاء رسوم',
};

const getPolicyTypeLabel = (parent: string | null, child: string | null): string => {
  if (!parent) return 'وثيقة';
  const parentLabel = POLICY_TYPE_LABELS[parent] || parent;
  if (child && parent === 'THIRD_FULL') {
    return child === 'FULL' ? 'شامل' : child === 'THIRD' ? 'ثالث' : parentLabel;
  }
  return parentLabel;
};


Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Helper to call a PostgREST RPC with the caller's JWT. We avoid
    // instantiating a second supabase-js client here because
    // constructing one with a global Authorization header triggers
    // local JWT decoding inside gotrue-js, which blows up with
    // "Unsupported JWT algorithm ES256" on ES256-signed tokens. Raw
    // fetch sends the bearer straight to PostgREST, which forwards
    // verification to the auth server (that side handles ES256).
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const rpcAsCaller = async (fn: string, params: Record<string, unknown>) => {
      const resp = await fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: anonKey,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(params),
      });
      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`rpc ${fn} failed (${resp.status}): ${body}`);
      }
      return resp.json();
    };

    // Parse request body
    // Resolve agent branding
    const agentId = await resolveAgentId(supabase, user.id);
    const brandingData = await getAgentBranding(supabase, agentId);
    const siteTitle = brandingData.companyName;

    const { filter_days, search } = await req.json();

    console.log(`Bulk SMS request - filter_days: ${filter_days}, search: ${search}`);

    // Get SMS credentials (with Thiqa platform fallback)
    const smsSettings = await resolveSmsSettings(supabase, agentId);

    if (!smsSettings) {
      return new Response(
        JSON.stringify({ error: "SMS settings not configured" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Get agent-level company settings
    const { data: agentSmsRow } = await supabase
      .from("sms_settings")
      .select("company_location, company_phone_links")
      .eq("agent_id", agentId)
      .maybeSingle();

    // Get all clients matching the filter (no pagination limit). Raw
    // fetch so auth.uid() inside the tenant-scoped RPC resolves to
    // the caller without going through supabase-js' JWT decoder.
    let clientRows: any[] = [];
    try {
      const rpcData = await rpcAsCaller("report_client_debts", {
        p_search: search || null,
        p_filter_days: filter_days,
        p_limit: 10000,
        p_offset: 0,
      });
      clientRows = Array.isArray(rpcData) ? rpcData : [];
    } catch (err) {
      console.error("report_client_debts failed:", err);
      throw err;
    }

    console.log(`Found ${clientRows.length} clients with debt`);

    // Defensive tenant guard: the RPC *should* already be scoped to the
    // caller's agent, but re-verify every row against `clients.agent_id`
    // before sending an SMS. Without this, any hole in the RPC leaks
    // straight into the SMS blast. Fetch the agent_id for every returned
    // client_id in one query and drop anything that doesn't belong to us.
    const rawClientIds = clientRows
      .map((c: any) => c.client_id)
      .filter(Boolean);
    const allowedClientIds = new Set<string>();
    if (rawClientIds.length > 0) {
      const { data: ownedRows, error: ownedError } = await supabase
        .from('clients')
        .select('id')
        .eq('agent_id', agentId)
        .is('deleted_at', null)
        .in('id', rawClientIds);
      if (ownedError) {
        console.error('Tenant guard lookup failed:', ownedError);
        throw ownedError;
      }
      for (const row of ownedRows || []) {
        allowedClientIds.add(row.id as string);
      }
    }

    const droppedCount = clientRows.length - allowedClientIds.size;
    if (droppedCount > 0) {
      console.warn(
        `[tenant-guard] Dropping ${droppedCount} client row(s) that do not belong to agent ${agentId}`,
      );
    }

    // Filter clients with valid phone numbers AND that passed the
    // tenant guard above.
    const clientsWithPhone = clientRows.filter(
      (c: any) =>
        c.client_phone &&
        c.client_phone.trim() !== "" &&
        allowedClientIds.has(c.client_id),
    );

    console.log(`${clientsWithPhone.length} clients have phone numbers`);

    // Enforce SMS quota — must have enough budget for the whole batch
    const smsCheck = await checkUsageLimit(supabase, agentId, "sms");
    if (!smsCheck.allowed) {
      return limitReachedResponse("sms", smsCheck, corsHeaders);
    }
    if (smsCheck.limit_type !== "unlimited") {
      const remaining = Math.max(0, smsCheck.limit - smsCheck.used);
      if (clientsWithPhone.length > remaining) {
        return new Response(
          JSON.stringify({
            error: `رصيد الرسائل غير كافٍ: متاح ${remaining} من ${smsCheck.limit} ${smsCheck.period_label}، والمطلوب ${clientsWithPhone.length} رسالة. تواصل مع إدارة ثقة لزيادة الحد.`,
            error_code: "sms_limit_insufficient",
            available: remaining,
            requested: clientsWithPhone.length,
            limit: smsCheck.limit,
          }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Get company footer info
    const companyLocation = agentSmsRow?.company_location || '';
    const phoneLinks = (agentSmsRow?.company_phone_links as any[]) || [];
    const phones = phoneLinks.map((p: any) => p.phone).filter(Boolean).join(' | ');

    const smsUser = smsSettings.sms_user;
    const smsToken = smsSettings.sms_token;
    const smsSource = smsSettings.sms_source;

    let sentCount = 0;
    let failedCount = 0;

    // Send SMS to each client
    for (const client of clientsWithPhone) {
      try {
        // Clean phone number - normalize to 05xxxxxxx format
        let cleanPhone = client.client_phone.replace(/[^0-9]/g, "");
        if (cleanPhone.startsWith("972")) {
          cleanPhone = "0" + cleanPhone.substring(3);
        }
        
        const clientName = client.client_name || "عميل";
        
        // Use the unified total_remaining from the RPC (already calculated correctly)
        const totalRemaining = Math.round(Number(client.total_remaining) || 0);

        // Skip if no remaining amount
        if (totalRemaining <= 0) {
          console.log(`Client ${client.client_id} has no remaining debt, skipping`);
          continue;
        }

        // Fetch policy details for this client (user-scoped so
        // is_active_user / can_access_branch inside the RPC see the
        // caller's uid).
        let policies: any[] = [];
        try {
          const rpcData = await rpcAsCaller("report_debt_policies_for_clients", {
            p_client_ids: [client.client_id],
          });
          policies = Array.isArray(rpcData) ? rpcData : [];
        } catch (err) {
          console.error(`policy lookup failed for client ${client.client_id}:`, err);
        }

        // Build policy lines (max 5 to keep SMS short)
        const policyLines = policies
          .filter((p: any) => (p.remaining || 0) > 0)
          .map((p: any) => {
            const typeLabel = getPolicyTypeLabel(p.policy_type_parent, p.policy_type_child);
            const car = p.car_number || '';
            const remaining = Math.round(p.remaining || 0);
            return `• ${typeLabel}${car ? ` - ${car}` : ''} - ₪${remaining.toLocaleString()}`;
          })
          .slice(0, 5)
          .join('\n');

        // Build final message with policy details and footer
        let message = `مرحباً ${clientName}،

عليك تسديد المبلغ: ₪${totalRemaining.toLocaleString()}

الوثائق:
${policyLines}

${siteTitle}`;

        // Add location if available
        if (companyLocation) {
          message += `\n📍 ${companyLocation}`;
        }

        // Add phones if available
        if (phones) {
          message += `\n📞 ${phones}`;
        }

        // Build 019sms XML request (official API format)
        const dlr = crypto.randomUUID();
        const smsXml =
          `<?xml version="1.0" encoding="UTF-8"?>` +
          `<sms>` +
          `<user><username>${escapeXml(smsUser)}</username></user>` +
          `<source>${escapeXml(smsSource)}</source>` +
          `<destinations><phone id="${dlr}">${escapeXml(cleanPhone)}</phone></destinations>` +
          `<message>${escapeXml(message)}</message>` +
          `</sms>`;

        console.log(`Sending SMS to ${cleanPhone} from ${smsSource}`);

        const smsResponse = await fetch("https://019sms.co.il/api", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${smsToken}`,
            "Content-Type": "application/xml; charset=utf-8",
          },
          body: smsXml,
        });

        const smsResult = await smsResponse.text();
        console.log(`019sms response for ${cleanPhone}:`, smsResult);

        const status = extractTag(smsResult, "status");
        const apiMessage = extractTag(smsResult, "message");
        const isSuccess = status === "0";

        // Log the SMS
        await supabase.from("sms_logs").insert({
          phone_number: cleanPhone,
          message: message,
          sms_type: "payment_request",
          client_id: client.client_id,
          status: isSuccess ? "sent" : "failed",
          error_message: isSuccess ? null : (apiMessage || smsResult.substring(0, 200)),
          sent_at: new Date().toISOString(),
          created_by: user.id,
        });

        if (isSuccess) {
          sentCount++;
          await logUsage(supabase, agentId, "sms");
        } else {
          failedCount++;
        }

        // Small delay to avoid rate limiting
        await new Promise((r) => setTimeout(r, 100));
      } catch (err) {
        console.error(`Error sending to ${client.client_phone}:`, err);
        failedCount++;
      }
    }

    console.log(`Bulk SMS complete: sent=${sentCount}, failed=${failedCount}`);

    return new Response(
      JSON.stringify({
        success: true,
        sent_count: sentCount,
        failed_count: failedCount,
        total_clients: clientsWithPhone.length,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("Bulk SMS error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
