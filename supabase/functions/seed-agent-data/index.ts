import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { performSeed } from "../_shared/seed-agent-data.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
      throw new Error("Missing backend environment variables");
    }

    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify token
    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: userError } = await authClient.auth.getUser(token);
    if (userError || !userData?.user?.id) {
      console.error("Auth error:", userError);
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = userData.user.id;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Optional body: { agent_id } — allows a super admin to seed an agent they
    // just created (e.g. from ThiqaCreateAgent) when they aren't themselves
    // mapped to that agent via agent_users/profiles.
    let requestedAgentId: string | null = null;
    if (req.headers.get("content-type")?.includes("application/json")) {
      try {
        const body = await req.json();
        if (body?.agent_id) requestedAgentId = String(body.agent_id);
      } catch {
        // no body, fine
      }
    }

    let agentId: string | null = null;

    if (requestedAgentId) {
      const { data: isSA } = await supabase.rpc("is_super_admin", { _user_id: userId });
      if (!isSA) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      agentId = requestedAgentId;
    } else {
      // Resolve agent_id from the caller's own membership
      const { data: agentUser } = await supabase
        .from("agent_users").select("agent_id").eq("user_id", userId).maybeSingle();
      agentId = agentUser?.agent_id ?? null;

      if (!agentId) {
        const { data: profile } = await supabase
          .from("profiles").select("agent_id").eq("id", userId).maybeSingle();
        agentId = profile?.agent_id ?? null;
      }
    }

    if (!agentId) {
      return new Response(JSON.stringify({ error: "No agent found for user" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results = await performSeed(supabase, agentId);

    console.log(`Seed completed for agent ${agentId}:`, results);

    return new Response(JSON.stringify({ success: true, seeded: results }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Seed error:", error);
    return new Response(JSON.stringify({ error: "Internal server error", details: String(error) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
