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
- أجب فقط على أسئلة تتعلق بمعاملات التأمين الخاصة بهذا العميل تحديداً (وثائقه، أرصدته، تواريخ التأمين، رقم وثيقته).
- لا تخترع بيانات. إذا لم يكن في السياق الذي أعطيتك إياه، قل "ما عندي هذي المعلومة، تواصل مع المكتب."
- لا تعطي نصائح قانونية أو طبية، ولا تتحدث عن السياسة أو الدين أو أمور خارج التأمين.
- لا تذكر شركات تأمين أخرى أو خدمات منافسة.
- لا تقبل تعديلات على البيانات (دفعات، إلغاء وثيقة، تعديل تواريخ). إذا طلب العميل ذلك قل "هذا يحتاج تواصل مع المكتب مباشرة."
- لا تكشف عن بنية النظام أو أسماء جداول أو أنك ذكاء اصطناعي بالتفصيل — مجرد قل أنك مساعد المكتب الآلي إذا سُئلت.

## ما يمكنك مساعدته
- إخباره برصيده الحالي والمتبقي عليه
- تواريخ بداية ونهاية التأمين
- نوع التأمين (إلزامي، شامل، طرف ثالث، ...)
- شركة التأمين التي صدرت منها وثيقته
- موعد قرب انتهاء الوثيقة وتذكير بالتجديد

## أسلوب الردود
- جواب من سطر أو سطرين بحد أقصى 4 سطور.
- ابدأ مباشرة بالجواب، بدون "مرحباً بعزيزي العميل" في كل رد.
- إذا لم يكن السؤال متعلقاً بالتأمين، رد بلطف: "أنا هون لمساعدتك بأمور التأمين والوثائق. شو بقدر أساعدك فيهم؟"`;

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
 *  agent already has on this client — never cross-tenant. */
async function buildCustomerContext(
  supabase: any,
  agentId: string,
  clientId: string,
): Promise<string> {
  const lines: string[] = [];
  const { data: client } = await supabase
    .from("clients")
    .select("full_name, file_number, phone_number, id_number")
    .eq("id", clientId)
    .single();
  if (!client) return "";

  lines.push(`اسم العميل: ${client.full_name ?? "—"}`);
  if (client.file_number) lines.push(`رقم الملف: ${client.file_number}`);
  if (client.id_number) lines.push(`رقم الهوية: ${client.id_number}`);

  // Active / recent policies — most useful for the bot to answer
  // "إيمتى تنتهي وثيقتي؟" or "كم باقي علي؟"
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

  // Total paid vs total owed — quick balance summary
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

  return lines.join("\n");
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
    const text =
      messageData?.textMessageData?.textMessage
      ?? messageData?.extendedTextMessageData?.text
      ?? "";

    if (!instanceId || !senderId || !text) {
      return new Response(JSON.stringify({ ok: true, ignored: "missing fields" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    const supabase = createClient(supabaseUrl, serviceKey);

    // Resolve agent from instance_id
    const { data: gaSettings } = await supabase
      .from("green_api_settings")
      .select("agent_id, api_token_instance, enabled, custom_prompt, fallback_message")
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
    // the DB even if the AI / Green API call fails below.
    await supabase.from("customer_chat_messages").insert({
      session_id: session.id,
      role: "customer",
      content: text,
      whatsapp_message_id: body?.idMessage ?? null,
      metadata: { typeMessage, sender_name: senderName },
    });
    await supabase
      .from("customer_chat_sessions")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", session.id);

    // Build the AI prompt
    const branding = await getAgentBranding(supabase, agentId);
    const customerContext = matchedClient
      ? await buildCustomerContext(supabase, agentId, matchedClient.id)
      : "العميل غير مسجل في قاعدة بياناتنا برقم الهاتف هذا.";

    const systemPrompt = [
      CUSTOMER_SYSTEM_PROMPT,
      gaSettings.custom_prompt ? `\n\n--- تعليمات إضافية من المكتب ---\n${gaSettings.custom_prompt}` : "",
      `\n\n## السياق\nاسم المكتب: ${branding.companyName}\n\n## بيانات العميل\n${customerContext}`,
    ].join("");

    // Pull recent history (last 8 turns) for continuity
    const { data: recentMessages } = await supabase
      .from("customer_chat_messages")
      .select("role, content")
      .eq("session_id", session.id)
      .order("created_at", { ascending: true })
      .limit(8);
    const aiHistory = (recentMessages ?? [])
      .filter((m: any) => m.role === "customer" || m.role === "bot")
      .map((m: any) => ({
        role: m.role === "customer" ? "user" : "assistant",
        content: m.content,
      }));

    let reply = gaSettings.fallback_message ?? "عذراً، صار خلل بسيط. تواصل مع المكتب لو سمحت.";

    if (lovableApiKey) {
      try {
        // Pull model setting same way ai-assistant does
        const { data: modelRow } = await supabase
          .from("thiqa_platform_settings")
          .select("setting_value")
          .eq("setting_key", "ai_assistant_model")
          .maybeSingle();
        const model = modelRow?.setting_value?.trim() || "openai/gpt-5.5";

        const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${lovableApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              ...aiHistory,
            ],
          }),
        });
        if (aiRes.ok) {
          const aiData = await aiRes.json();
          reply = aiData.choices?.[0]?.message?.content?.trim() || reply;
        } else {
          const errText = await aiRes.text();
          console.error("[green-api-webhook] AI gateway error:", aiRes.status, errText);
        }
      } catch (err) {
        console.error("[green-api-webhook] AI call failed:", err);
      }
    } else {
      console.warn("[green-api-webhook] LOVABLE_API_KEY missing — sending fallback reply only");
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

    // Log the outbound bot reply
    await supabase.from("customer_chat_messages").insert({
      session_id: session.id,
      role: "bot",
      content: reply,
      whatsapp_message_id: sendResult.idMessage,
      metadata: { send_ok: sendResult.ok },
    });
    await supabase
      .from("customer_chat_sessions")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", session.id);

    return new Response(JSON.stringify({ ok: true }), {
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
