import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Tables in dependency order (parents first)
const IMPORT_ORDER = [
  "branches",
  "insurance_companies",
  "insurance_categories",
  "pricing_rules",
  "brokers",
  "clients",
  "cars",
  "car_accidents",
  "policies",
  "policy_payments",
  "outside_cheques",
  "media_files",
  "invoice_templates",
  "invoices",
  "customer_signatures",
  "sms_settings",
  "payment_settings",
  "site_settings",
  "notifications",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify caller is super admin
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller } } = await callerClient.auth.getUser();
    if (!caller) throw new Error("Unauthorized");

    const adminClient = createClient(supabaseUrl, serviceKey);
    const { data: isSA } = await adminClient.rpc("is_super_admin", { _user_id: caller.id });
    if (!isSA) throw new Error("Not a super admin");

    const body = await req.json();
    const { agent_id, data: importData, tables } = body;

    if (!agent_id || !importData) {
      throw new Error("Missing agent_id or data");
    }

    const tablesToImport = tables || IMPORT_ORDER;
    const results: Record<string, { inserted: number; errors: number; skipped: number }> = {};

    for (const table of tablesToImport) {
      const rows = importData[table];
      if (!rows || !Array.isArray(rows) || rows.length === 0) {
        results[table] = { inserted: 0, errors: 0, skipped: 0 };
        continue;
      }

      let inserted = 0;
      let errors = 0;
      let skipped = 0;

      // Process in batches of 100
      const batchSize = 100;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize).map((row: any) => {
          const newRow = { ...row };
          // Set agent_id if the table has it
          if ("agent_id" in newRow || table !== "login_attempts") {
            newRow.agent_id = agent_id;
          }
          return newRow;
        });

        const { error, data: insertedData } = await adminClient
          .from(table)
          .upsert(batch, { onConflict: "id", ignoreDuplicates: true })
          .select("id");

        if (error) {
          console.error(`Error importing ${table} batch:`, error.message);
          // Try one by one for failed batch
          for (const row of batch) {
            const singleRow = { ...row, agent_id: agent_id };
            const { error: singleError } = await adminClient
              .from(table)
              .upsert(singleRow, { onConflict: "id", ignoreDuplicates: true });
            if (singleError) {
              console.error(`Error importing single ${table} row:`, singleError.message);
              errors++;
            } else {
              inserted++;
            }
          }
        } else {
          inserted += insertedData?.length || batch.length;
        }
      }

      results[table] = { inserted, errors, skipped };
    }

    return new Response(
      JSON.stringify({ success: true, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Import error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Unknown error" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
