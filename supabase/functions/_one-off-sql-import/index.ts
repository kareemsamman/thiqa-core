import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// One-off importer used to bulk insert legacy Excel rows for a single
// agent. Guarded by a shared secret so only the operator can call it.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    // One-off importer; gated by a hardcoded random token below.
    // Function is removed once the legacy Excel import is finished.
    const token = req.headers.get("x-import-token");
    if (token !== "e7514714fbdd312f0fcb350c354779a029c650ed744eb22bb253d542f21c142a") {
      return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: corsHeaders });
    }
    const sql = await req.text();
    if (!sql || sql.length < 10) {
      return new Response(JSON.stringify({ error: "empty sql" }), { status: 400, headers: corsHeaders });
    }
    const url = Deno.env.get("SUPABASE_URL")!;
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, key);
    const { error } = await admin.rpc("exec_one_off_sql", { _sql: sql });
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
    }
    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders });
  }
});