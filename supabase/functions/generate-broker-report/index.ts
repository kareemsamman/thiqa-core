import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAgentBranding, resolveAgentId, type AgentBranding } from "../_shared/agent-branding.ts";
import { THIQA_LOGO_SVG } from "../_shared/thiqa-logo.ts";
import {
  buildBunnyStorageUploadUrl,
  normalizeBunnyCdnUrl,
  resolveBunnyStorageZone,
} from "../_shared/bunny-storage.ts";
import { appendSmsFooter } from "../_shared/sms-footer.ts";
import { resolveSmsSettings } from "../_shared/sms-settings.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface BrokerReportRequest {
  broker_id: string;
  start_date?: string;
  end_date?: string;
  direction_filter?: 'from_broker' | 'to_broker' | 'all';
  /** If true, also SMS the report link to the broker's phone. */
  send_sms?: boolean;
}

const POLICY_TYPE_LABELS: Record<string, string> = {
  ELZAMI: 'إلزامي',
  THIRD_FULL: 'ثالث/شامل',
  ROAD_SERVICE: 'خدمات الطريق',
  ACCIDENT_FEE_EXEMPTION: 'إعفاء رسوم حادث',
  HEALTH: 'تأمين صحي',
  LIFE: 'تأمين حياة',
  PROPERTY: 'تأمين ممتلكات',
  TRAVEL: 'تأمين سفر',
  BUSINESS: 'تأمين أعمال',
  OTHER: 'أخرى',
  THIRD: 'ثالث',
  FULL: 'شامل',
};

