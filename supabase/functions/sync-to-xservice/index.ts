import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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
    const { data: settings, error: settingsErr } = await supabase
      .from("xservice_settings")
      .select("*")
      .limit(1)
      .single();

    if (settingsErr || !settings) {
      console.error("No xservice_settings found", settingsErr);
      return new Response(JSON.stringify({ error: "X-Service settings not configured" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!settings.is_enabled) {
      return new Response(JSON.stringify({ skipped: true, reason: "sync disabled" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!settings.api_url || !settings.api_key) {
      return new Response(JSON.stringify({ error: "API URL or key not set" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Fetch policy + client + car
    const { data: policy, error: policyErr } = await supabase
      .from("policies")
      .select(`
        id, policy_type_parent, policy_number, start_date, end_date,
        insurance_price, payed_for_company, notes, car_id, client_id,
        road_service_id, accident_fee_service_id, branch_id, agent_id
      `)
      .eq("id", policy_id)
      .single();

    if (policyErr || !policy) {
      console.error("Policy not found", policyErr);
      await logSync(supabase, policy_id, "failed", null, "Policy not found", {}, null);
      return new Response(JSON.stringify({ error: "Policy not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if this policy type should be synced
    const policyType = policy.policy_type_parent;
    const shouldSync =
      (policyType === "ROAD_SERVICE" && settings.sync_road_service) ||
      (policyType === "ACCIDENT_FEE_EXEMPTION" && settings.sync_accident_fee);

    if (!shouldSync) {
      return new Response(JSON.stringify({ skipped: true, reason: "type not enabled for sync" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch client
    const { data: client } = await supabase
      .from("clients")
      .select("full_name, id_number, phone_number, phone_number_2, birth_date")
      .eq("id", policy.client_id)
      .single();

    // Fetch car
    let car = null;
    if (policy.car_id) {
      const { data: carData } = await supabase
        .from("cars")
        .select("car_number, car_type, manufacturer_name, model, year, color")
        .eq("id", policy.car_id)
        .single();
      car = carData;
    }

    // Fetch service name
    let serviceName = null;
    if (policy.road_service_id) {
      const { data: svc } = await supabase
        .from("road_services")
        .select("name_ar, name")
        .eq("id", policy.road_service_id)
        .single();
      serviceName = svc?.name_ar || svc?.name || null;
    }
    if (!serviceName && policy.accident_fee_service_id) {
      const { data: svc } = await supabase
        .from("accident_fee_services")
        .select("name_ar, name")
        .eq("id", policy.accident_fee_service_id)
        .single();
      serviceName = svc?.name_ar || svc?.name || null;
    }

    // Map service_type
    const serviceType = policyType === "ROAD_SERVICE" ? "road_service" : "accident_fee";

    const requestPayload = {
      api_key: settings.api_key,
      customer: {
        full_name: client?.full_name || "",
        id_number: client?.id_number || "",
        phone1: client?.phone_number || "",
        phone2: client?.phone_number_2 || "",
        birth_date: client?.birth_date || null,
      },
      car: {
        car_number: car?.car_number || "",
        car_type: car?.car_type || null,
        manufacturer: car?.manufacturer_name || "",
        model: car?.model || "",
        year: car?.year || null,
        color: car?.color || "",
      },
      policy: {
        service_type: serviceType,
        service_id: policy.road_service_id || policy.accident_fee_service_id || null,
        service_name: serviceName,
        start_date: policy.start_date,
        end_date: policy.end_date,
        sell_price: policy.insurance_price || 0,
        notes: policy.notes || "",
      },
    };

    // 3. Send to X-Service
    const rawUrl = settings.api_url.replace(/\/+$/, "");
    // Smart URL: if it already contains /functions/v1/ use as-is, otherwise append
    const syncUrl = rawUrl.includes("/functions/v1/")
      ? rawUrl
      : `${rawUrl}/functions/v1/ab-sync-receive`;

    console.log(`[sync-to-xservice] Sending to ${syncUrl}`);

    const response = await fetch(syncUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestPayload),
    });

    const responseBody = await response.json().catch(() => null);

    if (!response.ok) {
      const errMsg = responseBody?.error || `HTTP ${response.status}`;
      await logSync(supabase, policy_id, "failed", null, errMsg, requestPayload, responseBody);
      return new Response(JSON.stringify({ error: errMsg }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const xservicePolicyId = responseBody?.policy_id || responseBody?.policy_number || null;
    await logSync(supabase, policy_id, "success", xservicePolicyId, null, requestPayload, responseBody);

    // Auto-save X-Service invoice URL to policy files
    if (xservicePolicyId && settings.invoice_base_url) {
      const invoiceUrl = `${settings.invoice_base_url.replace(/\/+$/, "")}/invoice/${xservicePolicyId}`;
      const { error: insertErr } = await supabase.from("media_files").insert({
        original_name: "فاتورة X-Service.pdf",
        mime_type: "application/pdf",
        size: 0,
        cdn_url: invoiceUrl,
        storage_path: null,
        entity_type: "policy_insurance",
        entity_id: policy_id,
        uploaded_by: null,
        branch_id: policy.branch_id || null,
      });
      if (insertErr) {
        console.error("[sync-to-xservice] Failed to save invoice URL:", insertErr.message);
      } else {
        console.log(`[sync-to-xservice] Saved invoice URL: ${invoiceUrl}`);
      }
    }

    return new Response(JSON.stringify({ success: true, xservice_response: responseBody }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[sync-to-xservice] Unexpected error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function logSync(
  supabase: any,
  policyId: string,
  status: string,
  xservicePolicyId: string | null,
  errorMessage: string | null,
  requestPayload: any,
  responsePayload: any
) {
  try {
    await supabase.from("xservice_sync_log").insert({
      policy_id: policyId,
      status,
      xservice_policy_id: xservicePolicyId,
      error_message: errorMessage,
      request_payload: requestPayload,
      response_payload: responsePayload,
    });
  } catch (e) {
    console.error("[sync-to-xservice] Failed to log sync:", e);
  }
}
