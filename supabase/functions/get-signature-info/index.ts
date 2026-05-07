import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import { getAgentBranding } from "../_shared/agent-branding.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Rate limiting configuration
const RATE_LIMIT_WINDOW_MS = 3600000; // 1 hour
const MAX_ATTEMPTS_PER_IP = 30; // 30 attempts per hour per IP

// In-memory rate limit store (resets on cold start, but provides basic protection)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

function checkRateLimit(ipAddress: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const key = `sig_info:${ipAddress}`;
  
  const existing = rateLimitStore.get(key);
  
  if (!existing || existing.resetTime < now) {
    rateLimitStore.set(key, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, remaining: MAX_ATTEMPTS_PER_IP - 1 };
  }
  
  if (existing.count >= MAX_ATTEMPTS_PER_IP) {
    return { allowed: false, remaining: 0 };
  }
  
  existing.count++;
  return { allowed: true, remaining: MAX_ATTEMPTS_PER_IP - existing.count };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get IP for rate limiting
    const ipAddress = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || 
                      req.headers.get("cf-connecting-ip") || 
                      "unknown";
    
    // Check rate limit
    const { allowed, remaining } = checkRateLimit(ipAddress);
    if (!allowed) {
      console.log(`[get-signature-info] Rate limit exceeded for IP: ${ipAddress.substring(0, 10)}...`);
      return new Response(
        JSON.stringify({ error: "Too many requests. Please try again later." }),
        { 
          status: 429, 
          headers: { 
            ...corsHeaders, 
            "Content-Type": "application/json",
            "Retry-After": "3600"
          } 
        }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const url = new URL(req.url);
    const token = url.searchParams.get("token");

    if (!token) {
      return new Response(
        JSON.stringify({ error: "Token is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[get-signature-info] Looking up token: ${token.substring(0, 8)}... from IP: ${ipAddress.substring(0, 10)}...`);

    // Find signature record by token
    const { data: signatureRecord, error: signatureError } = await supabase
      .from("customer_signatures")
      .select(`
        id,
        token_expires_at,
        signature_image_url,
        signed_at,
        client_id
      `)
      .eq("token", token)
      .maybeSingle();

    // Get client name and resolve the owning agent so branding + any
    // signature template can be loaded scoped to that tenant.
    let clientName = "عميل";
    let clientAgentId: string | null = null;
    if (signatureRecord?.client_id) {
      const { data: clientData } = await supabase
        .from("clients")
        .select("full_name, agent_id")
        .eq("id", signatureRecord.client_id)
        .single();
      if (clientData) {
        clientName = clientData.full_name;
        clientAgentId = clientData.agent_id;
      }
    }

    // Log token not found - don't reveal whether token exists
    if (signatureError || !signatureRecord) {
      console.log("[get-signature-info] Token not found or invalid");
      return new Response(
        JSON.stringify({ error: "Invalid or expired signature link" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if token is expired
    if (signatureRecord.token_expires_at && new Date(signatureRecord.token_expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ error: "Signature link has expired", expired: true }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if already signed
    if (signatureRecord.signature_image_url && signatureRecord.signature_image_url !== "") {
      return new Response(
        JSON.stringify({
          valid: false,
          already_signed: true,
          client_name: clientName,
          signed_at: signatureRecord.signed_at,
          message: "Signature already submitted"
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Compose the customer-facing signature content. The agent's
    // BrandingSettings (site_settings.signature_*_html) is the source
    // of truth — anything the agent edits in the admin UI must show up
    // here. An invoice_templates row (pointed at by
    // sms_settings.default_signature_template_id) only fills any
    // field the agent left blank, so it can't silently override saved
    // changes. Both lookups are scoped to the client's agent so a
    // template from another tenant can't leak in.
    const branding = await getAgentBranding(supabase, clientAgentId);
    const templateContent: {
      header_html: string;
      body_html: string;
      footer_html: string;
      logo_url: string | null;
      direction: string;
      // New: lets the customer page render the agent's branding inside
      // the standard Thiqa hero (instead of replacing the layout with
      // the agent's raw HTML). Falls back to defaults from
      // DEFAULT_BRANDING when the agent hasn't customized.
      primary_color: string;
      company_name: string;
    } = {
      header_html: branding.signatureHeaderHtml,
      body_html: branding.signatureBodyHtml.replace(/الشركة/g, branding.companyName),
      footer_html: branding.signatureFooterHtml.replace(/جميع الحقوق محفوظة/g, `© ${branding.companyName} - جميع الحقوق محفوظة`),
      logo_url: branding.logoUrl,
      direction: "rtl",
      primary_color: branding.signaturePrimaryColor,
      company_name: branding.companyName,
    };

    if (clientAgentId) {
      const { data: smsSettings } = await supabase
        .from("sms_settings")
        .select("default_signature_template_id")
        .eq("agent_id", clientAgentId)
        .maybeSingle();

      if (smsSettings?.default_signature_template_id) {
        const { data: template } = await supabase
          .from("invoice_templates")
          .select("header_html, body_html, footer_html, logo_url, direction")
          .eq("id", smsSettings.default_signature_template_id)
          .maybeSingle();

        if (template) {
          if (!templateContent.header_html && template.header_html) {
            templateContent.header_html = template.header_html;
          }
          if (!templateContent.body_html && template.body_html) {
            templateContent.body_html = template.body_html;
          }
          if (!templateContent.footer_html && template.footer_html) {
            templateContent.footer_html = template.footer_html;
          }
          if (!templateContent.logo_url && template.logo_url) {
            templateContent.logo_url = template.logo_url;
          }
          if (template.direction) {
            templateContent.direction = template.direction;
          }
        }
      }
    }

    return new Response(
      JSON.stringify({ 
        valid: true,
        client_name: clientName,
        expires_at: signatureRecord.token_expires_at,
        template: templateContent
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    // Log full error details server-side for debugging
    console.error("[get-signature-info] Fatal error:", error);
    
    // Return generic error message to client - never expose internal details
    return new Response(
      JSON.stringify({ error: "An error occurred. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
