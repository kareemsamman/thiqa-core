// Kick a user out of a specific session.
//
// Called from /admin/users → Sessions tab → "طرد" button. Stamps
// kicked_at on the row; the target session's heartbeat picks it up on
// its next tick (≤30s) and the client calls auth.signOut + redirects
// to login. Only agent admins (or super admins) can kick rows that
// belong to their own agent.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "missing authorization" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authed = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller }, error: userErr } = await authed.auth.getUser();
    if (userErr || !caller) {
      return new Response(
        JSON.stringify({ error: "invalid session" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json().catch(() => ({}));
    const sessionId: string | undefined = body.session_id;
    if (!sessionId || typeof sessionId !== "string") {
      return new Response(
        JSON.stringify({ error: "session_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // Look up the target session's agent_id. Service role bypasses RLS
    // so we can authorize the kick ourselves below.
    const { data: target, error: targetErr } = await admin
      .from("user_sessions")
      .select("id, agent_id, user_id, is_active, kicked_at")
      .eq("id", sessionId)
      .maybeSingle();
    if (targetErr || !target) {
      return new Response(
        JSON.stringify({ error: "session not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Super admin can kick anyone; otherwise caller must be an admin of
    // the target session's agent (same pattern as create-agent-user).
    const { data: superRow } = await admin
      .from("thiqa_super_admins")
      .select("user_id")
      .eq("user_id", caller.id)
      .maybeSingle();
    const isSuperAdmin = !!superRow;

    if (!isSuperAdmin) {
      const { data: callerRole } = await admin
        .from("user_roles")
        .select("role")
        .eq("user_id", caller.id)
        .eq("role", "admin")
        .eq("agent_id", target.agent_id)
        .maybeSingle();
      if (!callerRole) {
        return new Response(
          JSON.stringify({ error: "ليس لديك صلاحية لإنهاء هذه الجلسة" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // Don't let an admin kick themselves by accident — they'd bounce to
    // login the next time their own heartbeat ticks.
    if (target.user_id === caller.id) {
      return new Response(
        JSON.stringify({ error: "لا يمكنك إنهاء جلستك الحالية من هنا" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (target.kicked_at) {
      return new Response(
        JSON.stringify({ ok: true, already_kicked: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const now = new Date().toISOString();
    const { error: updateErr } = await admin
      .from("user_sessions")
      .update({ kicked_at: now, ended_at: now, is_active: false })
      .eq("id", sessionId);

    if (updateErr) {
      console.error("[kick-user-session] update error:", updateErr);
      return new Response(
        JSON.stringify({ error: updateErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[kick-user-session] fatal:", err);
    return new Response(
      JSON.stringify({ error: "internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
