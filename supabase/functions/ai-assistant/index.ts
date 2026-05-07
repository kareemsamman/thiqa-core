import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkUsageLimit, limitReachedResponse, logUsage } from "../_shared/usage-limits.ts";
import {
  isDeleteIntent,
  handleDeleteIntent,
  handleDeletePick,
  handleDeleteConfirm,
  type DeleteFlowMetadata,
} from "./delete-flow.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DEFAULT_SYSTEM_PROMPT = `أنت "ثاقب"، المساعد الذكي لنظام ثقة لإدارة التأمين. أنت مساعد متخصص حصرياً في مساعدة وكلاء التأمين في إدارة عملهم.

## هويتك وحدودك
- أنت مساعد مكتب تأمين فقط — لا تجيب على أي سؤال خارج نطاق عمل التأمين وإدارة المكتب
- لا تتصرف كـ ChatGPT أو مساعد عام — إذا سألك أحد عن الطقس أو وصفات طبخ أو أي موضوع غير متعلق بالتأمين، قل بلطف: "أنا متخصص في مساعدتك بإدارة مكتب التأمين فقط. كيف أقدر أساعدك؟"
- لا تكتب كود برمجي أو تشرح مفاهيم تقنية
- لا تعطي نصائح قانونية أو طبية
- لا تكشف عن تفاصيل تقنية أو بنية النظام (لا تذكر أسماء جداول أو APIs أو قواعد بيانات أو edge functions)

## قواعد أساسية
- تجيب باللغة العربية دائمًا بأسلوب مهني وودود ومختصر
- تقدم معلومات دقيقة بناءً على البيانات المتاحة فقط
- لا تخترع أو تفترض بيانات غير موجودة في السياق أبداً — هذا مهم جداً
- إذا لم تجد البيانات المطلوبة، أخبر المستخدم بوضوح
- تذكّر سياق المحادثة السابقة وابنِ عليه

## عرض بيانات العملاء
- عند السؤال عن عميل، اعرض دائماً: الاسم الكامل، رقم الهوية، رقم الهاتف، رقم الملف
- إذا كان للعميل سيارات أو معاملات، اذكرها باختصار
- لا تعرض أكثر من 15 عميل في رد واحد

## عرض المعاملات
- عند عرض معاملة، اذكر: نوع التأمين، شركة التأمين، تاريخ البداية والانتهاء، المبلغ
- عند السؤال عن معاملات منتهية أو قريبة الانتهاء، ذكّر المستخدم: "⚠️ يُنصح بالتواصل مع العميل لتجديد المعاملة"
- عند عرض معاملات ملغاة، وضّح أنها ملغاة

## المدفوعات
- اعرض: المبلغ، طريقة الدفع (نقدي/شيك/فيزا/تحويل)، التاريخ، اسم العميل
- إذا كان هناك مبلغ متبقي على عميل، نبّه المستخدم

## صفحات النظام — وجّه المستخدم عند الحاجة
عندما يسأل المستخدم "أين أجد...؟" أو "كيف أعمل...؟" وجّهه للصفحة المناسبة:
- لوحة التحكم ← صفحة "لوحة التحكم" — ملخص عام للنظام والإحصائيات
- العملاء ← صفحة "العملاء" — إضافة وإدارة العملاء والبحث بالاسم أو الهوية أو الهاتف
- السيارات ← صفحة "السيارات" — إدارة مركبات العملاء
- المعاملات ← صفحة "المعاملات" — عرض وإصدار معاملات التأمين (إلزامي، شامل، خدمات الطريق، إعفاء رسوم)
- إضافة معاملة جديدة ← زر "معاملة جديدة" في الشريط السفلي أو من صفحة العميل
- المدفوعات ← من تفاصيل المعاملة، تبويب "الدفعات"
- جهات الاتصال ← صفحة "جهات الاتصال" — دفتر هواتف العمل
- متابعة الديون ← صفحة "متابعة الديون" — متابعة المبالغ المستحقة على العملاء
- شركات التأمين ← صفحة "شركات التأمين" — إدارة شركات التأمين المتعامل معها
- التقارير المالية ← صفحة "التقارير" — أرباح، تسويات، ملخصات مالية (للمدير فقط)
- المهام ← صفحة "المهام" — إنشاء ومتابعة المهام والتذكيرات
- سجل النشاط ← صفحة "سجل النشاط" — تتبع جميع العمليات في النظام
- التنبيهات ← صفحة "التنبيهات" — الإشعارات والتنبيهات
- المستخدمون ← صفحة "المستخدمون" في الإعدادات — إضافة موظفين وتحديد صلاحياتهم (للمدير فقط)
- الفروع ← صفحة "الفروع" في الإعدادات — إدارة فروع الوكالة (للمدير فقط)
- إعدادات SMS ← صفحة "إعدادات SMS" في الإعدادات — تفعيل خدمة الرسائل النصية
- العلامة التجارية ← صفحة "العلامة التجارية" في الإعدادات — تخصيص الشعار والتوقيع
- الاشتراك ← صفحة "الاشتراك" في القائمة الجانبية — إدارة خطة الاشتراك
- الملف الشخصي ← من أيقونة الحساب أسفل القائمة الجانبية

## كيفية إرشاد المستخدم
عندما يسأل "كيف أضيف عميل؟":
- وجّهه: "اذهب لصفحة العملاء واضغط على زر 'إضافة عميل' أو يمكنك إضافته مباشرة عند إنشاء معاملة جديدة"

عندما يسأل "كيف أصدر معاملة؟":
- وجّهه: "اضغط على 'معاملة جديدة' من الشريط السفلي، اختر نوع التأمين والعميل والسيارة، ثم أكمل البيانات"

عندما يسأل "كيف أرسل فاتورة للعميل؟":
- وجّهه: "افتح تفاصيل المعاملة، ثم اضغط على أيقونة الإرسال (✈️) لإرسال الفاتورة عبر SMS"

## ما يمكنك مساعدة المستخدم به
- الاستعلام عن العملاء (بالاسم، الهوية، الهاتف، رقم الملف)
- الاستعلام عن السيارات (برقم السيارة، الشركة المصنعة، الموديل)
- الاستعلام عن المعاملات والبوالص (النوع، الحالة، تاريخ الانتهاء، الشركة)
- الاستعلام عن المدفوعات (المبلغ، النوع، التاريخ)
- الاستعلام عن شركات التأمين
- تقديم ملخصات وإحصائيات (عدد العملاء، عدد المعاملات، إجمالي المبالغ)
- إرشاد المستخدم لاستخدام صفحات النظام
- الإجابة عن أسئلة متعلقة بعمل مكتب التأمين
- التذكير بمعاملات قريبة الانتهاء

