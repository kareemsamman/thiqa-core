import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPER_ADMIN_EMAIL = "morshed500@gmail.com";

type RuleType = "THIRD_PRICE" | "DISCOUNT" | "FULL_PERCENT" | "MIN_PRICE";
type CarType = "car" | "tjeradown4" | "tjeraup4" | "taxi";

type TargetRow = {
  rule_type: RuleType;
  car_type: CarType;
  age_band: "ANY";
  value: number;
  min_car_value: number | null;
  max_car_value: number | null;
};

// Al Aradi Al Muqadasa 2024 tariff (الأراضي المقدسة) — third-party + comprehensive
// for Israeli-licensed vehicles in Jerusalem. Buses + ambiguous rows
// (equipment/bulldozers, taxi by driver count, rental) are intentionally
// not in this set — they need a separate decision per agency.
const TARGET_ROWS: TargetRow[] = [
  // البند الأول — THIRD_PRICE (ثالث فقط)
  { rule_type: "THIRD_PRICE", car_type: "car",        age_band: "ANY", value: 900,  min_car_value: null, max_car_value: null },
  { rule_type: "THIRD_PRICE", car_type: "tjeradown4", age_band: "ANY", value: 1300, min_car_value: null, max_car_value: null },
  { rule_type: "THIRD_PRICE", car_type: "tjeraup4",   age_band: "ANY", value: 2500, min_car_value: null, max_car_value: null },
  { rule_type: "THIRD_PRICE", car_type: "taxi",       age_band: "ANY", value: 3000, min_car_value: null, max_car_value: null },

  // البند الأول — DISCOUNT (الجزء الثالث ضمن شامل)
  { rule_type: "DISCOUNT",    car_type: "car",        age_band: "ANY", value: 700,  min_car_value: null, max_car_value: null },
  { rule_type: "DISCOUNT",    car_type: "tjeradown4", age_band: "ANY", value: 1100, min_car_value: null, max_car_value: null },
  { rule_type: "DISCOUNT",    car_type: "tjeraup4",   age_band: "ANY", value: 1500, min_car_value: null, max_car_value: null },
  { rule_type: "DISCOUNT",    car_type: "taxi",       age_band: "ANY", value: 2000, min_car_value: null, max_car_value: null },

  // البند الثاني — FULL_PERCENT (نسبة قسط التكميلي)
  { rule_type: "FULL_PERCENT", car_type: "car",        age_band: "ANY", value: 1.75, min_car_value: null,    max_car_value: 100000 },
  { rule_type: "FULL_PERCENT", car_type: "car",        age_band: "ANY", value: 2,    min_car_value: 100001,  max_car_value: 500000 },
  { rule_type: "FULL_PERCENT", car_type: "car",        age_band: "ANY", value: 2.25, min_car_value: 500001,  max_car_value: 1000000 },
  { rule_type: "FULL_PERCENT", car_type: "car",        age_band: "ANY", value: 3,    min_car_value: 1000001, max_car_value: null },
  { rule_type: "FULL_PERCENT", car_type: "tjeradown4", age_band: "ANY", value: 2.5,  min_car_value: null,    max_car_value: null },
  { rule_type: "FULL_PERCENT", car_type: "tjeraup4",   age_band: "ANY", value: 3,    min_car_value: null,    max_car_value: null },
  { rule_type: "FULL_PERCENT", car_type: "taxi",       age_band: "ANY", value: 3,    min_car_value: null,    max_car_value: null },

  // البند الثاني — MIN_PRICE (الحد الأدنى لقسط التكميلي)
  { rule_type: "MIN_PRICE",    car_type: "car",        age_band: "ANY", value: 1200,  min_car_value: null,    max_car_value: 100000 },
  { rule_type: "MIN_PRICE",    car_type: "car",        age_band: "ANY", value: 2000,  min_car_value: 100001,  max_car_value: 500000 },
  { rule_type: "MIN_PRICE",    car_type: "car",        age_band: "ANY", value: 11250, min_car_value: 500001,  max_car_value: 1000000 },
  { rule_type: "MIN_PRICE",    car_type: "car",        age_band: "ANY", value: 30000, min_car_value: 1000001, max_car_value: null },
  { rule_type: "MIN_PRICE",    car_type: "tjeradown4", age_band: "ANY", value: 2500,  min_car_value: null,    max_car_value: null },
  { rule_type: "MIN_PRICE",    car_type: "tjeraup4",   age_band: "ANY", value: 3000,  min_car_value: null,    max_car_value: null },
  { rule_type: "MIN_PRICE",    car_type: "taxi",       age_band: "ANY", value: 3000,  min_car_value: null,    max_car_value: null },
];

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonError(401, "Unauthorized");

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(url, serviceKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) return jsonError(401, "Invalid token");

    // Admin gate (mirrors delete-policy edge function)
    const isSuper = user.email === SUPER_ADMIN_EMAIL;
    if (!isSuper) {
      const { data: roleRow } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();
      if (!roleRow) return jsonError(403, "Only admins can seed pricing rules");
    }

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const company_id = typeof body.company_id === "string" ? body.company_id : null;
    if (!company_id) return jsonError(400, "company_id (string) is required");

    const { data: company, error: companyErr } = await supabase
      .from("insurance_companies")
      .select("id, name, name_ar, category_parent, agent_id")
      .eq("id", company_id)
      .maybeSingle();
    if (companyErr) return jsonError(500, companyErr.message);
    if (!company) return jsonError(404, "Company not found");
    if (!company.agent_id) return jsonError(400, "Company has no agent_id; cannot satisfy pricing_rules RLS");

    const { data: existing, error: existingErr } = await supabase
      .from("pricing_rules")
      .select("rule_type, car_type, age_band, value, min_car_value, max_car_value")
      .eq("company_id", company_id)
      .eq("policy_type_parent", "THIRD_FULL");
    if (existingErr) return jsonError(500, existingErr.message);

    // Conservative coverage check: if any existing rule for this
    // (rule_type, car_type) tuple exists — regardless of age_band or
    // range — treat the slot as "already touched" and don't insert.
    // This honors the user's "اذا اشي موجود ما رح يمحيه" rule and
    // sidesteps overlap ambiguity with open-ended ranges.
    const existingKeys = new Set(
      (existing ?? []).map((r) => `${r.rule_type}|${r.car_type ?? "car"}`),
    );

    const inserted: TargetRow[] = [];
    const skipped: TargetRow[] = [];
    for (const t of TARGET_ROWS) {
      const key = `${t.rule_type}|${t.car_type}`;
      if (existingKeys.has(key)) skipped.push(t);
      else inserted.push(t);
    }

    let insertError: string | null = null;
    if (inserted.length > 0) {
      // agent_id is required by RLS — pricing_rules without it are
      // invisible to the agency's users. Pulled from the parent
      // insurance_companies row above.
      const rows = inserted.map((t) => ({
        company_id,
        agent_id: company.agent_id,
        policy_type_parent: "THIRD_FULL" as const,
        rule_type: t.rule_type,
        car_type: t.car_type,
        age_band: t.age_band,
        value: t.value,
        min_car_value: t.min_car_value,
        max_car_value: t.max_car_value,
      }));
      const { error } = await supabase.from("pricing_rules").insert(rows);
      if (error) insertError = error.message;
    }

    if (insertError) return jsonError(500, `Insert failed: ${insertError}`);

    return new Response(
      JSON.stringify({
        ok: true,
        company: { id: company.id, name: company.name, name_ar: company.name_ar },
        inserted_count: inserted.length,
        skipped_count: skipped.length,
        inserted,
        skipped,
        note:
          "Buses excluded by design. Equipment/bulldozers, taxi by driver count, and rental cars are not seeded — they need a separate decision per agency.",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return jsonError(500, e instanceof Error ? e.message : String(e));
  }
});
