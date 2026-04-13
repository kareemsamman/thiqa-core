import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import { buildBunnyStorageUploadUrl, normalizeBunnyCdnUrl, resolveBunnyStorageZone } from "../_shared/bunny-storage.ts";
import { getAgentBranding, resolveAgentId, type AgentBranding } from "../_shared/agent-branding.ts";
import { resolveSmsSettings } from "../_shared/sms-settings.ts";
import { checkUsageLimit, limitReachedResponse, logUsage } from "../_shared/usage-limits.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface SendPackageInvoiceSmsRequest {
  policy_ids: string[];
  skip_sms?: boolean;
}

const POLICY_TYPE_LABELS: Record<string, string> = {
  ELZAMI: 'إلزامي',
  THIRD_FULL: 'ثالث/شامل',
  ROAD_SERVICE: 'خدمات الطريق',
  ACCIDENT_FEE_EXEMPTION: 'إعفاء رسوم حادث',
  THIRD: 'ثالث',
  FULL: 'شامل',
};

const PAYMENT_TYPE_LABELS: Record<string, string> = {
  cash: 'نقدي',
  cheque: 'شيك',
  visa: 'فيزا',
  transfer: 'تحويل',
};

const CAR_TYPE_LABELS: Record<string, string> = {
  car: 'سيارة خاصة',
  cargo: 'شحن',
  small: 'اوتوبس زعير',
  taxi: 'تاكسي',
  tjeradown4: 'تجارة أقل من 4 طن',
  tjeraup4: 'تجارة أكثر من 4 طن',
};

function normalizePhoneForWhatsapp(phone: string): string {
  if (!phone) return '';
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('0')) {
    digits = '972' + digits.substring(1);
  }
  return digits;
}

interface PhoneLink {
  phone: string;
  href: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const bunnyApiKey = Deno.env.get('BUNNY_API_KEY');
    const rawBunnyStorageZone = Deno.env.get('BUNNY_STORAGE_ZONE');
    const bunnyCdnUrl = normalizeBunnyCdnUrl(Deno.env.get('BUNNY_CDN_URL'));
    const bunnyStorageZone = resolveBunnyStorageZone(rawBunnyStorageZone, bunnyCdnUrl);

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify user
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid authentication" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Resolve agent branding
    const agentId = await resolveAgentId(supabase, user.id);
    const branding = await getAgentBranding(supabase, agentId);

    const { policy_ids, skip_sms }: SendPackageInvoiceSmsRequest = await req.json();