## ما لا يمكنك فعله
- لا تجيب على أسئلة عامة غير متعلقة بالتأمين
- لا تعدّل أو تحذف أي بيانات — أنت للاستعلام فقط
- لا تعطي أسعار تأمين أو عروض أسعار — وجّه المستخدم لإنشاء معاملة جديدة
- لا تشارك بيانات عميل مع عميل آخر
- لا تخبر المستخدم بمعلومات وكلاء آخرين — بياناتك محصورة بالوكيل الحالي فقط

## أسلوب الردود — قواعد إلزامية
- **اختصر قدر الإمكان** — جواب من سطر أو سطرين أفضل من فقرة. لا تكتب مقدمات طويلة.
- لا ترحّب في كل رد، ولا تكرر السؤال، ولا تختم بـ"كيف أقدر أساعدك؟" في كل مرة.
- لا تذكر تفاصيل النظام أو إحصائيات لم يطلبها المستخدم. أجب على ما سأل عنه فقط.
- إذا سأل سؤال "كم/عدد"، أعطه الرقم مباشرة، لا قائمة.
- عند عرض بيانات، استخدم أسطر مختصرة بدون شرح طويل.
- استخدم الرموز التعبيرية باعتدال شديد (✅ ❌ 👤 🚗 ⚠️ — رمز واحد لكل رد على الأكثر).
- إذا كانت النتائج فارغة، قل "لا توجد نتائج" واقترح بحثاً بديلاً قصيراً.`;

const ADMIN_EXTRA = `

## صلاحيات المدير
- لديك صلاحية كاملة لعرض جميع البيانات المالية (أرباح، مدفوعات للشركة، عمولات)
- يمكنك عرض تقارير مالية وملخصات أرباح
- يمكنك الإجابة عن أسئلة حول أداء المكتب المالي`;

const WORKER_EXTRA = `

## صلاحيات الموظف
- ليس لديك صلاحية لعرض: الأرباح، المدفوعات للشركة، العمولات، التسويات المالية
- إذا سُئلت عن هذه المعلومات، قل بلطف: "هذه المعلومات متاحة للمدير فقط. يمكنك التواصل مع مديرك للاطلاع عليها."
- يمكنك عرض: بيانات العملاء، السيارات، المعاملات (بدون أرباح)، المدفوعات
- لا تذكر وجود بيانات مالية حساسة — فقط قل أنها غير متاحة`;

// ─── Intent classification ───
interface IntentResult {
  tables: string[];
  searchTerms: string[];
  isAggregate: boolean;
  isFinancial: boolean;
}

function classifyIntent(message: string): IntentResult {
  const msg = message.toLowerCase();
  const tables: string[] = [];
  let isAggregate = false;
  let isFinancial = false;
  const searchTerms: string[] = [];

  // Extract potential search terms (names, numbers)
  const nameMatch = msg.match(/["«»"](.*?)["«»"]/);
  if (nameMatch) searchTerms.push(nameMatch[1]);

  // Numbers that look like IDs or phone numbers
  const numMatch = msg.match(/\d{5,}/g);
  if (numMatch) searchTerms.push(...numMatch);

  // Client intent
  if (/عميل|عملاء|زبون|زبائن|اسم|هوية|رقم هوية|ملف|هاتف العميل/.test(msg)) {
    tables.push("clients");
  }

  // Car intent
  if (/سيارة|سيارات|مركبة|مركبات|رقم سيارة|لوحة|رقم لوحة|موديل/.test(msg)) {
    tables.push("cars");
  }

  // Policy intent
  if (/معاملة|معاملات|بوليصة|بوالص|تأمين|إلزامي|شامل|طرف ثالث|تنتهي|انتهاء|تجديد|منتهية|سارية/.test(msg)) {
    tables.push("policies");
  }

  // Payment intent
  if (/دفعة|دفعات|مدفوع|تحصيل|مبلغ|شيك|شيكات|فيزا|نقدي|تحويل/.test(msg)) {
    tables.push("payments");
  }

  // Company intent
  if (/شركة تأمين|شركات تأمين|شركة/.test(msg)) {
    tables.push("companies");
  }

  // Broker intent
  if (/وسيط|وسطاء|سمسار|سماسرة/.test(msg)) {
    tables.push("brokers");
  }

  // Accident report intent
  if (/حادث|حوادث|بلاغ|بلاغات|تقرير حادث/.test(msg)) {
    tables.push("accidents");
  }

  // Branch intent
  if (/فرع|فروع/.test(msg)) {
    tables.push("branches");
  }

  // Debt intent — pull policies + payments so AI can compute outstanding
  if (/دين|ديون|متبقي|مستحق|باقي|مدين|مديون/.test(msg)) {
    tables.push("policies", "payments");
  }

  // Task intent
  if (/مهمة|مهام|تذكير|تذكيرات|أعمال اليوم|todo/.test(msg)) {
    tables.push("tasks");
  }

  // Contacts intent (business contacts: lawyers, garages, surveyors)
  if (/جهة اتصال|جهات اتصال|جهات الاتصال|محامي|ورشة|مقدر/.test(msg)) {
    tables.push("contacts");
  }

  // Receipts intent
  if (/إيصال|إيصالات|سند قبض|سندات قبض/.test(msg)) {
    tables.push("receipts");
  }

  // Claims intent
  if (/مطالبة|مطالبات|تصليح|إصلاح/.test(msg)) {
    tables.push("claims");
  }

  // Leads intent
  if (/ليد|ليدز|عميل محتمل|عملاء محتملين|متابعة عملاء/.test(msg)) {
    tables.push("leads");
  }

  // Financial intent
  if (/ربح|أرباح|عمولة|عمولات|خسارة|دفع للشركة|تسوية|مالي|إيرادات/.test(msg)) {
    isFinancial = true;
    tables.push("policies");
  }

  // Accounting intent — companies/brokers balances, expenses, owed amounts
  if (/محاسبة|حساب|رصيد|مستحق|بده|بدها|مصاري|تطالب|تسويات|مدفوع للشركة|دفع للوسيط|مصاريف/.test(msg)) {
    isFinancial = true;
    tables.push("accounting");
  }

  // Aggregate intent
  if (/كم|عدد|مجموع|إجمالي|إحصائيات|إحصاء|متوسط|أكثر|أقل|ملخص/.test(msg)) {
    isAggregate = true;
  }

  // Default: if no intent matched, include clients + policies
  if (tables.length === 0) {
    tables.push("clients", "policies");
  }

  return { tables: [...new Set(tables)], searchTerms, isAggregate, isFinancial };
}

// ─── Date-range + ownership scope helpers ───
// Pulled out of fetchContextData so policies / payments / accidents
// can all share the same logic — without this, "كم معاملة اليوم" was
// counting every policy ever issued because the count query ignored
// the date keyword in the user message.

// All date math runs in Asia/Jerusalem so "today" matches what the
// agent sees in the dashboard — Deno edge functions run in UTC, so a
// naive new Date()/setHours(0,0,0,0) here gave UTC midnight, which is
// 02:00 or 03:00 Israel time. Result: policies created right after
// local midnight got dropped from "اليوم" while the dashboard counted
// them. We now compute Israel-local YYYY-MM-DD then convert to a UTC
// ISO timestamp at Israel midnight so PostgREST comparisons line up
// with how the user (and the dashboard) think about dates.
const APP_TZ = "Asia/Jerusalem";

function israelDate(d: Date = new Date()): string {
  // en-CA gives "YYYY-MM-DD", which is what we want.
  return new Intl.DateTimeFormat("en-CA", { timeZone: APP_TZ }).format(d);
}

function israelTzOffsetHours(dateIso: string): number {
  // Israel switches between IST (+02:00) and IDT (+03:00). Determine
  // the offset for a given date by comparing UTC noon to the Israel
  // hour at the same instant — saves us from hard-coding DST rules.
  const probe = new Date(`${dateIso}T12:00:00Z`);
  const hour = parseInt(
    probe.toLocaleString("en-US", { timeZone: APP_TZ, hour: "numeric", hour12: false }),
    10,
  );
  return hour - 12;
}

function israelMidnightUtcIso(dateIso: string): string {
  const offset = israelTzOffsetHours(dateIso);
  const sign = offset >= 0 ? "+" : "-";
  const tz = `${sign}${String(Math.abs(offset)).padStart(2, "0")}:00`;
  return new Date(`${dateIso}T00:00:00${tz}`).toISOString();
}

function addDays(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T12:00:00Z`); // noon avoids DST edge cases
  d.setUTCDate(d.getUTCDate() + days);
  return israelDate(d);
}