const SETTLEMENT_STATUS_LABELS: Record<string, string> = {
  pending: 'قيد التسوية',
  partial: 'مدفوعة جزئياً',
  completed: 'مكتملة',
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  let currentStep = "init";

  try {
    currentStep = "read env";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const bunnyApiKey = Deno.env.get("BUNNY_API_KEY");
    const rawBunnyStorageZone = Deno.env.get("BUNNY_STORAGE_ZONE");
    const bunnyCdnUrl = normalizeBunnyCdnUrl(Deno.env.get("BUNNY_CDN_URL"));
    const bunnyStorageZone = resolveBunnyStorageZone(rawBunnyStorageZone, bunnyCdnUrl);

    if (!bunnyApiKey || !bunnyStorageZone) {
      return new Response(
        JSON.stringify({
          error: "إعدادات Bunny CDN غير مكتملة",
          detail: "BUNNY_API_KEY / BUNNY_STORAGE_ZONE is missing",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    currentStep = "create supabase client";
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    currentStep = "auth";
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    currentStep = "parse body";
    const { broker_id, start_date, end_date, direction_filter, send_sms }: BrokerReportRequest = await req.json();
    if (!broker_id) {
      return new Response(JSON.stringify({ error: "broker_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    currentStep = "resolve agent branding";
    const agentId = await resolveAgentId(supabase, user.id);
    const branding = await getAgentBranding(supabase, agentId);

    currentStep = "fetch broker";
    const { data: broker, error: brokerError } = await supabase
      .from("brokers")
      .select("*")
      .eq("id", broker_id)
      .single();
    if (brokerError || !broker) {
      return new Response(JSON.stringify({ error: "Broker not found", detail: brokerError?.message }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    currentStep = "fetch policies";
    let query = supabase
      .from("policies")
      .select(`
        id, policy_number, policy_type_parent, policy_type_child, start_date, end_date,
        insurance_price, office_commission, broker_buy_price, profit, broker_direction,
        cancelled, transferred, notes,
        company:insurance_companies(name, name_ar),
        client:clients(full_name, phone_number, id_number),
        car:cars(car_number, manufacturer_name, model, year)
      `)
      .eq("broker_id", broker_id)
      .is("deleted_at", null)
      .order("start_date", { ascending: false });

    if (start_date) query = query.gte("start_date", start_date);
    if (end_date) query = query.lte("start_date", end_date);
    if (direction_filter && direction_filter !== 'all') {
      query = query.eq("broker_direction", direction_filter);
    }

    const { data: policies, error: policiesError } = await query;
    if (policiesError) throw new Error(`policies query: ${policiesError.message}`);

    currentStep = "fetch settlements";
    const { data: settlements, error: settlementsError } = await supabase
      .from("broker_settlements")
      .select("id, direction, total_amount, settlement_number, settlement_date, status, notes")
      .eq("broker_id", broker_id)
      .order("settlement_date", { ascending: false });
    if (settlementsError) throw new Error(`broker_settlements query: ${settlementsError.message}`);

    currentStep = "fetch sms settings";
    const { data: smsSettingsRow } = await supabase
      .from("sms_settings")
      .select("company_email, company_phones, company_whatsapp, company_location")
      .limit(1)
      .maybeSingle();

    const companySettings = {
      company_email: (smsSettingsRow as any)?.company_email || '',
      company_phones: (smsSettingsRow as any)?.company_phones || [],
      company_whatsapp: (smsSettingsRow as any)?.company_whatsapp || '',
      company_location: (smsSettingsRow as any)?.company_location || '',
    };

    // Totals — count every row the broker page counts (cancelled &
    // transferred included). The page's "ملخص" card and the items
    // المجموع all include those rows, so excluding them in the PDF
    // used to produce a net balance that didn't reconcile. Keep the
    // tag on the row in the table so the reader still sees which ones
    // are cancelled/transferred, but don't drop them from the math.
    const allPolicies = policies || [];

    // from_broker row value = what we owe the broker for bringing the
    // deal. Uses broker_buy_price when set, otherwise insurance_price
    // as a safe fallback (legacy rows without a buy price).
    const fromBrokerTotal = allPolicies
      .filter((p: any) => p.broker_direction === 'from_broker')
      .reduce((sum: number, p: any) => sum + Number(p.broker_buy_price || p.insurance_price || 0), 0);

    const toBrokerTotal = allPolicies
      .filter((p: any) => p.broker_direction === 'to_broker' || !p.broker_direction)
      .reduce((sum: number, p: any) => sum + Number(p.insurance_price || 0), 0);

    // Settlements — only completed lines count against the balance. Pending /
    // partial still appear in the log so the reader sees what's outstanding.
    const paidToBroker = (settlements || [])
      .filter((s: any) => s.direction === 'we_owe' && s.status === 'completed')
      .reduce((sum: number, s: any) => sum + Number(s.total_amount || 0), 0);

    const receivedFromBroker = (settlements || [])
      .filter((s: any) => s.direction === 'broker_owes' && s.status === 'completed')
      .reduce((sum: number, s: any) => sum + Number(s.total_amount || 0), 0);

    // Net = (broker owes me + I received from broker)
    //     − (I owe broker + I paid broker)
    // Positive = broker still owes me. Negative = I still owe broker.
    const policyNet = toBrokerTotal - fromBrokerTotal;
    const settlementNet = receivedFromBroker - paidToBroker;
    const netBalance = policyNet + settlementNet;

    currentStep = "build html";
    const html = generateReportHtml({
      broker,
      policies: policies || [],
      settlements: settlements || [],
      fromBrokerTotal,
      toBrokerTotal,
      paidToBroker,
      receivedFromBroker,
      netBalance,
      branding,
      companySettings,
      filters: { start_date, end_date, direction_filter },
    });

    currentStep = "upload to bunny";
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const timestamp = now.getTime();
    const safeName = broker.name.replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, "_");
    const fileName = `broker_report_${safeName}_${timestamp}.html`;
    const storagePath = `uploads/${year}/${month}/${fileName}`;
    const uploadUrl = buildBunnyStorageUploadUrl(bunnyStorageZone, storagePath);

    const uploadResponse = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "AccessKey": bunnyApiKey,
        "Content-Type": "text/html; charset=utf-8",
      },
      body: html,
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      throw new Error(`Bunny upload failed (${uploadResponse.status}): ${errorText}`);
    }

    const cdnUrl = `${bunnyCdnUrl}/${storagePath}`;

    // Optional SMS leg — done inside this function so the client only
    // makes a single authenticated call. Calling send-sms separately
    // from the browser hit the gateway's HS256 check (project signs
    // ES256) and 401'd before the function ran. Sending here, with the
    // service-role supabase client, sidesteps that entirely.
    let smsSent = false;
    let smsError: string | null = null;
    if (send_sms) {
      currentStep = "send sms";
      const rawPhone = (broker.phone || "").toString();
      if (!rawPhone) {
        smsError = "لا يوجد رقم هاتف مسجل لهذا الوسيط";
      } else {
        const smsSettingsData = await resolveSmsSettings(supabase, agentId);
        if (!smsSettingsData || !smsSettingsData.is_enabled) {
          smsError = "خدمة الرسائل غير مفعلة";
        } else {
          let smsMessage = `مرحباً ${broker.name}،\n\nيمكنك مشاهدة كشف حسابك عبر الرابط:\n${cdnUrl}`;
          smsMessage = appendSmsFooter(smsMessage, branding);

          const escapeXml = (value: string) =>
            value
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/"/g, "&quot;")
              .replace(/'/g, "&apos;");

          let cleanPhone = rawPhone.replace(/[^0-9]/g, "");
          if (cleanPhone.startsWith("972")) {
            cleanPhone = "0" + cleanPhone.substring(3);
          }

          const dlr = crypto.randomUUID();
          const smsXml =
            `<?xml version="1.0" encoding="UTF-8"?>` +
            `<sms>` +
            `<user><username>${escapeXml(smsSettingsData.sms_user || "")}</username></user>` +
            `<source>${escapeXml(smsSettingsData.sms_source || "")}</source>` +
            `<destinations><phone id="${dlr}">${escapeXml(cleanPhone)}</phone></destinations>` +
            `<message>${escapeXml(smsMessage)}</message>` +
            `</sms>`;

          try {
            const smsResponse = await fetch("https://019sms.co.il/api", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${smsSettingsData.sms_token}`,
                "Content-Type": "application/xml; charset=utf-8",
              },
              body: smsXml,
            });
            const smsResultText = await smsResponse.text();
            console.log("[generate-broker-report] 019sms response:", smsResponse.status, smsResultText);

            if (!smsResponse.ok) {
              smsError = `فشل إرسال SMS (${smsResponse.status})`;
            } else {
              smsSent = true;
              // Log the outbound SMS so it shows up in sms_logs like every
              // other outgoing message in the system.
              await supabase.from("sms_logs").insert({
                phone_number: cleanPhone,
                message: `تقرير الوسيط - ${cdnUrl}`,
                sms_type: "manual",
                status: "sent",
                sent_at: new Date().toISOString(),
                agent_id: agentId,
              });
            }
          } catch (err) {
            console.error("[generate-broker-report] SMS error:", err);
            smsError = err instanceof Error ? err.message : String(err);
          }
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        url: cdnUrl,
        broker_name: broker.name,
        phone: broker.phone,
        policies_count: (policies || []).length,
        sms_sent: smsSent,
        sms_error: smsError,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[generate-broker-report] failed at step "${currentStep}":`, message);
    return new Response(
      JSON.stringify({
        error: `فشل في توليد التقرير (${currentStep}): ${message}`,
        step: currentStep,
        detail: message,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// ---------- Helpers ----------

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-GB");
}

function escapeHtml(text: string): string {
  return (text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizePhoneForWhatsapp(phone: string): string {
  if (!phone) return '';
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('0')) {
    digits = '972' + digits.substring(1);
  }
  return digits;
}

function getPolicyTypeLabel(parent: string, child: string | null): string {
  if (parent === 'THIRD_FULL' && child) {
    return POLICY_TYPE_LABELS[child] || POLICY_TYPE_LABELS[parent] || parent;
  }
  return POLICY_TYPE_LABELS[parent] || parent;
}

// ---------- HTML generation ----------

interface GenerateReportArgs {
  broker: any;
  policies: any[];
  settlements: any[];
  fromBrokerTotal: number;
  toBrokerTotal: number;
  paidToBroker: number;
  receivedFromBroker: number;
  netBalance: number;
  branding: AgentBranding;
  companySettings: {
    company_email: string;
    company_phones: string[];
    company_whatsapp: string;
    company_location: string;
  };
  filters: {
    start_date?: string;
    end_date?: string;
    direction_filter?: string;
  };
}

function generateReportHtml(args: GenerateReportArgs): string {
  const {
    broker,
    policies,
    settlements,
    fromBrokerTotal,
    toBrokerTotal,
    paidToBroker,
    receivedFromBroker,
    netBalance,
    branding,
    companySettings,
    filters,
  } = args;

  const today = new Date();

  // Brand block: custom logo if the agent uploaded one, else the bundled
  // Thiqa SVG — same rule the client report uses so paper output matches.
  const brandBlock = branding.logoUrl
    ? `<img class="logo" src="${branding.logoUrl}" alt="${branding.companyName}" />`
    : `<div class="logo logo-svg">${THIQA_LOGO_SVG}</div>`;

  // Period string for the meta box. Shows "كل الفترات" when no filter
  // was applied so the reader knows nothing's being hidden.
  const periodText = (filters.start_date || filters.end_date)
    ? `${filters.start_date ? formatDate(filters.start_date) : '...'} → ${filters.end_date ? formatDate(filters.end_date) : '...'}`
    : 'كل الفترات';

  // Policy rows — one per policy. Description cell carries the direction
  // tag ("من الوسيط" / "إلى الوسيط"), client name, car plate, company,
  // and optional notes. Cancelled/transferred rows get the muted look
  // from the shared `.cancelled-row` style.
  const getCompany = (p: any): string => {
    const c = Array.isArray(p.company) ? p.company[0] : p.company;
    return c?.name_ar || c?.name || '-';
  };
  const getClient = (p: any): string => {
    const c = Array.isArray(p.client) ? p.client[0] : p.client;
    return c?.full_name || '-';
  };
  const getCar = (p: any): string => {
    const car = Array.isArray(p.car) ? p.car[0] : p.car;
    return car?.car_number || '';
  };

  const policyRowsHtml = policies.length > 0
    ? policies.map((p: any, i: number) => {
        const typeLabel = getPolicyTypeLabel(p.policy_type_parent, p.policy_type_child);
        const companyName = getCompany(p);
        const clientName = getClient(p);
        const carNumber = getCar(p);
        const direction = p.broker_direction;
        const directionLabel = direction === 'from_broker'
          ? 'من الوسيط'
          : direction === 'to_broker'
            ? 'إلى الوسيط'
            : 'وسيط';
        const directionClass = direction === 'from_broker' ? 'dir-from' : 'dir-to';
        // Amount displayed: buy price for from_broker (what we owe), full
        // insurance price for to_broker (what the broker owes).
        const amount = direction === 'from_broker'
          ? Number(p.broker_buy_price || p.insurance_price || 0)
          : Number(p.insurance_price || 0);
        const cancelledTag = p.cancelled ? `<span class="cancelled-tag">ملغاة</span>` : '';
        const transferredTag = p.transferred && !p.cancelled ? `<span class="cancelled-tag">محولة</span>` : '';
        const rowClass = p.cancelled || p.transferred ? 'cancelled-row' : '';
        const notesLine = p.notes ? `<div class="item-meta">${escapeHtml(p.notes)}</div>` : '';
        const carLine = carNumber
          ? `<div class="item-meta">السيارة: <span class="tabular">${escapeHtml(carNumber)}</span></div>`
          : '';
        const periodStr = (p.start_date && p.end_date)
          ? `${formatDate(p.start_date)} → ${formatDate(p.end_date)}`
          : '-';
        return `
          <tr class="${rowClass}">
            <td class="num">${i + 1}</td>
            <td>
              <div class="item-title">${escapeHtml(typeLabel)} ${cancelledTag} ${transferredTag}</div>
              <div class="item-meta">العميل: ${escapeHtml(clientName)}</div>
              ${carLine}
              <div class="item-meta">${escapeHtml(companyName)}</div>
              <div class="item-broker ${directionClass}">${directionLabel}</div>
              ${notesLine}
            </td>
            <td class="period">${periodStr}</td>
            <td class="num">₪${amount.toLocaleString('en-US')}</td>
          </tr>
        `;
      }).join('')
    : `<tr><td colspan="4" class="empty-cell">لا توجد وثائق لهذا الوسيط</td></tr>`;

  // Settlements log — the "wallet" section. Lists every settlement record
  // (completed + pending) so the reader sees the full accounting trail.
  // Status column flags pending/partial rows that aren't counted in the
  // totals yet.
  const settlementsHtml = settlements.length > 0
    ? `
    <table class="payments">
      <thead>
        <tr>
          <th style="width: 50px;">#</th>
          <th style="width: 150px;">الرقم المرجعي</th>
          <th style="width: 130px;">الاتجاه</th>
          <th style="width: 120px;">التاريخ</th>
          <th style="width: 120px;">الحالة</th>
          <th>المبلغ</th>
        </tr>
      </thead>
      <tbody>
        ${settlements.map((s: any, i: number) => {
          const dirLabel = s.direction === 'we_owe'
            ? 'دفعنا للوسيط'
            : 'استلمنا من الوسيط';
          const dirClass = s.direction === 'we_owe' ? 'dir-to' : 'dir-from';
          const statusLabel = SETTLEMENT_STATUS_LABELS[s.status] || s.status;
          return `
          <tr>
            <td class="num">${i + 1}</td>
            <td class="num">${escapeHtml(s.settlement_number || '—')}</td>
            <td><span class="item-broker ${dirClass}">${dirLabel}</span></td>
            <td class="date">${formatDate(s.settlement_date)}</td>
            <td>${statusLabel}</td>
            <td class="amount">₪${Number(s.total_amount || 0).toLocaleString('en-US')}</td>
          </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `
    : `<div class="payments-empty">لا توجد تسويات مسجلة. ستظهر هنا الدفعات المتبادلة مع الوسيط فور تسجيلها من صفحة المحاسبة.</div>`;

  // Contact footer — same merge strategy as the client report so the
  // printed contact info stays consistent across document types.
  const effectivePhones = branding.invoicePhones.length > 0
    ? branding.invoicePhones
    : (companySettings.company_phones || []);
  const effectiveAddress = branding.invoiceAddress || companySettings.company_location || '';
  const whatsappNormalized = normalizePhoneForWhatsapp(companySettings.company_whatsapp || '');
  const contactLines: string[] = [];
  if (effectivePhones.length > 0) {
    contactLines.push(
      `هاتف: ${effectivePhones
        .map((phone: string) => `<a href="tel:${phone.replace(/[^0-9+]/g, '')}">${phone}</a>`)
        .join(' / ')}`,
    );
  }
  if (companySettings.company_whatsapp) {
    contactLines.push(`واتساب: <a href="https://wa.me/${whatsappNormalized}">${companySettings.company_whatsapp}</a>`);
  }
  if (companySettings.company_email) {
    contactLines.push(`بريد: <a href="mailto:${companySettings.company_email}">${companySettings.company_email}</a>`);
  }
  if (effectiveAddress) {
    contactLines.push(effectiveAddress);
  }
  const contactFooterHtml = contactLines.length > 0
    ? `<div class="contact">${contactLines.join(' &nbsp;•&nbsp; ')}</div>`
    : '';

  const reportNumber = `BRK-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}-${(broker.id || '').slice(0, 4).toUpperCase()}`;

  const netIsFavourable = netBalance >= 0;

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>تقرير الوسيط - ${escapeHtml(broker.name || '')}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@300;400;500;600;700&display=swap');

    * { box-sizing: border-box; margin: 0; padding: 0; }
    @page { size: A4; margin: 14mm; }
    html, body {
      font-family: 'IBM Plex Sans Arabic', 'Tajawal', system-ui, -apple-system, 'Segoe UI', sans-serif;
      font-size: 13px;
      line-height: 1.6;
      color: #1a1a1a;
      background: #f4f4f5;
      direction: rtl;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      font-feature-settings: "kern" 1, "liga" 1;
    }
    body { padding: 32px 16px; }
    .invoice {
      max-width: 820px;
      margin: 0 auto;
      background: #ffffff;
      padding: 40px 44px;
      border: 1px solid #1a1a1a;
    }
    a { color: inherit; text-decoration: none; }
    a:hover { color: #18181b; }

    .invoice-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 24px;
      padding-bottom: 22px;
      border-bottom: 1px solid #1a1a1a;
      margin-bottom: 24px;
    }
    .brand { max-width: 55%; }
    .brand .logo { max-height: 60px; max-width: 220px; object-fit: contain; display: block; margin-bottom: 10px; }
    .brand .logo-svg { display: block; margin-bottom: 10px; }
    .brand .logo-svg svg { height: 44px; width: auto; display: block; }
    .brand .name { font-size: 15px; font-weight: 700; color: #1a1a1a; }
    .brand .owner { font-size: 12px; color: #1a1a1a; margin-top: 4px; font-weight: 600; }
    .brand .tax { font-size: 12px; color: #1a1a1a; margin-top: 2px; direction: ltr; text-align: right; font-variant-numeric: tabular-nums; font-weight: 500; }
    .brand .tagline { font-size: 12px; color: #1a1a1a; margin-top: 2px; font-weight: 500; }
    .brand .address { font-size: 12px; color: #1a1a1a; margin-top: 8px; max-width: 320px; line-height: 1.55; font-weight: 500; }

    .invoice-meta { text-align: left; min-width: 240px; }
    .invoice-meta .doc-title {
      font-size: 42px;
      font-weight: 800;
      letter-spacing: 0.5px;
      color: #1a1a1a;
      line-height: 1;
      margin-bottom: 4px;
    }
    .invoice-meta .subtitle {
      font-size: 12px;
      font-weight: 600;
      color: #1a1a1a;
      margin-top: -8px;
      margin-bottom: 14px;
      letter-spacing: 0.5px;
    }
    .meta-rows { width: 100%; border: 1px solid #1a1a1a; font-size: 12px; }
    .meta-rows .row { display: flex; }
    .meta-rows .row + .row { border-top: 1px solid #1a1a1a; }
    .meta-rows .label {
      flex: 0 0 110px;
      padding: 7px 12px;
      background: #f4f4f5;
      font-weight: 700;
      color: #1a1a1a;
      font-size: 11.5px;
      text-align: right;
      border-left: 1px solid #1a1a1a;
      letter-spacing: 0.3px;
    }
    .meta-rows .val {
      flex: 1;
      padding: 7px 12px;
      text-align: left;
      direction: ltr;
      font-weight: 700;
      color: #1a1a1a;
      font-variant-numeric: tabular-nums;
    }

    .customer { margin-bottom: 20px; border: 1px solid #1a1a1a; }
    .section-title {
      padding: 8px 14px;
      border-bottom: 1px solid #1a1a1a;
      background: #f4f4f5;
      font-size: 11px;
      font-weight: 700;
      color: #1a1a1a;
      letter-spacing: 1.5px;
      text-transform: uppercase;
    }
    .customer-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; }
    .customer-grid .cell { padding: 9px 14px; }
    .customer-grid .cell:not(:nth-child(3n+1)) { border-right: 1px solid #1a1a1a; }
    .customer-grid .cell:nth-child(n+4) { border-top: 1px solid #1a1a1a; }
    .customer-grid .cell.full { grid-column: 1 / -1; }
    .customer-grid .label {
      font-size: 10px;
      font-weight: 700;
      color: #1a1a1a;
      margin-bottom: 3px;
      letter-spacing: 0.8px;
      text-transform: uppercase;
    }
    .customer-grid .value { font-size: 14px; font-weight: 700; color: #1a1a1a; }
    .customer-grid .value.tabular { font-variant-numeric: tabular-nums; direction: ltr; text-align: right; }

    .items tbody td { vertical-align: top; }
    .items tbody td.num {
      text-align: left;
      direction: ltr;
      white-space: nowrap;
      font-weight: 700;
    }
    .items tbody td.period {
      direction: ltr;
      text-align: right;
      font-variant-numeric: tabular-nums;
      font-size: 12px;
      white-space: nowrap;
    }
    .items tbody .item-title { font-weight: 700; font-size: 14px; color: #1a1a1a; }
    .items tbody .item-meta {
      color: #1a1a1a;
      font-size: 11.5px;
      margin-top: 3px;
      font-weight: 500;
    }
    .items tbody .item-meta .tabular { font-variant-numeric: tabular-nums; direction: ltr; }
    /* Direction chip — green for to_broker / broker_owes (money coming
       to me), orange/amber for from_broker / we_owe (money going out). */
    .items tbody .item-broker,
    .payments tbody .item-broker {
      display: inline-block;
      font-size: 11px;
      padding: 2px 8px;
      margin-top: 4px;
      font-weight: 700;
      letter-spacing: 0.2px;
      border: 1px solid;
    }
    .item-broker.dir-from { color: #78350f; background: #fef3c7; border-color: #fcd34d; }
    .item-broker.dir-to { color: #065f46; background: #d1fae5; border-color: #6ee7b7; }
    .items tbody td.empty-cell,
    .payments tbody td.empty-cell {
      text-align: center;
      font-weight: 500;
      opacity: 0.7;
    }

    .data-table {
      width: 100%;
      border-collapse: collapse;
    }
    .data-table thead th {
      background: #f4f4f5;
      color: #1a1a1a;
      padding: 8px 12px;
      text-align: right;
      font-size: 11px;
      letter-spacing: 1.5px;
      font-weight: 700;
      text-transform: uppercase;
      border-bottom: 1px solid #1a1a1a;
      border-left: 1px solid #1a1a1a;
    }
    .data-table thead th:last-child { border-left: none; }
    .data-table tbody td {
      padding: 9px 12px;
      border-top: 1px solid #1a1a1a;
      border-left: 1px solid #1a1a1a;
      font-size: 13px;
      color: #1a1a1a;
      text-align: right;
      font-weight: 500;
    }
    .data-table tbody td:last-child { border-left: none; }
    .data-table tbody tr:first-child td { border-top: none; }
    .data-table tbody td.num {
      text-align: center;
      font-variant-numeric: tabular-nums;
      font-weight: 700;
    }
    .data-table tbody td.tabular {
      direction: ltr;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    .payments-section { margin-bottom: 20px; }
    .payments { width: 100%; border-collapse: collapse; font-size: 12px; border: 1px solid #1a1a1a; }
    .payments thead th {
      background: #f4f4f5;
      color: #1a1a1a;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 1px;
      text-transform: uppercase;
      padding: 9px 12px;
      text-align: right;
      border-bottom: 1px solid #1a1a1a;
      border-left: 1px solid #1a1a1a;
    }
    .payments thead th:last-child { border-left: none; }
    .payments tbody td {
      padding: 9px 12px;
      border-top: 1px solid #1a1a1a;
      border-left: 1px solid #1a1a1a;
      font-size: 12px;
      color: #1a1a1a;
      font-weight: 500;
      vertical-align: middle;
    }
    .payments tbody td:last-child { border-left: none; }
    .payments tbody tr:first-child td { border-top: none; }
    .payments tbody td.num,
    .payments tbody td.date,
    .payments tbody td.amount {
      direction: ltr;
      text-align: left;
      font-variant-numeric: tabular-nums;
      font-weight: 700;
    }
    .payments-empty {
      padding: 14px;
      border: 1px solid #1a1a1a;
      font-size: 12px;
      color: #1a1a1a;
      opacity: 0.75;
      text-align: center;
    }

    .bottom {
      display: flex;
      justify-content: flex-end;
      gap: 18px;
      align-items: stretch;
      margin-bottom: 20px;
    }
    .totals {
      width: 360px;
      border-collapse: collapse;
      font-size: 13px;
      align-self: flex-start;
      border: 1px solid #1a1a1a;
    }
    .totals td {
      padding: 9px 14px;
      border-top: 1px solid #1a1a1a;
      border-left: 1px solid #1a1a1a;
    }
    .totals tr:first-child td { border-top: none; }
    .totals td:last-child { border-left: none; }
    .totals td.label {
      font-weight: 700;
      background: #f4f4f5;
      color: #1a1a1a;
      font-size: 11.5px;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }
    .totals td.val {
      text-align: left;
      direction: ltr;
      font-weight: 700;
      color: #1a1a1a;
      font-variant-numeric: tabular-nums;
    }
    .totals tr.total td {
      font-weight: 800;
      background: #1a1a1a;
      color: #ffffff;
      font-size: 15px;
      border-top: 1px solid #1a1a1a;
      padding: 12px 14px;
    }
    .totals tr.total td.label { text-transform: uppercase; font-size: 12px; letter-spacing: 0.5px; }
    .totals tr.total td.val { color: #ffffff; }

    .cancelled-row td { color: #9ca3af; text-decoration: line-through; }
    .cancelled-row td .cancelled-tag { text-decoration: none; }
    .cancelled-tag {
      display: inline-block;
      background: #fee2e2;
      color: #991b1b;
      font-size: 9px;
      font-weight: 700;
      padding: 2px 6px;
      margin-right: 6px;
      border: 1px solid #fca5a5;
      letter-spacing: 0.3px;
      vertical-align: middle;
    }

    .footer {
      margin-top: 28px;
      padding-top: 18px;
      border-top: 1px solid #1a1a1a;
      text-align: center;
      font-size: 12px;
    }
    .footer .thanks { font-weight: 700; font-size: 14px; color: #1a1a1a; margin-bottom: 8px; letter-spacing: 0.3px; }
    .footer .contact { color: #1a1a1a; margin-top: 8px; font-weight: 600; line-height: 1.7; }
    .footer .contact a { color: #1a1a1a; }
    .footer .issued { color: #1a1a1a; margin-top: 10px; font-size: 11px; font-variant-numeric: tabular-nums; opacity: 0.7; }

    .actions { text-align: center; margin-top: 28px; }
    .actions button {
      background: #18181b;
      color: #fff;
      border: 1px solid #18181b;
      padding: 10px 26px;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.5px;
      cursor: pointer;
      font-family: inherit;
      margin: 0 5px;
      border-radius: 4px;
      transition: background 0.15s, color 0.15s;
    }
    .actions button:hover { background: #fff; color: #18181b; }

    @media print {
      @page { size: A4; margin: 0; }
      html, body { background: #fff; }
      body { padding: 12mm 10mm; }
      .no-print { display: none !important; }
      .invoice { max-width: 100%; padding: 16px 20px; border: 1px solid #1a1a1a; }
      .items thead th,
      .items tbody .item-broker,
      .payments tbody .item-broker,
      .meta-rows .label,
      .section-title,
      .totals td.label,
      .totals tr.total td,
      .data-table thead th,
      .payments thead th {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }

    @media (max-width: 640px) {
      body { padding: 14px 8px; font-size: 12px; }
      .invoice { padding: 22px 18px; }
      .invoice-top {
        flex-direction: column;
        align-items: center;
        gap: 16px;
        text-align: center;
      }
      .brand {
        max-width: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
      }
      .brand .logo { max-height: 110px; max-width: 260px; margin: 0 auto; }
      .brand .logo-svg { margin: 0 auto; }
      .brand .logo-svg svg { height: 72px; }
      .brand .address { max-width: 100%; text-align: center; }
      .invoice-meta {
        text-align: center;
        min-width: 0;
        width: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
      }
      .invoice-meta .doc-title { font-size: 36px; }
      .invoice-meta .subtitle { text-align: center; }
      .meta-rows { width: 100%; max-width: 320px; }
      .customer-grid { grid-template-columns: 1fr; }
      .customer-grid .cell:not(:nth-child(3n+1)) { border-right: none; }
      .customer-grid .cell:nth-child(n+2) { border-top: 1px solid #1a1a1a; }
      .bottom { flex-direction: column; }
      .totals { width: 100%; }
    }
  </style>
</head>
<body>
  <div class="invoice">

    <div class="invoice-top">
      <div class="brand">
        ${brandBlock}
        <div class="name">${escapeHtml(branding.companyName)}</div>
        ${branding.ownerName && branding.ownerName.trim() !== branding.companyName.trim() ? `<div class="owner">${escapeHtml(branding.ownerName)}</div>` : ''}
        ${branding.taxNumber ? `<div class="tax">رقم المشغل: ${escapeHtml(branding.taxNumber)}</div>` : ''}
        ${branding.siteDescription ? `<div class="tagline">${escapeHtml(branding.siteDescription)}</div>` : ''}
        ${effectiveAddress ? `<div class="address">${escapeHtml(effectiveAddress)}</div>` : ''}
      </div>
      <div class="invoice-meta">
        <div class="doc-title">تقرير</div>
        <div class="subtitle">كشف حساب الوسيط</div>
        <div class="meta-rows">
          <div class="row">
            <div class="label">رقم التقرير</div>
            <div class="val">${reportNumber}</div>
          </div>
          <div class="row">
            <div class="label">التاريخ</div>
            <div class="val">${formatDate(today.toISOString())}</div>
          </div>
          <div class="row">
            <div class="label">الفترة</div>
            <div class="val">${escapeHtml(periodText)}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="customer">
      <div class="section-title">معلومات الوسيط</div>
      <div class="customer-grid">
        <div class="cell">
          <div class="label">الاسم</div>
          <div class="value">${escapeHtml(broker.name || '-')}</div>
        </div>
        <div class="cell">
          <div class="label">رقم الهاتف</div>
          <div class="value tabular">${broker.phone || '-'}</div>
        </div>
        <div class="cell">
          <div class="label">عدد الوثائق</div>
          <div class="value tabular">${policies.length}</div>
        </div>
        ${broker.notes ? `
        <div class="cell full">
          <div class="label">ملاحظات</div>
          <div class="value" style="font-size: 12px; font-weight: 500;">${escapeHtml(broker.notes)}</div>
        </div>
        ` : ''}
      </div>
    </div>

    <div class="customer">
      <div class="section-title">الوثائق</div>
      <table class="data-table items">
        <thead>
          <tr>
            <th style="width: 40px;">#</th>
            <th>الوصف</th>
            <th style="width: 170px;">المدة</th>
            <th style="width: 120px;">المبلغ</th>
          </tr>
        </thead>
        <tbody>
          ${policyRowsHtml}
        </tbody>
      </table>
    </div>

    <div class="payments-section">
      <div class="section-title">سجل التسويات (محفظة الوسيط)</div>
      ${settlementsHtml}
    </div>

    <div class="bottom">
      <table class="totals">
        <tr>
          <td class="label">له عليّ (وثائق)</td>
          <td class="val">₪${fromBrokerTotal.toLocaleString('en-US')}</td>
        </tr>
        <tr>
          <td class="label">ليَ عليه (وثائق)</td>
          <td class="val">₪${toBrokerTotal.toLocaleString('en-US')}</td>
        </tr>
        <tr>
          <td class="label">دفعت للوسيط</td>
          <td class="val">₪${paidToBroker.toLocaleString('en-US')}</td>
        </tr>
        <tr>
          <td class="label">استلمت من الوسيط</td>
          <td class="val">₪${receivedFromBroker.toLocaleString('en-US')}</td>
        </tr>
        <tr class="total">
          <td class="label">${netIsFavourable ? 'ليَ عليه (صافي)' : 'له عليّ (صافي)'}</td>
          <td class="val">₪${Math.abs(netBalance).toLocaleString('en-US')}</td>
        </tr>
      </table>
    </div>

    ${branding.invoicePrivacyText ? `
    <div class="customer">
      <div class="section-title">سياسة الخصوصية والشروط</div>
      <div style="padding: 11px 14px; font-size: 12px; color: #1a1a1a; line-height: 1.7; white-space: pre-wrap; font-weight: 500;">${escapeHtml(branding.invoicePrivacyText)}</div>
    </div>
    ` : ''}

    <div class="footer">
      <div class="thanks">شكراً لثقتكم</div>
      ${contactFooterHtml}
      <div class="issued">تاريخ الإصدار: ${formatDate(today.toISOString())}</div>
    </div>

    <div class="actions no-print">
      <button type="button" onclick="window.print()">طباعة</button>
      <button type="button" onclick="shareReport()">مشاركة</button>
    </div>
  </div>

  <script>
    function shareReport() {
      var url = window.location.href;
      if (navigator.share) {
        navigator.share({ title: 'تقرير الوسيط', url: url }).catch(function(){});
      } else {
        window.open('https://wa.me/?text=' + encodeURIComponent(url), '_blank');
      }
    }
  </script>
</body>
</html>`;
}
