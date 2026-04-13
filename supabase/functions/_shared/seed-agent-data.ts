// Shared seed data + seeding logic for a new agent.
// Used by:
//   - supabase/functions/seed-agent-data      (onboarding wizard / thiqa admin manual trigger)
//   - supabase/functions/register-agent       (auto-seed on public self-signup)
// And invoked from ThiqaCreateAgent.tsx via the seed-agent-data HTTP wrapper.

export const SEED_COMPANIES = [
  // 1 ELZAMI company
  { name: "כלל", name_ar: "כלל", category_parent: ["ELZAMI"], elzami_commission: 100, is_seed: true },
  // 1 THIRD_FULL company (with pricing rules)
  { name: "اراضي مقدسة", name_ar: "اراضي مقدسة", category_parent: ["THIRD_FULL"], elzami_commission: 0, is_seed: true },
  // 1 ROAD_SERVICE company (X Service - with service & accident fee prices)
  { name: "شركة اكس", name_ar: "شركة اكس", category_parent: ["ROAD_SERVICE"], elzami_commission: 0, is_seed: true },
];

export const SEED_INSURANCE_CATEGORIES = [
  { name: "Car Insurance", name_ar: "تأمين السيارات", slug: "THIRD_FULL", mode: "FULL", is_active: true, is_default: true, sort_order: 1 },
  { name: "Health Insurance", name_ar: "التأمين الصحي", slug: "HEALTH", mode: "LIGHT", is_active: true, is_default: false, sort_order: 10 },
  { name: "Life Insurance", name_ar: "التأمين على الحياة", slug: "LIFE", mode: "LIGHT", is_active: true, is_default: false, sort_order: 11 },
  { name: "Property Insurance", name_ar: "تأمين الممتلكات", slug: "PROPERTY", mode: "LIGHT", is_active: true, is_default: false, sort_order: 12 },
  { name: "Travel Insurance", name_ar: "تأمين السفر", slug: "TRAVEL", mode: "LIGHT", is_active: true, is_default: false, sort_order: 13 },
  { name: "Business Insurance", name_ar: "تأمين الشركات", slug: "BUSINESS", mode: "LIGHT", is_active: true, is_default: false, sort_order: 14 },
];

export const SEED_ROAD_SERVICES = [
  { name: "زجاج", name_ar: "زجاج", description: "زجاج", active: true, sort_order: 0, allowed_car_types: ["car"] },
  { name: "زجاج +ونش ضفة قدس", name_ar: "زجاج +ونش ضفة قدس", description: null, active: true, sort_order: 1, allowed_car_types: ["car"] },
  { name: "زجاج +ونش +سيارة بديلة ضفة قدس", name_ar: "زجاج +ونش +سيارة بديلة ضفة قدس", description: null, active: true, sort_order: 2, allowed_car_types: ["car"] },
  { name: "زجاج + ونش اوتبوس زعير ضفة قدس", name_ar: "زجاج + ونش اوتبوس زعير ضفة قدس", description: null, active: true, sort_order: 3, allowed_car_types: ["small"] },
  { name: "زجاج +ونش تجاري تحت ال 4 طن ضفة قدس", name_ar: "زجاج +ونش تجاري تحت ال 4 طن ضفة قدس", description: null, active: true, sort_order: 4, allowed_car_types: ["tjeradown4"] },
  { name: "زجاج +ونش تجاري حتى ال 12 طن ضفة قدس", name_ar: null, description: null, active: true, sort_order: 5, allowed_car_types: ["tjeraup4"] },
];

export const SEED_ACCIDENT_FEE_SERVICES = [
  { name: "اعفاء رسوم حادث حتى 1000", name_ar: "اعفاء رسوم حادث حتى 1000", description: null, active: true, sort_order: 0 },
  { name: "اعفاء رسوم حادث حتى 1500", name_ar: "اعفاء رسوم حادث حتى 1500", description: null, active: true, sort_order: 1 },
  { name: "اعفاء رسوم حادث حتى 2000", name_ar: "اعفاء رسوم حادث حتى 2000", description: null, active: true, sort_order: 2 },
  { name: "اعفاء رسوم حادث فوق 24 حتى 2000 شيكل", name_ar: "اعفاء رسوم حادث فوق 24 حتى 2000 شيكل", description: null, active: true, sort_order: 3 },
];

// Pricing rules for "اراضي مقدسة" company
export const SEED_PRICING_RULES = [
  { rule_type: "THIRD_PRICE", car_type: "car", age_band: "UNDER_24", value: 900, notes: "سعر ثالث - تحت 24" },
  { rule_type: "THIRD_PRICE", car_type: "car", age_band: "UP_24", value: 900, notes: "سعر ثالث - فوق 24" },
  { rule_type: "THIRD_PRICE", car_type: "tjeradown4", age_band: "ANY", value: 1300, notes: "سعر ثالث - تجاري أقل من 4 طن" },
  { rule_type: "FULL_PERCENT", car_type: "car", age_band: "UP_24", value: 1.75, min_car_value: null, max_car_value: null, notes: "نسبة شامل - أساسي" },
  { rule_type: "FULL_PERCENT", car_type: "car", age_band: "UP_24", value: 2.0, min_car_value: 100001, max_car_value: null, notes: "نسبة شامل - قيمة سيارة فوق 100k" },
  { rule_type: "DISCOUNT", car_type: "car", age_band: "ANY", value: 700, notes: "خصم - خصوصي" },
  { rule_type: "DISCOUNT", car_type: "tjeradown4", age_band: "ANY", value: 1100, notes: "خصم - تجاري أقل من 4 طن" },
  { rule_type: "MIN_PRICE", car_type: "car", age_band: "ANY", value: 1200, notes: "حد أدنى - خصوصي" },
  { rule_type: "MIN_PRICE", car_type: "tjeradown4", age_band: "ANY", value: 2500, notes: "حد أدنى - تجاري أقل من 4 طن" },
];

