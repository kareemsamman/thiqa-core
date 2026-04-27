import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkUsageLimit, limitReachedResponse, logUsage } from "../_shared/usage-limits.ts";

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

  // Financial intent
  if (/ربح|أرباح|عمولة|عمولات|خسارة|دفع للشركة|تسوية|مالي|إيرادات/.test(msg)) {
    isFinancial = true;
    tables.push("policies");
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

// ─── Data retrieval ───
async function fetchContextData(
  supabase: any,
  agentId: string,
  intent: IntentResult,
  isAdmin: boolean,
  branchId: string | null,
  userMessage: string
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
        const { count: totalPolicies } = await supabase.from("policies")
          .select("id", { count: "exact", head: true })
          .eq("agent_id", agentId)
          .is("deleted_at", null);

        const selectFields = isAdmin
          ? "policy_number, policy_type_parent, insurance_price, profit, payed_for_company, office_commission, start_date, end_date, cancelled, clients(full_name), cars(car_number), insurance_companies(name_ar)"
          : "policy_number, policy_type_parent, insurance_price, start_date, end_date, cancelled, clients(full_name), cars(car_number), insurance_companies(name_ar)";

        let query = supabase.from("policies")
          .select(selectFields)
          .eq("agent_id", agentId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(limit);

        if (branchId && !isAdmin) query = query.eq("branch_id", branchId);

        if (/تنتهي|انتهاء|منتهية/.test(userMessage)) {
          const now = new Date();
          const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
          query = query.lte("end_date", monthEnd.toISOString()).gte("end_date", now.toISOString()).eq("cancelled", false);
        }

        const { data } = await query;
        if (data && data.length > 0) {
          const typeLabels: Record<string, string> = {
            ELZAMI: "إلزامي", THIRD_FULL: "شامل", ROAD_SERVICE: "خدمة طريق",
            ACCIDENT_FEE_EXEMPTION: "إعفاء رسوم", HEALTH: "صحي", LIFE: "حياة",
          };

          if (intent.isAggregate) {
            const totalPrice = data.reduce((s: number, p: any) => s + (p.insurance_price || 0), 0);
            let summary = `[ملخص المعاملات]\nإجمالي في النظام: ${totalPolicies} معاملة | مجموع أسعار العينة (${data.length}): ₪${totalPrice.toLocaleString()}`;
            if (isAdmin) {
              const totalProfit = data.reduce((s: number, p: any) => s + (p.profit || 0), 0);
              summary += ` | ربح العينة: ₪${totalProfit.toLocaleString()}`;
            }
            parts.push(summary);
          } else {
            const header = (totalPolicies || 0) > limit
              ? `[معاملات - عرض ${data.length} من أصل ${totalPolicies} | لرؤية الجميع → صفحة المعاملات]`
              : `[معاملات - ${data.length} نتيجة]`;
            parts.push(header + '\n' +
              data.map((p: any, i: number) => {
                let line = `${i + 1}. ${(p.clients as any)?.full_name || '-'} | ${typeLabels[p.policy_type_parent] || p.policy_type_parent} | ${(p.insurance_companies as any)?.name_ar || '-'} | ₪${p.insurance_price || 0} | ${p.start_date} → ${p.end_date}`;
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
        const select = branchId && !isAdmin
          ? "amount, payment_type, payment_date, policies!inner(clients(full_name), policy_number, branch_id)"
          : "amount, payment_type, payment_date, policies(clients(full_name), policy_number)";

        let countQ = supabase.from("policy_payments")
          .select(branchId && !isAdmin ? "id, policies!inner(branch_id)" : "id", { count: "exact", head: true })
          .eq("agent_id", agentId);
        if (branchId && !isAdmin) countQ = countQ.eq("policies.branch_id", branchId);
        const { count: totalPayments } = await countQ;

        let pQuery = supabase.from("policy_payments")
          .select(select)
          .eq("agent_id", agentId)
          .order("payment_date", { ascending: false })
          .limit(limit);
        if (branchId && !isAdmin) pQuery = pQuery.eq("policies.branch_id", branchId);
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
        let query = supabase.from("accident_reports")
          .select("report_number, accident_date, status, clients(full_name), insurance_companies(name_ar)")
          .eq("agent_id", agentId)
          .order("accident_date", { ascending: false })
          .limit(limit);

        if (branchId && !isAdmin) query = query.eq("branch_id", branchId);

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

    const { data: agentRow } = await adminClient
      .from("agents")
      .select("name, name_ar")
      .eq("id", agentId)
      .maybeSingle();
    const agencyName = agentRow?.name_ar || agentRow?.name || "";

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

    // Load chat history (last 10 messages)
    const { data: history } = await adminClient
      .from("ai_chat_messages")
      .select("role, content")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true })
      .limit(10);

    // Classify intent and fetch data
    const intent = classifyIntent(message);
    console.log(`[ai-assistant] Agent: ${agentId}, Role: ${isAdmin ? 'admin' : 'worker'}, Intent: ${JSON.stringify(intent.tables)}`);
    const contextData = await fetchContextData(adminClient, agentId, intent, isAdmin, branchId, message);
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
