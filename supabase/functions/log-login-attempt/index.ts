// Log a password-login attempt (success or failure) to login_attempts.
//
// Password login goes through supabase.auth.signInWithPassword directly
// from the client, which means it never touches the OTP edge functions
// that populate login_attempts. Failed passwords therefore leave no
// trace in the admin's "محاولات الدخول" tab. This function fills that
// gap: the client calls it after each signInWithPassword with the
// result. Runs with the service role so it can write even when the
// caller is unauthenticated (failed login = no session yet).

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
    const { email, success } = await req.json();
    if (!email || typeof email !== "string") {
      return new Response(
        JSON.stringify({ error: "email is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const ip_address =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("cf-connecting-ip") ||
      null;
    const user_agent = req.headers.get("user-agent") || null;

    // The BEFORE INSERT trigger on login_attempts resolves agent_id
    // from profiles via email, so admins of that agent will see the row.
    const { error } = await supabase.from("login_attempts").insert({
      email: email.trim().toLowerCase(),
      success: !!success,
      method: "password",
      ip_address,
      user_agent,
    });

    if (error) {
      console.error("[log-login-attempt] insert error:", error);
      return new Response(
        JSON.stringify({ error: "failed to log" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[log-login-attempt] fatal:", err);
    return new Response(
      JSON.stringify({ error: "internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
