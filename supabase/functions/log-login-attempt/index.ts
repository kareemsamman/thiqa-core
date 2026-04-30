// Log a password-login attempt (success or failure) to login_attempts,
// AND enforce server-side brute-force lockout based on the same table.
//
// Two modes:
//   { action: "check", email } → returns { locked, remaining_minutes,
//     attempts_left } based on recent failures in login_attempts. Client
//     should call this BEFORE signInWithPassword.
//   { email, success } (default "log") → records the attempt and, on
//     failure, returns the updated lockout state.
//
// Authoritative enforcement lives here (service role + DB), so the
// client-side localStorage counter is purely UX feedback and cannot be
// used to bypass the limit by clearing browser storage.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MINUTES = 15;

async function getLockoutState(
  supabase: ReturnType<typeof createClient>,
  email: string,
) {
  const sinceIso = new Date(
    Date.now() - LOCKOUT_WINDOW_MINUTES * 60_000,
  ).toISOString();

  const { data, error } = await supabase
    .from("login_attempts")
    .select("created_at, success")
    .eq("email", email)
    .eq("method", "password")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("[log-login-attempt] lockout read error:", error);
    return { locked: false, attempts_left: MAX_ATTEMPTS, remaining_minutes: 0 };
  }

  // Count consecutive failures since the last success (or since window start).
  let failures = 0;
  let oldestFailureAt: string | null = null;
  for (const row of data ?? []) {
    if ((row as any).success) break;
    failures += 1;
    oldestFailureAt = (row as any).created_at;
  }

  if (failures >= MAX_ATTEMPTS && oldestFailureAt) {
    const unlockAt =
      new Date(oldestFailureAt).getTime() + LOCKOUT_WINDOW_MINUTES * 60_000;
    const remainingMs = unlockAt - Date.now();
    if (remainingMs > 0) {
      return {
        locked: true,
        attempts_left: 0,
        remaining_minutes: Math.max(1, Math.ceil(remainingMs / 60_000)),
      };
    }
  }

  return {
    locked: false,
    attempts_left: Math.max(0, MAX_ATTEMPTS - failures),
    remaining_minutes: 0,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { email, success, action } = body ?? {};
    if (!email || typeof email !== "string") {
      return new Response(
        JSON.stringify({ error: "email is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const normalizedEmail = email.trim().toLowerCase();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Pre-flight check used by the client before signInWithPassword.
    if (action === "check") {
      const state = await getLockoutState(supabase, normalizedEmail);
      return new Response(
        JSON.stringify({ ok: true, ...state }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ip_address =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("cf-connecting-ip") ||
      null;
    const user_agent = req.headers.get("user-agent") || null;

    // The BEFORE INSERT trigger on login_attempts resolves agent_id
    // from profiles via email, so admins of that agent will see the row.
    const { error } = await supabase.from("login_attempts").insert({
      email: normalizedEmail,
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

    // Recompute lockout state so the client gets authoritative numbers
    // without an extra round-trip.
    const state = await getLockoutState(supabase, normalizedEmail);

    return new Response(
      JSON.stringify({ ok: true, ...state }),
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
