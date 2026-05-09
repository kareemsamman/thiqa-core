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

## ركّز على الرسالة الحالية
- ردّك دائماً يكون على **آخر رسالة من العميل**.
- لو الرسالة طلب صريح، اقفز فوراً للسيناريو المناسب — **ممنوع** تسأل "كيف بقدر أساعدك" أو تعرض قائمة خيارات لما يكون الطلب واضح. لا ترحب من جديد.
- التحيات (مرحبا، السلام عليكم، هاي، صباح الخير) بتنترد عليها تلقائياً قبل ما توصلك — مش شغلتك.
- إذا العميل **مش مسجل** بالنظام، ممنوع تذكر اسمه أو تسأله عن اسمه.
- إذا العميل **ما عندوا وثائق فعّالة**، ممنوع تعرض عليه "تفاصيل تأميناتك" أو "معلومات بحال صار حادث".

### كلمات الدخول للسيناريوهات (لازم تطبّق فوراً)
- **سيناريو 1 (عرض سعر)**: "عرض سعر"، "بدي عرض سعر"، "كم السعر"، "كم سعر التأمين"، "بكم"، "بدي تأمين"، "بدي تأمين جديد"، "أسعار"، "اسعار"، "كم بدفع"، أي ذكر لـ"إلزامي/طرف ثالث/شامل/خدمات طريق" بسياق طلب → اقفز لخطوة 1 من سيناريو 1 فوراً.
- **سيناريو 2 (وثيقة)**: "تأميني"، "وثيقتي"، "متى تنتهي"، "متى ينتهي"، "تاريخ انتهاء"، "شركتي"، "وين فاتورتي"، "بدي فاتورتي"، "كم باقي عليّ"، "رصيدي".
- **سيناريو 3 (حادث)**: "صار حادث"، "اصطدمت"، "تلف"، "ضربت سيارتي"، "شو أعمل لو صار حادث".

## السيناريوهات الثلاثة الرئيسية — اتبعها حرفياً

### 1) عرض سعر / استفسار عن تأمين جديد — فلو متعدد الخطوات
لو العميل طلب سعر تأمين جديد أو سأل "بكم؟" أو "كم سعر التأمين":
- **ممنوع** تعطي أسعار من رأسك.
- **ممنوع** تنادي create_customer_request قبل ما تجمع كل المعلومات اللازمة.
- اتبع الخطوات بالترتيب التالي. كل خطوة برسالة قصيرة، وانتظر رد العميل قبل الانتقال للتالية:

**الخطوة 1 — نوع التأمين**:
اسأل بهالنص بالضبط (نسخ ولصق، لا تغيّر صياغته):
"إلزامي، طرف ثالث، ولا شامل وخدمات طريق؟"

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

/** OCR an Israeli vehicle plate from a customer-sent photo (the car
 *  itself, the plate close-up, or the registration card / רישיון רכב).
 *  Uses gpt-4o-mini via the OpenAI API. Returns the digits (7–9 chars)
 *  on success, null on any failure or when the model couldn't read a
 *  confident plate. */
async function extractPlateFromImage(downloadUrl: string, mimeType: string): Promise<string | null> {
  try {
    const imgRes = await fetch(downloadUrl);
    if (!imgRes.ok) {
      console.error(`[plate-vision] download failed: status=${imgRes.status}`);
      return null;
    }
    const bytes = new Uint8Array(await imgRes.arrayBuffer());
    // Chunked btoa — String.fromCharCode(...) hits stack limits over
    // ~125k bytes, which kicks in for any non-thumbnail JPEG.
    let binary = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
    }
    const base64 = btoa(binary);
    const dataUrl = `data:${mimeType || "image/jpeg"};base64,${base64}`;

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      console.error("[plate-vision] OPENAI_API_KEY missing");
      return null;
    }

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 16,
        messages: [{
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Extract the Israeli vehicle plate number from this image. The image may show the car itself, a close-up of the plate, or a vehicle registration card (רישיון רכב). Israeli plates are 7 or 8 digits. Reply with ONLY the digits, no spaces, no dashes, no other words. If you cannot read a confident plate number, reply with the single word NONE.",
            },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        }],
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error(`[plate-vision] api error: status=${res.status} body=${errText.slice(0, 200)}`);
      return null;
    }
    const data = await res.json();
    const out = String(data?.choices?.[0]?.message?.content ?? "").trim();
    if (!out || /^NONE$/i.test(out)) return null;
    const digits = out.replace(/\D/g, "");
    if (digits.length < 6 || digits.length > 9) {
      console.warn(`[plate-vision] discarding implausible output: "${out}"`);
      return null;
    }
    console.log(`[plate-vision] extracted ${digits}`);
    return digits;
  } catch (err) {
    console.error("[plate-vision] threw:", err);
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

// ─── Deterministic quote-flow state machine ───────────────────────────
//
// The AI was unreliable at running the quote intake step-by-step — it
// kept menu-ing back, paraphrasing the question, or jumping straight
// to create_customer_request without gathering all the fields. So the
// entire flow is now driven server-side. The model never sees an
// in-progress quote turn; once the customer triggers an entry phrase
// like "بدي عرض سعر", every subsequent step is matched + dispatched
// here until the request is filed.
//
// State is carried across turns on the bot message's metadata:
//   metadata.flow      = "quote"
//   metadata.flow_step = "awaiting_car_number" | "awaiting_car_number_retry"
//                      | "awaiting_car_confirm" | "awaiting_type"
//                      | "awaiting_age"
//   metadata.flow_data = { car_number?, car_details?, insurance_type? }
//
// Each step handler either advances the state (writes a new bot turn
// with the next step + accumulated data) or stays in the same step
// when it can't parse the customer's reply.

interface QuoteFlowCtx {
  supabase: any;
  agentId: string;
  branchId: string | null;
  sessionId: string;
  clientId: string | null;
  customerPhone: string;
  instanceId: string;
  apiToken: string;
  senderId: string;
  supabaseUrl: string;
  serviceKey: string;
}

interface QuoteFlowData {
  car_number?: string;
  car_details?: {
    manufacturer: string | null;
    model: string | null;
    year: number | null;
    color: string | null;
  };
  insurance_type?: string;
}

async function sendQuoteStep(
  ctx: QuoteFlowCtx,
  reply: string,
  flowStep: string | null,
  flowData: QuoteFlowData,
  extraMetadata: Record<string, any> = {},
) {
  const sendResult = await sendWhatsAppText(ctx.instanceId, ctx.apiToken, ctx.senderId, reply);
  const metadata: Record<string, any> = {
    deterministic: "quote_flow",
    send_ok: sendResult.ok,
    ...extraMetadata,
  };
  if (flowStep) {
    metadata.flow = "quote";
    metadata.flow_step = flowStep;
    metadata.flow_data = flowData;
  }
  await ctx.supabase.from("customer_chat_messages").insert({
    session_id: ctx.sessionId,
    role: "bot",
    content: reply,
    whatsapp_message_id: sendResult.idMessage,
    metadata,
  });
  await ctx.supabase
    .from("customer_chat_sessions")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", ctx.sessionId);
}

/** Send the very first step of the flow — ask which car the quote is for. */
async function startQuoteFlow(ctx: QuoteFlowCtx) {
  await sendQuoteStep(
    ctx,
    "تمام. شو رقم سيارتك اللي بدك تعملها تأمين؟",
    "awaiting_car_number",
    {},
  );
}

/** Look up a car number on the gov data API. */
async function lookupCarNumber(ctx: QuoteFlowCtx, carNumber: string) {
  try {
    const res = await fetch(`${ctx.supabaseUrl}/functions/v1/fetch-vehicle`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ctx.serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ car_number: carNumber }),
    });
    return await res.json();
  } catch (err) {
    console.error("[quote-flow] lookup_vehicle threw:", err);
    return { success: false, found: false };
  }
}

