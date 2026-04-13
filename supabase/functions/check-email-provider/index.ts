import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Given an email, return whether an auth.users row exists for it and which
// identity providers it has. The frontend login form calls this on blur so
// it can show a "sign in with Google" hint when a Gmail account only has a
// google identity attached — avoids the common confusion where the user
// enters their Google email + some password and gets "invalid credentials"
// with no explanation.
//
// Enumeration exposure: this does reveal existence of an email, but the
// same info is already reachable via Supabase's built-in auth endpoints
// (password reset, sign-in error messages), so no new surface is exposed.

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceKey);

    const { email } = await req.json();
    const normalizedEmail = String(email || "").trim().toLowerCase();

    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      return new Response(
        JSON.stringify({ exists: false, providers: [], is_google_only: false }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Paginate through auth.users — admin.listUsers doesn't support email
    // filtering directly. This is bounded by user count and fine for the
    // low-volume login-blur use case.
    const perPage = 200;
    let found: any = null;

    for (let page = 1; page <= 50; page++) {
      const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
      if (error) throw error;

      found = (data.users || []).find(
        (u: any) => (u.email || "").toLowerCase() === normalizedEmail,
      );
      if (found) break;
      if ((data.users || []).length < perPage) break;
    }

    if (!found) {
      return new Response(
        JSON.stringify({ exists: false, providers: [], is_google_only: false }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const providers: string[] = Array.from(
      new Set(
        ((found.identities || []) as any[])
          .map((i: any) => i.provider)
          .filter((p: any) => typeof p === "string"),
      ),
    );

    const isGoogleOnly = providers.length > 0 && providers.every((p) => p === "google");

    return new Response(
      JSON.stringify({
        exists: true,
        providers,
        is_google_only: isGoogleOnly,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("check-email-provider error:", error);
    return new Response(
      JSON.stringify({
        exists: false,
        providers: [],
        is_google_only: false,
        error: error?.message || "unknown",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
