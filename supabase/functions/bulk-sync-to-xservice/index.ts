import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

async function getAllSyncedPolicyIds(supabase: any): Promise<Set<string>> {
  const ids = new Set<string>();
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data } = await supabase
      .from("xservice_sync_log")
      .select("policy_id")
      .eq("status", "success")
      .range(from, from + pageSize - 1);
    if (!data || data.length === 0) break;
    for (const r of data) ids.add(r.policy_id);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return ids;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const { offset = 0, limit = 20 } = await req.json();

    // 1. Fetch settings
    const { data: settings, error: settingsErr } = await supabase
      .from("xservice_settings")
      .select("*")
      .limit(1)
      .single();

    if (settingsErr || !settings || !settings.is_enabled || !settings.api_url || !settings.api_key) {
      return new Response(JSON.stringify({ error: "X-Service not configured or disabled" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Build type filter
    const types: string[] = [];
    if (settings.sync_road_service) types.push("ROAD_SERVICE");
    if (settings.sync_accident_fee) types.push("ACCIDENT_FEE_EXEMPTION");
    if (types.length === 0) {
      return new Response(JSON.stringify({ error: "No sync types enabled" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Get ALL already-synced policy IDs (paginated to avoid 1000-row limit)
    const syncedIds = await getAllSyncedPolicyIds(supabase);

    // 4. Fetch a larger batch of candidates, then filter out synced in-memory
    // This avoids the massive NOT IN (...) query that breaks with 400+ UUIDs
    const fetchSize = Math.max(limit * 3, 100); // fetch more to account for filtering
    let candidates: any[] = [];
    let dbOffset = offset;
    let totalScanned = 0;

    while (candidates.length < limit) {
      const { data: batch, error: bErr } = await supabase
        .from("policies")
        .select("id, policy_type_parent, policy_number, start_date, end_date, insurance_price, payed_for_company, notes, car_id, client_id, road_service_id, accident_fee_service_id")
        .in("policy_type_parent", types)
        .is("deleted_at", null)
        .or("road_service_id.not.is.null,accident_fee_service_id.not.is.null")
        .order("created_at", { ascending: true })
        .range(dbOffset, dbOffset + fetchSize - 1);

      if (bErr || !batch || batch.length === 0) break;

      for (const p of batch) {
        if (!syncedIds.has(p.id) && candidates.length < limit) {
          candidates.push(p);
        }
      }
      totalScanned += batch.length;
      dbOffset += batch.length;

      // If we got fewer than requested, we've exhausted the table
      if (batch.length < fetchSize) break;
    }

    // 5. Count total eligible (all service policies minus synced)
    const { count: totalAllCount } = await supabase
      .from("policies")
      .select("id", { count: "exact", head: true })
      .in("policy_type_parent", types)
      .is("deleted_at", null)
      .or("road_service_id.not.is.null,accident_fee_service_id.not.is.null");

    const totalEligible = (totalAllCount || 0) - syncedIds.size;

    const rawUrl = settings.api_url.replace(/\/+$/, "");
    const syncUrl = rawUrl.includes("/functions/v1/")
      ? rawUrl
      : `${rawUrl}/functions/v1/ab-sync-receive`;

    let synced = 0;
    let failed = 0;

    for (const policy of candidates) {
      try {
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

        const serviceType = policy.policy_type_parent === "ROAD_SERVICE" ? "road_service" : "accident_fee";

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

        const response = await fetch(syncUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestPayload),
        });

        const responseBody = await response.json().catch(() => null);

        if (response.ok) {
          synced++;
          const xservicePolicyId = responseBody?.policy_id || responseBody?.policy_number || null;
          await supabase.from("xservice_sync_log").insert({
            policy_id: policy.id,
            status: "success",
            xservice_policy_id: xservicePolicyId,
            request_payload: requestPayload,
            response_payload: responseBody,
          });
        } else {
          failed++;
          await supabase.from("xservice_sync_log").insert({
            policy_id: policy.id,
            status: "failed",
            error_message: responseBody?.error || `HTTP ${response.status}`,
            request_payload: requestPayload,
            response_payload: responseBody,
          });
        }
      } catch (e) {
        failed++;
        await supabase.from("xservice_sync_log").insert({
          policy_id: policy.id,
          status: "failed",
          error_message: String(e),
          request_payload: {},
          response_payload: null,
        });
      }
    }

    const processedSoFar = offset + candidates.length;
    const done = candidates.length === 0 || processedSoFar >= totalEligible;

    return new Response(JSON.stringify({
      synced,
      failed,
      processed: candidates.length,
      total: totalEligible,
      done,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[bulk-sync-to-xservice] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