async function processCarNumber(
  ctx: QuoteFlowCtx,
  flowData: QuoteFlowData,
  text: string,
  isRetry: boolean,
) {
  // Strip everything but digits from the customer's text. Customers
  // sometimes type "رقمها 1234567" or send the number with dashes.
  const digits = (text || "").replace(/[^0-9]/g, "");
  if (!digits || digits.length < 6) {
    if (isRetry) {
      // Already retried once — give up on car details, move on.
      await sendQuoteStep(
        ctx,
        "تمام، رح أكمل بدون بيانات السيارة. إيش نوع التأمين؟ إلزامي، طرف ثالث، ولا شامل وخدمات طريق؟",
        "awaiting_type",
        flowData,
      );
    } else {
      await sendQuoteStep(
        ctx,
        "ما لقيت رقم سيارة بالرسالة. ابعتلي رقم سيارتك (٧ أو ٨ أرقام).",
        "awaiting_car_number_retry",
        flowData,
      );
    }
    return;
  }

  const result = await lookupCarNumber(ctx, digits);
  if (result?.success && result?.found && result?.data) {
    const d = result.data;
    const modelStr = [d.manufacturer_name, d.model, d.year ? `موديل ${d.year}` : null]
      .filter(Boolean)
      .join(" ");
    const reply = modelStr
      ? `سيارتك ${modelStr}، صحيح؟`
      : `سيارتك رقم ${digits}، صحيح؟`;
    await sendQuoteStep(ctx, reply, "awaiting_car_confirm", {
      ...flowData,
      car_number: digits,
      car_details: {
        manufacturer: d.manufacturer_name ?? null,
        model: d.model ?? null,
        year: d.year ?? null,
        color: d.color ?? null,
      },
    });
    return;
  }

  // Not found
  if (isRetry) {
    await sendQuoteStep(
      ctx,
      "ما لقيت بيانات هالرقم بقاعدة البيانات. رح أكمل بدونه. إيش نوع التأمين؟ إلزامي، طرف ثالث، ولا شامل وخدمات طريق؟",
      "awaiting_type",
      { ...flowData, car_number: digits },
    );
  } else {
    await sendQuoteStep(
      ctx,
      "ما لقيت بيانات لهالرقم. متأكد منه؟ ابعتلي إياه مرة ثانية لو سمحت.",
      "awaiting_car_number_retry",
      flowData,
    );
  }
}

const POSITIVE_RE = /(نعم|أيوه|ايوه|أيوا|اي\b|ايه|إيه|تمام|مظبوط|مضبوط|صح|صحيح|اوكي|أوكي|اوك|أوك|ok|yes|yeh|yeah|أكيد|اكيد)/i;
const NEGATIVE_RE = /(^|\s)(لا|مش|مو|غلط|خطأ|no|nope|not)(\s|$)/i;

async function processCarConfirm(
  ctx: QuoteFlowCtx,
  flowData: QuoteFlowData,
  text: string,
) {
  if (POSITIVE_RE.test(text)) {
    await sendQuoteStep(
      ctx,
      "تمام. إيش نوع التأمين؟ إلزامي، طرف ثالث، ولا شامل وخدمات طريق؟",
      "awaiting_type",
      flowData,
    );
  } else if (NEGATIVE_RE.test(text)) {
    await sendQuoteStep(
      ctx,
      "تمام، ابعتلي رقم سيارتك مرة ثانية لو سمحت.",
      "awaiting_car_number",
      { ...flowData, car_number: undefined, car_details: undefined },
    );
  } else {
    const carDesc = flowData.car_details
      ? `${flowData.car_details.manufacturer ?? ""} ${flowData.car_details.model ?? ""}`.trim()
      : "هالسيارة";
    await sendQuoteStep(
      ctx,
      `ما فهمت. ${carDesc} صحيحة؟ جاوبني نعم أو لا.`,
      "awaiting_car_confirm",
      flowData,
    );
  }
}

async function processType(
  ctx: QuoteFlowCtx,
  flowData: QuoteFlowData,
  text: string,
) {
  let insuranceType: string | null = null;
  const hasShamel = /شامل/.test(text);
  const hasRoadServices = /(خدمات\s*طريق|خدمة\s*الطريق|خدمات\s*الطريق)/.test(text);
  const hasThird = /(طرف\s*ثالث|ثالث)/.test(text);
  const hasMandatory = /(إلزامي|الزامي)/.test(text);

  if (hasShamel) {
    insuranceType = hasRoadServices ? "شامل وخدمات طريق" : "شامل";
  } else if (hasThird) {
    insuranceType = "طرف ثالث";
  } else if (hasMandatory) {
    insuranceType = "إلزامي";
  }

  if (!insuranceType) {
    await sendQuoteStep(
      ctx,
      "ما عرفت أي نوع تختار. اختار واحد: إلزامي، طرف ثالث، أو شامل وخدمات طريق.",
      "awaiting_type",
      flowData,
    );
    return;
  }

  await sendQuoteStep(
    ctx,
    "تمام. السائق عمره أكثر من ٢٤ ولا أقل؟",
    "awaiting_age",
    { ...flowData, insurance_type: insuranceType },
  );
}

