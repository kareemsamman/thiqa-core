// Canonical agent feature catalog.
//
// Each entry maps a feature_key (the same string stored in
// subscription_plans.default_features and agent_feature_flags) to
// the Arabic label + description + grouping shown in the Thiqa admin
// "Features" tab.
//
// Source of truth for the keyset: union of
//   - Every featureKey referenced in src/components/layout/navigation.ts
//     (so any item agents can see in their sidebar can be controlled)
//   - Every key currently shipped in subscription_plans.default_features
//     across plans (so backend-only features like AI assistant or
//     financial_reports stay controllable).
//
// Drop-list (intentionally NOT in this file): leads, ippbx — removed
// from plans and not in any nav. The Features tab silently ignores
// any agent_feature_flags rows for keys not in this registry, which
// is what we want during a tail-cleanup.
//
// Admin-gated entries (visa_payment) live in a dedicated group below.
// They sit outside plan defaults — Thiqa flips them manually per
// agent. ADMIN_ONLY_FEATURES in useAgentContext is the matching
// runtime gate; keep the two lists in sync.

export interface AgentFeatureDef {
  key: string;
  label: string;
  description: string;
  group: string;
}

export const AGENT_FEATURE_GROUPS = [
  "الأساسيات",
  "العملاء والمعاملات",
  "المالية والمحاسبة",
  "المراسلات والاتصال",
  "ميزات متقدمة",
  "بموافقة إدارية",
] as const;

export const AGENT_FEATURES: AgentFeatureDef[] = [
  // ─── Core / "always on" pages ────────────────────────────────
  { key: "dashboard",          label: "لوحة التحكم",          description: "صفحة الإحصائيات والمؤشرات الرئيسية",      group: "الأساسيات" },
  { key: "tasks",              label: "المهام",                description: "إدارة المهام اليومية للفريق",              group: "الأساسيات" },
  { key: "notifications",      label: "التنبيهات",             description: "مركز التنبيهات الداخلي",                    group: "الأساسيات" },
  { key: "files_upload",       label: "رفع الملفات",           description: "إرفاق ملفات للعملاء والمعاملات",          group: "الأساسيات" },
  { key: "files_explorer",     label: "مستكشف الملفات",        description: "صفحة مستقلة لتصفّح كل الملفات والقوالب",  group: "الأساسيات" },

  // ─── Customer & policy management ────────────────────────────
  { key: "renewals",           label: "تقارير التجديد",        description: "متابعة تجديد المعاملات",                   group: "العملاء والمعاملات" },
  { key: "contacts",           label: "جهات الاتصال",          description: "دفتر جهات اتصال خارج العملاء",             group: "العملاء والمعاملات" },
  { key: "accident_reports",   label: "بلاغات الحوادث",        description: "تسجيل ومتابعة بلاغات الحوادث",            group: "العملاء والمعاملات" },
  { key: "repair_claims",      label: "مطالبات التصليح",       description: "إدارة مطالبات تصليح المركبات",            group: "العملاء والمعاملات" },
  { key: "accident_fees",      label: "إعفاء رسوم الحادث",     description: "خدمة إعفاء رسوم الحادث",                  group: "العملاء والمعاملات" },
  { key: "road_services",      label: "خدمات الطريق",          description: "إدارة خدمات الطريق والمساعدة",            group: "العملاء والمعاملات" },

  // ─── Financial / accounting ──────────────────────────────────
  { key: "debt_tracking",      label: "متابعة الديون",         description: "متابعة المديونيات والتحصيلات",            group: "المالية والمحاسبة" },
  { key: "broker_wallet",      label: "محفظة الوسطاء",         description: "إدارة محفظة وعمولات الوسطاء",             group: "المالية والمحاسبة" },
  { key: "company_settlement", label: "تسويات الشركات",        description: "تقارير تسويات شركات التأمين",              group: "المالية والمحاسبة" },
  { key: "cheques",            label: "الشيكات",                description: "إدارة الشيكات الواردة والصادرة",          group: "المالية والمحاسبة" },
  { key: "receipts",           label: "الإيصالات",              description: "إصدار وطباعة الإيصالات",                  group: "المالية والمحاسبة" },
  { key: "accounting",         label: "المحاسبة",               description: "دفتر محاسبة موحد",                          group: "المالية والمحاسبة" },
  { key: "financial_reports",  label: "التقارير المالية",       description: "عرض التقارير المالية الشاملة",            group: "المالية والمحاسبة" },

  // ─── Communications ──────────────────────────────────────────
  { key: "sms",                label: "إرسال SMS",              description: "إرسال رسائل نصية تشغيلية للعملاء",         group: "المراسلات والاتصال" },
  { key: "marketing_sms",      label: "SMS تسويقية",            description: "حملات SMS تسويقية موجهة",                  group: "المراسلات والاتصال" },
  { key: "correspondence",     label: "المراسلات والترويسات",   description: "نظام إدارة المراسلات والترويسات",         group: "المراسلات والاتصال" },
  { key: "digital_signatures", label: "التوقيع الرقمي",         description: "التقاط توقيعات العملاء رقمياً",            group: "المراسلات والاتصال" },

  // ─── Advanced ────────────────────────────────────────────────
  { key: "ai_assistant",       label: "المساعد الذكي (ثاقب)",   description: "مساعد AI للاستعلام عن بيانات النظام",     group: "ميزات متقدمة" },

  // ─── Admin-gated (default OFF, never set by plan defaults) ───
  { key: "visa_payment",       label: "الدفع بفيزا (Tranzila)", description: "تفعيل بطاقات Visa عبر Tranzila — يتطلب موافقة إدارية", group: "بموافقة إدارية" },
];

export const AGENT_FEATURE_BY_KEY: Record<string, AgentFeatureDef> = AGENT_FEATURES.reduce((acc, f) => {
  acc[f.key] = f;
  return acc;
}, {} as Record<string, AgentFeatureDef>);
