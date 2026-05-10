/**
 * Stateful flow that seeds the Al Aradi Al Muqadasa 2024 tariff
 * (third-party + comprehensive, no buses) into pricing_rules for the
 * agent's matching insurance_companies row.
 *
 *   1. Detect a "load Aradi Muqadasa rules" intent.
 *   2. Find Aradi companies the agent has set up. 0 → tell user.
 *      1 → confirm prompt. 2+ → numbered pick list.
 *   3. State (pending_action + candidate IDs / chosen company) is
 *      persisted in `ai_chat_messages.metadata` of the assistant turn,
 *      same pattern as delete-flow.ts.
 *   4. On confirm → insert only the rows where no existing rule exists
 *      for that (rule_type, car_type) tuple under THIRD_FULL. Never
 *      overwrites — honours "اذا اشي موجود ما رح يمحيه".
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
  { rule_type: "THIRD_PRICE",  car_type: "car",        age_band: "ANY", value: 900,   min_car_value: null,    max_car_value: null },
  { rule_type: "THIRD_PRICE",  car_type: "tjeradown4", age_band: "ANY", value: 1300,  min_car_value: null,    max_car_value: null },
  { rule_type: "THIRD_PRICE",  car_type: "tjeraup4",   age_band: "ANY", value: 2500,  min_car_value: null,    max_car_value: null },
  { rule_type: "THIRD_PRICE",  car_type: "taxi",       age_band: "ANY", value: 3000,  min_car_value: null,    max_car_value: null },
  { rule_type: "DISCOUNT",     car_type: "car",        age_band: "ANY", value: 700,   min_car_value: null,    max_car_value: null },
  { rule_type: "DISCOUNT",     car_type: "tjeradown4", age_band: "ANY", value: 1100,  min_car_value: null,    max_car_value: null },
  { rule_type: "DISCOUNT",     car_type: "tjeraup4",   age_band: "ANY", value: 1500,  min_car_value: null,    max_car_value: null },
  { rule_type: "DISCOUNT",     car_type: "taxi",       age_band: "ANY", value: 2000,  min_car_value: null,    max_car_value: null },
  { rule_type: "FULL_PERCENT", car_type: "car",        age_band: "ANY", value: 1.75,  min_car_value: null,    max_car_value: 100000 },
  { rule_type: "FULL_PERCENT", car_type: "car",        age_band: "ANY", value: 2,     min_car_value: 100001,  max_car_value: 500000 },
  { rule_type: "FULL_PERCENT", car_type: "car",        age_band: "ANY", value: 2.25,  min_car_value: 500001,  max_car_value: 1000000 },
  { rule_type: "FULL_PERCENT", car_type: "car",        age_band: "ANY", value: 3,     min_car_value: 1000001, max_car_value: null },
  { rule_type: "FULL_PERCENT", car_type: "tjeradown4", age_band: "ANY", value: 2.5,   min_car_value: null,    max_car_value: null },
  { rule_type: "FULL_PERCENT", car_type: "tjeraup4",   age_band: "ANY", value: 3,     min_car_value: null,    max_car_value: null },
  { rule_type: "FULL_PERCENT", car_type: "taxi",       age_band: "ANY", value: 3,     min_car_value: null,    max_car_value: null },
  { rule_type: "MIN_PRICE",    car_type: "car",        age_band: "ANY", value: 1200,  min_car_value: null,    max_car_value: 100000 },
  { rule_type: "MIN_PRICE",    car_type: "car",        age_band: "ANY", value: 2000,  min_car_value: 100001,  max_car_value: 500000 },
  { rule_type: "MIN_PRICE",    car_type: "car",        age_band: "ANY", value: 11250, min_car_value: 500001,  max_car_value: 1000000 },
  { rule_type: "MIN_PRICE",    car_type: "car",        age_band: "ANY", value: 30000, min_car_value: 1000001, max_car_value: null },
  { rule_type: "MIN_PRICE",    car_type: "tjeradown4", age_band: "ANY", value: 2500,  min_car_value: null,    max_car_value: null },
  { rule_type: "MIN_PRICE",    car_type: "tjeraup4",   age_band: "ANY", value: 3000,  min_car_value: null,    max_car_value: null },
  { rule_type: "MIN_PRICE",    car_type: "taxi",       age_band: "ANY", value: 3000,  min_car_value: null,    max_car_value: null },
];

interface CompanyCandidate {
  id: string;
  name: string | null;
  name_ar: string | null;
}

export type AradiRulesFlowMetadata =
  | { pending_action: "aradi_rules_pick"; candidates: CompanyCandidate[] }
  | { pending_action: "aradi_rules_confirm"; company: CompanyCandidate };

export interface AradiRulesFlowResult {
  reply: string;
  metadata: AradiRulesFlowMetadata | null;
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

/** Trigger words. The combination "قواعد" + "اراضي" + "مقدسه" (post-
 *  normalize) is distinctive enough that any common phrasing — نزّل،
 *  نزلي، حط، ضيف، اعمل، sync، seed، load — gets picked up without
 *  brittle verb matching. */
