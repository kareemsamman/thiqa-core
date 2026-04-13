import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Fully delete an agent and every row that references it. The heavy lifting
 * is done by the SECURITY DEFINER RPC `delete_agent_cascade(agent_id)` which
 * discovers every FK to `agents.id` at runtime and deletes from each table.
 * This edge function:
 *   1. Verifies the caller is a super admin
 *   2. Collects the auth.users IDs of everyone linked to this agent
 *   3. Calls the cascade RPC (single transaction)
 *   4. Deletes the auth.users entries via the auth admin API
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) throw new Error("Missing authorization");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const adminClient = createClient(supabaseUrl, serviceKey);

    // Verify caller is a super admin using the JWT token
    const token = authHeader.replace("Bearer ", "");
    const { data: { user: caller }, error: callerError } = await adminClient.auth.getUser(token);
    if (callerError || !caller) throw new Error("Unauthorized");

    const { data: isSA } = await adminClient.rpc("is_super_admin", { _user_id: caller.id });
    if (!isSA) throw new Error("Not a super admin");

    const { agent_id } = await req.json();
    if (!agent_id) throw new Error("Missing agent_id");

    // 1. Collect every user linked to this agent before we blow away agent_users.
    const linkedUserIds = new Set<string>();

    const { data: agentUsers } = await adminClient
      .from("agent_users")
      .select("user_id")
      .eq("agent_id", agent_id);
    (agentUsers || []).forEach((u: any) => u.user_id && linkedUserIds.add(u.user_id));

    // Also sweep profiles that carry agent_id directly (some projects have
    // this column on profiles even without an agent_users row).
    const { data: profileRows } = await adminClient
      .from("profiles")
      .select("id")
      .eq("agent_id", agent_id);
    (profileRows || []).forEach((p: any) => p.id && linkedUserIds.add(p.id));

    // 2. Cascade delete every public-schema row referencing the agent.
    const { error: cascadeErr } = await adminClient.rpc("delete_agent_cascade", {
      p_agent_id: agent_id,
    });
    if (cascadeErr) {
      console.error("[delete-agent] cascade failed:", cascadeErr);
      const detail = [cascadeErr.message, cascadeErr.details, cascadeErr.hint]
        .filter(Boolean)
        .join(" | ");
      throw new Error(detail || "فشل في حذف البيانات المرتبطة بالوكيل.");
    }

    // 3. Delete the auth.users. These must be done through the admin API
    //    since they live outside the public schema.
    const failedAuthDeletes: Array<{ userId: string; error: string }> = [];
    for (const uid of linkedUserIds) {
      const { error: authDelErr } = await adminClient.auth.admin.deleteUser(uid);
      if (authDelErr) {
        console.error(`[delete-agent] Failed to delete auth user ${uid}:`, authDelErr);
        failedAuthDeletes.push({ userId: uid, error: authDelErr.message });
      }
    }

    if (failedAuthDeletes.length > 0) {
      throw new Error(
        `فشل حذف ${failedAuthDeletes.length} مستخدم: ${failedAuthDeletes
          .map((f) => f.error)
          .join("; ")}`,
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        deleted_user_count: linkedUserIds.size - failedAuthDeletes.length,
        failed_auth_deletes: failedAuthDeletes,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("Delete agent error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Unknown error" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