// Road service prices for "شركة اكس"
export const SEED_ROAD_SERVICE_PRICES = [
  { service_name: "زجاج +ونش ضفة قدس", car_type: "car", age_band: "ANY", company_cost: 150, selling_price: 300 },
  { service_name: "زجاج +ونش +سيارة بديلة ضفة قدس", car_type: "car", age_band: "ANY", company_cost: 250, selling_price: 500 },
  { service_name: "زجاج + ونش اوتبوس زعير ضفة قدس", car_type: "car", age_band: "ANY", company_cost: 500, selling_price: 500 },
  { service_name: "زجاج +ونش تجاري تحت ال 4 طن ضفة قدس", car_type: "car", age_band: "ANY", company_cost: 250, selling_price: 350 },
  { service_name: "زجاج +ونش تجاري حتى ال 12 طن ضفة قدس", car_type: "car", age_band: "ANY", company_cost: 600, selling_price: 800 },
];

// Accident fee prices for "شركة اكس"
export const SEED_ACCIDENT_FEE_PRICES = [
  { service_name: "اعفاء رسوم حادث حتى 1000", company_cost: 250, selling_price: 300 },
  { service_name: "اعفاء رسوم حادث حتى 1500", company_cost: 375, selling_price: 450 },
  { service_name: "اعفاء رسوم حادث حتى 2000", company_cost: 500, selling_price: 600 },
  { service_name: "اعفاء رسوم حادث فوق 24 حتى 2000 شيكل", company_cost: 0, selling_price: 0 },
];

// Helper: delete old seed rows (no FK dependencies) then insert new ones, return name→id map
async function syncSeedData(
  supabase: any,
  table: string,
  seedRows: any[],
  agentId: string,
  keyField = "name",
  dependencyTable?: string,
  dependencyFk?: string,
): Promise<{ inserted: number; idMap: Map<string, string> }> {
  const seedNames = new Set(seedRows.map((r) => r[keyField]));

  const { data: existing, error: readErr } = await supabase
    .from(table)
    .select(`id, ${keyField}`)
    .eq("agent_id", agentId);
  if (readErr) throw readErr;

  const idMap = new Map<string, string>();
  const idsToDelete: string[] = [];

  for (const row of existing ?? []) {
    if (seedNames.has(row[keyField])) {
      // Check if it has real dependencies
      if (dependencyTable && dependencyFk) {
        const { count } = await supabase
          .from(dependencyTable)
          .select("id", { count: "exact", head: true })
          .eq(dependencyFk, row.id);
        if ((count ?? 0) > 0) {
          idMap.set(row[keyField], row.id);
          continue;
        }
      }
      idsToDelete.push(row.id);
    } else {
      idMap.set(row[keyField], row.id);
    }
  }

  if (idsToDelete.length > 0) {
    await supabase.from(table).delete().in("id", idsToDelete);
  }

  const toInsert = seedRows.filter((r) => !idMap.has(r[keyField]));
  let insertedCount = 0;

  if (toInsert.length > 0) {
    const { data, error } = await supabase
      .from(table)
      .insert(toInsert.map((r) => ({ ...r, agent_id: agentId })))
      .select(`id, ${keyField}`);
    if (error) throw error;
    insertedCount = data?.length ?? 0;
    for (const row of data ?? []) {
      idMap.set(row[keyField], row.id);
    }
  }

  return { inserted: insertedCount, idMap };
}