interface DateRange {
  // Use fromIso/toIso for `timestamptz` columns (created_at).
  fromIso?: string;
  toIso?: string;
  // Use fromDate/toDate for plain `date` columns (payment_date,
  // accident_date) — they're already in Israel-local YYYY-MM-DD so
  // PostgREST sends them as-is and Postgres compares exact dates.
  fromDate?: string;
  toDate?: string;
  label: string;
}

function buildRange(fromDateIso: string, toDateIso: string | null, label: string): DateRange {
  return {
    fromIso: israelMidnightUtcIso(fromDateIso),
    toIso: toDateIso ? israelMidnightUtcIso(toDateIso) : undefined,
    fromDate: fromDateIso,
    toDate: toDateIso ?? undefined,
    label,
  };
}

function detectDateRange(msg: string): DateRange | null {
  const today = israelDate();

  if (/اليوم|today/i.test(msg)) return buildRange(today, addDays(today, 1), "اليوم");
  if (/أمس|امس|البارحة|yesterday/i.test(msg)) return buildRange(addDays(today, -1), today, "أمس");
  if (/هذا الأسبوع|الأسبوع الحالي|this week/i.test(msg)) return buildRange(addDays(today, -7), null, "آخر 7 أيام");
  if (/هذا الشهر|الشهر الحالي|this month/i.test(msg)) {
    return buildRange(`${today.slice(0, 7)}-01`, null, "هذا الشهر");
  }
  if (/هذه السنة|السنة الحالية|this year/i.test(msg)) {
    return buildRange(`${today.slice(0, 4)}-01-01`, null, "هذه السنة");
  }
  const iso = msg.match(/\d{4}-\d{2}-\d{2}/);
  if (iso) return buildRange(iso[0], addDays(iso[0], 1), iso[0]);
  return null;
}

// Detects "did I do" / "my" framing — user wants results scoped to
// themselves, not the whole agency. Triggers a created_by filter on
// policies so workers asking "كم معاملة عملت اليوم" get THEIR count.
function isOwnershipQuery(msg: string): boolean {
  return /\bأنا\b|عملتها|عملت|سويتها|سويت|خاصتي|تبعي|الخاصة بي|مالي/.test(msg);
}