export function isAradiRulesIntent(message: string): boolean {
  const compact = normalizeArabic(message).replace(/\s+/g, "");
  const hasQawaid = compact.includes("قواعد") || compact.includes("rules");
  const hasAradi = compact.includes("اراضي") || compact.includes("aradi") || compact.includes("muqadasa");
  return hasQawaid && hasAradi;
}

function describeCompany(c: CompanyCandidate): string {
  if (c.name_ar && c.name) return `${c.name_ar} (${c.name})`;
  return c.name_ar || c.name || c.id;
}

async function seedAradiRules(
  supabase: any,
  companyId: string,
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
    const rows = inserted.map((t) => ({
      company_id: companyId,
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

/** First step: detect any insurance_companies rows on this agent that
 *  look like Al Aradi Al Muqadasa, and either confirm (1 match) or
 *  show a numbered pick list (2+). */
export async function handleAradiRulesIntent(
  supabase: any,
  agentId: string,
  _message: string,
): Promise<AradiRulesFlowResult> {
  const { data, error } = await supabase
    .from("insurance_companies")
    .select("id, name, name_ar, active")
    .eq("agent_id", agentId)
    .or("name.ilike.%أراضي%,name.ilike.%اراضي%,name.ilike.%aradi%,name.ilike.%muqadasa%,name_ar.ilike.%أراضي%,name_ar.ilike.%اراضي%,name_ar.ilike.%مقدس%")
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
        "ما لقيت شركة الأراضي المقدسة عندك بشركات التأمين.",
        "",
        "أضفها أولاً من **شركات التأمين ← + شركة جديدة** بأي اسم (مثلاً \"شركة الأراضي المقدسة للتأمين التكافلي\")، ثم اطلبني نزّل القواعد مرة ثانية.",
      ].join("\n"),
      metadata: null,
    };
  }

  if (matches.length === 1) {
    const c = matches[0];
    return {
      reply: [
        `بدّك أنزّل قواعد الأراضي المقدسة (تعرفة 2024 — طرف ثالث + تكميلي، بدون باصات) على **${describeCompany(c)}**؟`,
        "",
        "ما رح أمسح ولا أعدّل أي قاعدة موجودة — بس أضيف الناقص.",
        "",
        "نعم أو لا؟",
      ].join("\n"),
      metadata: { pending_action: "aradi_rules_confirm", company: c },
    };
  }

  const lines = matches.map((c, i) => `${i + 1}. ${describeCompany(c)}`);
  return {
    reply: [
      "في عندك أكثر من شركة تطابق الأراضي المقدسة:",
      "",
      ...lines,
      "",
      "أيهم تقصد؟ اكتب الرقم (مثلاً: 2)، أو اكتب \"إلغاء\" للتراجع.",
    ].join("\n"),
    metadata: { pending_action: "aradi_rules_pick", candidates: matches },
  };
}

export async function handleAradiRulesPick(
  meta: Extract<AradiRulesFlowMetadata, { pending_action: "aradi_rules_pick" }>,
  message: string,
): Promise<AradiRulesFlowResult> {
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
      `بدّك أنزّل قواعد الأراضي المقدسة (تعرفة 2024 — طرف ثالث + تكميلي، بدون باصات) على **${describeCompany(chosen)}**؟`,
      "",
      "ما رح أمسح ولا أعدّل أي قاعدة موجودة — بس أضيف الناقص.",
      "",
      "نعم أو لا؟",
    ].join("\n"),
    metadata: { pending_action: "aradi_rules_confirm", company: chosen },
  };
}

export async function handleAradiRulesConfirm(
  supabase: any,
  meta: Extract<AradiRulesFlowMetadata, { pending_action: "aradi_rules_confirm" }>,
  message: string,
): Promise<AradiRulesFlowResult> {
  const m = (message || "").trim().toLowerCase();
  if (/^(لا|إلغاء|الغاء|no|cancel)$/i.test(m)) {
    return { reply: "تم الإلغاء.", metadata: null };
  }
  if (!/^(نعم|أكد|اكد|تأكيد|تاكيد|yes|y|confirm|ok|اوك)$/i.test(m)) {
    return { reply: "نعم أو لا؟", metadata: meta };
  }

  const result = await seedAradiRules(supabase, meta.company.id);
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
        "ملاحظة: المعدات/الجرافات، التاكسي حسب عدد السواقين، وسيارات التأجير ما بنزّلها تلقائياً — أعلمني لو بدّك أضيفها يدوياً.",
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
      "ملاحظة: المعدات/الجرافات، التاكسي حسب عدد السواقين، وسيارات التأجير ما نزّلتها — أعلمني لو بدّك أضيفها.",
    ].filter(Boolean).join("\n"),
    metadata: null,
  };
}
