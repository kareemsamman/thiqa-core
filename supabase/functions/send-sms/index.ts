import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import { checkUsageLimit, limitReachedResponse, logUsage } from "../_shared/usage-limits.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SmsRequest {
  phone: string;
  message: string;
}

interface SmsSettings {
  sms_user: string;
  sms_token: string;
  sms_source: string;
  is_enabled: boolean;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify authentication
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify user is authenticated and active
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid authentication" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if user is active and get agent_id
    const { data: profile } = await supabase
      .from("profiles")
      .select("status, agent_id")
      .eq("id", user.id)
      .single();

    if (!profile || profile.status !== "active") {
      return new Response(
        JSON.stringify({ error: "User not authorized" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Resolve agent_id
    const agentId = profile.agent_id || (await supabase.from("agent_users").select("agent_id").eq("user_id", user.id).maybeSingle())?.data?.agent_id;

    if (!agentId) {
      return new Response(
        JSON.stringify({ error: "Agent not found" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Enforce per-agent SMS quota (falls back to platform defaults if no per-agent row exists)
    const smsCheck = await checkUsageLimit(supabase, agentId, "sms");
    if (!smsCheck.allowed) {
      return limitReachedResponse("sms", smsCheck, corsHeaders);
    }

    // Parse request body
    const { phone, message, client_id }: SmsRequest & { client_id?: string } = await req.json();

    if (!phone || !message) {
      return new Response(
        JSON.stringify({ error: "Phone and message are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get SMS settings for this agent
    const { data: smsSettings, error: settingsError } = await supabase
      .from("sms_settings")
      .select("*")
      .eq("agent_id", agentId)
      .maybeSingle();

    if (settingsError) {
      console.error("Error fetching SMS settings:", settingsError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch SMS settings" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Agent-level credentials
    let sms_user = smsSettings?.sms_user || "";
    let sms_token = smsSettings?.sms_token || "";
    let sms_source = smsSettings?.sms_source || "";

    // Fallback to Thiqa platform default SMS credentials if agent has none
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
      return new Response(
        JSON.stringify({ error: "SMS settings are incomplete. Please contact support." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const escapeXml = (value: string) =>
      value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&apos;");

    // Normalize phone for 019sms (expects 05xxxxxxx or 5xxxxxxx)
    let cleanPhone = phone.replace(/[^0-9]/g, "");
    if (cleanPhone.startsWith("972")) {
      cleanPhone = "0" + cleanPhone.substring(3);
    }

    // Build 019sms XML request (official API)
    // Docs: https://docs.019sms.co.il/sms/send-sms.html
    const dlr = crypto.randomUUID();
    const smsXml =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<sms>` +
      `<user><username>${escapeXml(sms_user)}</username></user>` +
      `<source>${escapeXml(sms_source)}</source>` +
      `<destinations><phone id="${dlr}">${escapeXml(cleanPhone)}</phone></destinations>` +
      `<message>${escapeXml(message)}</message>` +
      `</sms>`;

    console.log(`Sending SMS to ${cleanPhone} from ${sms_source}`);

    const smsResponse = await fetch("https://019sms.co.il/api", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sms_token}`,
        "Content-Type": "application/xml; charset=utf-8",
      },
      body: smsXml,
    });

    const smsResult = await smsResponse.text();
    console.log("019sms raw response:", smsResult);

    const extractTag = (xml: string, tag: string) => {
      const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
      return match?.[1]?.trim() ?? null;
    };

    const status = extractTag(smsResult, "status");
    const apiMessage = extractTag(smsResult, "message");
    const shipmentId = extractTag(smsResult, "shipment_id");

    if (!smsResponse.ok || status !== "0") {
      return new Response(
        JSON.stringify({
          error: apiMessage || `SMS API error (status=${status ?? "unknown"})`,
          status,
          http_status: smsResponse.status,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log SMS to sms_logs table
    const { error: logError } = await supabase.from('sms_logs').insert({
      phone_number: cleanPhone,
      message: message,
      sms_type: 'manual',
      status: 'sent',
      sent_at: new Date().toISOString(),
      client_id: client_id || null,
      created_by: user.id,
    });

    if (logError) {
      console.error("Error logging SMS:", logError);
    }

    // Track usage for quota enforcement
    await logUsage(supabase, agentId, "sms");

    return new Response(
      JSON.stringify({
        success: true,
        message: apiMessage || "SMS sent successfully",
        phone: cleanPhone,
        shipment_id: shipmentId,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    // Log full error details server-side for debugging
    console.error("Error in send-sms function:", error);
    
    // Return generic error message to client - never expose internal details
    return new Response(
      JSON.stringify({ error: "An error occurred. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
