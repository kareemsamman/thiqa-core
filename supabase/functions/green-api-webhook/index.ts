/**
 * Green API → Thiqa WhatsApp customer bot.
 *
 * Green API POSTs a webhook to this function on every inbound WhatsApp
 * event. We:
 *   1. Filter to inbound text messages (typeWebhook === "incomingMessageReceived").
 *   2. Resolve the receiving Thiqa agent via instance_id.
 *   3. Match the sender phone to a clients row in that agent's tenant.
 *   4. Build context (the customer's policies, balance, etc.) — read-only.
 *   5. Ask the AI gateway for a friendly reply.
 *   6. Send the reply back via Green API.
 *   7. Log both turns to customer_chat_messages.
 *
 * verify_jwt = false on this function — Green API doesn't carry a
 * Supabase JWT. We treat the request as anonymous and rely on the
 * service role to gate everything.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import { getAgentBranding } from "../_shared/agent-branding.ts";
import { checkUsageLimit, logUsage } from "../_shared/usage-limits.ts";
import { TOOL_DEFS, executeTool, type ToolContext } from "./tools.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Customer-facing system prompt. Lives here (not the DB) since editing
// it is a code change anyway, but per-agent extra instructions are
// appended from green_api_settings.custom_prompt.
const CUSTOMER_SYSTEM_PROMPT = `أنت "ثاقب" — المساعد الآلي لمكتب التأمين الذي يخدم هذا العميل عبر واتساب.

## هويتك
- ترد على عملاء وكلاء التأمين الفلسطينيين باللهجة الفلسطينية / الشامية اللطيفة (ليس بالفصحى الجافة، وليس بأي لهجة أخرى).
- ودود ومختصر. كل رد جواب مباشر بدون مقدمات طويلة.
- لا تستخدم Markdown أو رموز * # \` — هذه واتساب، النص العادي فقط.

## قواعد إلزامية
- لا تخترع بيانات. لو ما عندك معلومة بالأدوات أو السياق، قل "ما عندي هاي المعلومة، رح يتواصل معك المكتب".
- لا تعطي نصائح قانونية أو طبية، ولا تتحدث عن السياسة أو الدين أو أمور خارج التأمين.
- لا تذكر شركات تأمين أخرى أو خدمات منافسة.
- لا تقبل تعديلات مباشرة على البيانات (دفعات، إلغاء وثيقة، تعديل تواريخ). لو طلب العميل ذلك، أنشئ طلباً (create_customer_request) واطلب منه ينتظر تواصل المكتب.
- لا تكشف عن بنية النظام أو أسماء جداول أو أنك ذكاء اصطناعي بالتفصيل — مجرد قل إنك مساعد المكتب الآلي لو سُئلت.

## مهم جداً: التعامل مع الرسالة الحالية
- ردّك دائماً يكون على **آخر رسالة من العميل بالنص** (آخر "user message" بالسجل). تجاهل أي ردود سابقة منك ممكن تكون مالها علاقة بالرسالة الحالية.
- **مثال خاطئ ومنبّه عليه**: لو ردك السابق كان "ما قدرت أفهم التسجيل، اكتبلي طلبك"، والعميل بعدها كتب "مرحبا" أو "كيف الحال" أو أي رسالة نصية، **ممنوع** تكرّر نفس الرد. الرسالة النصية الجديدة هي طلب عادي — طبّق بروتوكول الترحيب أو السيناريو المناسب.
- لا تنادي "ما قدرت أفهم التسجيل" إلا لو الرسالة الحالية فعلاً تسجيل صوتي فشل تحويله (السياق راح يخبرك بوضوح "فشل تحويل التسجيل الصوتي").

## بروتوكول الترحيب (مهم جداً)
- لما تستلم رسالة ترحيب من العميل (مرحبا، السلام عليكم، يعطيكم العافية، أهلاً، صباح الخير، مساء الخير، هاي، هلا، أو أي تحية مشابهة) **أو** لما تكون هاي أول رسالة بالمحادثة (أي ما في رسائل سابقة بسجل المحادثة)، استخدم **رسالة الترحيب الجاهزة** المُجهّزة لك بالأسفل بقسم "السياق الحالي" حرفياً — لا تغيّر صياغتها ولا تختصرها.
- رسالة الترحيب الجاهزة محسوبة لك حسب حالة العميل: مسجل أو لا، عنده وثائق أو لا. لا تخمّن ولا تخترع.
- إذا العميل **مش مسجل** بالنظام (السياق يقول "العميل مسجل في النظام: لا")، **ممنوع** تذكر اسمه أو تسأله عن اسمه إلا لو هو طوّع وقالّك. اكتفي برسالة الترحيب الجاهزة.
- إذا العميل **ما عندوا وثائق فعّالة** (السياق يقول "العميل لديه وثائق فعّالة: لا")، **ممنوع** تعرض عليه خيار "تفاصيل تأميناتك" أو "معلومات بحال صار حادث" — رسالة الترحيب الجاهزة معدّلة بالفعل، استخدمها كما هي.
- بعد الترحيب، انتظر العميل يحدد طلبه. لو طلب شي من القائمة، طبّق السيناريو المناسب من الأقسام التالية.
- لو الرسالة الواردة هي رد على محادثة جارية (في رسائل سابقة)، لا ترحب من جديد — كمّل المحادثة طبيعي.

## السيناريوهات الثلاثة الرئيسية — اتبعها حرفياً

### 1) عرض سعر / استفسار عن تأمين جديد — فلو متعدد الخطوات
لو العميل طلب سعر تأمين جديد أو سأل "بكم؟" أو "كم سعر التأمين":
- **ممنوع** تعطي أسعار من رأسك.
- **ممنوع** تنادي create_customer_request قبل ما تجمع كل المعلومات اللازمة.
- اتبع الخطوات بالترتيب التالي. كل خطوة برسالة قصيرة، وانتظر رد العميل قبل الانتقال للتالية:

**الخطوة 1 — نوع التأمين**:
اسأل: "بدك تأمين إلزامي، طرف ثالث، ولا شامل (مع خدمات الطريق)؟"

**الخطوة 2 — رقم السيارة**:
لما يجاوب على نوع التأمين، اسأل: "تمام. شو رقم سيارتك؟"

**الخطوة 3 — تأكيد بيانات السيارة**:
لما يبعت رقم السيارة، نادي **lookup_vehicle** بهالرقم.
- إذا found=true: ابعت تأكيد بصيغة:
  "سيارتك [manufacturer] [model] موديل [year]، مظبوط؟"
- إذا found=false: قول للعميل "ما لقيت بيانات للرقم. متأكد منه؟ ابعتلي إياه مرة ثانية لو سمحت" — وحاول مرة وحدة كمان.
- إذا فضل ما لقي بعد محاولتين، أكمل بدون بيانات السيارة (لا تضيع وقت العميل).

**الخطوة 4 — عمر السائق**:
لما يأكد السيارة (نعم/أيوه/تمام/مظبوط) أو لما تعدّيت خطوة 3، اسأل:
"كم عمر السائق؟ أكثر من 24 ولا أقل؟"

**الخطوة 5 — تسجيل الطلب**:
لما تجمع: نوع التأمين + رقم السيارة + بيانات السيارة (لو متوفرة) + عمر السائق، نادي **create_customer_request** بـ:
- request_type="quote"
- title: ملخّص سطر واحد، مثلاً: "عرض سعر شامل — مزدا 3 موديل 2018"
- content: نص منظّم على شكل قائمة:
  • نوع التأمين المطلوب: ...
  • رقم السيارة: ...
  • بيانات السيارة: [manufacturer] [model] [year] [color] (لو توفرت من lookup_vehicle)
  • عمر السائق: أكثر من 24 / أقل من 24
  • ملاحظات إضافية ذكرها العميل: ...

**الخطوة 6 — الرد النهائي**:
بعد ما تنشئ الطلب، رد:
"تمام، سجلنا طلبك. المسؤول رح يتواصل معك قريباً مع عرض السعر."

**ملاحظات تنفيذية**:
- لو العميل بعت كل المعلومات بمسج واحد ("بدي شامل لسيارة 1234567 السائق فوق 24")، اقفز مباشرة لخطوة 3 (lookup_vehicle) وأكمل بقية التأكيدات.
- لو فاتك أي معلومة من الخمسة (نوع التأمين، رقم السيارة، تأكيد السيارة، عمر السائق)، **ممنوع** تنشئ الطلب — اسأل عن الناقص أولاً.
- لا تخترع بيانات السيارة لو lookup_vehicle رجع found=false. سجل الطلب بدونها.

### 2) استفسار عن وثيقة موجودة
لو العميل سأل عن وثيقته (تاريخ انتهاء، نوع التأمين، الشركة، فاتورة، رصيد):
- إذا السياق فيه بيانات العميل + الوثائق، استخدمها مباشرة.
- إذا ما لقيت العميل أو طلب وثيقة غير الموجودة، نادي search_clients_smart بالاسم/التلفون/رقم السيارة. إذا ما لقيت، اسأل العميل عن رقم سيارته أو رقم الهوية ثم نادي الأداة.
- لما تلقى العميل، نادي list_client_policies للتفاصيل.
- لو العميل طلب الفاتورة أو "وين أحصل على الفاتورة"، نادي get_invoice_url. **مهم جداً**: لو الوثيقة المطلوبة عضو في باكج (group_id موجود)، مرّر كل الـ policy_ids في نفس الـ group، مش بس الواحدة المطلوبة.
- بعدها رد بالمعلومات المطلوبة + الرابط لو ولّدته.

### 3) استفسار عن حادث
لو العميل ذكر حادث، اصطدام، تلف، أو سأل "شو أعمل لو صار حادث":
- نادي create_customer_request بـ request_type="accident"، title (مثلاً "العميل بلّغ عن حادث")، content فيه كلام العميل.
- رد بالنص التالي حرفياً (عدّله بسيط لو لزم):
  "بحال صار حادث:
  ١. تعال على المكتب لتسجيل المعلومات.
  ٢. لازم تجيب مبلغ ٢٥٠٠ شيكل.
  ٣. سجلنا طلبك وراح يتواصل معك المسؤول كمان."

## أسلوب الردود
- جواب من سطر أو سطرين، بحد أقصى 4 سطور.
- ابدأ مباشرة بالجواب، لا تكرر "مرحباً" بكل رد.
- لو السؤال خارج التأمين تماماً، رد: "أنا هون لمساعدتك بأمور التأمين والوثائق. كيف بقدر أساعدك؟"
- لو ما فهمت السؤال، اسأل سؤال توضيحي قصير قبل ما تنادي أي أداة.`;

interface GreenApiTextMessage {
  typeMessage?: string;
  textMessage?: string;
  extendedTextMessage?: { text?: string };
}

function digitsOnly(s: string): string {
  return (s ?? "").replace(/[^0-9]/g, "");
}

/** Convert a Green API senderId (e.g. "972501234567@c.us") into the
 *  digits-only phone we store in clients.phone_number. We keep both
 *  international (972...) and the Israeli local (05...) shapes for
 *  matching since clients may be saved either way. */