export async function performSeed(
  supabase: any,
  agentId: string,
): Promise<Record<string, number>> {
  const results: Record<string, number> = {};

  // 0. Seed default branch if none exists
  const { count: branchCount } = await supabase
    .from("branches").select("id", { count: "exact", head: true }).eq("agent_id", agentId);
  if ((branchCount ?? 0) === 0) {
    const { data: branchData, error: branchErr } = await supabase
      .from("branches")
      .insert({ agent_id: agentId, name: "Beit Hanina", name_ar: "بيت حنينا", is_default: true })
      .select("id");
    if (!branchErr && branchData?.length) {
      results.branches = 1;
    }
  }

  // Collect all seed company names for cleanup
  const seedCompanyNames = new Set(SEED_COMPANIES.map((c) => c.name));

  // 1. Insurance companies — delete old seed data (no policies) then re-insert
  const { data: existingCo, error: coReadErr } = await supabase
    .from("insurance_companies").select("id, name, category_parent").eq("agent_id", agentId);
  if (coReadErr) throw coReadErr;

  const coMap = new Map<string, string>();
  const idsToDelete: string[] = [];

  for (const row of existingCo ?? []) {
    if (seedCompanyNames.has(row.name)) {
      const { count } = await supabase
        .from("policies")
        .select("id", { count: "exact", head: true })
        .eq("company_id", row.id)
        .is("deleted_at", null);

      if ((count ?? 0) === 0) {
        idsToDelete.push(row.id);
      } else {
        coMap.set(row.name, row.id);
      }
    } else {
      coMap.set(row.name, row.id);
    }
  }

  if (idsToDelete.length > 0) {
    await supabase.from("pricing_rules").delete().in("company_id", idsToDelete);
    await supabase.from("company_road_service_prices").delete().in("company_id", idsToDelete);
    await supabase.from("company_accident_fee_prices").delete().in("company_id", idsToDelete);
    await supabase.from("insurance_companies").delete().in("id", idsToDelete);
  }

  const coToInsert = SEED_COMPANIES.filter((r) => !coMap.has(r.name));
  if (coToInsert.length > 0) {
    const { data, error } = await supabase
      .from("insurance_companies")
      .insert(coToInsert.map((r) => ({ ...r, agent_id: agentId })))
      .select("id, name, category_parent");
    if (error) throw error;
    results.insurance_companies = data?.length ?? 0;
    for (const row of data ?? []) {
      coMap.set(row.name, row.id);
    }
  } else {
    results.insurance_companies = 0;
  }

  // 2. Insurance categories
  const catRes = await syncSeedData(supabase, "insurance_categories", SEED_INSURANCE_CATEGORIES.map(c => ({...c})), agentId, "slug");
  results.insurance_categories = catRes.inserted;

  // 3. Road services (check policies table for road_service_id FK)
  const rsRes = await syncSeedData(supabase, "road_services", SEED_ROAD_SERVICES.map(r => ({...r})), agentId, "name", "policies", "road_service_id");
  results.road_services = rsRes.inserted;

  // 4. Accident fee services (check policies table for accident_fee_service_id FK)
  const afRes = await syncSeedData(supabase, "accident_fee_services", SEED_ACCIDENT_FEE_SERVICES.map(a => ({...a})), agentId, "name", "policies", "accident_fee_service_id");
  results.accident_fee_services = afRes.inserted;

  // 5. Pricing rules for "اراضي مقدسة"
  const aradiCompanyId = coMap.get("اراضي مقدسة");
  if (aradiCompanyId) {
    await supabase.from("pricing_rules").delete().eq("company_id", aradiCompanyId).eq("agent_id", agentId);

    const rulesToInsert = SEED_PRICING_RULES.map((r) => ({
      company_id: aradiCompanyId,
      agent_id: agentId,
      policy_type_parent: "THIRD_FULL",
      rule_type: r.rule_type,
      car_type: r.car_type,
      age_band: r.age_band,
      value: r.value,
      min_car_value: (r as any).min_car_value ?? null,
      max_car_value: (r as any).max_car_value ?? null,
      notes: r.notes,
    }));
    const { data, error } = await supabase.from("pricing_rules").insert(rulesToInsert).select("id");
    if (error) throw error;
    results.pricing_rules = data?.length ?? 0;
  }

  // 6. Road service prices for "شركة اكس"
  const xCompanyId = coMap.get("شركة اكس");
  if (xCompanyId) {
    await supabase.from("company_road_service_prices").delete().eq("company_id", xCompanyId).eq("agent_id", agentId);

    const rspToInsert = SEED_ROAD_SERVICE_PRICES.map((r) => {
      const serviceId = rsRes.idMap.get(r.service_name);
      if (!serviceId) return null;
      return {
        company_id: xCompanyId,
        agent_id: agentId,
        road_service_id: serviceId,
        car_type: r.car_type,
        age_band: r.age_band,
        company_cost: r.company_cost,
        selling_price: r.selling_price,
      };
    }).filter(Boolean);

    if (rspToInsert.length > 0) {
      const { data, error } = await supabase.from("company_road_service_prices").insert(rspToInsert).select("id");
      if (error) throw error;
      results.road_service_prices = data?.length ?? 0;
    }

    // 7. Accident fee prices for "شركة اكس"
    await supabase.from("company_accident_fee_prices").delete().eq("company_id", xCompanyId).eq("agent_id", agentId);

    const afpToInsert = SEED_ACCIDENT_FEE_PRICES.map((r) => {
      const serviceId = afRes.idMap.get(r.service_name);
      if (!serviceId) return null;
      return {
        company_id: xCompanyId,
        agent_id: agentId,
        accident_fee_service_id: serviceId,
        company_cost: r.company_cost,
        selling_price: r.selling_price,
      };
    }).filter(Boolean);

    if (afpToInsert.length > 0) {
      const { data, error } = await supabase.from("company_accident_fee_prices").insert(afpToInsert).select("id");
      if (error) throw error;
      results.accident_fee_prices = data?.length ?? 0;
    }
  }

  return results;
}
