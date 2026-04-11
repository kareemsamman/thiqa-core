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
    const agentTables = [
      "accident_report_files", "accident_report_notes", "accident_report_reminders",
      "accident_injured_persons", "accident_third_parties", "accident_reports",
      "broker_settlement_items", "broker_settlements",
      "policy_payments", "ab_ledger", "invoices",
      "policies", "car_accidents", "cars",
      "clients", "pricing_rules", "insurance_categories",
      "brokers", "outside_cheques", "media_files",
      "invoice_templates", "customer_signatures",
      "notifications", "automated_sms_log", "sms_history",
      "correspondence_letters", "tasks", "business_contacts",
      "repair_claims", "road_services", "accident_fee_services",
      "branches", "announcements", "announcement_dismissals",
      "agent_subscription_payments", "agent_feature_flags",
      "sms_settings", "auth_settings", "payment_settings", "site_settings",
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