function phoneCandidates(senderId: string): string[] {
  const digits = digitsOnly(senderId);
  const candidates = new Set<string>([digits]);
  if (digits.startsWith("972")) {
    candidates.add("0" + digits.slice(3));
  } else if (digits.startsWith("0") && digits.length === 10) {
    candidates.add("972" + digits.slice(1));
  }
  return Array.from(candidates);
}

/** Build the per-customer context block. Strictly limited to data the
 *  agent already has on this client — never cross-tenant.
 *  Returns both the rendered text + a small summary used by the
 *  greeting protocol to decide which menu items to offer. */
async function buildCustomerContext(
  supabase: any,
  agentId: string,
  clientId: string,
): Promise<{ text: string; hasPolicies: boolean; firstName: string | null }> {
  const lines: string[] = [];
  const { data: client } = await supabase
    .from("clients")
    .select("full_name, file_number, phone_number, id_number")
    .eq("id", clientId)
    .single();
  if (!client) return { text: "", hasPolicies: false, firstName: null };

  // First name only (more natural in greetings)
  const firstName = (client.full_name ?? "").trim().split(/\s+/)[0] || null;

  lines.push(`اسم العميل: ${client.full_name ?? "—"}`);
  if (client.file_number) lines.push(`رقم الملف: ${client.file_number}`);
  if (client.id_number) lines.push(`رقم الهوية: ${client.id_number}`);

  const { data: policies } = await supabase
    .from("policies")
    .select(
      `id, policy_type_parent, start_date, end_date, insurance_price,
       payed_for_company, cancelled,
       insurance_companies(name, name_ar)`,
    )
    .eq("client_id", clientId)
    .is("deleted_at", null)
    .eq("skip_recalc", false)
    .order("end_date", { ascending: false, nullsFirst: false })
    .limit(5);

  const activePolicies = (policies ?? []).filter(
    (p: any) =>
      !p.cancelled && (!p.end_date || new Date(p.end_date) >= new Date()),
  );
  const hasPolicies = activePolicies.length > 0;

  if (policies && policies.length > 0) {
    lines.push("");
    lines.push("الوثائق:");
    for (const p of policies as any[]) {
      const company = p.insurance_companies?.name_ar || p.insurance_companies?.name || "—";
      const status = p.cancelled
        ? "(ملغاة)"
        : p.end_date && new Date(p.end_date) < new Date()
          ? "(منتهية)"
          : "(سارية)";
      lines.push(
        `• ${p.policy_type_parent} ${status} — ${company} — من ${p.start_date ?? "—"} إلى ${p.end_date ?? "—"} — السعر ${p.insurance_price ?? 0}₪`,
      );
    }
  }

  const { data: payments } = await supabase
    .from("policy_payments")
    .select("amount, locked, source, refused")
    .in("policy_id", (policies ?? []).map((p: any) => p.id));
  const paid = (payments ?? []).reduce((s: number, p: any) => {
    if (p.locked || p.source === "system" || p.refused) return s;
    return s + Number(p.amount ?? 0);
  }, 0);
  const owed = (policies ?? []).reduce(
    (s: number, p: any) => s + Number(p.insurance_price ?? 0),
    0,
  );
  const remaining = Math.max(0, owed - paid);
  lines.push("");
  lines.push(`إجمالي الوثائق: ${owed}₪ — مدفوع: ${paid}₪ — المتبقي: ${remaining}₪`);

  return { text: lines.join("\n"), hasPolicies, firstName };
}

