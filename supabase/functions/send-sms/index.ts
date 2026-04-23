import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import { checkUsageLimit, limitReachedResponse, logUsage } from "../_shared/usage-limits.ts";
import { getAgentBranding } from "../_shared/agent-branding.ts";
import { appendSmsFooter } from "../_shared/sms-footer.ts";
import { resolveSmsSettings } from "../_shared/sms-settings.ts";
import { sendSms, normalizePhoneFor } from "../_shared/sms-sender.ts";

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

    // Resolve provider + credentials (agent override → platform default).
    const smsSettings = await resolveSmsSettings(supabase, agentId);
    if (!smsSettings) {
      return new Response(
        JSON.stringify({ error: "SMS settings are incomplete. Please contact support." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Append the agent-branded footer (owner name + phones) before sending.
    const branding = await getAgentBranding(supabase, agentId);
    const finalMessage = appendSmsFooter(message, branding);

    const cleanPhone = normalizePhoneFor(smsSettings.provider, phone);
    console.log(`Sending SMS via ${smsSettings.provider} to ${cleanPhone}`);

    const result = await sendSms(smsSettings, phone, finalMessage);
    console.log(`${smsSettings.provider} raw response:`, result.rawResponse);

    if (!result.success) {
      return new Response(
        JSON.stringify({
          error: result.error || "SMS API error",
          provider: result.provider,
          http_status: result.httpStatus,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log SMS to sms_logs table (store the actual delivered text including footer)
    const { error: logError } = await supabase.from('sms_logs').insert({
      phone_number: cleanPhone,
      message: finalMessage,
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
        message: result.apiMessage || "SMS sent successfully",
        provider: result.provider,
        phone: cleanPhone,
        shipment_id: result.shipmentId,
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
