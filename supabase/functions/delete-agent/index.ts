import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) throw new Error("Missing authorization");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const adminClient = createClient(supabaseUrl, serviceKey);

    // Verify caller is a super admin using the JWT token
    const token = authHeader.replace("Bearer ", "");
    const { data: { user: caller }, error: callerError } = await adminClient.auth.getUser(token);
    if (callerError || !caller) throw new Error("Unauthorized");

    const { data: isSA } = await adminClient.rpc("is_super_admin", { _user_id: caller.id });
    if (!isSA) throw new Error("Not a super admin");

    const { agent_id } = await req.json();
    if (!agent_id) throw new Error("Missing agent_id");

    // Get all users linked to this agent
    const { data: agentUsers } = await adminClient
      .from("agent_users")
      .select("user_id")
      .eq("agent_id", agent_id);

    const userIds = (agentUsers || []).map((u: any) => u.user_id);

    // Delete in dependency order
    // All tables with agent_id — ordered so child tables are deleted before parents
    const agentTables = [
      // Accident sub-tables
      "accident_report_files", "accident_report_notes", "accident_report_reminders",
      "accident_injured_persons", "accident_third_parties", "accident_reports",
      // Broker/settlement sub-tables
      "settlement_supplements", "broker_settlement_items", "broker_settlements",
      "company_settlements", "company_accident_fee_prices", "company_accident_templates",
      "company_road_service_prices",
      // Policy sub-tables
      "policy_children", "policy_reminders", "policy_renewal_tracking", "policy_transfers",
      "policy_groups", "policy_payments",
      // Client sub-tables
      "client_children", "client_debits", "client_notes", "client_payments",
      "customer_wallet_transactions",
      // Repair sub-tables
      "repair_claim_notes", "repair_claim_reminders", "repair_claims",
      // Payment/invoice
      "payment_images", "ab_ledger", "invoices", "invoice_templates",
      // Lead/marketing
      "lead_messages", "leads", "marketing_sms_recipients", "marketing_sms_campaigns",
      // Main business tables
      "policies", "car_accidents", "cars", "clients",
      "pricing_rules", "insurance_categories", "insurance_companies", "insurance_company_groups",
      "brokers", "outside_cheques", "media_files", "expenses",
      "customer_signatures", "form_template_files", "form_template_folders",
      // Communication
      "notifications", "automated_sms_log", "sms_logs",
      "correspondence_letters", "tasks", "business_contacts",
      // Services
      "road_services", "accident_fee_services", "pbx_extensions",
      // AI
      "ai_chat_sessions",
      // Announcements
      "announcements",
      // Branch
      "branches",
      // Agent config
      "agent_subscription_payments", "agent_feature_flags",
      "sms_settings", "auth_settings", "payment_settings", "site_settings", "xservice_settings",
    ];

    for (const table of agentTables) {
      const { error } = await adminClient.from(table).delete().eq("agent_id", agent_id);
      if (error) {
        console.log(`Skipped ${table}: ${error.message}`);
      }
    }

    // Delete user_roles for agent users
    for (const uid of userIds) {
      await adminClient.from("user_roles").delete().eq("user_id", uid);
    }

    // Delete agent_users
    await adminClient.from("agent_users").delete().eq("agent_id", agent_id);

    // Delete profiles linked to this agent
    await adminClient.from("profiles").delete().eq("agent_id", agent_id);

    // Delete the agent
    const { error: agentError } = await adminClient.from("agents").delete().eq("id", agent_id);
    if (agentError) throw agentError;

    // Delete auth users
    for (const uid of userIds) {
      const { error: authDelErr } = await adminClient.auth.admin.deleteUser(uid);
      if (authDelErr) console.error(`Failed to delete auth user ${uid}:`, authDelErr);
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Delete agent error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Unknown error" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
