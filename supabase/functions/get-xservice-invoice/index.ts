import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Fetch invoice URL from X-Service for a given policy.
 *
 * Body: { policy_id: string }
 *
 * Returns: { invoice_url, invoice_id, exists }
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const { policy_id } = await req.json();

    if (!policy_id) {
      return new Response(JSON.stringify({ error: "policy_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Fetch xservice settings
    const { data: settings } = await supabase
      .from("xservice_settings")
      .select("*")
      .limit(1)
      .single();

    if (!settings || !settings.is_enabled || !settings.api_url || !settings.api_key) {
      return new Response(JSON.stringify({ exists: false, reason: "sync disabled or not configured" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Fetch policy + client + car info
    const { data: policy, error: policyErr } = await supabase
      .from("policies")
      .select(`
        id, policy_type_parent, policy_number, start_date, end_date,
        payed_for_company, car_id, client_id,
        clients!inner(full_name, id_number, phone_number),
        cars(car_number)
      `)
      .eq("id", policy_id)
      .single();

    if (policyErr || !policy) {
      return new Response(JSON.stringify({ exists: false, reason: "Policy not found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Only service-type policies have X-Service invoices
    const policyType = policy.policy_type_parent;
    if (policyType !== "ROAD_SERVICE" && policyType !== "ACCIDENT_FEE_EXEMPTION") {
      return new Response(JSON.stringify({ exists: false, reason: "Not a service policy" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceType = policyType === "ROAD_SERVICE" ? "road_service" : "accident_fee";
    const client = (policy as any).clients;
    const car = (policy as any).cars;

    // 3. Build the invoice request URL
    const rawUrl = settings.api_url.replace(/\/+$/, "");
    const invoiceUrl = rawUrl.includes("/functions/v1/")
      ? rawUrl.replace(/ab-sync-receive\/?$/, "ab-get-invoice")
      : `${rawUrl}/functions/v1/ab-get-invoice`;

    const payload = {
      api_key: settings.api_key,
      customer_id_number: client?.id_number || "",
      car_number: car?.car_number || "",
      service_type: serviceType,
      start_date: policy.start_date,
    };

    console.log(`[get-xservice-invoice] Fetching invoice for policy=${policy_id} -> ${invoiceUrl}`);

    const response = await fetch(invoiceUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const responseBody = await response.json().catch(() => null);

    if (!response.ok || !responseBody?.exists) {
      return new Response(JSON.stringify({
        exists: false,
        reason: responseBody?.error || "Invoice not found in X-Service",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      exists: true,
      invoice_url: responseBody.invoice_url,
      invoice_id: responseBody.invoice_id,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[get-xservice-invoice] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