// ─── Data retrieval ───
async function fetchContextData(
  supabase: any,
  agentId: string,
  intent: IntentResult,
  isAdmin: boolean,
  branchId: string | null,
  userMessage: string,
  userId: string
): Promise<string> {
  const parts: string[] = [];
  const limit = 20;

  // Extract search text from message (remove common Arabic words including definite articles)
  const searchText = userMessage
    .replace(/أعطني|أريد|ابحث|عن|معلومات|بيانات|تفاصيل|عميل|عملاء|العملاء|العميل|سيارة|سيارات|السيارات|السيارة|معاملة|معاملات|المعاملات|المعاملة|بوليصة|بوالص|كم|عدد|ما|هو|هي|هل|في|من|إلى|على|لي|كل|جميع|اليوم|هذا|هذه|الشهر|أخبرني|أظهر|اعرض|قائمة|لائحة|تفصيل|ملخص|إجمالي|إحصائيات|المدفوعات|الدفعات|الأرباح|شركة|شركات|تأمين|التأمين/g, "")
    .trim();

  for (const table of intent.tables) {
    try {
      if (table === "clients") {
        // Get total count first
        let countQuery = supabase.from("clients")
          .select("id", { count: "exact", head: true })
          .eq("agent_id", agentId)
          .is("deleted_at", null);
        if (branchId && !isAdmin) countQuery = countQuery.eq("branch_id", branchId);
        const { count: totalClients } = await countQuery;

        let query = supabase.from("clients")
          .select("full_name, id_number, phone_number, file_number, date_joined")
          .eq("agent_id", agentId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(limit);

        if (branchId && !isAdmin) query = query.eq("branch_id", branchId);
        if (searchText.length > 2 && !intent.isAggregate && intent.searchTerms.length === 0) {
          query = query.or(`full_name.ilike.%${searchText}%,id_number.ilike.%${searchText}%,phone_number.ilike.%${searchText}%,file_number.ilike.%${searchText}%`);
        } else if (intent.searchTerms.length > 0) {
          const term = intent.searchTerms[0];
          query = query.or(`full_name.ilike.%${term}%,id_number.ilike.%${term}%,phone_number.ilike.%${term}%,file_number.ilike.%${term}%`);
        }

        const { data, error } = await query;
        console.log(`[ai-assistant] Clients query: found ${data?.length || 0}, total: ${totalClients}, error: ${error?.message || 'none'}`);

        if (data && data.length > 0) {
          const header = (totalClients || 0) > limit
            ? `[عملاء - عرض ${data.length} من أصل ${totalClients} | لرؤية الجميع → صفحة العملاء]`
            : `[عملاء - ${data.length} نتيجة]`;
          parts.push(header + '\n' +
            data.map((c: any, i: number) => `${i + 1}. ${c.full_name} | هوية: ${c.id_number || '-'} | هاتف: ${c.phone_number || '-'} | ملف: ${c.file_number || '-'}`).join('\n'));
        } else if (intent.tables.length === 1) {
          parts.push("[لا يوجد عملاء مسجلين حالياً]");
        }
      }

      if (table === "cars") {
        // Workers see only cars belonging to clients in their branch.
        // We filter via the related client's branch_id by fetching only
        // cars whose owning client is visible — done as a join filter
        // through the clients!inner relation.
        const baseSelect = branchId && !isAdmin
          ? "car_number, manufacturer_name, model, year, car_type, clients!inner(full_name, branch_id)"
          : "car_number, manufacturer_name, model, year, car_type, clients(full_name)";

        let countQ = supabase.from("cars")
          .select(branchId && !isAdmin ? "id, clients!inner(branch_id)" : "id", { count: "exact", head: true })
          .eq("agent_id", agentId)
          .is("deleted_at", null);
        if (branchId && !isAdmin) countQ = countQ.eq("clients.branch_id", branchId);
        const { count: totalCars } = await countQ;

        let query = supabase.from("cars")
          .select(baseSelect)
          .eq("agent_id", agentId)
          .is("deleted_at", null)
          .limit(limit);

        if (branchId && !isAdmin) query = query.eq("clients.branch_id", branchId);

        if (searchText.length > 2 && !intent.isAggregate) {
          query = query.or(`car_number.ilike.%${searchText}%,manufacturer_name.ilike.%${searchText}%,model.ilike.%${searchText}%`);
        } else if (intent.searchTerms.length > 0) {
          const term = intent.searchTerms[0];
          query = query.or(`car_number.ilike.%${term}%,manufacturer_name.ilike.%${term}%,model.ilike.%${term}%`);
        }

        const { data } = await query;
        if (data && data.length > 0) {
          const header = (totalCars || 0) > limit
            ? `[سيارات - عرض ${data.length} من أصل ${totalCars} | لرؤية الجميع → صفحة السيارات]`
            : `[سيارات - ${data.length} نتيجة]`;
          parts.push(header + '\n' +
            data.map((c: any, i: number) => `${i + 1}. ${c.car_number} | ${c.manufacturer_name || ''} ${c.model || ''} ${c.year || ''} | مالك: ${(c.clients as any)?.full_name || '-'}`).join('\n'));
        }
      }

      if (table === "policies") {
        const dateRange = detectDateRange(userMessage);
        const mineOnly = isOwnershipQuery(userMessage);

        // Build filters once and apply to BOTH the count query and
        // the data query so "كم معاملة عملت اليوم" gives the right
        // scoped number, not the agency's lifetime count.
        const applyFilters = (q: any) => {
          q = q.eq("agent_id", agentId).is("deleted_at", null);
          if (branchId && !isAdmin) q = q.eq("branch_id", branchId);
          if (mineOnly) q = q.eq("created_by_admin_id", userId);
          if (dateRange?.fromIso) q = q.gte("created_at", dateRange.fromIso);
          if (dateRange?.toIso) q = q.lt("created_at", dateRange.toIso);
          if (/تنتهي|انتهاء|منتهية/.test(userMessage)) {
            const now = new Date();
            const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            q = q.lte("end_date", monthEnd.toISOString()).gte("end_date", now.toISOString()).eq("cancelled", false);
          }
          return q;
        };

        // Count *transactions*, not raw policy rows — a "package"
        // (إلزامي + شامل + خدمات طريق sold together) shares one
        // group_id and counts as ONE معاملة, matching how the
        // dashboard ("الحزم تُحتسب معاملة واحدة") and useAgentLimits
        // count them. We pull id+group_id without head:true and dedupe
        // client-side; cheap for any realistic volume.
        const { data: idRows } = await applyFilters(
          supabase.from("policies").select("id, group_id")
        );
        const distinctTxIds = new Set(
          (idRows ?? []).map((r: any) => r.group_id ?? r.id),
        );
        const totalPolicies = distinctTxIds.size;

        const selectFields = isAdmin
          ? "id, group_id, policy_number, policy_type_parent, insurance_price, profit, payed_for_company, office_commission, start_date, end_date, cancelled, clients(full_name), cars(car_number), insurance_companies(name_ar)"
          : "id, group_id, policy_number, policy_type_parent, insurance_price, start_date, end_date, cancelled, clients(full_name), cars(car_number), insurance_companies(name_ar)";

        // Fetch up to limit*3 raw rows so we can collapse packages and
        // still end up with `limit` distinct transactions to show.
        const query = applyFilters(
          supabase.from("policies").select(selectFields).order("created_at", { ascending: false }).limit(limit * 3)
        );

        const { data: rawRows } = await query;
        // Group rows by transaction id, keep the first as primary,
        // accumulate the full type list. Don't break early — a group
        // can have its rows interleaved with other groups in the
        // result, so we'd miss types if we stopped at limit groups.
        const txMap = new Map<string, { primary: any; types: string[] }>();
        for (const r of (rawRows ?? [])) {
          const txId = r.group_id ?? r.id;
          if (!txMap.has(txId)) {
            txMap.set(txId, { primary: r, types: [] });
          }
          txMap.get(txId)!.types.push(r.policy_type_parent);
        }
        const data = Array.from(txMap.values()).slice(0, limit).map(g => ({
          ...g.primary,
          _types: g.types,
          _isPackage: g.types.length > 1,
        }));
        if (data && data.length > 0) {
          const typeLabels: Record<string, string> = {
            ELZAMI: "إلزامي", THIRD_FULL: "شامل", ROAD_SERVICE: "خدمة طريق",
            ACCIDENT_FEE_EXEMPTION: "إعفاء رسوم", HEALTH: "صحي", LIFE: "حياة",
          };

          // Scope label so the AI knows the filter applied
          const scopeBits: string[] = [];
          if (dateRange) scopeBits.push(dateRange.label);
          if (mineOnly) scopeBits.push("التي أصدرتها");
          const scopeSuffix = scopeBits.length > 0 ? ` (${scopeBits.join(' — ')})` : '';

          if (intent.isAggregate) {
            // Distinct-transactions count is authoritative; price sum
            // covers ALL fetched rows so packaged policies aren't
            // double-counted in the count but their prices still show.
            let summary = `[ملخص المعاملات${scopeSuffix}]\nالعدد: ${totalPolicies} معاملة (الحزم تُحتسب معاملة واحدة)`;
            if (rawRows && rawRows.length > 0) {
              const sumPrice = (rawRows as any[]).reduce((s, p) => s + (p.insurance_price || 0), 0);
              summary += ` | مجموع الأسعار: ₪${sumPrice.toLocaleString()}`;
              if (isAdmin) {
                const sumProfit = (rawRows as any[]).reduce((s, p) => s + (p.profit || 0), 0);
                summary += ` | الربح: ₪${sumProfit.toLocaleString()}`;
              }
            }
            parts.push(summary);
          } else {
            const header = (totalPolicies || 0) > limit
              ? `[معاملات${scopeSuffix} - عرض ${data.length} من أصل ${totalPolicies} (الحزم تُحتسب معاملة واحدة)]`
              : `[معاملات${scopeSuffix} - ${data.length} معاملة (الحزم تُحتسب معاملة واحدة)]`;
            parts.push(header + '\n' +
              data.map((p: any, i: number) => {
                // Show all types in the package on one line, then
                // common metadata (client, company, dates).
                const typesStr = (p._types || [p.policy_type_parent])
                  .map((t: string) => typeLabels[t] || t)
                  .join(' + ');
                let line = `${i + 1}. ${(p.clients as any)?.full_name || '-'} | ${typesStr}${p._isPackage ? ' 📦 حزمة' : ''} | ${(p.insurance_companies as any)?.name_ar || '-'} | ₪${p.insurance_price || 0} | ${p.start_date} → ${p.end_date}`;
                if (isAdmin && p.profit !== undefined) line += ` | ربح: ₪${p.profit || 0}`;
                if (p.cancelled) line += " | ❌ ملغاة";
                return line;
              }).join('\n'));
          }
        }
      }

      if (table === "payments") {
        // Worker scoping: payments inherit branch from their parent
        // policy. Use the inner-join trick on policies!inner to push
        // the branch filter down into the relation, so workers don't
        // see payments tied to other branches' policies.
        const dateRange = detectDateRange(userMessage);
        const select = branchId && !isAdmin
          ? "amount, payment_type, payment_date, policies!inner(clients(full_name), policy_number, branch_id)"
          : "amount, payment_type, payment_date, policies(clients(full_name), policy_number)";

        const applyPayFilters = (q: any) => {
          q = q.eq("agent_id", agentId);
          if (branchId && !isAdmin) q = q.eq("policies.branch_id", branchId);
          // payment_date is a DATE column — fromIso/toIso ISO strings work
          // because PostgREST accepts both date and timestamp comparisons.
          if (dateRange?.fromDate) q = q.gte("payment_date", dateRange.fromDate);
          if (dateRange?.toDate) q = q.lt("payment_date", dateRange.toDate);
          return q;
        };

        const { count: totalPayments } = await applyPayFilters(
          supabase.from("policy_payments").select(branchId && !isAdmin ? "id, policies!inner(branch_id)" : "id", { count: "exact", head: true })
        );

        const pQuery = applyPayFilters(
          supabase.from("policy_payments").select(select).order("payment_date", { ascending: false }).limit(limit)
        );
        const { data } = await pQuery;

        if (data && data.length > 0) {
          const typeLabels: Record<string, string> = { cash: "نقدي", cheque: "شيك", visa: "فيزا", transfer: "تحويل" };

          if (intent.isAggregate) {
            const total = data.reduce((s: number, p: any) => s + (p.amount || 0), 0);
            parts.push(`[ملخص المدفوعات]\nإجمالي في النظام: ${totalPayments} دفعة | مجموع العينة (${data.length}): ₪${total.toLocaleString()}`);
          } else {
            const header = (totalPayments || 0) > limit
              ? `[مدفوعات - عرض ${data.length} من أصل ${totalPayments} | لرؤية الجميع → صفحة المدفوعات]`
              : `[مدفوعات - ${data.length} نتيجة]`;
            parts.push(header + '\n' +
              data.map((p: any, i: number) =>
                `${i + 1}. ₪${p.amount} | ${typeLabels[p.payment_type] || p.payment_type} | ${p.payment_date} | ${(p.policies as any)?.clients?.full_name || '-'}`
              ).join('\n'));
          }
        }
      }

      if (table === "companies") {
        const { data } = await supabase.from("insurance_companies")
          .select("name, name_ar, active")
          .eq("agent_id", agentId)
          .limit(20);

        if (data && data.length > 0) {
          parts.push(`[شركات التأمين - ${data.length}]\n` +
            data.map((c: any, i: number) => `${i + 1}. ${c.name_ar || c.name}${c.active ? '' : ' (غير فعالة)'}`).join('\n'));
        }
      }

      if (table === "brokers") {
        // Brokers don't have branch_id — they're agent-wide. Workers
        // still see them, which matches sidebar behavior (broker_wallet
        // gating is feature-based, not branch-based).
        let query = supabase.from("brokers")
          .select("name, phone, notes")
          .eq("agent_id", agentId)
          .order("name", { ascending: true })
          .limit(limit);

        if (searchText.length > 2 && !intent.isAggregate) {
          query = query.or(`name.ilike.%${searchText}%,phone.ilike.%${searchText}%`);
        } else if (intent.searchTerms.length > 0) {
          const term = intent.searchTerms[0];
          query = query.or(`name.ilike.%${term}%,phone.ilike.%${term}%`);
        }

        const { data } = await query;
        if (data && data.length > 0) {
          parts.push(`[وسطاء - ${data.length} نتيجة]\n` +
            data.map((b: any, i: number) => `${i + 1}. ${b.name} | هاتف: ${b.phone || '-'}${b.notes ? ` | ${b.notes}` : ''}`).join('\n'));
        }
      }

      if (table === "accidents") {
        const dateRange = detectDateRange(userMessage);
        let query = supabase.from("accident_reports")
          .select("report_number, accident_date, status, clients(full_name), insurance_companies(name_ar)")
          .eq("agent_id", agentId)
          .order("accident_date", { ascending: false })
          .limit(limit);

        if (branchId && !isAdmin) query = query.eq("branch_id", branchId);
        if (dateRange?.fromDate) query = query.gte("accident_date", dateRange.fromDate);
        if (dateRange?.toDate) query = query.lt("accident_date", dateRange.toDate);

        const { data } = await query;
        if (data && data.length > 0) {
          const statusLabels: Record<string, string> = {
            draft: "مسودة", submitted: "مُقدَّم", closed: "مغلق",
          };
          parts.push(`[بلاغات الحوادث - ${data.length} نتيجة]\n` +
            data.map((a: any, i: number) =>
              `${i + 1}. بلاغ #${a.report_number} | ${a.accident_date} | ${(a.clients as any)?.full_name || '-'} | ${(a.insurance_companies as any)?.name_ar || '-'} | ${statusLabels[a.status] || a.status}`
            ).join('\n'));
        }
      }

      if (table === "branches") {
        // Workers shouldn't browse other branches; they only get to see
        // their own branch listed.
        let query = supabase.from("branches")
          .select("name, name_ar, is_default, is_active")
          .eq("agent_id", agentId)
          .order("is_default", { ascending: false })
          .limit(20);
        if (branchId && !isAdmin) query = query.eq("id", branchId);

        const { data } = await query;
        if (data && data.length > 0) {
          parts.push(`[الفروع - ${data.length}]\n` +
            data.map((b: any, i: number) =>
              `${i + 1}. ${b.name_ar || b.name}${b.is_default ? ' (افتراضي)' : ''}${!b.is_active ? ' (معطّل)' : ''}`
            ).join('\n'));
        }
      }

      if (table === "tasks") {
        // Default scope: tasks assigned to the current user, ordered by
        // due date, pending first. If the message mentions "اليوم" we
        // filter to today's date. Admins still see only their own
        // assigned tasks here — "tasks for X" requires explicit search.
        const today = new Date().toISOString().slice(0, 10);
        const isToday = /اليوم|today/.test(userMessage);

        let query = supabase.from("tasks")
          .select("title, description, due_date, due_time, status, assigned_to")
          .eq("agent_id", agentId)
          .eq("assigned_to", userId)
          .order("due_date", { ascending: true })
          .limit(limit);

        if (isToday) {
          query = query.eq("due_date", today);
        } else {
          query = query.neq("status", "completed");
        }

        const { data } = await query;
        if (data && data.length > 0) {
          const statusLabels: Record<string, string> = {
            pending: "قيد التنفيذ", in_progress: "قيد التنفيذ", completed: "مكتملة",
          };
          parts.push(`[مهامك ${isToday ? 'اليوم' : 'القادمة'} - ${data.length}]\n` +
            data.map((t: any, i: number) =>
              `${i + 1}. ${t.title} | ${t.due_date} ${t.due_time || ''} | ${statusLabels[t.status] || t.status}${t.description ? ` — ${t.description.slice(0, 60)}` : ''}`
            ).join('\n'));
        } else {
          parts.push(isToday ? "[لا توجد مهام لك اليوم]" : "[لا توجد مهام مفتوحة لك]");
        }
      }

      if (table === "contacts") {
        // business_contacts has no branch_id — agent-wide directory.
        let query = supabase.from("business_contacts")
          .select("name, phone, email, category, notes")
          .eq("agent_id", agentId)
          .order("name", { ascending: true })
          .limit(limit);

        if (searchText.length > 2 && !intent.isAggregate) {
          query = query.or(`name.ilike.%${searchText}%,phone.ilike.%${searchText}%,category.ilike.%${searchText}%`);
        } else if (intent.searchTerms.length > 0) {
          const term = intent.searchTerms[0];
          query = query.or(`name.ilike.%${term}%,phone.ilike.%${term}%`);
        }

        const { data } = await query;
        if (data && data.length > 0) {
          parts.push(`[جهات الاتصال - ${data.length}]\n` +
            data.map((c: any, i: number) =>
              `${i + 1}. ${c.name}${c.category ? ` (${c.category})` : ''} | هاتف: ${c.phone || '-'}${c.email ? ` | ${c.email}` : ''}`
            ).join('\n'));
        }
      }

      if (table === "receipts") {
        let query = supabase.from("receipts")
          .select("receipt_number, amount, payment_method, receipt_date, client_name, car_number")
          .eq("agent_id", agentId)
          .order("receipt_date", { ascending: false })
          .limit(limit);
        if (branchId && !isAdmin) query = query.eq("branch_id", branchId);

        const { data } = await query;
        if (data && data.length > 0) {
          if (intent.isAggregate) {
            const total = data.reduce((s: number, r: any) => s + (r.amount || 0), 0);
            parts.push(`[ملخص الإيصالات]\nالعينة: ${data.length} إيصال | المجموع: ₪${total.toLocaleString()}`);
          } else {
            parts.push(`[إيصالات - ${data.length}]\n` +
              data.map((r: any, i: number) =>
                `${i + 1}. إيصال #${r.receipt_number} | ₪${r.amount} | ${r.payment_method || '-'} | ${r.receipt_date} | ${r.client_name || '-'}`
              ).join('\n'));
          }
        }
      }

      if (table === "claims") {
        // repair_claims has no branch_id directly; rely on agent_id.
        let query = supabase.from("repair_claims")
          .select("claim_number, garage_name, total_amount, status, accident_date, clients(full_name), insurance_companies(name_ar)")
          .eq("agent_id", agentId)
          .order("created_at", { ascending: false })
          .limit(limit);

        const { data } = await query;
        if (data && data.length > 0) {
          const statusLabels: Record<string, string> = {
            pending: "قيد المراجعة", approved: "مقبولة", rejected: "مرفوضة", completed: "مكتملة",
          };
          parts.push(`[المطالبات - ${data.length}]\n` +
            data.map((c: any, i: number) =>
              `${i + 1}. ${c.claim_number || '-'} | ${(c.clients as any)?.full_name || '-'} | ${c.garage_name} | ${(c.insurance_companies as any)?.name_ar || '-'} | ₪${c.total_amount || 0} | ${statusLabels[c.status || ''] || c.status || '-'}`
            ).join('\n'));
        }
      }

      if (table === "accounting" && isAdmin) {
        // Unified accounting snapshot — mirrors the /accounting page's
        // CompaniesSection + BrokersSection + ExpensesSection. Admin
        // gate is enforced here AND at the route level (PermissionRoute
        // permission="page.accounting"), so workers never reach this
        // branch even if they manage to phrase a financial question.
        const dateRange = detectDateRange(userMessage);

        // 1. Per-company balance: SUM(payed_for_company) on policies
        //    minus SUM(outgoing settlements) plus SUM(incoming settlements).
        let polQ = supabase.from("policies")
          .select("company_id, payed_for_company, insurance_companies(name_ar, name)")
          .eq("agent_id", agentId)
          .is("deleted_at", null)
          .not("company_id", "is", null);
        if (branchId && !isAdmin) polQ = polQ.eq("branch_id", branchId);
        if (dateRange?.fromIso) polQ = polQ.gte("created_at", dateRange.fromIso);
        if (dateRange?.toIso) polQ = polQ.lt("created_at", dateRange.toIso);
        const { data: polRows } = await polQ;

        let csQ = supabase.from("company_settlements")
          .select("company_id, total_amount, direction, insurance_companies(name_ar, name)")
          .eq("agent_id", agentId);
        if (branchId && !isAdmin) csQ = csQ.eq("branch_id", branchId);
        if (dateRange?.fromDate) csQ = csQ.gte("settlement_date", dateRange.fromDate);
        if (dateRange?.toDate) csQ = csQ.lt("settlement_date", dateRange.toDate);
        const { data: csRows } = await csQ;

        type CompanyAgg = { name: string; owed: number; paid: number; received: number };
        const byCompany = new Map<string, CompanyAgg>();
        for (const r of (polRows ?? []) as any[]) {
          const id = r.company_id; if (!id) continue;
          const name = (r.insurance_companies?.name_ar) || (r.insurance_companies?.name) || "—";
          const cur = byCompany.get(id) ?? { name, owed: 0, paid: 0, received: 0 };
          cur.owed += Number(r.payed_for_company ?? 0);
          byCompany.set(id, cur);
        }
        for (const r of (csRows ?? []) as any[]) {
          const id = r.company_id; if (!id) continue;
          const name = (r.insurance_companies?.name_ar) || (r.insurance_companies?.name) || "—";
          const cur = byCompany.get(id) ?? { name, owed: 0, paid: 0, received: 0 };
          if (r.direction === "incoming") cur.received += Number(r.total_amount ?? 0);
          else cur.paid += Number(r.total_amount ?? 0);
          byCompany.set(id, cur);
        }

        const companyLines: string[] = [];
        let totalNetOwed = 0;
        for (const [, c] of byCompany) {
          const net = c.owed - c.paid + c.received; // positive = we still owe them
          totalNetOwed += net;
          companyLines.push(
            `- ${c.name}: مستحق عليها ₪${c.owed.toLocaleString()} | دفعنا ₪${c.paid.toLocaleString()} | استلمنا ₪${c.received.toLocaleString()} | الرصيد: ₪${net.toLocaleString()}${net > 0 ? ' (نحن مدينون)' : net < 0 ? ' (الشركة مدينة)' : ''}`
          );
        }

        // 2. Per-broker balance from broker_settlements
        let bsQ = supabase.from("broker_settlements")
          .select("broker_id, total_amount, direction, brokers(name)")
          .eq("agent_id", agentId);
        if (branchId && !isAdmin) bsQ = bsQ.eq("branch_id", branchId);
        if (dateRange?.fromDate) bsQ = bsQ.gte("settlement_date", dateRange.fromDate);
        if (dateRange?.toDate) bsQ = bsQ.lt("settlement_date", dateRange.toDate);
        const { data: bsRows } = await bsQ;

        type BrokerAgg = { name: string; weOwe: number; brokerOwes: number };
        const byBroker = new Map<string, BrokerAgg>();
        for (const r of (bsRows ?? []) as any[]) {
          const id = r.broker_id; if (!id) continue;
          const name = r.brokers?.name || "—";
          const cur = byBroker.get(id) ?? { name, weOwe: 0, brokerOwes: 0 };
          if (r.direction === "we_owe") cur.weOwe += Number(r.total_amount ?? 0);
          else if (r.direction === "broker_owes") cur.brokerOwes += Number(r.total_amount ?? 0);
          byBroker.set(id, cur);
        }
        const brokerLines: string[] = [];
        for (const [, b] of byBroker) {
          const net = b.weOwe - b.brokerOwes;
          brokerLines.push(
            `- ${b.name}: نحن ندفع ₪${b.weOwe.toLocaleString()} | يدفع لنا ₪${b.brokerOwes.toLocaleString()} | الرصيد: ₪${net.toLocaleString()}${net > 0 ? ' (نحن ندين له)' : net < 0 ? ' (يدين لنا)' : ''}`
          );
        }

        // 3. Expenses total
        let exQ = supabase.from("expenses").select("amount").eq("agent_id", agentId);
        if (branchId && !isAdmin) exQ = exQ.eq("branch_id", branchId);
        if (dateRange?.fromDate) exQ = exQ.gte("expense_date", dateRange.fromDate);
        if (dateRange?.toDate) exQ = exQ.lt("expense_date", dateRange.toDate);
        const { data: exRows } = await exQ;
        const expensesTotal = (exRows ?? []).reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0);

        const scope = dateRange ? ` (${dateRange.label})` : '';
        const sections = [`[المحاسبة${scope}]`];
        if (companyLines.length > 0) {
          sections.push(`شركات التأمين (إجمالي صافي مستحق علينا: ₪${totalNetOwed.toLocaleString()}):`);
          sections.push(...companyLines);
        }
        if (brokerLines.length > 0) {
          sections.push(`الوسطاء:`);
          sections.push(...brokerLines);
        }
        sections.push(`المصاريف: ₪${expensesTotal.toLocaleString()}`);
        parts.push(sections.join('\n'));
      }

      if (table === "leads") {
        // Leads aren't branch-scoped in the schema — surface them all
        // to anyone who has the leads feature enabled (route guard
        // already enforces feature access; here we just hand over data).
        let query = supabase.from("leads")
          .select("customer_name, phone, status, total_price, car_manufacturer, car_model, requires_callback")
          .eq("agent_id", agentId)
          .order("created_at", { ascending: false })
          .limit(limit);

        if (searchText.length > 2 && !intent.isAggregate) {
          query = query.or(`customer_name.ilike.%${searchText}%,phone.ilike.%${searchText}%`);
        }

        const { data } = await query;
        if (data && data.length > 0) {
          const statusLabels: Record<string, string> = {
            new: "جديد", contacted: "تم التواصل", converted: "تحوّل لعميل", lost: "مفقود",
          };
          parts.push(`[ليدز - ${data.length}]\n` +
            data.map((l: any, i: number) =>
              `${i + 1}. ${l.customer_name || '-'} | ${l.phone} | ${l.car_manufacturer || ''} ${l.car_model || ''} | ₪${l.total_price || 0} | ${statusLabels[l.status || ''] || l.status || '-'}${l.requires_callback ? ' | 📞 يحتاج اتصال' : ''}`
            ).join('\n'));
        }
      }
    } catch (e) {
      console.error(`[ai-assistant] Error fetching ${table}:`, e);
    }
  }

  return parts.length > 0 ? parts.join('\n\n') : "[لا توجد بيانات مطابقة للاستعلام]";
}