    if (!policy_ids || policy_ids.length === 0) {
      return new Response(
        JSON.stringify({ error: "policy_ids is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[send-package-invoice-sms] Processing ${policy_ids.length} policies, skip_sms: ${skip_sms}`);

    // Get all policies with related data
    const { data: policies, error: policiesError } = await supabase
      .from("policies")
      .select(`
        *,
        client:clients(full_name, phone_number, id_number, signature_url),
        car:cars(car_number, manufacturer_name, model, year, car_type, color),
        company:insurance_companies(name, name_ar),
        broker:brokers(name),
        road_service:road_services(name, name_ar),
        accident_fee_service:accident_fee_services(name, name_ar)
      `)
      .in("id", policy_ids);

    if (policiesError || !policies || policies.length === 0) {
      console.error("[send-package-invoice-sms] Policies not found:", policiesError);
      return new Response(
        JSON.stringify({ error: "Policies not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // All policies should have the same client
    const client = policies[0].client;
    
    // Only require phone number when actually sending SMS
    if (!skip_sms && !client?.phone_number) {
      return new Response(
        JSON.stringify({ error: "رقم هاتف العميل مطلوب لإرسال SMS" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get insurance files for all policies (main + add-ons)
    const { data: insuranceFiles, error: filesError } = await supabase
      .from("media_files")
      .select("id, cdn_url, original_name, mime_type, entity_id")
      .in("entity_id", policy_ids)
      .in("entity_type", ["policy", "policy_insurance"])
      .is("deleted_at", null)
      .order("created_at", { ascending: true });

    if (filesError) {
      console.error("[send-package-invoice-sms] Error fetching files:", filesError);
    }

    // For skip_sms (print only): files are NOT required - we always generate the HTML invoice
    // For sending SMS: files are optional now (we always send HTML invoice link)
    const hasAnyFiles = insuranceFiles && insuranceFiles.length > 0;
    console.log(`[send-package-invoice-sms] Files found: ${insuranceFiles?.length || 0} for ${policies.length} policies`);

    // Fetch SMS credentials for this agent (with Thiqa platform fallback)
    const packageAgentId = policies?.[0]?.agent_id;
    const smsSettingsData = await resolveSmsSettings(supabase, packageAgentId);

    // For SMS sending, require enabled settings
    if (!skip_sms) {
      if (!smsSettingsData) {
        return new Response(
          JSON.stringify({ error: "خدمة الرسائل غير مفعلة" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Enforce SMS quota for the agent who owns this package
      const smsCheck = await checkUsageLimit(supabase, packageAgentId, "sms");
      if (!smsCheck.allowed) {
        return limitReachedResponse("sms", smsCheck, corsHeaders);
      }
    }

    // Get company settings from agent's SMS settings row
    const { data: agentSmsRow } = await supabase
      .from("sms_settings")
      .select("company_email, company_phones, company_whatsapp, company_location")
      .eq("agent_id", packageAgentId)
      .maybeSingle();

    const companySettings = {
      company_email: agentSmsRow?.company_email || '',
      company_phones: agentSmsRow?.company_phones || [],
      company_whatsapp: agentSmsRow?.company_whatsapp || '',
      company_location: agentSmsRow?.company_location || '',
    };

    if (!bunnyApiKey || !bunnyStorageZone) {
      return new Response(
        JSON.stringify({ error: 'إعدادات التخزين غير مكتملة' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get payments for all policies (include refused=null for pending Visa payments)
    const { data: allPayments } = await supabase
      .from('policy_payments')
      .select('policy_id, payment_type, amount, payment_date')
      .in('policy_id', policy_ids)
      .or('refused.eq.false,refused.is.null')
      .order('created_at', { ascending: true });

    // Get policy children (additional drivers) for all policies
    const { data: policyChildren, error: childrenError } = await supabase
      .from('policy_children')
      .select(`
        policy_id,
        child:client_children(full_name, id_number, relation, phone)
      `)
      .in('policy_id', policy_ids);

    if (childrenError) {
      console.error("[send-package-invoice-sms] Error fetching policy children:", childrenError);
    }

    console.log(`[send-package-invoice-sms] Found ${policyChildren?.length || 0} additional drivers`);

    // Group payments by policy
    const paymentsByPolicy: Record<string, any[]> = {};
    (allPayments || []).forEach(p => {
      if (!paymentsByPolicy[p.policy_id]) {
        paymentsByPolicy[p.policy_id] = [];
      }
      paymentsByPolicy[p.policy_id].push(p);
    });

    // Calculate totals
    const totalPrice = policies.reduce((sum, p) => sum + (p.insurance_price || 0), 0);
    const totalPaid = (allPayments || []).reduce((sum, p) => sum + (p.amount || 0), 0);
    const totalRemaining = totalPrice - totalPaid;

    // Generate Package Invoice HTML with files and policy children
    const packageInvoiceHtml = buildPackageInvoiceHtml(policies, paymentsByPolicy, totalPrice, totalPaid, totalRemaining, insuranceFiles || [], policyChildren || [], companySettings, branding);
    
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const timestamp = Date.now();
    const randomId = crypto.randomUUID().slice(0, 8);
    const clientNameSafe = client?.full_name?.replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '_') || 'customer';
    const storagePath = `invoices/${year}/${month}/package_invoice_${clientNameSafe}_${timestamp}_${randomId}.html`;

    // Upload to Bunny Storage
    const bunnyUploadUrl = buildBunnyStorageUploadUrl(bunnyStorageZone, storagePath);
    
    console.log(`[send-package-invoice-sms] Uploading package invoice to: ${bunnyUploadUrl}`);

    const uploadResponse = await fetch(bunnyUploadUrl, {
      method: 'PUT',
      headers: {
        'AccessKey': bunnyApiKey,
        'Content-Type': 'text/html; charset=utf-8',
      },
      body: packageInvoiceHtml,
    });

    if (!uploadResponse.ok) {
      console.error('[send-package-invoice-sms] Bunny upload failed');
      return new Response(
        JSON.stringify({ error: 'فشل في رفع الفاتورة' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const packageInvoiceUrl = `${bunnyCdnUrl}/${storagePath}`;
    console.log(`[send-package-invoice-sms] Package Invoice uploaded: ${packageInvoiceUrl}`);

    // Build policy file URLs (all files from all policies)
    // Normalize CDN URLs (replace old b-cdn.net with custom domain)
    const policyFileUrls = hasAnyFiles 
      ? insuranceFiles.map(f => f.cdn_url.replace('https://basheer-ab.b-cdn.net/', bunnyCdnUrl + '/').replace('https://cdn.basheer-ab.com/', bunnyCdnUrl + '/'))
      : [];
    
    // Build all policy URLs with labels for SMS - include ALL files
    const allPolicyUrlsText = policyFileUrls.length > 0 
      ? policyFileUrls.map((url) => `البوليصة ${url}`).join('\n')
      : '';

    // Skip SMS sending if requested (for print only)
    if (skip_sms) {
      console.log(`[send-package-invoice-sms] Skipping SMS (skip_sms=true)`);
      
      const duration = Date.now() - startTime;
      console.log(`[send-package-invoice-sms] Completed in ${duration}ms (print only)`);

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "تم توليد الفاتورة",
          policy_count: policy_ids.length,
          file_count: policyFileUrls.length,
          package_invoice_url: packageInvoiceUrl,
          duration_ms: duration
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build SMS message with ALL files included
    let smsMessage = `مرحباً ${client.full_name}، تم إصدار وثيقة التأمين`;
    
    // Add policy files if available
    if (allPolicyUrlsText) {
      smsMessage += `\n\n${allPolicyUrlsText}`;
    }
    
    // Always add invoice URL
    smsMessage += `\n\nفاتورة شركة التأمين: ${packageInvoiceUrl}`;

    const escapeXml = (value: string) =>
      value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&apos;");

    // Normalize phone
    let cleanPhone = client.phone_number.replace(/[^0-9]/g, "");
    if (cleanPhone.startsWith("972")) {
      cleanPhone = "0" + cleanPhone.substring(3);
    }

    // Send SMS via 019sms
    const dlr = crypto.randomUUID();
    const smsXml =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<sms>` +
      `<user><username>${escapeXml(smsSettingsData.sms_user || "")}</username></user>` +
      `<source>${escapeXml(smsSettingsData.sms_source || "")}</source>` +
      `<destinations><phone id="${dlr}">${escapeXml(cleanPhone)}</phone></destinations>` +
      `<message>${escapeXml(smsMessage)}</message>` +
      `</sms>`;

    console.log(`[send-package-invoice-sms] Sending SMS to ${cleanPhone} with ${policyFileUrls.length} policy files`);

    const smsResponse = await fetch("https://019sms.co.il/api", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${smsSettingsData.sms_token}`,
        "Content-Type": "application/xml; charset=utf-8",
      },
      body: smsXml,
    });

    const smsResult = await smsResponse.text();
    console.log("[send-package-invoice-sms] 019sms response:", smsResult);

    const extractTag = (xml: string, tag: string) => {
      const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
      return match?.[1]?.trim() ?? null;
    };

    const status = extractTag(smsResult, "status");
    const apiMessage = extractTag(smsResult, "message");

    if (!smsResponse.ok || status !== "0") {
      console.error(`[send-package-invoice-sms] SMS failed: status=${status} message=${apiMessage}`);
      return new Response(
        JSON.stringify({ error: apiMessage || `خطأ في إرسال الرسالة` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log SMS to sms_logs table
    const { error: logError } = await supabase.from('sms_logs').insert({
      branch_id: policies[0]?.branch_id || null,
      client_id: client?.id || null,
      policy_id: policy_ids[0], // Primary policy
      phone_number: cleanPhone,
      message: smsMessage,
      sms_type: 'invoice',
      status: 'sent',
      sent_at: new Date().toISOString(),
    });

    if (logError) {
      console.error("[send-package-invoice-sms] Error logging SMS:", logError);
    }

    // Track usage for quota enforcement
    await logUsage(supabase, packageAgentId, "sms");

    // Mark all policies as sent
    const { error: updateError } = await supabase
      .from("policies")
      .update({ invoices_sent_at: new Date().toISOString() })
      .in("id", policy_ids);

    if (updateError) {
      console.error("[send-package-invoice-sms] Error updating policies:", updateError);
    }

    const duration = Date.now() - startTime;
    console.log(`[send-package-invoice-sms] Completed in ${duration}ms`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "تم إرسال الوثائق عبر الرسائل",
        sent_to: cleanPhone,
        policy_count: policy_ids.length,
        file_count: policyFileUrls.length,
        package_invoice_url: packageInvoiceUrl,
        duration_ms: duration
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    console.error("[send-package-invoice-sms] Fatal error:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-GB', { 
    year: 'numeric', 
    month: '2-digit', 
    day: '2-digit',
  });
}

function buildPackageInvoiceHtml(
  policies: any[],
  paymentsByPolicy: Record<string, any[]>,
  totalPrice: number,
  totalPaid: number,
  remaining: number,
  policyFiles: { cdn_url: string; original_name: string; mime_type: string; entity_id: string }[],
  policyChildren: any[] = [],
  companySettings: { company_email?: string; company_phones?: string[]; company_whatsapp?: string; company_location?: string },
  branding: AgentBranding = { companyName: 'وكالة التأمين', companyNameEn: '', logoUrl: null, siteDescription: '' }
): string {
  const client = policies[0]?.client || {};
  const today = new Date();
  // Invoice number: YYYYMMDD-<first 6 of first policy id>
  const firstPolicyId = policies[0]?.id || '';
  const invoiceNumber = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}-${firstPolicyId.slice(0, 6).toUpperCase()}`;

  // Brand block: agent logo if present, otherwise a Thiqa text wordmark.
  const brandBlock = branding.logoUrl
    ? `<img class="logo" src="${branding.logoUrl}" alt="${branding.companyName}" />`
    : `<div class="logo-fallback">Thiqa</div>`;

  // Additional drivers — flat comma-separated list in the bill-to section.
  const additionalDrivers = policyChildren
    .map((pc: any) => pc?.child?.full_name)
    .filter(Boolean)
    .join('، ');

  // Normalize attachment CDN urls.
  const normalizedFiles = policyFiles.map(f => ({
    ...f,
    cdn_url: f.cdn_url
      .replace('https://basheer-ab.b-cdn.net/', bunnyCdnUrl + '/')
      .replace('https://cdn.basheer-ab.com/', bunnyCdnUrl + '/'),
  }));

  // Item rows — one per policy. "Description" = type + car, "Amount" = price.
  const policyRows = policies.map((p, i) => {
    let policyType = '';
    if (p.policy_type_parent === 'ROAD_SERVICE' && p.road_service) {
      policyType = `خدمات الطريق - ${(p.road_service as any).name_ar || (p.road_service as any).name || ''}`;
    } else if (p.policy_type_parent === 'ACCIDENT_FEE_EXEMPTION' && p.accident_fee_service) {
      policyType = `إعفاء رسوم - ${(p.accident_fee_service as any).name_ar || (p.accident_fee_service as any).name || ''}`;
    } else if (p.policy_type_child && POLICY_TYPE_LABELS[p.policy_type_child]) {
      policyType = POLICY_TYPE_LABELS[p.policy_type_child];
    } else {
      policyType = POLICY_TYPE_LABELS[p.policy_type_parent] || p.policy_type_parent;
    }

    const carLine = p.car?.car_number ? ` — سيارة ${p.car.car_number}` : '';
    const companyName = p.company?.name_ar || p.company?.name || '-';

    return `
      <tr>
        <td class="num">${i + 1}</td>
        <td>
          <div class="item-title">${policyType}${carLine}</div>
          <div class="item-meta">${companyName}</div>
        </td>
        <td class="num">₪${(p.insurance_price || 0).toLocaleString()}</td>
      </tr>
    `;
  }).join('');

  // Payments list for the notes section.
  const allPaymentsList: any[] = [];
  policies.forEach(p => {
    const policyPayments = paymentsByPolicy[p.id] || [];
    policyPayments.forEach(pay => allPaymentsList.push(pay));
  });
  allPaymentsList.sort((a, b) => new Date(a.payment_date).getTime() - new Date(b.payment_date).getTime());

  const paymentsNoteHtml = allPaymentsList.length > 0 ? `
    <div class="notes-line"><strong>سجل الدفعات:</strong></div>
    <ul class="notes-list">
      ${allPaymentsList.map(p => `
        <li>${formatDate(p.payment_date)} — ${PAYMENT_TYPE_LABELS[p.payment_type] || p.payment_type}: ₪${(p.amount || 0).toLocaleString()}</li>
      `).join('')}
    </ul>
  ` : `<div class="notes-line muted">لا توجد دفعات مسجلة.</div>`;

  // Attached files — simple thumbnail grid at the bottom (still useful but
  // styled flat, no gradients or rounded cards).
  const filesHtml = normalizedFiles.length > 0 ? `
    <div class="files-section">
      <div class="section-label">الملفات المرفقة</div>
      <div class="files-grid">
        ${normalizedFiles.map((file) => {
          const isImage = file.mime_type?.startsWith('image/');
          return `
            <a href="${file.cdn_url}" target="_blank" class="file-link" ${isImage ? `onclick="event.preventDefault();openLightbox('${file.cdn_url}')"` : ''}>
              ${isImage
                ? `<img src="${file.cdn_url}" alt="${file.original_name}" />`
                : `<div class="file-placeholder">PDF</div>`}
              <span>${file.original_name}</span>
            </a>
          `;
        }).join('')}
      </div>
    </div>
  ` : '';

  // Contact footer — plain text rows, no emojis, no badges.
  const whatsappNormalized = normalizePhoneForWhatsapp(companySettings.company_whatsapp || '');
  const contactLines: string[] = [];
  if (companySettings.company_phones && companySettings.company_phones.length > 0) {
    contactLines.push(
      `هاتف: ${companySettings.company_phones
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
  if (companySettings.company_location) {
    contactLines.push(companySettings.company_location);
  }
  const contactFooterHtml = contactLines.length > 0
    ? `<div class="contact">${contactLines.join(' &nbsp;•&nbsp; ')}</div>`
    : '';

  return `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>فاتورة - ${client.full_name || 'عميل'}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;800;900&display=swap');

    * { box-sizing: border-box; margin: 0; padding: 0; }
    @page { size: A4; margin: 12mm; }
    html, body {
      font-family: 'Cairo', 'Tajawal', 'Segoe UI', Tahoma, Arial, sans-serif;
      font-size: 13px;
      line-height: 1.6;
      color: #000;
      background: #ededed;
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
      padding: 42px 44px;
      border: 3px double #000;
      position: relative;
    }
    .invoice::before {
      content: '';
      position: absolute;
      inset: 6px;
      border: 1px solid #000;
      pointer-events: none;
    }
    .invoice > * { position: relative; }
    a { color: inherit; text-decoration: none; }
    a:hover { text-decoration: underline; }

    /* ── Header: brand (right, RTL visual-right) + meta (left) ── */
    .invoice-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 24px;
      padding-bottom: 22px;
      border-bottom: 3px double #000;
      margin-bottom: 26px;
    }
    .brand { max-width: 55%; }
    .brand .logo {
      max-height: 76px;
      max-width: 240px;
      object-fit: contain;
      display: block;
      margin-bottom: 10px;
    }
    .brand .logo-fallback {
      font-size: 32px;
      font-weight: 900;
      letter-spacing: 2px;
      margin-bottom: 10px;
    }
    .brand .name { font-size: 19px; font-weight: 800; letter-spacing: 0.3px; }
    .brand .tagline { font-size: 11px; color: #444; margin-top: 3px; font-weight: 500; }
    .brand .address { font-size: 11px; color: #444; margin-top: 8px; max-width: 340px; line-height: 1.5; }

    .invoice-meta { text-align: left; min-width: 280px; }
    .invoice-meta h1 {
      font-size: 46px;
      font-weight: 900;
      letter-spacing: 4px;
      margin-bottom: 16px;
      line-height: 1;
    }
    .meta-rows {
      width: 100%;
      border: 2px solid #000;
      font-size: 12px;
    }
    .meta-rows .row { display: flex; }
    .meta-rows .row + .row { border-top: 1px solid #000; }
    .meta-rows .label {
      flex: 0 0 110px;
      background: #000;
      color: #fff;
      font-weight: 700;
      padding: 8px 12px;
      letter-spacing: 0.5px;
      font-size: 11px;
      text-align: right;
    }
    .meta-rows .val {
      flex: 1;
      padding: 8px 12px;
      text-align: center;
      direction: ltr;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }

    /* ── Bill-to ── */
    .bill-to {
      margin-bottom: 22px;
    }
    .section-header {
      background: #000;
      color: #fff;
      padding: 9px 14px;
      font-weight: 700;
      font-size: 12px;
      letter-spacing: 1.5px;
    }
    .section-body {
      padding: 12px 14px;
      border: 2px solid #000;
      border-top: none;
      font-size: 12px;
    }
    .bill-to .name { font-weight: 800; font-size: 15px; margin-bottom: 3px; }
    .bill-to .meta { color: #333; font-weight: 500; font-variant-numeric: tabular-nums; }
    .bill-to .drivers {
      color: #444;
      margin-top: 6px;
      padding-top: 6px;
      border-top: 1px dashed #999;
    }

    /* ── Items table ── */
    .items {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 22px;
      border: 2px solid #000;
    }
    .items thead th {
      background: #000;
      color: #fff;
      padding: 11px 12px;
      text-align: right;
      font-size: 11px;
      letter-spacing: 1.5px;
      font-weight: 700;
      border-left: 1px solid #444;
    }
    .items thead th:last-child { border-left: none; }
    .items tbody td {
      padding: 12px;
      border-top: 1px solid #000;
      border-left: 1px solid #000;
      font-size: 12px;
      text-align: right;
      vertical-align: top;
    }
    .items tbody td:last-child { border-left: none; }
    .items tbody tr:nth-child(even) td { background: #f7f7f7; }
    .items tbody td.num {
      text-align: center;
      direction: ltr;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
      font-weight: 700;
    }
    .items tbody .item-title { font-weight: 700; font-size: 13px; }
    .items tbody .item-meta { color: #555; font-size: 11px; margin-top: 3px; }

    /* ── Bottom row: notes (left / visual-right in RTL) + totals ── */
    .bottom {
      display: flex;
      justify-content: space-between;
      gap: 20px;
      align-items: stretch;
      margin-bottom: 24px;
    }
    .notes {
      flex: 1;
      font-size: 11px;
      display: flex;
      flex-direction: column;
    }
    .notes .body {
      padding: 12px 14px;
      border: 2px solid #000;
      border-top: none;
      flex: 1;
      min-height: 140px;
    }
    .notes-line { margin-bottom: 5px; }
    .notes-line.muted { color: #666; }
    .notes-list {
      list-style: none;
      padding: 0;
      margin: 6px 0 0 0;
    }
    .notes-list li {
      padding: 5px 0;
      border-bottom: 1px dashed #aaa;
      font-size: 11px;
      font-variant-numeric: tabular-nums;
    }
    .notes-list li:last-child { border-bottom: none; }

    .totals {
      width: 290px;
      border-collapse: collapse;
      font-size: 13px;
      align-self: flex-start;
      border: 2px solid #000;
    }
    .totals td {
      padding: 10px 14px;
      border-top: 1px solid #000;
      border-left: 1px solid #000;
    }
    .totals tr:first-child td { border-top: none; }
    .totals td:last-child { border-left: none; }
    .totals td.label { font-weight: 700; background: #fff; letter-spacing: 0.5px; }
    .totals td.val {
      text-align: left;
      direction: ltr;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .totals tr.total td {
      font-weight: 900;
      background: #000;
      color: #fff;
      font-size: 15px;
      border-top: 3px double #fff;
      padding: 13px 14px;
    }

    /* ── Files ── */
    .files-section { margin-bottom: 24px; }
    .section-label {
      font-weight: 800;
      font-size: 12px;
      padding: 8px 0;
      border-bottom: 2px solid #000;
      margin-bottom: 12px;
      letter-spacing: 1.5px;
    }
    .files-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
    }
    .file-link {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 7px;
      padding: 10px;
      border: 1.5px solid #000;
      font-size: 10px;
      text-align: center;
      word-break: break-word;
      background: #fff;
    }
    .file-link:hover { background: #f5f5f5; }
    .file-link img {
      max-width: 100%;
      max-height: 90px;
      object-fit: contain;
    }
    .file-placeholder {
      width: 100%;
      height: 72px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1.5px solid #000;
      font-weight: 800;
      font-size: 14px;
      letter-spacing: 2px;
      background: #000;
      color: #fff;
    }

    /* ── Footer ── */
    .footer {
      margin-top: 32px;
      padding-top: 18px;
      border-top: 3px double #000;
      text-align: center;
      font-size: 11px;
    }
    .footer .thanks {
      font-weight: 800;
      font-size: 15px;
      margin-bottom: 8px;
      letter-spacing: 2px;
    }
    .footer .contact { color: #333; margin-top: 6px; font-weight: 500; }
    .footer .issued {
      color: #666;
      margin-top: 8px;
      font-size: 10px;
      font-variant-numeric: tabular-nums;
    }

    /* ── Action buttons (only on screen, hidden in print) ── */
    .actions {
      text-align: center;
      margin-top: 26px;
    }
    .actions button {
      background: #000;
      color: #fff;
      border: 1.5px solid #000;
      padding: 11px 28px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 1.5px;
      cursor: pointer;
      font-family: inherit;
      margin: 0 5px;
      transition: background 0.15s, color 0.15s;
    }
    .actions button:hover { background: #fff; color: #000; }

    /* ── Lightbox ── */
    .lightbox {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.94);
      z-index: 9999;
      justify-content: center;
      align-items: center;
    }
    .lightbox.active { display: flex; }
    .lightbox img { max-width: 94%; max-height: 90vh; object-fit: contain; }
    .lightbox .close {
      position: absolute;
      top: 18px;
      right: 22px;
      background: none;
      border: none;
      color: #fff;
      font-size: 36px;
      cursor: pointer;
    }

    @media print {
      body { padding: 0; background: #fff; }
      .no-print { display: none !important; }
      .invoice {
        max-width: 100%;
        padding: 18px 22px;
        border: 3px double #000;
      }
      .items thead th,
      .items tbody tr:nth-child(even) td,
      .totals tr.total td,
      .section-header,
      .meta-rows .label,
      .file-placeholder {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }

    @media (max-width: 640px) {
      body { padding: 14px 8px; font-size: 12px; }
      .invoice { padding: 22px 18px; }
      .invoice::before { inset: 4px; }
      .invoice-top { flex-direction: column; gap: 18px; }
      .invoice-meta { text-align: right; min-width: 0; }
      .invoice-meta h1 { font-size: 34px; letter-spacing: 2px; }
      .meta-rows { margin-left: 0; margin-right: 0; }
      .bottom { flex-direction: column; }
      .totals { width: 100%; }
      .files-grid { grid-template-columns: repeat(2, 1fr); }
    }
  </style>
</head>
<body>
  <div class="invoice">

    <!-- Header: brand on the visual right, invoice metadata on the left -->
    <div class="invoice-top">
      <div class="brand">
        ${brandBlock}
        <div class="name">${branding.companyName}</div>
        ${branding.siteDescription ? `<div class="tagline">${branding.siteDescription}</div>` : ''}
        ${companySettings.company_location ? `<div class="address">${companySettings.company_location}</div>` : ''}
      </div>
      <div class="invoice-meta">
        <h1>فاتورة</h1>
        <div class="meta-rows">
          <div class="row">
            <div class="label">التاريخ</div>
            <div class="val">${formatDate(today.toISOString())}</div>
          </div>
          <div class="row">
            <div class="label">رقم الفاتورة</div>
            <div class="val">${invoiceNumber}</div>
          </div>
          ${client.id_number ? `
          <div class="row">
            <div class="label">هوية العميل</div>
            <div class="val">${client.id_number}</div>
          </div>
          ` : ''}
        </div>
      </div>
    </div>

    <!-- Bill to -->
    <div class="bill-to">
      <div class="section-header">إلى</div>
      <div class="section-body">
        <div class="name">${client.full_name || '-'}</div>
        ${client.phone_number ? `<div class="meta">${client.phone_number}</div>` : ''}
        ${additionalDrivers ? `<div class="drivers">سائقون إضافيون: ${additionalDrivers}</div>` : ''}
      </div>
    </div>

    <!-- Items table -->
    <table class="items">
      <thead>
        <tr>
          <th style="width: 44px;">#</th>
          <th>الوصف</th>
          <th style="width: 130px;">المبلغ</th>
        </tr>
      </thead>
      <tbody>
        ${policyRows}
      </tbody>
    </table>

    <!-- Notes (left of page-bottom in LTR, right in RTL) + totals -->
    <div class="bottom">
      <div class="notes">
        <div class="section-header">ملاحظات</div>
        <div class="body">
          ${paymentsNoteHtml}
        </div>
      </div>
      <table class="totals">
        <tr>
          <td class="label">الإجمالي</td>
          <td class="val">₪${totalPrice.toLocaleString()}</td>
        </tr>
        <tr>
          <td class="label">المدفوع</td>
          <td class="val">₪${totalPaid.toLocaleString()}</td>
        </tr>
        <tr class="total">
          <td class="label">المتبقي</td>
          <td class="val">₪${remaining.toLocaleString()}</td>
        </tr>
      </table>
    </div>

    ${filesHtml}

    <!-- Footer -->
    <div class="footer">
      <div class="thanks">شكراً لثقتكم</div>
      ${contactFooterHtml}
      <div class="issued">تاريخ الإصدار: ${formatDate(today.toISOString())}</div>
    </div>

    <div class="actions no-print">
      <button type="button" onclick="window.print()">طباعة</button>
      <button type="button" onclick="shareInvoice()">مشاركة</button>
    </div>
  </div>

  <!-- Lightbox for attachment previews -->
  <div class="lightbox" id="lightbox" onclick="closeLightbox()">
    <button class="close" type="button" onclick="closeLightbox()">×</button>
    <img id="lightbox-img" alt="" onclick="event.stopPropagation()" />
  </div>

  <script>
    function openLightbox(src) {
      var box = document.getElementById('lightbox');
      document.getElementById('lightbox-img').src = src;
      box.classList.add('active');
      document.body.style.overflow = 'hidden';
    }
    function closeLightbox() {
      document.getElementById('lightbox').classList.remove('active');
      document.body.style.overflow = '';
    }
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeLightbox();
    });
    function shareInvoice() {
      var url = window.location.href;
      if (navigator.share) {
        navigator.share({ title: 'فاتورة', url: url }).catch(function(){});
      } else {
        window.open('https://wa.me/?text=' + encodeURIComponent(url), '_blank');
      }
    }
  </script>
</body>
</html>
  `;
}