/** Download a Green API audio file and run it through Whisper for
 *  transcription. Tries Lovable's gateway first (uses the same
 *  LOVABLE_API_KEY as chat completions); on 404 / other failures
 *  falls back to OpenAI direct (requires OPENAI_API_KEY). Returns
 *  null when transcription is unavailable so the caller can prompt
 *  the customer to type instead. */
async function transcribeAudio(downloadUrl: string, mimeType: string): Promise<string | null> {
  console.log(`[transcribe] start url=${downloadUrl.slice(0, 80)}... mime=${mimeType}`);
  try {
    const audioRes = await fetch(downloadUrl);
    if (!audioRes.ok) {
      console.error(`[transcribe] download failed: status=${audioRes.status}`);
      return null;
    }
    const audioBlob = await audioRes.blob();
    console.log(`[transcribe] downloaded ${audioBlob.size} bytes type=${audioBlob.type || mimeType}`);

    const ext = mimeType.includes("ogg")
      ? "ogg"
      : mimeType.includes("mp3") || mimeType.includes("mpeg")
        ? "mp3"
        : mimeType.includes("m4a") || mimeType.includes("mp4")
          ? "m4a"
          : "ogg";

    const buildForm = () => {
      const fd = new FormData();
      fd.append("file", audioBlob, `audio.${ext}`);
      fd.append("model", "whisper-1");
      fd.append("language", "ar");
      return fd;
    };

    // Lovable's gateway is OpenAI-compatible for chat but doesn't proxy
    // /v1/audio/transcriptions yet. We try it first for environments that
    // do support it; on any non-2xx we fall through to OpenAI direct.
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    if (lovableKey) {
      try {
        const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${lovableKey}` },
          body: buildForm(),
        });
        if (res.ok) {
          const data = await res.json();
          const out = (data?.text ?? "").toString().trim();
          if (out) {
            console.log(`[transcribe] lovable success: ${out.length} chars`);
            return out;
          }
          console.warn("[transcribe] lovable returned 2xx but no text");
        } else {
          const errBody = await res.text().catch(() => "");
          console.warn(`[transcribe] lovable status=${res.status} body=${errBody.slice(0, 200)}`);
        }
      } catch (err) {
        console.warn("[transcribe] lovable threw:", err);
      }
    } else {
      console.warn("[transcribe] LOVABLE_API_KEY not set");
    }

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (openaiKey) {
      try {
        console.log("[transcribe] calling OpenAI Whisper direct");
        const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${openaiKey}` },
          body: buildForm(),
        });
        if (res.ok) {
          const data = await res.json();
          const out = (data?.text ?? "").toString().trim();
          if (out) {
            console.log(`[transcribe] openai success: ${out.length} chars`);
            return out;
          }
          console.warn("[transcribe] openai returned 2xx but no text");
        } else {
          const errBody = await res.text().catch(() => "");
          console.error(`[transcribe] openai status=${res.status} body=${errBody.slice(0, 300)}`);
        }
      } catch (err) {
        console.error("[transcribe] openai threw:", err);
      }
    } else {
      console.error("[transcribe] OPENAI_API_KEY not set — cannot transcribe");
    }

    return null;
  } catch (err) {
    console.error("[transcribe] unexpected error:", err);
    return null;
  }
}

