/**
 * Stateful flow that seeds the Palestine Insurance (شركة فلسطين للتأمين)
 * tariff into pricing_rules for the agent's matching insurance_companies
 * row. Source: per-agent PDF for Mr. Tamer Asali effective 2026-05-01
 * with a 10% commission on total production (commission is end-of-month
 * settlement on aggregate sales, NOT per-policy — so it isn't modeled
 * here; companyPayment reflects the full carrier dues from the PDF).
 *
 * Mirrors aradi-rules-flow.ts: 1) detect intent, 2) find candidate
 * companies, 3) ask for pick if multiple, 4) on confirmation insert
 * rows where no existing (rule_type, car_type) tuple exists for that
 * company under THIRD_FULL.
 *
 * Admin-only — workers fall through to the regular read-only AI.
 */

type RuleType = "THIRD_PRICE" | "DISCOUNT" | "FULL_PERCENT" | "MIN_PRICE";
type CarType = "car" | "tjeradown4" | "tjeraup4" | "taxi";

interface TargetRow {
  rule_type: RuleType;
  car_type: CarType;
  age_band: "ANY";
  value: number;
  min_car_value: number | null;
  max_car_value: number | null;
}

const TARGET_ROWS: TargetRow[] = [
  // قسط فريق ثالث فقط → THIRD_PRICE
  { rule_type: "THIRD_PRICE",  car_type: "car",        age_band: "ANY", value: 850,   min_car_value: null,    max_car_value: null },
  { rule_type: "THIRD_PRICE",  car_type: "tjeradown4", age_band: "ANY", value: 1200,  min_car_value: null,    max_car_value: null },
  { rule_type: "THIRD_PRICE",  car_type: "tjeraup4",   age_band: "ANY", value: 1800,  min_car_value: null,    max_car_value: null },
  { rule_type: "THIRD_PRICE",  car_type: "taxi",       age_band: "ANY", value: 3500,  min_car_value: null,    max_car_value: null },

  // فريق ثالث مع شامل → DISCOUNT
  { rule_type: "DISCOUNT",     car_type: "car",        age_band: "ANY", value: 500,   min_car_value: null,    max_car_value: null },
  { rule_type: "DISCOUNT",     car_type: "tjeradown4", age_band: "ANY", value: 1000,  min_car_value: null,    max_car_value: null },
  { rule_type: "DISCOUNT",     car_type: "tjeraup4",   age_band: "ANY", value: 1000,  min_car_value: null,    max_car_value: null },
  { rule_type: "DISCOUNT",     car_type: "taxi",       age_band: "ANY", value: 1750,  min_car_value: null,    max_car_value: null },

  // نسبة احتساب الشامل → FULL_PERCENT
  { rule_type: "FULL_PERCENT", car_type: "car",        age_band: "ANY", value: 2.5,   min_car_value: null,    max_car_value: null },
  { rule_type: "FULL_PERCENT", car_type: "car",        age_band: "ANY", value: 2.7,   min_car_value: 250000,  max_car_value: 300000 },
  { rule_type: "FULL_PERCENT", car_type: "tjeradown4", age_band: "ANY", value: 2.5,   min_car_value: null,    max_car_value: null },
  { rule_type: "FULL_PERCENT", car_type: "tjeraup4",   age_band: "ANY", value: 2.75,  min_car_value: null,    max_car_value: null },
  { rule_type: "FULL_PERCENT", car_type: "taxi",       age_band: "ANY", value: 3,     min_car_value: null,    max_car_value: null },

  // الحد الأدنى للشامل → MIN_PRICE
  { rule_type: "MIN_PRICE",    car_type: "car",        age_band: "ANY", value: 1500,  min_car_value: null,    max_car_value: null },
  { rule_type: "MIN_PRICE",    car_type: "car",        age_band: "ANY", value: 2500,  min_car_value: 250000,  max_car_value: 300000 },
  { rule_type: "MIN_PRICE",    car_type: "tjeradown4", age_band: "ANY", value: 2500,  min_car_value: null,    max_car_value: null },
  { rule_type: "MIN_PRICE",    car_type: "tjeraup4",   age_band: "ANY", value: 2500,  min_car_value: null,    max_car_value: null },
  { rule_type: "MIN_PRICE",    car_type: "taxi",       age_band: "ANY", value: 3000,  min_car_value: null,    max_car_value: null },
];

interface CompanyCandidate {
  id: string;
  name: string | null;
  name_ar: string | null;
}

export type PalestineRulesFlowMetadata =
  | { pending_action: "palestine_rules_pick"; candidates: CompanyCandidate[] }
  | { pending_action: "palestine_rules_confirm"; company: CompanyCandidate };

