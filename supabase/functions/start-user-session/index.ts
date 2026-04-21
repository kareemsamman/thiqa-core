// Create a user_sessions row for the caller, returning its id so the
// client can heartbeat + end it later.
//
// This replaces the client-side insert in useSessionTracker. Doing it
// server-side means:
//   - RLS can't silently drop the insert (we use service role)
//   - agent_id lookup is explicit, not dependent on the trigger
//   - the caller's JWT is validated before we touch anything
//   - errors come back to the client as real HTTP responses, not a
//     swallowed RLS "permission denied" that never reaches logs.

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

    // Verify the caller's JWT using the anon client, then use service
    // role for the actual write (so agent-scoped RLS can't drop it).
    const authed = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await authed.auth.getUser();
    if (userErr || !user) {
      return new Response(
        JSON.stringify({ error: "invalid session" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: profile } = await admin
      .from("profiles")
      .select("agent_id")
      .eq("id", user.id)
      .maybeSingle();

    if (!profile?.agent_id) {
      return new Response(
        JSON.stringify({ error: "profile missing agent_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json().catch(() => ({}));
    const ip_address =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("cf-connecting-ip") ||
      body.ip_address ||
      null;

    const { data: inserted, error: insertErr } = await admin
      .from("user_sessions")
      .insert({
        user_id: user.id,
        agent_id: profile.agent_id,
        user_agent: body.user_agent || req.headers.get("user-agent") || null,
        browser_name: body.browser_name || null,
        browser_version: body.browser_version || null,
        os_name: body.os_name || null,
        device_type: body.device_type || null,
        ip_address,
        current_path: typeof body.current_path === "string" ? body.current_path : null,
        is_active: true,
      })
      .select("id")
      .single();

    if (insertErr || !inserted) {
      console.error("[start-user-session] insert error:", insertErr);
      return new Response(
        JSON.stringify({ error: insertErr?.message || "insert failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ id: inserted.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[start-user-session] fatal:", err);
    return new Response(
      JSON.stringify({ error: "internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