async function processAge(
  ctx: QuoteFlowCtx,
  flowData: QuoteFlowData,
  text: string,
) {
  let ageBand: "above_24" | "below_24" | null = null;
  // Accept fusha (أكثر/أقل) and the colloquial Levantine "اكتر/اقل"
  // (with ت instead of ث) — customers type the dialect form far more
  // often than the standard.
  if (/(فوق|أكثر|اكثر|أكتر|اكتر|أعلى|اعلى|أكبر|اكبر|كبير)/.test(text)) ageBand = "above_24";
  else if (/(تحت|أقل|اقل|أصغر|اصغر|صغير)/.test(text)) ageBand = "below_24";
  else {
    // Bare number reply — also accept 1-digit (e.g. "9" stripped from "29").
    const numMatch = text.match(/(\d{2,3})/);
    if (numMatch) {
      const age = parseInt(numMatch[1], 10);
      if (age >= 24 && age <= 90) ageBand = "above_24";
      else if (age >= 16 && age < 24) ageBand = "below_24";
    }
  }

  if (!ageBand) {
    await sendQuoteStep(
      ctx,
      "ما فهمت. السائق فوق ٢٤ ولا تحت؟",
      "awaiting_age",
      flowData,
    );
    return;
  }

  // File the customer request
  const carDesc = flowData.car_details
    ? `${flowData.car_details.manufacturer ?? ""} ${flowData.car_details.model ?? ""}${flowData.car_details.year ? " موديل " + flowData.car_details.year : ""}`.trim()
    : "";
  const titleSummary = carDesc || flowData.car_number || "—";
  const title = `عرض سعر ${flowData.insurance_type ?? ""} — ${titleSummary}`.slice(0, 200);

  const lines = [
    `نوع التأمين: ${flowData.insurance_type ?? "—"}`,
    `رقم السيارة: ${flowData.car_number ?? "—"}`,
    flowData.car_details
      ? `بيانات السيارة: ${carDesc || "—"}${flowData.car_details.color ? " (" + flowData.car_details.color + ")" : ""}`
      : "بيانات السيارة: غير متوفرة",
    `عمر السائق: ${ageBand === "above_24" ? "أكثر من ٢٤" : "أقل من ٢٤"}`,
  ];

  try {
    await ctx.supabase.from("customer_requests").insert({
      agent_id: ctx.agentId,
      branch_id: ctx.branchId,
      client_id: ctx.clientId,
      phone_number: ctx.customerPhone,
      request_type: "quote",
      title,
      content: lines.join("\n").slice(0, 5000),
      status: "open",
    });
  } catch (err) {
    console.error("[quote-flow] insert customer_requests failed:", err);
  }

  // Send confirmation. Don't keep flow state — quote is done. Subsequent
  // turns from the customer flow back through the AI normally.
  await sendQuoteStep(
    ctx,
    "تمام، سجلنا طلبك. رح نرد عليك بأسرع وقت بعرض السعر.",
    null,
    {},
    { quote_completed: true },
  );
}

/** Main dispatcher — call after we detect metadata.flow === "quote" on
 *  the latest bot message. Returns true if a step was handled. */
