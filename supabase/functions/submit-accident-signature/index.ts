 import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
 import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
 
 const corsHeaders = {
   "Access-Control-Allow-Origin": "*",
   "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
 };
 
 interface SubmitAccidentSignatureRequest {
   token: string;
   signature_data_url: string;
 }
 
 // Rate limiting configuration
 const RATE_LIMIT_WINDOW_MS = 3600000; // 1 hour
 const MAX_ATTEMPTS_PER_IP = 15;
 
 const rateLimitStore = new Map<string, { count: number; resetTime: number }>();
 
 function checkRateLimit(ipAddress: string): { allowed: boolean; remaining: number } {
   const now = Date.now();
   const key = `accident_sig:${ipAddress}`;
   
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
       console.log(`[submit-accident-signature] Rate limit exceeded for IP: ${ipAddress.substring(0, 10)}...`);
       return new Response(
         JSON.stringify({ error: "طلبات كثيرة. يرجى المحاولة لاحقاً." }),
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
 
     const { token, signature_data_url }: SubmitAccidentSignatureRequest = await req.json();
 
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
 
     console.log(`[submit-accident-signature] Processing token: ${token.substring(0, 8)}... from IP: ${ipAddress.substring(0, 10)}...`);
 
     // Find accident report by token
     const { data: report, error: reportError } = await supabase
       .from("accident_reports")
       .select("id, client_id, branch_id, customer_signature_url, signature_token_expires_at")
       .eq("signature_token", token)
       .maybeSingle();
 
     if (reportError || !report) {
       console.log("[submit-accident-signature] Token not found or invalid");
       return new Response(
         JSON.stringify({ error: "رابط التوقيع غير صالح أو منتهي الصلاحية" }),
         { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
       );
     }
 
     // Check if token is expired
     if (report.signature_token_expires_at && new Date(report.signature_token_expires_at) < new Date()) {
       return new Response(
         JSON.stringify({ error: "انتهت صلاحية رابط التوقيع" }),
         { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
       );
     }
 
     // Check if already signed
     if (report.customer_signature_url) {
       return new Response(
         JSON.stringify({ 
           success: false, 
           message: "البلاغ موقع مسبقاً",
           signed_at: report.customer_signature_url
         }),
         { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
       );
     }
 
     // Upload signature to Bunny CDN
     const bunnyApiKey = Deno.env.get("BUNNY_API_KEY");
     const bunnyStorageZone = Deno.env.get("BUNNY_STORAGE_ZONE");
     const bunnyCdnUrl = Deno.env.get('BUNNY_CDN_URL') || 'https://kareem.b-cdn.net';
 
     if (!bunnyApiKey || !bunnyStorageZone) {
       console.error("[submit-accident-signature] Missing Bunny configuration");
       return new Response(
         JSON.stringify({ error: "خطأ في إعدادات التخزين" }),
         { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
       );
     }
 
     // Convert base64 to binary
     const base64Data = signature_data_url.split(",")[1];
     const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
 
     // Generate unique filename
     const timestamp = Date.now();
     const fileName = `accident-signatures/${report.id}/${timestamp}.png`;
 
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
       console.error("[submit-accident-signature] Bunny upload failed:", errorText);
       return new Response(
         JSON.stringify({ error: "فشل في رفع التوقيع" }),
         { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
       );
     }
 
     const signatureImageUrl = `${bunnyCdnUrl}/${fileName}`;
     console.log(`[submit-accident-signature] Signature uploaded: ${signatureImageUrl}`);
 
     // Get request metadata
     const userAgent = req.headers.get("user-agent") || "unknown";
 
     // Update accident report
     const { error: updateError } = await supabase
       .from("accident_reports")
       .update({
         customer_signature_url: signatureImageUrl,
         customer_signed_at: new Date().toISOString(),
         customer_signature_ip: ipAddress,
         signature_token: null, // Invalidate token
         signature_token_expires_at: null,
       })
       .eq("id", report.id);
 
     if (updateError) {
       console.error("[submit-accident-signature] Error updating report:", updateError);
       return new Response(
         JSON.stringify({ error: "فشل في حفظ التوقيع" }),
         { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
       );
     }
 
     const duration = Date.now() - startTime;
     console.log(`[submit-accident-signature] Completed in ${duration}ms`);
 
     return new Response(
       JSON.stringify({ 
         success: true, 
         message: "تم حفظ التوقيع بنجاح",
         signature_url: signatureImageUrl,
         duration_ms: duration
       }),
       { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
     );
 
   } catch (error: unknown) {
     console.error("[submit-accident-signature] Fatal error:", error);
     return new Response(
       JSON.stringify({ error: "حدث خطأ. يرجى المحاولة مرة أخرى." }),
       { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
     );
   }
 });