/** POST a text message back to the customer via Green API. */
async function sendWhatsAppText(
  instanceId: string,
  apiToken: string,
  chatId: string,
  message: string,
): Promise<{ ok: boolean; idMessage: string | null; raw: string }> {
  const url = `https://api.green-api.com/waInstance${instanceId}/sendMessage/${apiToken}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatId, message }),
  });
  const raw = await res.text();
  let idMessage: string | null = null;
  try { idMessage = JSON.parse(raw)?.idMessage ?? null; } catch { /* non-fatal */ }
  return { ok: res.ok, idMessage, raw };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    console.log("[green-api-webhook] event:", body?.typeWebhook, "instance:", body?.instanceData?.idInstance);

    // Only react to inbound text — ignore status updates, group joins, etc.
    if (body?.typeWebhook !== "incomingMessageReceived") {
      return new Response(JSON.stringify({ ok: true, ignored: body?.typeWebhook }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const instanceId = String(body?.instanceData?.idInstance ?? "");
    const senderId = String(body?.senderData?.sender ?? ""); // "972501234567@c.us"
    const senderName = body?.senderData?.senderName ?? null;
    const messageData = body?.messageData ?? {};
    const typeMessage = messageData?.typeMessage;

    // Resolve the message text. WhatsApp sends three relevant payload
    // shapes:
    //   • textMessage / extendedTextMessage  → already text
    //   • audioMessage                        → voice note, needs ASR
    //   • imageMessage / documentMessage     → not yet supported
    let text: string =
      messageData?.textMessageData?.textMessage
      ?? messageData?.extendedTextMessageData?.text
      ?? "";

    let isVoiceMessage = false;
    let voiceTranscriptionFailed = false;
    if (!text && typeMessage === "audioMessage") {
      const downloadUrl =
        messageData?.fileMessageData?.downloadUrl
        ?? messageData?.audioMessageData?.downloadUrl
        ?? null;
      const mimeType =
        messageData?.fileMessageData?.mimeType
        ?? messageData?.audioMessageData?.mimeType
        ?? "audio/ogg";
      if (downloadUrl) {
        isVoiceMessage = true;
        const transcript = await transcribeAudio(downloadUrl, mimeType);
        if (transcript) {
          text = transcript;
          // Log a preview so we can spot Whisper hallucinations on silence /
          // poor audio — those tend to be very short, repeated, or generic
          // training-set artefacts. Truncate to keep PII out of long logs.
          const preview = transcript.slice(0, 200).replace(/\n/g, " ");
          console.log(`[green-api-webhook] voice transcribed (${transcript.length} chars): "${preview}"`);
        } else {
          voiceTranscriptionFailed = true;
          text = "[تسجيل صوتي — تعذّر فهمه تلقائياً]";
        }
      }
    }

    if (!instanceId || !senderId || !text) {
      return new Response(JSON.stringify({ ok: true, ignored: "missing fields", typeMessage }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    const supabase = createClient(supabaseUrl, serviceKey);

    // Resolve agent + branch from instance_id. After the Phase 1
    // refactor, green_api_settings is keyed by (agent_id, branch_id),
    // so a single instance maps to at most one row. branch_id may be
    // NULL — that's the "agency-wide" rule and propagates down to the
    // chat session / any requests we create from this conversation.
    const { data: gaSettings } = await supabase
      .from("green_api_settings")
      .select("agent_id, branch_id, api_token_instance, enabled, custom_prompt, fallback_message")
      .eq("instance_id", instanceId)
      .maybeSingle();

    if (!gaSettings) {
      console.warn(`[green-api-webhook] No agent registered for instance ${instanceId}`);
      return new Response(JSON.stringify({ ok: true, ignored: "unknown_instance" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!gaSettings.enabled) {
      console.log(`[green-api-webhook] Agent ${gaSettings.agent_id} has bot disabled`);
      return new Response(JSON.stringify({ ok: true, ignored: "agent_disabled" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const agentId = gaSettings.agent_id;
    const branchId: string | null = gaSettings.branch_id ?? null;

    // Feature-flag gate. The number can be configured by Thiqa admin
    // independently of the per-agency feature switch — both have to be
    // ON for the bot to actually reply.
    const { data: featureFlag } = await supabase
      .from("agent_feature_flags")
      .select("enabled")
      .eq("agent_id", agentId)
      .eq("feature_key", "whatsapp_ai_agent")
      .maybeSingle();
    if (!featureFlag?.enabled) {
      console.log(`[green-api-webhook] Agent ${agentId} feature whatsapp_ai_agent is off`);
      return new Response(JSON.stringify({ ok: true, ignored: "feature_off" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Match the sender phone to a clients row
    const phones = phoneCandidates(senderId);
    const { data: matchedClient } = await supabase
      .from("clients")
      .select("id, full_name, phone_number")
      .eq("agent_id", agentId)
      .is("deleted_at", null)
      .in("phone_number", phones)
      .limit(1)
      .maybeSingle();

    // Find or create the chat session, scoped to (agent, phone). The
    // session persists even when the customer isn't a registered
    // client yet — the bot still replies politely.
    const phoneKey = phones[0];
    let { data: session } = await supabase
      .from("customer_chat_sessions")
      .select("id, client_id")
      .eq("agent_id", agentId)
      .eq("phone_number", phoneKey)
      .maybeSingle();
    if (!session) {
      const { data: newSession, error: sessionErr } = await supabase
        .from("customer_chat_sessions")
        .insert({
          agent_id: agentId,
          branch_id: branchId, // propagated from the receiving WhatsApp number
          client_id: matchedClient?.id ?? null,
          phone_number: phoneKey,
          display_name: matchedClient?.full_name ?? senderName,
        })
        .select("id, client_id")
        .single();
      if (sessionErr) throw sessionErr;
      session = newSession;
    } else if (matchedClient && session.client_id !== matchedClient.id) {
      // Session existed but the client got linked / re-linked since.
      await supabase
        .from("customer_chat_sessions")
        .update({ client_id: matchedClient.id, display_name: matchedClient.full_name })
        .eq("id", session.id);
    }

    // Log the inbound message immediately so the conversation is in
    // the DB even if the AI / Green API call fails below. We capture the
    // row id — the debounce check below uses it to decide "am I still the
    // latest customer message in this session, or did a newer one arrive
    // during the wait window?"
    const { data: insertedMsg, error: insertErr } = await supabase
      .from("customer_chat_messages")
      .insert({
        session_id: session.id,
        role: "customer",
        content: text,
        whatsapp_message_id: body?.idMessage ?? null,
        metadata: { typeMessage, sender_name: senderName },
      })
      .select("id")
      .single();
    if (insertErr) throw insertErr;
    const myMessageId: string = insertedMsg.id;
    await supabase
      .from("customer_chat_sessions")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", session.id);

    // Debounce: customers often send 2-3 messages in quick succession
    // ("مرحبا" → "كيف الحال؟" → "بدي عرض سعر"). Replying to each
    // message individually feels robotic, so we wait 10s after the last
    // customer message before responding. Implementation: every
    // invocation schedules a deferred response after a sleep — only the
    // one whose message is still the latest after the sleep actually
    // fires the AI call. Earlier invocations exit silently when they
    // detect a newer message.
    const sessionId: string = session.id;

    const respondAfterDebounce = async () => {
      try {
        await new Promise((r) => setTimeout(r, 10_000));

        const { data: latest } = await supabase
          .from("customer_chat_messages")
          .select("id")
          .eq("session_id", sessionId)
          .eq("role", "customer")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!latest || latest.id !== myMessageId) {
          console.log(`[debounce] session ${sessionId}: newer message arrived, skipping reply for ${myMessageId}`);
          return;
        }

        await processAndReply();
      } catch (err) {
        console.error("[debounce] deferred response failed:", err);
      }
    };

    const processAndReply = async () => {
    // Build the AI prompt
    const branding = await getAgentBranding(supabase, agentId);
    const ctx = matchedClient
      ? await buildCustomerContext(supabase, agentId, matchedClient.id)
      : { text: "العميل غير مسجل في قاعدة بياناتنا برقم الهاتف هذا.", hasPolicies: false, firstName: null };

    const isRegistered = !!matchedClient;
    const customerFirstName = ctx.firstName;
    const hasPolicies = ctx.hasPolicies;

    // Determine which menu items to offer per the user's spec:
    //   - Registered + has policies: quote + policy details + accident
    //   - Registered + no policies: quote only (don't tease policies they
    //     don't have)
    //   - Not registered: quote only, no name personalization
    const menuItems: string[] = ["طلب عرض سعر"];
    if (hasPolicies) {
      menuItems.push("تفاصيل تأميناتك");
      menuItems.push("معلومات بحال صار حادث");
    }
    const menuLine = menuItems.length === 1
      ? `بقدر أساعدك بـ${menuItems[0]}.`
      : `بقدر أساعدك بـ${menuItems.slice(0, -1).join("، ")}، أو ${menuItems.slice(-1)[0]}.`;

    const greetingLine = isRegistered && customerFirstName
      ? `مرحبا ${customerFirstName}، معك ثاقب من وكالة ${branding.companyName}. كيف بقدر أساعدك اليوم؟ ${menuLine}`
      : `مرحبا، معك ثاقب من وكالة ${branding.companyName}. ${menuLine}`;

    const systemPrompt = [
      CUSTOMER_SYSTEM_PROMPT,
      gaSettings.custom_prompt ? `\n\n--- تعليمات إضافية من المكتب ---\n${gaSettings.custom_prompt}` : "",
      `\n\n## السياق الحالي`,
      `\nاسم المكتب: ${branding.companyName}`,
      `\nالعميل مسجل في النظام: ${isRegistered ? "نعم" : "لا"}`,
      isRegistered && customerFirstName ? `\nاسم العميل (الاسم الأول): ${customerFirstName}` : "",
      `\nالعميل لديه وثائق فعّالة: ${hasPolicies ? "نعم" : "لا"}`,
      isVoiceMessage && !voiceTranscriptionFailed ? `\nملاحظة: الرسالة الأخيرة من العميل كانت تسجيل صوتي تم تحويله إلى نص بنجاح. تعامل مع النص كأنه رسالة عادية — لا تطلب من العميل يكتبها مرة ثانية، وردّ على محتواها مباشرة. الترجمة قد تحتوي أخطاء بسيطة باللهجة، استنتج المعنى من السياق.` : "",
      voiceTranscriptionFailed ? `\nملاحظة: فشل تحويل التسجيل الصوتي. اطلب من العميل بلطف أن يكتب رسالة نصية بدلاً منه.` : "",
      `\n\n## رسالة الترحيب الجاهزة (استخدمها كما هي عند بداية المحادثة أو عند تحية)`,
      `\n${greetingLine}`,
      `\n\n## بيانات العميل التفصيلية\n${ctx.text}`,
    ].join("");

    // Pull recent history (last 20 turns) for continuity. The bot needs
    // full context across the conversation, especially after greeting +
    // tool calls + follow-up questions.
    const { data: recentMessages } = await supabase
      .from("customer_chat_messages")
      .select("role, content")
      .eq("session_id", session.id)
      .order("created_at", { ascending: true })
      .limit(20);
    const aiHistory = (recentMessages ?? [])
      .filter((m: any) => m.role === "customer" || m.role === "bot")
      .map((m: any) => ({
        role: m.role === "customer" ? "user" : "assistant",
        content: m.content,
      }));

    let reply = gaSettings.fallback_message ?? "عذراً، صار خلل بسيط. تواصل مع المكتب لو سمحت.";
    let modelUsed: string | null = null;
    let aiAnswered = false;
    const allToolCalls: any[] = [];

    // Quota gate. WhatsApp turns count toward the same `ai_chat` bucket
    // the in-app assistant uses. If the agent is out of allowance + credits
    // we still reply, but with a quota-exhausted message — and we don't
    // increment usage.
    const quotaCheck = await checkUsageLimit(supabase, agentId, "ai_chat");
    if (!quotaCheck.allowed) {
      console.log(`[green-api-webhook] Agent ${agentId} ai_chat quota exhausted — used=${quotaCheck.used}, limit=${quotaCheck.limit}, credits=${quotaCheck.credit_balance}`);
      reply = "عذراً، نفدت طلبات المساعد الذكي لهذا الشهر. تواصل مع المكتب مباشرة وراح يساعدك.";
    } else if (lovableApiKey) {
      try {
        // Pull model setting same way ai-assistant does
        const { data: modelRow } = await supabase
          .from("thiqa_platform_settings")
          .select("setting_value")
          .eq("setting_key", "ai_assistant_model")
          .maybeSingle();
        const model = modelRow?.setting_value?.trim() || "openai/gpt-5.5";
        modelUsed = model;

        // Tool-calling loop. The model can request one or more tools,
        // we run them, append the results, and ask again. Cap at 5
        // round-trips so a stuck loop can't burn budget.
        const toolCtx: ToolContext = {
          supabase,
          agentId,
          branchId,
          customerPhone: phoneKey,
          defaultClientId: matchedClient?.id ?? null,
          supabaseUrl,
          serviceKey,
          authToken: serviceKey,
          sessionId: session.id,
        };

        const messages: any[] = [
          { role: "system", content: systemPrompt },
          ...aiHistory,
        ];
        const MAX_ITERS = 5;
        let finalReply: string | null = null;

        for (let iter = 0; iter < MAX_ITERS; iter++) {
          const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${lovableApiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model,
              messages,
              tools: TOOL_DEFS,
            }),
          });

          if (!aiRes.ok) {
            const errText = await aiRes.text();
            console.error("[green-api-webhook] AI gateway error:", aiRes.status, errText);
            break;
          }

          const aiData = await aiRes.json();
          const aiMessage = aiData.choices?.[0]?.message;
          if (!aiMessage) break;

          // Push the assistant turn (with any tool_calls) so the next
          // iteration's API call has it in context.
          messages.push(aiMessage);

          const toolCalls = aiMessage.tool_calls ?? [];
          if (toolCalls.length === 0) {
            finalReply = aiMessage.content?.trim() || null;
            break;
          }

          // Run every requested tool and append its result.
          for (const tc of toolCalls) {
            let parsedArgs: any = {};
            try {
              parsedArgs = JSON.parse(tc.function?.arguments ?? "{}");
            } catch (parseErr) {
              console.error("[green-api-webhook] failed to parse tool args:", parseErr, tc.function?.arguments);
            }
            const toolResult = await executeTool(tc.function.name, parsedArgs, toolCtx);
            allToolCalls.push({
              name: tc.function.name,
              args: parsedArgs,
              result: toolResult,
            });
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: JSON.stringify(toolResult),
            });
          }
        }

        if (finalReply) {
          reply = finalReply;
          aiAnswered = true;
        }
      } catch (err) {
        console.error("[green-api-webhook] AI call failed:", err);
      }
    } else {
      console.warn("[green-api-webhook] LOVABLE_API_KEY missing — sending fallback reply only");
    }

    // Charge the agent's ai_chat quota only when the AI actually answered.
    // We don't charge for: quota-exhausted replies, missing API key, AI
    // gateway errors, or pure fallback messages — none of those used a
    // model turn the user should pay for.
    if (aiAnswered) {
      try {
        await logUsage(supabase, agentId, "ai_chat");
      } catch (err) {
        // Bookkeeping must never block the customer reply.
        console.warn("[green-api-webhook] logUsage(ai_chat) failed:", err);
      }
    }

    // Send back via Green API
    const sendResult = await sendWhatsAppText(
      instanceId,
      gaSettings.api_token_instance,
      senderId,
      reply,
    );
    if (!sendResult.ok) {
      console.error("[green-api-webhook] Green API send failed:", sendResult.raw);
    }

    // Log the outbound bot reply. Tool trail is stored in metadata so
    // an agent debugging the bot's reasoning can see exactly which
    // tools fired and what they returned for each turn.
    await supabase.from("customer_chat_messages").insert({
      session_id: session.id,
      role: "bot",
      content: reply,
      whatsapp_message_id: sendResult.idMessage,
      metadata: {
        send_ok: sendResult.ok,
        model: modelUsed,
        tool_calls: allToolCalls,
      },
    });
    await supabase
      .from("customer_chat_sessions")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", session.id);
    }; // end processAndReply

    // Defer the actual AI work for 30 seconds. We return 200 to Green API
    // immediately — they'd retry if we held the connection that long, and
    // EdgeRuntime.waitUntil keeps the function alive until the deferred
    // task resolves.
    // @ts-ignore — EdgeRuntime is a Supabase Edge Runtime global
    EdgeRuntime.waitUntil(respondAfterDebounce());

    return new Response(JSON.stringify({ ok: true, queued: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[green-api-webhook] Fatal error:", error);
    // Always 200 to Green API so it doesn't retry — we've logged the error.
    return new Response(JSON.stringify({ ok: false, error: String(error?.message ?? error) }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