async function dispatchQuoteFlow(
  ctx: QuoteFlowCtx,
  step: string,
  flowData: QuoteFlowData,
  customerText: string,
): Promise<boolean> {
  switch (step) {
    case "awaiting_car_number":
      await processCarNumber(ctx, flowData, customerText, false);
      return true;
    case "awaiting_car_number_retry":
      await processCarNumber(ctx, flowData, customerText, true);
      return true;
    case "awaiting_car_confirm":
      await processCarConfirm(ctx, flowData, customerText);
      return true;
    case "awaiting_type":
      await processType(ctx, flowData, customerText);
      return true;
    case "awaiting_age":
      await processAge(ctx, flowData, customerText);
      return true;
    default:
      return false;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Policy lookup flow
// ─────────────────────────────────────────────────────────────────────
//
// Triggered when a customer asks about their existing policy ("تفاصيل
// تأميني", "بوليصتي", "فاتورة", …). Resolves the customer to a row in
// the agent's `clients` table — first by sender phone, then by national
// ID if the phone match misses — and routes based on how many active
// policies they have:
//
//   • 0 active   → ask if they'd like a full client report
//   • 1 active   → send the invoice link, then offer a full report
//   • 2+ active  → send the full report link directly (one invoice
//                  wouldn't represent the situation)
//
// If neither phone nor ID matches, ask whether they want an agent to
// reach out — and if yes, file a customer_requests row of type "help"
// so the dashboard picks it up.

interface PolicyFlowData {
  client_id?: string;
}

const YES_RX = /(^|\s)(اه|آه|ايه|أيه|ايوا|أيوا|اي|نعم|أكيد|اكيد|تمام|اوكي|أوكي|ok|okay|yes|y|بدي|ابعت|ابعتلي|أبعتلي|طيب)(\s|$|[.!؟،,])/i;
const NO_RX = /(^|\s)(لأ|لا|لاء|مش|مو|كلا|no|n)(\s|$|[.!؟،,])/i;

function parseYesNo(text: string): "yes" | "no" | null {
  const t = (text || "").trim();
  if (YES_RX.test(t)) return "yes";
  if (NO_RX.test(t)) return "no";
  return null;
}

async function sendPolicyStep(
  ctx: QuoteFlowCtx,
  reply: string,
  flowStep: string | null,
  flowData: PolicyFlowData,
  extraMetadata: Record<string, any> = {},
) {
  const sendResult = await sendWhatsAppText(ctx.instanceId, ctx.apiToken, ctx.senderId, reply);
  const metadata: Record<string, any> = {
    deterministic: "policy_flow",
    send_ok: sendResult.ok,
    ...extraMetadata,
  };
  if (flowStep) {
    metadata.flow = "policy";
    metadata.flow_step = flowStep;
    metadata.flow_data = flowData;
  }
  await ctx.supabase.from("customer_chat_messages").insert({
    session_id: ctx.sessionId,
    role: "bot",
    content: reply,
    whatsapp_message_id: sendResult.idMessage,
    metadata,
  });
  await ctx.supabase
    .from("customer_chat_sessions")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", ctx.sessionId);
}

async function lookupActivePolicies(ctx: QuoteFlowCtx, clientId: string) {
  // Filters mirror the dashboard's "ساري" badge: not soft-deleted, not
  // cancelled, and end_date still in the future. policy_type doesn't
  // exist on this table — the columns are policy_type_parent /
  // policy_type_child — and we don't need either since we only branch
  // on the count.
  const { data: policies, error } = await ctx.supabase
    .from("policies")
    .select("id, end_date, cancelled, start_date")
    .eq("client_id", clientId)
    .is("deleted_at", null);
  if (error) {
    console.error("[policy-flow] active policies query failed:", error);
    return [];
  }
  const today = new Date();
  return (policies ?? []).filter(
    (p: any) => !p.cancelled && (!p.end_date || new Date(p.end_date) >= today),
  );
}

async function getInvoiceLink(ctx: QuoteFlowCtx, policyIds: string[]): Promise<string | null> {
  try {
    const res = await fetch(`${ctx.supabaseUrl}/functions/v1/send-package-invoice-sms`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ctx.serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        policy_ids: policyIds,
        skip_sms: true,
        internal_token: ctx.serviceKey,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error("[policy-flow] invoice gen failed:", data);
      return null;
    }
    return data.package_invoice_url ?? data.invoice_url ?? null;
  } catch (err) {
    console.error("[policy-flow] invoice fetch threw:", err);
    return null;
  }
}

async function getClientReportLink(ctx: QuoteFlowCtx, clientId: string): Promise<string | null> {
  try {
    const res = await fetch(`${ctx.supabaseUrl}/functions/v1/generate-client-report`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ctx.serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        internal_token: ctx.serviceKey,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error("[policy-flow] report gen failed:", data);
      return null;
    }
    return data.url ?? null;
  } catch (err) {
    console.error("[policy-flow] report fetch threw:", err);
    return null;
  }
}

async function fileHandoffRequest(ctx: QuoteFlowCtx, reason: string) {
  try {
    await ctx.supabase.from("customer_requests").insert({
      agent_id: ctx.agentId,
      branch_id: ctx.branchId,
      client_id: ctx.clientId,
      phone_number: ctx.customerPhone,
      request_type: "help",
      title: "طلب تواصل من العميل",
      content: reason.slice(0, 5000),
      status: "open",
    });
  } catch (err) {
    console.error("[policy-flow] handoff insert failed:", err);
  }
}

/** Branch on active-policy count and reply with the right artifact. */
async function respondWithPolicies(ctx: QuoteFlowCtx, clientId: string) {
  const active = await lookupActivePolicies(ctx, clientId);

  if (active.length === 0) {
    await sendPolicyStep(
      ctx,
      "ما لقيتلك بوليصة فعّالة حالياً. بدك تقرير كامل عن ملفك (المدفوعات، الحوادث، إلخ)؟",
      "awaiting_report_for_zero",
      { client_id: clientId },
    );
    return;
  }

  if (active.length === 1) {
    const link = await getInvoiceLink(ctx, [active[0].id]);
    if (!link) {
      await sendPolicyStep(
        ctx,
        "في عندي بوليصة فعّالة بس صار في مشكلة بتجهيز الفاتورة. رح يتواصل معك الوكيل.",
        null,
        {},
      );
      await fileHandoffRequest(ctx, "تعذّر توليد رابط الفاتورة لبوليصة فعّالة وحيدة.");
      return;
    }
    await sendPolicyStep(
      ctx,
      `تفضل، هاي فاتورتك:\n${link}\n\nبدك كمان تقرير كامل عن ملفك؟`,
      "awaiting_report_after_invoice",
      { client_id: clientId },
    );
    return;
  }

  // 2+ active → comprehensive report is the right artifact.
  const link = await getClientReportLink(ctx, clientId);
  if (!link) {
    await sendPolicyStep(
      ctx,
      "عندك أكثر من بوليصة فعّالة. صار في مشكلة بتجهيز التقرير، رح يتواصل معك الوكيل.",
      null,
      {},
    );
    await fileHandoffRequest(ctx, `العميل لديه ${active.length} بوليصات فعّالة وفشل توليد التقرير.`);
    return;
  }
  await sendPolicyStep(
    ctx,
    `عندك ${active.length} بوليصات فعّالة. هاي تقرير كامل عن ملفك:\n${link}`,
    null,
    {},
    { policy_completed: true },
  );
}

/** Entry point — fired when a POLICY_TRIGGERS phrase is detected.
 *
 *  Always asks for the customer's ID number rather than trusting the
 *  sender phone. Multiple clients in the agent's books can share a phone
 *  (family members, business owners, etc.), so the safer disambiguator
 *  is the national ID. Lookup is scoped to ctx.agentId.
 */
async function startPolicyFlow(ctx: QuoteFlowCtx) {
  await sendPolicyStep(
    ctx,
    "شو رقم هويتك؟",
    "awaiting_id_for_policy",
    {},
  );
}

async function processPolicyIdLookup(
  ctx: QuoteFlowCtx,
  flowData: PolicyFlowData,
  text: string,
) {
  const idDigits = (text || "").replace(/[^0-9]/g, "");
  if (idDigits.length < 8 || idDigits.length > 9) {
    await sendPolicyStep(
      ctx,
      "ما لقيت رقم هوية صحيح بالرسالة. ابعتلي رقم الهوية (٩ أرقام) لو سمحت.",
      "awaiting_id_for_policy",
      flowData,
    );
    return;
  }

  // Lookup by id_number scoped to this agent. Pad to 9 digits if needed
  // — id_number is stored as a string and may or may not have a leading
  // zero in the DB.
  const padded = idDigits.padStart(9, "0");
  const candidates = Array.from(new Set([idDigits, padded]));
  const { data: clientRow } = await ctx.supabase
    .from("clients")
    .select("id, full_name")
    .eq("agent_id", ctx.agentId)
    .is("deleted_at", null)
    .in("id_number", candidates)
    .limit(1)
    .maybeSingle();

  if (!clientRow?.id) {
    await sendPolicyStep(
      ctx,
      "ما لقيت حساب بهالرقم. بدك أحوّلك للوكيل يساعدك؟",
      "awaiting_handoff_confirm",
      flowData,
    );
    return;
  }

  await respondWithPolicies(ctx, clientRow.id);
}

async function processReportConfirm(
  ctx: QuoteFlowCtx,
  flowData: PolicyFlowData,
  text: string,
  context: "zero" | "after_invoice",
) {
  const yn = parseYesNo(text);
  if (yn === "yes") {
    if (!flowData.client_id) {
      await sendPolicyStep(ctx, "صار في مشكلة، رح يتواصل معك الوكيل.", null, {});
      await fileHandoffRequest(ctx, "Lost client_id while confirming report.");
      return;
    }
    const link = await getClientReportLink(ctx, flowData.client_id);
    if (!link) {
      await sendPolicyStep(ctx, "صار في مشكلة بتجهيز التقرير. رح يتواصل معك الوكيل.", null, {});
      await fileHandoffRequest(ctx, "Failed to generate client report on confirm.");
      return;
    }
    await sendPolicyStep(
      ctx,
      `تفضل، تقرير ملفك:\n${link}`,
      null,
      {},
      { policy_completed: true },
    );
    return;
  }

  if (yn === "no") {
    const closing = context === "zero"
      ? "تمام. لو احتجت شي ثاني احكيلي."
      : "تمام، شكراً. لو احتجت شي ثاني احكيلي.";
    await sendPolicyStep(ctx, closing, null, {}, { policy_completed: true });
    return;
  }

  // Couldn't parse — ask once more, stay in same step.
  const stepName = context === "zero" ? "awaiting_report_for_zero" : "awaiting_report_after_invoice";
  await sendPolicyStep(
    ctx,
    "ما فهمت قصدك. بدك تقرير كامل؟ جاوبني آه أو لا لو سمحت.",
    stepName,
    flowData,
  );
}

async function processHandoffConfirm(
  ctx: QuoteFlowCtx,
  flowData: PolicyFlowData,
  text: string,
) {
  const yn = parseYesNo(text);
  if (yn === "yes") {
    await fileHandoffRequest(ctx, "العميل طلب تأمين/بوليصة بس ما تعرّف عليه النظام بالهاتف ولا برقم الهوية.");
    await sendPolicyStep(
      ctx,
      "تمام، سجلت طلبك. رح يتواصل معك الوكيل بأسرع وقت.",
      null,
      {},
      { policy_completed: true },
    );
    return;
  }

  if (yn === "no") {
    await sendPolicyStep(ctx, "تمام، شكراً.", null, {}, { policy_completed: true });
    return;
  }

  await sendPolicyStep(
    ctx,
    "ما فهمت قصدك. بدك أحوّلك للوكيل؟ جاوبني آه أو لا لو سمحت.",
    "awaiting_handoff_confirm",
    flowData,
  );
}

async function dispatchPolicyFlow(
  ctx: QuoteFlowCtx,
  step: string,
  flowData: PolicyFlowData,
  customerText: string,
): Promise<boolean> {
  switch (step) {
    case "awaiting_id_for_policy":
      await processPolicyIdLookup(ctx, flowData, customerText);
      return true;
    case "awaiting_report_for_zero":
      await processReportConfirm(ctx, flowData, customerText, "zero");
      return true;
    case "awaiting_report_after_invoice":
      await processReportConfirm(ctx, flowData, customerText, "after_invoice");
      return true;
    case "awaiting_handoff_confirm":
      await processHandoffConfirm(ctx, flowData, customerText);
      return true;
    default:
      return false;
  }
}

const POLICY_TRIGGERS = [
  "تفاصيل تأميني",
  "تفاصيل تأمينات",
  "تفاصيل تأميناتي",
  "تفاصيل التأمين",
  "تفاصيل البوليصة",
  "تأميناتي",
  "تأميني",
  "بوليصتي",
  "بوليصة تأمين",
  "البوليصة",
  "بوليصة",
  "ابعتلي البوليصة",
  "بدي بوليصتي",
  "بدي البوليصة",
  "فاتورتي",
  "الفاتورة",
  "فاتورة",
  "إيصال",
  "الإيصال",
  "معاملاتي",
  "معاملتي",
];

// ─────────────────────────────────────────────────────────────────────
// Accident-info handler
// ─────────────────────────────────────────────────────────────────────
//
// One-shot informational reply when a customer asks what to do after a
// car accident. No state machine — the bot returns the agency's
// instructions in one message and ends. Customers who want to actually
// open a claim are told to come to the office, since the claim file
// requires photos + the other driver's details + signatures that aren't
// practical to collect over WhatsApp.

const ACCIDENT_TRIGGERS = [
  "حادث",
  "صار حادث",
  "وقع حادث",
  "بحال حادث",
  "بحالة حادث",
  "إذا صار حادث",
  "اذا صار حادث",
  "إذا وقع حادث",
  "اذا وقع حادث",
  "تبليغ حادث",
  "بلاغ حادث",
  "حدثت حادثة",
  "صدمت",
  "اصطدمت",
];

const ACCIDENT_INFO_MESSAGE =
  "بحالة وقوع حادث، اتبع هالخطوات لو سمحت:\n\n" +
  "١. صوّر مكان الحادث وكل المركبات اللي اشتركت فيه بشكل واضح ومن أكثر من زاوية.\n" +
  "٢. خذ معلومات السائق الثاني — الاسم، رقم الهوية، رقم رخصة السواقة، رقم السيارة، وشركة التأمين تبعته.\n" +
  "٣. إذا الحادث صار بالضفة الغربية، لازم تتواصل مع شركة التأمين والشرطة الفلسطينية بأسرع وقت.\n" +
  "٤. التبليغ عن الحادث لازم يصير خلال ٤٨ ساعة من وقوعه.\n\n" +
  "وعشان نقدر نفتحلك ملف الحادث رسمياً، لازم تيجي على المكتب لتعبي الطلب وتسلّم الصور والمعلومات. " +
  "احكيلي إيمتى يناسبك وبنرتبلك موعد.";

async function handleAccidentInfo(ctx: QuoteFlowCtx) {
  const sendResult = await sendWhatsAppText(
    ctx.instanceId,
    ctx.apiToken,
    ctx.senderId,
    ACCIDENT_INFO_MESSAGE,
  );
  await ctx.supabase.from("customer_chat_messages").insert({
    session_id: ctx.sessionId,
    role: "bot",
    content: ACCIDENT_INFO_MESSAGE,
    whatsapp_message_id: sendResult.idMessage,
    metadata: { deterministic: "accident_info", send_ok: sendResult.ok },
  });
  await ctx.supabase
    .from("customer_chat_sessions")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", ctx.sessionId);
}

// ─────────────────────────────────────────────────────────────────────
// Manager handoff
// ─────────────────────────────────────────────────────────────────────
//
// When a customer explicitly asks to speak to a person ("بدي احكي مع
// المدير", "وصلني للوكيل"), thank them, file a customer_requests row of
// type "manager" so the dashboard can pick it up, and stop. No
// follow-up state — the agent calls the customer back.

const MANAGER_TRIGGERS = [
  "احكي مع المدير",
  "احكي مع المديرة",
  "احكي مع الإدارة",
  "احكي مع الادارة",
  "احكي مع موظف",
  "احكي مع وكيل",
  "احكي مع حدا",
  "بدي احكي مع المدير",
  "بدي احكي مع موظف",
  "بدي احكي مع وكيل",
  "بدي احكي مع حدا",
  "بدي اتكلم مع حدا",
  "بدي اتكلم مع موظف",
  "بدي اتكلم مع المدير",
  "بدي مدير",
  "بدي وكيل",
  "وصلني للمدير",
  "وصلني لموظف",
  "وصلني للوكيل",
  "بدي حدا يتواصل معي",
  "بدي حدا يحكي معي",
  "بدي اتصل بحدا",
  "تواصلوا معي",
];

const MANAGER_HANDOFF_MESSAGE =
  "تمام، سجلت طلبك ورح يتواصل معك حدا من الإدارة بأسرع وقت ممكن. شكراً لتواصلك معنا.";

async function handleManagerHandoff(ctx: QuoteFlowCtx, customerText: string) {
  // File the help request first so the agent has context even if the
  // outgoing WhatsApp send fails.
  try {
    await ctx.supabase.from("customer_requests").insert({
      agent_id: ctx.agentId,
      branch_id: ctx.branchId,
      client_id: ctx.clientId,
      phone_number: ctx.customerPhone,
      request_type: "manager",
      title: "طلب تواصل مع الإدارة",
      content: `العميل طلب التواصل مع الإدارة.\nنص الرسالة: ${(customerText || "").slice(0, 1000)}`,
      status: "open",
    });
  } catch (err) {
    console.error("[manager-handoff] insert customer_requests failed:", err);
  }

  const sendResult = await sendWhatsAppText(
    ctx.instanceId,
    ctx.apiToken,
    ctx.senderId,
    MANAGER_HANDOFF_MESSAGE,
  );
  await ctx.supabase.from("customer_chat_messages").insert({
    session_id: ctx.sessionId,
    role: "bot",
    content: MANAGER_HANDOFF_MESSAGE,
    whatsapp_message_id: sendResult.idMessage,
    metadata: { deterministic: "manager_handoff", send_ok: sendResult.ok },
  });
  await ctx.supabase
    .from("customer_chat_sessions")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", ctx.sessionId);
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

    // Image messages (e.g. customer sends a photo of the registration
    // card when the bot asks for their plate number). We capture the
    // download URL here but defer OCR until after the session +
    // in-progress flow are resolved — we only OCR when it makes sense
    // for the current step (today: awaiting_car_number).
    let pendingImage: { downloadUrl: string; mimeType: string } | null = null;
    if (!text && typeMessage === "imageMessage") {
      const downloadUrl =
        messageData?.fileMessageData?.downloadUrl
        ?? messageData?.imageMessageData?.downloadUrl
        ?? null;
      const mimeType =
        messageData?.fileMessageData?.mimeType
        ?? messageData?.imageMessageData?.mimeType
        ?? "image/jpeg";
      if (downloadUrl) pendingImage = { downloadUrl, mimeType };
    }

    if (!instanceId || !senderId || (!text && !pendingImage)) {
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
    const customerMetadata: Record<string, any> = {
      typeMessage,
      sender_name: senderName,
    };
    // Tag voice-transcription-failed turns so we can filter them out of
    // the AI's history later. Otherwise the model parrots the previous
    // "اكتبلي طلبك" reply for the next text message.
    if (voiceTranscriptionFailed) customerMetadata.voice_transcription_failed = true;
    if (pendingImage) {
      customerMetadata.image_message = true;
      customerMetadata.image_download_url = pendingImage.downloadUrl;
    }

    const { data: insertedMsg, error: insertErr } = await supabase
      .from("customer_chat_messages")
      .insert({
        session_id: session.id,
        role: "customer",
        content: text || (pendingImage ? "[صورة]" : ""),
        whatsapp_message_id: body?.idMessage ?? null,
        metadata: customerMetadata,
      })
      .select("id")
      .single();
    if (insertErr) throw insertErr;
    const myMessageId: string = insertedMsg.id;
    await supabase
      .from("customer_chat_sessions")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", session.id);

    // Voice that couldn't be transcribed: short-circuit the AI flow with
    // a deterministic reply. Skipping the AI here is faster (no 10s
    // debounce, no model call), cheaper (no quota burn), and prevents the
    // "ما قدرت أفهم التسجيل" loop from leaking into the conversation
    // history that the model sees on later turns.
    if (voiceTranscriptionFailed) {
      const failureReply = "ما قدرت أفهم التسجيل. اكتبلي طلبك برسالة نصية لو سمحت وبساعدك فوراً.";
      const sendResult = await sendWhatsAppText(
        instanceId,
        gaSettings.api_token_instance,
        senderId,
        failureReply,
      );
      await supabase.from("customer_chat_messages").insert({
        session_id: session.id,
        role: "bot",
        content: failureReply,
        whatsapp_message_id: sendResult.idMessage,
        metadata: { voice_failure_response: true, send_ok: sendResult.ok },
      });
      await supabase
        .from("customer_chat_sessions")
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", session.id);
      return new Response(JSON.stringify({ ok: true, voice_failure: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const trimmedText = text.trim();

    // Pure greeting regex used below — defined here so the flow check
    // can also reference it if needed.
    const GREETING_REGEX = /^(?:مرحبا(?:ً)?|السلام\s+عليكم|وعليكم\s+السلام|سلام\s+عليكم|سلام|أهلا(?:ً)?|هلا|هاي|hi|hello|hey|صباح\s+الخير|مساء\s+الخير|يعطيكم\s+العافية|الله\s+يعطيكم\s+العافية)[\s!.؟،,]*$/i;
    const isPureGreeting = trimmedText.length <= 40 && GREETING_REGEX.test(trimmedText);

    // Deterministic greeting handler. Pure greetings ("مرحبا", "السلام
    // عليكم", "hi", ...) get a fixed reply that always uses the prepared
    // welcome line. We don't trust the AI for this — even with explicit
    // instructions, the model was reading prior turns in history and
    // truncating the greeting to "كيف بقدر أساعدك؟" because it had
    // "already greeted." A regex match + DB-driven personalization is
    // 100% reliable, instant, and doesn't burn AI quota.
    //
    // Note: this runs AFTER the quote-flow check below — if the
    // customer is mid-flow and just types "مرحبا", we continue the flow
    // instead of greeting them again.
    const greetingHandler = async () => {
      const branding = await getAgentBranding(supabase, agentId);
      let firstName: string | null = null;
      let hasActivePolicies = false;
      if (matchedClient) {
        firstName = (matchedClient.full_name ?? "").trim().split(/\s+/)[0] || null;
        const { data: pols } = await supabase
          .from("policies")
          .select("end_date, cancelled")
          .eq("client_id", matchedClient.id)
          .is("deleted_at", null)
          .eq("skip_recalc", false);
        hasActivePolicies = (pols ?? []).some(
          (p: any) => !p.cancelled && (!p.end_date || new Date(p.end_date) >= new Date()),
        );
      }
      const menuItems = ["طلب عرض سعر"];
      if (hasActivePolicies) {
        menuItems.push("تفاصيل تأميناتك");
        menuItems.push("معلومات بحال صار حادث");
      }
      const menuLine = menuItems.length === 1
        ? `بقدر أساعدك بـ${menuItems[0]}.`
        : `بقدر أساعدك بـ${menuItems.slice(0, -1).join("، ")}، أو ${menuItems.slice(-1)[0]}.`;
      const greetingReply = matchedClient && firstName
        ? `مرحبا ${firstName}، معك ثاقب من وكالة ${branding.companyName}. كيف بقدر أساعدك اليوم؟ ${menuLine}`
        : `مرحبا، معك ثاقب من وكالة ${branding.companyName}. ${menuLine}`;

      const sendResult = await sendWhatsAppText(
        instanceId,
        gaSettings.api_token_instance,
        senderId,
        greetingReply,
      );
      await supabase.from("customer_chat_messages").insert({
        session_id: session.id,
        role: "bot",
        content: greetingReply,
        whatsapp_message_id: sendResult.idMessage,
        metadata: { deterministic: "greeting", send_ok: sendResult.ok },
      });
      await supabase
        .from("customer_chat_sessions")
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", session.id);
      return new Response(JSON.stringify({ ok: true, greeting: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Look up the latest bot message ONCE — used both to detect an
    // in-progress deterministic flow (quote state machine) and to know
    // whether we're at the start of a conversation (greeting handler).
    const { data: lastBotMsg } = await supabase
      .from("customer_chat_messages")
      .select("metadata")
      .eq("session_id", session.id)
      .eq("role", "bot")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const inProgressFlow = lastBotMsg?.metadata?.flow ?? null;
    const inProgressStep = lastBotMsg?.metadata?.flow_step ?? null;
    const inProgressData: QuoteFlowData = lastBotMsg?.metadata?.flow_data ?? {};

    const quoteCtx: QuoteFlowCtx = {
      supabase,
      agentId,
      branchId,
      sessionId: session.id,
      clientId: matchedClient?.id ?? null,
      customerPhone: phoneKey,
      instanceId,
      apiToken: gaSettings.api_token_instance,
      senderId,
      supabaseUrl,
      serviceKey,
    };

    // Image-only message (no text) — only the awaiting_car_number step
    // knows what to do with a picture today: try to OCR the plate from
    // it and feed the digits into the existing flow. Anywhere else, ask
    // the customer to write their request as text.
    if (pendingImage && !text) {
      const inCarStep =
        inProgressFlow === "quote" &&
        (inProgressStep === "awaiting_car_number" || inProgressStep === "awaiting_car_number_retry");
      if (inCarStep) {
        const plate = await extractPlateFromImage(pendingImage.downloadUrl, pendingImage.mimeType);
        if (plate) {
          // Treat the OCR result as if the customer had typed it. The
          // existing (1a) dispatch below will run processCarNumber on
          // this text and continue the flow naturally.
          text = plate;
        } else {
          await sendQuoteStep(
            quoteCtx,
            "ما قدرت أقرأ رقم السيارة من الصورة. ابعتلي رقم سيارتك مكتوب لو سمحت.",
            "awaiting_car_number_retry",
            inProgressData,
          );
          return new Response(JSON.stringify({ ok: true, image_plate_ocr: "failed" }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } else {
        const reply = "ابعتلي طلبك مكتوب بالنص لو سمحت، وبساعدك فوراً.";
        const sendResult = await sendWhatsAppText(
          instanceId,
          gaSettings.api_token_instance,
          senderId,
          reply,
        );
        await supabase.from("customer_chat_messages").insert({
          session_id: session.id,
          role: "bot",
          content: reply,
          whatsapp_message_id: sendResult.idMessage,
          metadata: { image_unsupported: true, send_ok: sendResult.ok },
        });
        await supabase
          .from("customer_chat_sessions")
          .update({ last_message_at: new Date().toISOString() })
          .eq("id", session.id);
        return new Response(JSON.stringify({ ok: true, image_unsupported: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const QUOTE_TRIGGERS = [
      "عرض سعر",
      "عرض الأسعار",
      "عرض اسعار",
      "كم السعر",
      "كم سعر التأمين",
      "كم سعر التامين",
      "بكم",
      "بدي تأمين",
      "بدي تامين",
      "أسعار التأمين",
      "اسعار التامين",
      "كم بدفع",
      "كم بكلف",
      "كم بكلّف",
      "بدي اسعر",
      "بدي أسعر",
      "بدي اسعار",
      "بدي أسعار",
      "تأمين جديد",
      "تامين جديد",
    ];
    // Normalize Arabic for trigger matching: strip hamza variants
    // (أ/إ/آ → ا) and tashkeel diacritics. Customers freely drop the
    // hamza ("تاميناتي" instead of "تأميناتي") and fusha keyboards
    // sometimes carry diacritics, so a literal includes() misses both.
    const arNormalize = (s: string) =>
      (s || "")
        .replace(/[أإآ]/g, "ا")
        .replace(/ى/g, "ي")
        .replace(/ة/g, "ه")
        .replace(/[ً-ٰٟ]/g, ""); // tashkeel range
    const normalizedText = arNormalize(trimmedText);
    const matchesQuoteTrigger = QUOTE_TRIGGERS.some((t) => normalizedText.includes(arNormalize(t)));
    const matchesPolicyTrigger = POLICY_TRIGGERS.some((t) => normalizedText.includes(arNormalize(t)));
    const matchesAccidentTrigger = ACCIDENT_TRIGGERS.some((t) => normalizedText.includes(arNormalize(t)));
    const matchesManagerTrigger = MANAGER_TRIGGERS.some((t) => normalizedText.includes(arNormalize(t)));

    // Escape hatch: a customer stuck mid-flow can break out by sending a
    // pure greeting, a fresh quote-trigger, a fresh policy-trigger, or
    // an accident-trigger phrase. Without this, a wrong turn traps them
    // inside the active flow (e.g. car lookup failed → bot is now in
    // awaiting_type and any plate number reads as a bad type answer).
    const wantsReset =
      isPureGreeting
      || matchesQuoteTrigger
      || matchesPolicyTrigger
      || matchesAccidentTrigger
      || matchesManagerTrigger;

    // (1a) Already inside a quote flow → run the state machine, unless
    // the customer is explicitly trying to restart.
    if (inProgressFlow === "quote" && inProgressStep && !wantsReset) {
      const handled = await dispatchQuoteFlow(quoteCtx, inProgressStep, inProgressData, text);
      if (handled) {
        return new Response(JSON.stringify({ ok: true, quote_step: inProgressStep }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // (1b) Already inside a policy flow → run its state machine.
    if (inProgressFlow === "policy" && inProgressStep && !wantsReset) {
      const handled = await dispatchPolicyFlow(
        quoteCtx,
        inProgressStep,
        (lastBotMsg?.metadata?.flow_data ?? {}) as PolicyFlowData,
        text,
      );
      if (handled) {
        return new Response(JSON.stringify({ ok: true, policy_step: inProgressStep }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // (2) Pure greeting → deterministic welcome line.
    if (isPureGreeting) {
      return await greetingHandler();
    }

    // (3) Quote flow ENTRY. Customer typed any of the obvious request
    // triggers — fires whether or not there's an active flow, so a
    // stuck customer can restart by re-asking for a quote.
    if (matchesQuoteTrigger) {
      await startQuoteFlow(quoteCtx);
      return new Response(JSON.stringify({ ok: true, deterministic: "quote_entry" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // (4) Policy flow ENTRY. Customer asked about their existing policy
    // / invoice / "تفاصيل تأميني". Resolves the customer and replies
    // with the right artifact (invoice / report / agent handoff).
    if (matchesPolicyTrigger) {
      await startPolicyFlow(quoteCtx);
      return new Response(JSON.stringify({ ok: true, deterministic: "policy_entry" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // (5) Accident-info — one-shot reply with the agency's instructions
    // for what to do after a car accident. No state machine; the answer
    // tells the customer to come into the office to file the claim.
    if (matchesAccidentTrigger) {
      await handleAccidentInfo(quoteCtx);
      return new Response(JSON.stringify({ ok: true, deterministic: "accident_info" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // (6) Manager handoff — customer explicitly asked to speak to a
    // human. File a customer_requests row of type "manager" so it shows
    // up in the dashboard, and acknowledge.
    if (matchesManagerTrigger) {
      await handleManagerHandoff(quoteCtx, text);
      return new Response(JSON.stringify({ ok: true, deterministic: "manager_handoff" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    const systemPrompt = [
      CUSTOMER_SYSTEM_PROMPT,
      gaSettings.custom_prompt ? `\n\n--- تعليمات إضافية من المكتب ---\n${gaSettings.custom_prompt}` : "",
      `\n\n## السياق الحالي`,
      `\nاسم المكتب: ${branding.companyName}`,
      `\nالعميل مسجل في النظام: ${isRegistered ? "نعم" : "لا"}`,
      isRegistered && customerFirstName ? `\nاسم العميل (الاسم الأول): ${customerFirstName}` : "",
      `\nالعميل لديه وثائق فعّالة: ${hasPolicies ? "نعم" : "لا"}`,
      isVoiceMessage && !voiceTranscriptionFailed ? `\nملاحظة: الرسالة الأخيرة من العميل كانت تسجيل صوتي تم تحويله إلى نص بنجاح. تعامل مع النص كأنه رسالة عادية — لا تطلب من العميل يكتبها مرة ثانية، وردّ على محتواها مباشرة.` : "",
      `\n\n## بيانات العميل التفصيلية\n${ctx.text}`,
    ].join("");

    // Pull recent history (last 20 turns) for continuity. The bot needs
    // full context across the conversation, especially after greeting +
    // tool calls + follow-up questions.
    const { data: recentMessages } = await supabase
      .from("customer_chat_messages")
      .select("role, content, metadata")
      .eq("session_id", session.id)
      .order("created_at", { ascending: true })
      .limit(20);
    const aiHistory = (recentMessages ?? [])
      .filter((m: any) => m.role === "customer" || m.role === "bot")
      // Hide voice-failure exchanges from the model — both the
      // "[تسجيل صوتي]" placeholder customer turn and the
      // "اكتبلي طلبك" bot reply. Without this, the model copies the
      // failure reply when the customer types something fresh next.
      // Filter on metadata flags (new path) AND content patterns
      // (catches pre-existing rows from before this fix).
      .filter((m: any) => {
        if (m.metadata?.voice_transcription_failed) return false;
        if (m.metadata?.voice_failure_response) return false;
        if (m.role === "customer" && (m.content ?? "").startsWith("[تسجيل صوتي")) return false;
        if (m.role === "bot" && /(?:ما قدرت أفهم التسجيل|تعذّر فهمه|التسجيل ?(?:مش|غير) ?واضح|ما وصلني الصوت)/.test(m.content ?? "")) return false;
        return true;
      })
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
