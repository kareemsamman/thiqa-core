import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SubmitSignatureRequest {
  token: string;
  signature_data_url: string; // Base64 data URL of signature image
}

// Rate limiting configuration
const RATE_LIMIT_WINDOW_MS = 3600000; // 1 hour
const MAX_ATTEMPTS_PER_IP = 15; // 15 submission attempts per hour per IP

// In-memory rate limit store (resets on cold start, but provides basic protection)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

function checkRateLimit(ipAddress: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const key = `sig_submit:${ipAddress}`;
  
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

  const startTime = Date.now();

  try {
    // Get IP for rate limiting
    const ipAddress = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || 
                      req.headers.get("cf-connecting-ip") || 
                      "unknown";
    
    // Check rate limit
    const { allowed, remaining } = checkRateLimit(ipAddress);
    if (!allowed) {
      console.log(`[submit-signature] Rate limit exceeded for IP: ${ipAddress.substring(0, 10)}...`);
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

    const { token, signature_data_url }: SubmitSignatureRequest = await req.json();

    if (!token) {
      return new Response(
        JSON.stringify({ error: "Token is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!signature_data_url) {
      return new Response(
        JSON.stringify({ error: "Signature data is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[submit-signature] Processing token: ${token.substring(0, 8)}... from IP: ${ipAddress.substring(0, 10)}...`);

    // Find signature record by token
    const { data: signatureRecord, error: signatureError } = await supabase
      .from("customer_signatures")
      .select("*, client:clients(id, full_name, signature_url)")
      .eq("token", token)
      .maybeSingle();

    // Log token not found - don't reveal whether token exists
    if (signatureError || !signatureRecord) {
      console.log("[submit-signature] Token not found or invalid");
      return new Response(
        JSON.stringify({ error: "Invalid or expired signature link" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if token is expired
    if (signatureRecord.token_expires_at && new Date(signatureRecord.token_expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ error: "Signature link has expired" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if already signed (has signature_image_url)
    if (signatureRecord.signature_image_url && signatureRecord.signature_image_url !== "") {
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: "Signature already submitted",
          signed_at: signatureRecord.signed_at
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Upload signature to Bunny CDN
    const bunnyApiKey = Deno.env.get("BUNNY_API_KEY");
    const bunnyStorageZone = Deno.env.get("BUNNY_STORAGE_ZONE");
    const bunnyCdnUrl = Deno.env.get('BUNNY_CDN_URL') || 'https://kareem.b-cdn.net';

    if (!bunnyApiKey || !bunnyStorageZone) {
      console.error("[submit-signature] Missing Bunny configuration");
      return new Response(
        JSON.stringify({ error: "Storage configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Convert base64 to binary
    const base64Data = signature_data_url.split(",")[1];
    const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

    // Generate unique filename
    const timestamp = Date.now();
    const fileName = `signatures/${signatureRecord.client_id}/${timestamp}.png`;

    // Upload to Bunny Storage
    const uploadResponse = await fetch(
      `https://storage.bunnycdn.com/${bunnyStorageZone}/${fileName}`,
      {
        method: "PUT",
        headers: {
          "AccessKey": bunnyApiKey,
          "Content-Type": "image/png",
        },
        body: binaryData,
      }
    );

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error("[submit-signature] Bunny upload failed:", errorText);
      return new Response(
        JSON.stringify({ error: "Failed to upload signature" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const signatureImageUrl = `${bunnyCdnUrl}/${fileName}`;
    console.log(`[submit-signature] Signature uploaded: ${signatureImageUrl}`);

    // Get request metadata (ipAddress already captured at start for rate limiting)
    const userAgent = req.headers.get("user-agent") || "unknown";

    // Update signature record
    const { error: updateSignatureError } = await supabase
      .from("customer_signatures")
      .update({
        signature_image_url: signatureImageUrl,
        signed_at: new Date().toISOString(),
        ip_address: ipAddress,
        user_agent: userAgent,
        token: null, // Invalidate token after use
        token_expires_at: null,
      })
      .eq("id", signatureRecord.id);

    if (updateSignatureError) {
      console.error("[submit-signature] Error updating signature record:", updateSignatureError);
    }

    // Update client with permanent signature URL
    const { error: updateClientError } = await supabase
      .from("clients")
      .update({ signature_url: signatureImageUrl })
      .eq("id", signatureRecord.client_id);

    if (updateClientError) {
      console.error("[submit-signature] Error updating client:", updateClientError);
    }

    const duration = Date.now() - startTime;
    console.log(`[submit-signature] Completed in ${duration}ms`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Signature submitted successfully",
        signature_url: signatureImageUrl,
        duration_ms: duration
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    // Log full error details server-side for debugging
    console.error("[submit-signature] Fatal error:", error);
    
    // Return generic error message to client - never expose internal details
    return new Response(
      JSON.stringify({ error: "An error occurred. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