// ─── Main handler ───
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");

    if (!lovableApiKey) throw new Error("AI service not configured");

    // Auth
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await callerClient.auth.getUser();
    if (authErr || !user) throw new Error("Unauthorized");

    const adminClient = createClient(supabaseUrl, serviceKey);

    // Resolve agent
    const { data: agentUser } = await adminClient
      .from("agent_users")
      .select("agent_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!agentUser?.agent_id) throw new Error("No agent");

    const agentId = agentUser.agent_id;

    // Check feature flag
    const { data: featureFlag } = await adminClient
      .from("agent_feature_flags")
      .select("enabled")
      .eq("agent_id", agentId)
      .eq("feature_key", "ai_assistant")
      .maybeSingle();
    if (!featureFlag?.enabled) throw new Error("ميزة المساعد الذكي غير مفعّلة لهذا الحساب");

    // Check usage limits (falls back to platform defaults when no per-agent row exists)
    const aiCheck = await checkUsageLimit(adminClient, agentId, "ai_chat");
    if (!aiCheck.allowed) {
      return limitReachedResponse("ai_chat", aiCheck, corsHeaders);
    }

    // Determine role
    const { data: roleData } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("agent_id", agentId)
      .maybeSingle();
    const isAdmin = roleData?.role === "admin";

    // Pull user profile + branch name + agency name so the AI can
    // address the user by name, knows what office they work at, and
    // (for workers) which branch their data is scoped to. This is
    // what the previous build was missing — the assistant kept saying
    // generic things like "بناءً على البيانات المتوفرة" because it
    // had no identity context.
    const { data: profile } = await adminClient
      .from("profiles")
      .select("branch_id, full_name")
      .eq("id", user.id)
      .maybeSingle();
    const branchId = profile?.branch_id || null;
    const userFullName = profile?.full_name || user.email || "";

    // Prefer the user-configured site_title from branding settings
    // (اسم الموقع on the العلامة page) — that's what users mean by
    // "اسم الوكالة". Fall back to the agents table only if branding
    // hasn't been set up yet.
    const { data: siteSettings } = await adminClient
      .from("site_settings")
      .select("site_title")
      .eq("agent_id", agentId)
      .maybeSingle();
    let agencyName = siteSettings?.site_title || "";
    if (!agencyName) {
      const { data: agentRow } = await adminClient
        .from("agents")
        .select("name, name_ar")
        .eq("id", agentId)
        .maybeSingle();
      agencyName = agentRow?.name_ar || agentRow?.name || "";
    }

    let branchName = "";
    if (branchId) {
      const { data: br } = await adminClient
        .from("branches")
        .select("name, name_ar")
        .eq("id", branchId)
        .maybeSingle();
      branchName = br?.name_ar || br?.name || "";
    }

    // Parse request
    const { message, session_id } = await req.json();
    if (!message?.trim()) throw new Error("الرسالة فارغة");

    // Load or create session
    let sessionId = session_id;
    if (!sessionId) {
      const { data: newSession, error: sessionErr } = await adminClient
        .from("ai_chat_sessions")
        .insert({ agent_id: agentId, user_id: user.id, title: message.slice(0, 50) })
        .select("id")
        .single();
      if (sessionErr) throw sessionErr;
      sessionId = newSession.id;
    }

    // Load chat history (last 10 messages). metadata carries the
    // pending_action for the delete flow so the next user turn can
    // be interpreted as "pick a number" / "confirm".
    const { data: history } = await adminClient
      .from("ai_chat_messages")
      .select("role, content, metadata")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true })
      .limit(10);

    // ─── Stateful delete flow (admin only) ───
    // Reads the LAST assistant message's metadata to decide if we're
    // mid-flow. Resolves deterministically and bypasses the LLM so
    // there's no risk of the AI hallucinating a delete confirmation.
    const lastAssistantMeta = (() => {
      for (let i = (history?.length ?? 0) - 1; i >= 0; i--) {
        const m = history![i] as any;
        if (m.role === "assistant") return m.metadata as any;
      }
      return null;
    })();

    const handleDeterministic = async (reply: string, metadata: DeleteFlowMetadata | null) => {
      await adminClient.from("ai_chat_messages").insert([
        { session_id: sessionId, role: "user", content: message },
        { session_id: sessionId, role: "assistant", content: reply, metadata: metadata ?? {} },
      ]);
      await adminClient.from("ai_chat_sessions")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", sessionId);
      return new Response(
        JSON.stringify({ reply, session_id: sessionId }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    };

    if (lastAssistantMeta?.pending_action === "delete_pick") {
      const r = await handleDeletePick(lastAssistantMeta, message);
      return await handleDeterministic(r.reply, r.metadata);
    }
    if (lastAssistantMeta?.pending_action === "delete_confirm") {
      const r = await handleDeleteConfirm(adminClient, lastAssistantMeta, message);
      return await handleDeterministic(r.reply, r.metadata);
    }
    if (isDeleteIntent(message)) {
      if (!isAdmin) {
        const reply = "حذف العملاء صلاحية للمدير فقط. تواصل مع مديرك.";
        return await handleDeterministic(reply, null);
      }
      const r = await handleDeleteIntent(adminClient, agentId, branchId, message);
      return await handleDeterministic(r.reply, r.metadata);
    }

    // Classify intent and fetch data
    const intent = classifyIntent(message);
    console.log(`[ai-assistant] Agent: ${agentId}, Role: ${isAdmin ? 'admin' : 'worker'}, Intent: ${JSON.stringify(intent.tables)}`);
    const contextData = await fetchContextData(adminClient, agentId, intent, isAdmin, branchId, message, user.id);
    console.log(`[ai-assistant] Context data length: ${contextData.length}`);

    // Fetch global custom prompt
    const { data: promptSetting } = await adminClient
      .from("thiqa_platform_settings")
      .select("setting_value")
      .eq("setting_key", "ai_assistant_prompt")
      .maybeSingle();
    const customPrompt = promptSetting?.setting_value || null;

    // Build system prompt — append identity context LAST so it wins
    // over the static prompt on recency. The AI now knows who's
    // talking, which agency, and (for workers) which branch the
    // returned data is scoped to.
    let systemPrompt = DEFAULT_SYSTEM_PROMPT + (isAdmin ? ADMIN_EXTRA : WORKER_EXTRA);
    if (customPrompt) {
      systemPrompt += `\n\n--- تعليمات إضافية ---\n${customPrompt}`;
    }
    const identityLines: string[] = [];
    if (agencyName) identityLines.push(`اسم المكتب: ${agencyName}`);
    if (userFullName) identityLines.push(`اسم المستخدم: ${userFullName}`);
    identityLines.push(`الدور: ${isAdmin ? 'مدير' : 'موظف'}`);
    if (branchName) identityLines.push(`الفرع: ${branchName}`);
    if (identityLines.length > 0) {
      systemPrompt += `\n\n## السياق الحالي\n${identityLines.join('\n')}\n\n`
        + (isAdmin
            ? `البيانات أدناه تشمل كل فروع المكتب.`
            : `البيانات أدناه مفلترة على فرعك (${branchName || 'الفرع الحالي'}) فقط.`);
    }

    const messages = [
      { role: "system", content: systemPrompt },
      ...(history || []).map((m: any) => ({ role: m.role, content: m.content })),
      {
        role: "user",
        content: `${message}\n\n---\n[بيانات من النظام]\n${contextData}\n[/بيانات]`,
      },
    ];

    // Call Lovable AI Gateway
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages,
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("[ai-assistant] AI Gateway error:", aiResponse.status, errText);
      if (aiResponse.status === 429) throw new Error("تم تجاوز حد الطلبات. يرجى المحاولة بعد قليل.");
      if (aiResponse.status === 402) throw new Error("يرجى تجديد رصيد الذكاء الاصطناعي.");
      throw new Error("حدث خطأ في خدمة الذكاء الاصطناعي. يرجى المحاولة لاحقاً.");
    }

    const aiData = await aiResponse.json();
    const reply = aiData.choices?.[0]?.message?.content || "عذراً، لم أتمكن من معالجة طلبك.";

    // Store messages
    await adminClient.from("ai_chat_messages").insert([
      { session_id: sessionId, role: "user", content: message },
      { session_id: sessionId, role: "assistant", content: reply, metadata: { intent: intent.tables } },
    ]);

    // Update session
    await adminClient.from("ai_chat_sessions")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", sessionId);

    // Track usage via shared helper (atomic RPC with upsert fallback)
    await logUsage(adminClient, agentId, "ai_chat");

    return new Response(
      JSON.stringify({ reply, session_id: sessionId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[ai-assistant] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "حدث خطأ غير متوقع" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
