import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Verify the caller is authenticated
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify user is admin using anon client
    const anonClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await anonClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if user is admin
    const { data: profile } = await anonClient
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    const { data: userRole } = await anonClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (profile?.role !== "admin" && !userRole) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use service role client for imports (bypasses RLS)
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json();
    const { table, data, onConflict } = body;

    if (!table || !data || !Array.isArray(data) || data.length === 0) {
      return new Response(
        JSON.stringify({ error: "Missing table or data" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate table name (whitelist)
    const allowedTables = [
      "branches", "brokers", "insurance_companies", "insurance_categories",
      "pricing_rules", "clients", "cars", "car_accidents", "policies",
      "policy_payments", "policy_groups", "outside_cheques", "media_files",
      "invoice_templates", "invoices", "customer_signatures", "sms_settings",
      "payment_settings", "profiles", "user_roles", "notifications",
      "login_attempts", "client_notes", "client_debits", "client_children",
      "client_payments", "correspondence_letters", "business_contacts",
      "tasks", "expenses", "cheque_reminders", "sms_logs", "automated_sms_log",
      "road_services", "accident_fee_services", "company_road_service_prices",
      "company_accident_fee_prices", "company_accident_templates",
      "auth_settings", "site_settings", "xservice_settings",
      "form_templates", "repair_claims", "lead_chats", "lead_notes",
      "ab_ledger", "broker_settlements", "broker_settlement_items",
      "company_settlements", "company_settlement_items",
      "accident_reports", "accident_third_parties", "accident_report_files",
      "accident_report_notes", "accident_report_reminders",
      "accident_injured_persons", "customer_wallet_transactions",
      "announcement_dismissals", "announcements",
    ];

    if (!allowedTables.includes(table)) {
      return new Response(
        JSON.stringify({ error: `Table '${table}' is not allowed for import` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Upsert in batches of 200
    const batchSize = 200;
    let imported = 0;
    const errors: string[] = [];

    for (let i = 0; i < data.length; i += batchSize) {
      const batch = data.slice(i, i + batchSize);
      const { error } = await adminClient
        .from(table)
        .upsert(batch, { onConflict: onConflict || "id", ignoreDuplicates: true });

      if (error) {
        errors.push(`Batch ${Math.floor(i / batchSize)}: ${error.message}`);
      } else {
        imported += batch.length;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        table,
        total: data.length,
        imported,
        errors: errors.length > 0 ? errors : undefined,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