export interface PalestineRulesFlowResult {
  reply: string;
  metadata: PalestineRulesFlowMetadata | null;
}

function normalizeArabic(input: string): string {
  if (!input) return "";
  return input
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[ً-ْ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Combination "قواعد" + "فلسطين" / "palestine" / "filastin" is
 *  distinctive enough that any common phrasing — نزّل، نزلي، حط،
 *  ضيف، اعمل، load، seed — gets picked up. */
export function isPalestineRulesIntent(message: string): boolean {
  const compact = normalizeArabic(message).replace(/\s+/g, "");
  const hasQawaid = compact.includes("قواعد") || compact.includes("rules");
  const hasFilastin =
    compact.includes("فلسطين") ||
    compact.includes("palestine") ||
    compact.includes("filastin");
  return hasQawaid && hasFilastin;
}

function describeCompany(c: CompanyCandidate): string {
  if (c.name_ar && c.name) return `${c.name_ar} (${c.name})`;
  return c.name_ar || c.name || c.id;
}

async function seedPalestineRules(
  supabase: any,
  companyId: string,
  agentId: string,
): Promise<{ inserted: TargetRow[]; skipped: TargetRow[]; error?: string }> {
  const { data: existing, error: existingErr } = await supabase
    .from("pricing_rules")
    .select("rule_type, car_type")
    .eq("company_id", companyId)
    .eq("policy_type_parent", "THIRD_FULL");
  if (existingErr) return { inserted: [], skipped: [], error: existingErr.message };

  const existingKeys = new Set(
    (existing ?? []).map((r: any) => `${r.rule_type}|${r.car_type ?? "car"}`),
  );

  const inserted: TargetRow[] = [];
  const skipped: TargetRow[] = [];
  for (const t of TARGET_ROWS) {
    const key = `${t.rule_type}|${t.car_type}`;
    if (existingKeys.has(key)) skipped.push(t);
    else inserted.push(t);
  }

  if (inserted.length > 0) {
    // agent_id is required by RLS — pricing_rules without it are
    // invisible to the agency UI even when physically present.
    const rows = inserted.map((t) => ({
      company_id: companyId,
      agent_id: agentId,
      policy_type_parent: "THIRD_FULL" as const,
      rule_type: t.rule_type,
      car_type: t.car_type,
      age_band: t.age_band,
      value: t.value,
      min_car_value: t.min_car_value,
      max_car_value: t.max_car_value,
    }));
    const { error } = await supabase.from("pricing_rules").insert(rows);
    if (error) return { inserted: [], skipped, error: error.message };
  }

  return { inserted, skipped };
}

export async function handlePalestineRulesIntent(
  supabase: any,
  agentId: string,
  _message: string,
): Promise<PalestineRulesFlowResult> {
  const { data, error } = await supabase
    .from("insurance_companies")
    .select("id, name, name_ar, active")
    .eq("agent_id", agentId)
    .or("name.ilike.%فلسطين%,name.ilike.%palestine%,name.ilike.%filastin%,name_ar.ilike.%فلسطين%")
    .order("created_at", { ascending: true })
    .limit(8);

  if (error) {
    return { reply: `تعذّر البحث عن الشركة: ${error.message}`, metadata: null };
  }

  const matches: CompanyCandidate[] = (data ?? []).map((r: any) => ({
    id: r.id,
    name: r.name,
    name_ar: r.name_ar,
  }));

  if (matches.length === 0) {
    return {
      reply: [
        "ما لقيت شركة فلسطين للتأمين عندك بشركات التأمين.",
        "",
        "أضفها أولاً من **شركات التأمين ← + شركة جديدة** (مثلاً \"شركة فلسطين للتأمين\")، ثم اطلبني نزّل القواعد مرة ثانية.",
      ].join("\n"),
      metadata: null,
    };
  }

  if (matches.length === 1) {
    const c = matches[0];
    return {
      reply: [
        `بدّك أنزّل قواعد فلسطين للتأمين (تعرفة الأسعار الإسرائيلية — طرف ثالث + تكميلي) على **${describeCompany(c)}**؟`,
        "",
        "ما رح أمسح ولا أعدّل أي قاعدة موجودة — بس أضيف الناقص.",
        "",
        "نعم أو لا؟",
      ].join("\n"),
      metadata: { pending_action: "palestine_rules_confirm", company: c },
    };
  }

  const lines = matches.map((c, i) => `${i + 1}. ${describeCompany(c)}`);
  return {
    reply: [
      "في عندك أكثر من شركة تطابق فلسطين:",
      "",
      ...lines,
      "",
      "أيهم تقصد؟ اكتب الرقم (مثلاً: 2)، أو اكتب \"إلغاء\" للتراجع.",
    ].join("\n"),
    metadata: { pending_action: "palestine_rules_pick", candidates: matches },
  };
}

export async function handlePalestineRulesPick(
  meta: Extract<PalestineRulesFlowMetadata, { pending_action: "palestine_rules_pick" }>,
  message: string,
): Promise<PalestineRulesFlowResult> {
  const m = (message || "").trim().toLowerCase();
  if (/^(إلغاء|الغاء|cancel|لا|no)$/i.test(m)) {
    return { reply: "تم الإلغاء.", metadata: null };
  }
  const ascii = m.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  const match = ascii.match(/\d+/);
  if (!match) {
    return {
      reply: "لم أفهم اختيارك. اكتب رقم الشركة من القائمة (مثلاً: 2)، أو \"إلغاء\".",
      metadata: meta,
    };
  }
  const n = parseInt(match[0], 10);
  const idx = n - 1;
  if (idx < 0 || idx >= meta.candidates.length) {
    return {
      reply: `الرقم ${n} مش موجود. اختر رقم بين 1 و${meta.candidates.length}، أو اكتب "إلغاء".`,
      metadata: meta,
    };
  }
  const chosen = meta.candidates[idx];
  return {
    reply: [
      `بدّك أنزّل قواعد فلسطين للتأمين (تعرفة الأسعار الإسرائيلية — طرف ثالث + تكميلي) على **${describeCompany(chosen)}**؟`,
      "",
      "ما رح أمسح ولا أعدّل أي قاعدة موجودة — بس أضيف الناقص.",
      "",
      "نعم أو لا؟",
    ].join("\n"),
    metadata: { pending_action: "palestine_rules_confirm", company: chosen },
  };
}

export async function handlePalestineRulesConfirm(
  supabase: any,
  agentId: string,
  meta: Extract<PalestineRulesFlowMetadata, { pending_action: "palestine_rules_confirm" }>,
  message: string,
): Promise<PalestineRulesFlowResult> {
  const m = (message || "").trim().toLowerCase();
  if (/^(لا|إلغاء|الغاء|no|cancel)$/i.test(m)) {
    return { reply: "تم الإلغاء.", metadata: null };
  }
  if (!/^(نعم|أكد|اكد|تأكيد|تاكيد|yes|y|confirm|ok|اوك)$/i.test(m)) {
    return { reply: "نعم أو لا؟", metadata: meta };
  }

  const result = await seedPalestineRules(supabase, meta.company.id, agentId);
  if (result.error) {
    return { reply: `تعذّر إضافة القواعد: ${result.error}`, metadata: null };
  }

  const company = describeCompany(meta.company);
  if (result.inserted.length === 0) {
    return {
      reply: [
        `✅ القواعد كلها موجودة عند **${company}** — ما في شي ناقص لأضيفه.`,
        `(تمّ تخطّي ${result.skipped.length} قاعدة موجودة)`,
        "",
        "ملاحظة: المركبات التجارية أكثر من 10 طن، المجرور، والتكسي حسب عدد السواقين ما بنزّلها تلقائياً — أعلمني لو بدّك أضيفها يدوياً.",
      ].join("\n"),
      metadata: null,
    };
  }

  const summaryByType = result.inserted.reduce<Record<string, number>>((acc, r) => {
    acc[r.rule_type] = (acc[r.rule_type] ?? 0) + 1;
    return acc;
  }, {});
  const breakdown = [
    summaryByType.THIRD_PRICE ? `طرف ثالث: ${summaryByType.THIRD_PRICE}` : null,
    summaryByType.DISCOUNT ? `خصم: ${summaryByType.DISCOUNT}` : null,
    summaryByType.FULL_PERCENT ? `نسبة شامل: ${summaryByType.FULL_PERCENT}` : null,
    summaryByType.MIN_PRICE ? `حد أدنى: ${summaryByType.MIN_PRICE}` : null,
  ].filter(Boolean).join(" · ");

  return {
    reply: [
      `✅ ضفت ${result.inserted.length} قاعدة على **${company}**.`,
      `(${breakdown})`,
      result.skipped.length ? `تمّ تخطّي ${result.skipped.length} قاعدة موجودة من قبل (ما لمستها).` : "",
      "",
      "بتقدر تشوفها/تعدّلها من **شركات التأمين ← " + company + " ← التسعير ⚙️**.",
      "",
      "ملاحظة: المركبات أكثر من 10 طن، المجرور، والتكسي حسب عدد السواقين ما نزّلتها — أعلمني لو بدّك أضيفها. والـ10% عمولة على إجمالي الإنتاج تسوية شهرية، مش جزء من قواعد الـper-policy.",
    ].filter(Boolean).join("\n"),
    metadata: null,
  };
}
