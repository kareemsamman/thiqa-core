import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Notify X-Service about policy lifecycle changes: cancel, delete, transfer, update.
 *
 * Body:
 * {
 *   action: "cancel" | "delete" | "transfer" | "update",
 *   policy_id: string,
 *   transfer_to_car?: { car_number: string, manufacturer?: string, model?: string, year?: number, color?: string }
 * }
 *
 * OR for batch delete (from delete-policy edge function using service role):
 * {
 *   action: "delete",
 *   policies: Array<{ policy_id, client, car, policy_details }>
 * }
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const body = await req.json();
    const { action, policy_id, transfer_to_car, policies } = body;

    if (!action || (!policy_id && !policies)) {
      return new Response(JSON.stringify({ error: "action and policy_id (or policies) required" }), {
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

    if (settingsErr || !settings || !settings.is_enabled) {
      return new Response(JSON.stringify({ skipped: true, reason: "sync disabled or not configured" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!settings.api_url || !settings.api_key) {
      return new Response(JSON.stringify({ skipped: true, reason: "API URL or key not set" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rawUrl = settings.api_url.replace(/\/+$/, "");
    const syncUrl = rawUrl.includes("/functions/v1/")
      ? rawUrl.replace(/ab-sync-receive\/?$/, "ab-sync-update")
      : `${rawUrl}/functions/v1/ab-sync-update`;

    // Batch mode (used by delete-policy edge function)
    if (policies && Array.isArray(policies)) {
      const results = [];
      for (const p of policies) {
        const payload = {
          api_key: settings.api_key,
          action: p.action || action,
          customer: p.client,
          car: p.car,
          policy: p.policy_details,
        };

        try {
          const resp = await fetch(syncUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          const respBody = await resp.json().catch(() => null);
          await logSync(supabase, p.policy_id, resp.ok ? "success" : "failed", action, respBody?.error || null, payload, respBody);
          results.push({ policy_id: p.policy_id, ok: resp.ok });
        } catch (err) {
          await logSync(supabase, p.policy_id, "failed", action, String(err), payload, null);
          results.push({ policy_id: p.policy_id, ok: false, error: String(err) });
        }
      }

      return new Response(JSON.stringify({ success: true, results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Single policy mode (cancel / transfer from frontend)
    const { data: policy, error: policyErr } = await supabase
      .from("policies")
      .select(`
        id, policy_type_parent, policy_number, start_date, end_date,
        payed_for_company, notes, car_id, client_id,
        road_service_id, accident_fee_service_id
      `)
      .eq("id", policy_id)
      .single();

    if (policyErr || !policy) {
      return new Response(JSON.stringify({ skipped: true, reason: "Policy not found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Only sync service-type policies
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
      .select("full_name, id_number, phone_number")
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

    const serviceType = policyType === "ROAD_SERVICE" ? "road_service" : "accident_fee";

    const requestPayload: Record<string, unknown> = {
      api_key: settings.api_key,
      action,
      customer: {
        full_name: client?.full_name || "",
        id_number: client?.id_number || "",
        phone1: client?.phone_number || "",
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
        policy_number: policy.policy_number,
        start_date: policy.start_date,
        end_date: policy.end_date,
        sell_price: policy.payed_for_company || 0,
        notes: policy.notes || "",
      },
    };

    if (action === "transfer" && transfer_to_car) {
      requestPayload.transfer_to_car = transfer_to_car;
    }

    console.log(`[notify-xservice-change] action=${action} policy=${policy_id} -> ${syncUrl}`);

    const response = await fetch(syncUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestPayload),
    });

    const responseBody = await response.json().catch(() => null);

    await logSync(
      supabase,
      policy_id,
      response.ok ? "success" : "failed",
      action,
      response.ok ? null : (responseBody?.error || `HTTP ${response.status}`),
      requestPayload,
      responseBody
    );

    return new Response(JSON.stringify({ success: response.ok, xservice_response: responseBody }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[notify-xservice-change] Unexpected error:", err);
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
  action: string,
  errorMessage: string | null,
  requestPayload: any,
  responsePayload: any
) {
  try {
    await supabase.from("xservice_sync_log").insert({
      policy_id: policyId,
      status,
      error_message: errorMessage ? `[${action}] ${errorMessage}` : null,
      request_payload: requestPayload,
      response_payload: responsePayload,
    });
  } catch (e) {
    console.error("[notify-xservice-change] Failed to log sync:", e);
  }
}
