import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import { buildBunnyStorageUploadUrl, normalizeBunnyCdnUrl, resolveBunnyStorageZone } from "../_shared/bunny-storage.ts";
import { getAgentBranding, resolveAgentId, type AgentBranding } from "../_shared/agent-branding.ts";
import { appendSmsFooter } from "../_shared/sms-footer.ts";
import { resolveSmsSettings } from "../_shared/sms-settings.ts";
import { checkUsageLimit, limitReachedResponse, logUsage } from "../_shared/usage-limits.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface SendInvoiceSmsRequest {
  policy_id: string;
  force_resend?: boolean;
  skip_sms?: boolean;
}

// Map policy types to Arabic labels
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

    const { policy_id, force_resend, skip_sms }: SendInvoiceSmsRequest = await req.json();

    if (!policy_id) {
      return new Response(
        JSON.stringify({ error: "policy_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[send-invoice-sms] Processing policy: ${policy_id}, skip_sms: ${skip_sms}`);

    // Get policy with all related data
    const { data: policy, error: policyError } = await supabase
      .from("policies")
      .select(`
        *,
        client:clients(full_name, phone_number, id_number, signature_url),
        car:cars(car_number, manufacturer_name, model, year, car_type, color),
        company:insurance_companies(name, name_ar),
        broker:brokers(name),
        created_by:profiles!policies_created_by_admin_id_fkey(full_name, email)
      `)
      .eq("id", policy_id)
      .single();

    if (policyError || !policy) {
      console.error("[send-invoice-sms] Policy not found:", policyError);
      return new Response(
        JSON.stringify({ error: "Policy not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if already sent (skip check if force_resend is true)
    if (policy.invoices_sent_at && !force_resend && !skip_sms) {
      console.log("[send-invoice-sms] Invoices already sent at:", policy.invoices_sent_at);
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: "Invoices already sent",
          sent_at: policy.invoices_sent_at
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    if (force_resend) {
      console.log("[send-invoice-sms] Force resend enabled, bypassing sent check");
    }

    // Get insurance files (uploaded policy documents from Bunny CDN)
    const { data: insuranceFiles, error: filesError } = await supabase
      .from("media_files")
      .select("id, cdn_url, original_name, mime_type")
      .eq("entity_id", policy_id)
      .in("entity_type", ["policy", "policy_insurance"])
      .is("deleted_at", null)
      .order("created_at", { ascending: true });

    if (filesError) {
      console.error("[send-invoice-sms] Error fetching files:", filesError);
    }

    // For skip_sms (print only): files are NOT required
    // For sending SMS: files are optional now (we always send HTML invoice link)
    const hasInsuranceFiles = insuranceFiles && insuranceFiles.length > 0;
    console.log(`[send-invoice-sms] Files found: ${insuranceFiles?.length || 0}`);

    // Check if client has phone number - only required when actually sending SMS
    if (!skip_sms && !policy.client?.phone_number) {
      return new Response(
        JSON.stringify({ error: "رقم هاتف العميل مطلوب لإرسال SMS" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch SMS credentials for this agent (with Thiqa platform fallback)
    const policyAgentId = policy.agent_id;
    const smsSettingsData = await resolveSmsSettings(supabase, policyAgentId);

    // For SMS sending, require enabled settings
    if (!skip_sms) {
      if (!smsSettingsData) {
        return new Response(
          JSON.stringify({ error: "خدمة الرسائل غير مفعلة" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Enforce SMS quota for the agent who owns this policy
      const smsCheck = await checkUsageLimit(supabase, policyAgentId, "sms");
      if (!smsCheck.allowed) {
        return limitReachedResponse("sms", smsCheck, corsHeaders);
      }
    }

    // Get company settings and template from agent's SMS settings row
    const { data: agentSmsRow } = await supabase
      .from("sms_settings")
      .select("company_email, company_phones, company_whatsapp, company_location, invoice_sms_template")
      .eq("agent_id", policyAgentId)
      .maybeSingle();

    const companySettings = {
      company_email: agentSmsRow?.company_email || '',
      company_phones: agentSmsRow?.company_phones || [],
      company_whatsapp: agentSmsRow?.company_whatsapp || '',
      company_location: agentSmsRow?.company_location || '',
    };

    // Check Bunny configuration for AB invoice generation
    if (!bunnyApiKey || !bunnyStorageZone) {
      console.error('[send-invoice-sms] Missing Bunny configuration');
      return new Response(
        JSON.stringify({ error: 'إعدادات التخزين غير مكتملة' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get payment details for invoice
    const { data: payments } = await supabase
      .from('policy_payments')
      .select('payment_type, amount, payment_date')
      .eq('policy_id', policy_id)
      .eq('refused', false)
      .order('created_at', { ascending: true });

    // Get policy children (additional drivers) for this policy
    const { data: policyChildren, error: childrenError } = await supabase
      .from('policy_children')
      .select(`
        policy_id,
        child:client_children(full_name, id_number, relation, phone)
      `)
      .eq('policy_id', policy_id);

    if (childrenError) {
      console.error("[send-invoice-sms] Error fetching policy children:", childrenError);
    }

    console.log(`[send-invoice-sms] Found ${policyChildren?.length || 0} additional drivers`);

    const paymentType = payments?.[0]?.payment_type || 'cash';
    const totalPaid = payments?.reduce((sum, p) => sum + (p.amount || 0), 0) || 0;
    const remaining = (policy.insurance_price || 0) - totalPaid;

    // Generate AB Invoice HTML and upload to Bunny CDN
    const abInvoiceHtml = buildAbInvoiceHtml(policy, payments || [], paymentType, totalPaid, remaining, insuranceFiles || [], policyChildren || [], companySettings, branding);
    
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const timestamp = Date.now();
    const randomId = crypto.randomUUID().slice(0, 8);
    const clientNameSafe = policy.client?.full_name?.replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '_') || 'customer';
    const storagePath = `invoices/${year}/${month}/invoice_${clientNameSafe}_${timestamp}_${randomId}.html`;

    // Upload AB Invoice to Bunny Storage
    const bunnyUploadUrl = buildBunnyStorageUploadUrl(bunnyStorageZone, storagePath);
    
    console.log(`[send-invoice-sms] Uploading AB invoice to: ${bunnyUploadUrl}`);

    const uploadResponse = await fetch(bunnyUploadUrl, {
      method: 'PUT',
      headers: {
        'AccessKey': bunnyApiKey,
        'Content-Type': 'text/html; charset=utf-8',
      },
      body: abInvoiceHtml,
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error('[send-invoice-sms] Bunny upload failed:', errorText);
      return new Response(
        JSON.stringify({ error: 'فشل في رفع الفاتورة' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const abInvoiceUrl = `${bunnyCdnUrl}/${storagePath}`;
    console.log(`[send-invoice-sms] AB Invoice uploaded: ${abInvoiceUrl}`);

    // Build policy file URLs (all uploaded files - could be multiple)
    // Normalize CDN URLs (replace old b-cdn.net with custom domain)
    const sortedPolicyUrls = hasInsuranceFiles 
      ? insuranceFiles.map(f => f.cdn_url.replace('https://basheer-ab.b-cdn.net/', bunnyCdnUrl + '/').replace('https://cdn.basheer-ab.com/', bunnyCdnUrl + '/'))
      : [];
    
    // Build all policy URLs text - each file on separate line with label
    const allPolicyUrlsText = sortedPolicyUrls.length > 0 
      ? sortedPolicyUrls.map((url) => `البوليصة ${url}`).join('\n')
      : '';

    // Skip SMS sending if requested (for print only)
    if (skip_sms) {
      console.log(`[send-invoice-sms] Skipping SMS (skip_sms=true)`);
      
      const duration = Date.now() - startTime;
      console.log(`[send-invoice-sms] Completed in ${duration}ms (print only)`);

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "تم توليد الفاتورة",
          policy_urls: sortedPolicyUrls,
          ab_invoice_url: abInvoiceUrl,
          duration_ms: duration
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build SMS message with ALL files included
    // Default template now includes all files
    let smsMessage = agentSmsRow?.invoice_sms_template ||
      "مرحباً {{client_name}}، تم إصدار وثيقة التأمين\n\n{{all_policy_urls}}\n\nفاتورة شركة التأمين: {{ab_invoice_url}}";

    // If no policy files, provide a simplified message
    const policyUrlsOrMessage = allPolicyUrlsText || '';
    
    // Replace {{insurance_invoice_url}} with ALL policy URLs (user expects all files, not just one)
    // This ensures backward compatibility with existing templates that use this placeholder
    smsMessage = smsMessage
      .replace(/\{\{client_name\}\}/g, policy.client?.full_name || "عميل")
      .replace(/\{\{policy_number\}\}/g, policy.policy_number || "")
      .replace(/\{\{policy_url\}\}/g, sortedPolicyUrls[0] || abInvoiceUrl) // First file for backward compatibility
      .replace(/\{\{all_policy_urls\}\}/g, policyUrlsOrMessage)
      .replace(/\{\{ab_invoice_url\}\}/g, abInvoiceUrl)
      .replace(/\{\{insurance_invoice_url\}\}/g, policyUrlsOrMessage || abInvoiceUrl); // Now sends ALL files, not just first

    // Clean up any double newlines from empty placeholders
    smsMessage = smsMessage.replace(/\n{3,}/g, '\n\n').trim();

    // Append the shared agent footer (owner + phones).
    smsMessage = appendSmsFooter(smsMessage, branding);

    const escapeXml = (value: string) =>
      value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&apos;");

    // Normalize phone for 019sms (expects 05xxxxxxx or 5xxxxxxx)
    let cleanPhone = policy.client.phone_number.replace(/[^0-9]/g, "");
    if (cleanPhone.startsWith("972")) {
      cleanPhone = "0" + cleanPhone.substring(3);
    }

    // Send SMS via 019sms (official XML API)
    const dlr = crypto.randomUUID();
    const smsXml =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<sms>` +
      `<user><username>${escapeXml(smsSettingsData.sms_user || "")}</username></user>` +
      `<source>${escapeXml(smsSettingsData.sms_source || "")}</source>` +
      `<destinations><phone id="${dlr}">${escapeXml(cleanPhone)}</phone></destinations>` +
      `<message>${escapeXml(smsMessage)}</message>` +
      `</sms>`;

    console.log(`[send-invoice-sms] Sending SMS to ${cleanPhone}`);
    console.log(`[send-invoice-sms] Policy URLs: ${sortedPolicyUrls.length} files`);
    console.log(`[send-invoice-sms] AB Invoice URL: ${abInvoiceUrl}`);

    const smsResponse = await fetch("https://019sms.co.il/api", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${smsSettingsData.sms_token}`,
        "Content-Type": "application/xml; charset=utf-8",
      },
      body: smsXml,
    });

    const smsResult = await smsResponse.text();
    console.log("[send-invoice-sms] 019sms raw response:", smsResult);

    const extractTag = (xml: string, tag: string) => {
      const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
      return match?.[1]?.trim() ?? null;
    };

    const status = extractTag(smsResult, "status");
    const apiMessage = extractTag(smsResult, "message");

    if (!smsResponse.ok || status !== "0") {
      console.error(`[send-invoice-sms] SMS failed: status=${status} message=${apiMessage}`);
      return new Response(
        JSON.stringify({ error: apiMessage || `خطأ في إرسال الرسالة (status=${status ?? "unknown"})` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log SMS to sms_logs table
    const { error: logError } = await supabase.from('sms_logs').insert({
      branch_id: policy.branch_id || null,
      client_id: policy.client?.id || null,
      policy_id: policy_id,
      phone_number: cleanPhone,
      message: smsMessage,
      sms_type: 'invoice',
      status: 'sent',
      sent_at: new Date().toISOString(),
    });

    if (logError) {
      console.error("[send-invoice-sms] Error logging SMS:", logError);
    }

    // Track usage for quota enforcement
    await logUsage(supabase, policyAgentId, "sms");

    // Mark as sent
    const { error: updateError } = await supabase
      .from("policies")
      .update({ invoices_sent_at: new Date().toISOString() })
      .eq("id", policy_id);

    if (updateError) {
      console.error("[send-invoice-sms] Error updating policy:", updateError);
    }

    const duration = Date.now() - startTime;
    console.log(`[send-invoice-sms] Completed in ${duration}ms`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "تم إرسال الوثائق عبر الرسائل",
        sent_to: cleanPhone,
        policy_urls: sortedPolicyUrls,
        ab_invoice_url: abInvoiceUrl,
        duration_ms: duration
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    console.error("[send-invoice-sms] Fatal error:", error);
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

function getInsuranceTypeLabel(parent: string, child: string | null): string {
  if (parent === 'THIRD_FULL' && child) {
    const childLabels: Record<string, string> = { THIRD: 'ثالث', FULL: 'شامل' };
    return childLabels[child] || child;
  }
  return POLICY_TYPE_LABELS[parent] || parent;
}

function buildAbInvoiceHtml(
  policy: any,
  payments: any[],
  paymentType: string,
  totalPaid: number,
  remaining: number,
  policyFiles: { cdn_url: string; original_name: string; mime_type: string }[],
  policyChildren: any[] = [],
  companySettings: { company_email?: string; company_phones?: string[]; company_whatsapp?: string; company_location?: string },
  branding: AgentBranding = { companyName: 'وكالة التأمين', companyNameEn: '', logoUrl: null, siteDescription: '' }
): string {
  const client = policy.client || {};
  const car = policy.car || {};
  const company = policy.company || {};
  const broker = policy.broker || {};
  const createdBy = policy.created_by || {};

  const isPaid = remaining <= 0;
  const insuranceType = getInsuranceTypeLabel(policy.policy_type_parent, policy.policy_type_child);
  const carType = CAR_TYPE_LABELS[car.car_type] || car.car_type || '-';
  const paymentLabel = PAYMENT_TYPE_LABELS[paymentType] || paymentType;

  // Build additional drivers HTML section
  const additionalDriversHtml = policyChildren.length > 0 ? `
    <div class="section">
      <div class="section-title">👥 السائقين الإضافيين / التابعين</div>
      <div class="section-content">
        <div class="info-grid">
          ${policyChildren.map(pc => pc.child ? `
            <div class="info-item">
              <span class="info-label">${pc.child.full_name}</span>
              <span class="info-value">${pc.child.id_number}${pc.child.relation ? ` - ${pc.child.relation}` : ''}</span>
            </div>
          ` : '').join('')}
        </div>
      </div>
    </div>
  ` : '';

  // Build payments table rows
  const paymentRows = payments.map((p, i) => `
    <tr>
      <td style="padding: 8px; border: 1px solid #ddd;">${i + 1}</td>
      <td style="padding: 8px; border: 1px solid #ddd;">${formatDate(p.payment_date)}</td>
      <td style="padding: 8px; border: 1px solid #ddd;">${PAYMENT_TYPE_LABELS[p.payment_type] || p.payment_type}</td>
      <td style="padding: 8px; border: 1px solid #ddd;">₪${p.amount?.toLocaleString() || 0}</td>
    </tr>
  `).join('');

  // Build policy files/documents section with lightbox popup for images
  // Normalize CDN URLs
  const normalizedFiles = policyFiles.map(f => ({
    ...f,
    cdn_url: f.cdn_url.replace('https://basheer-ab.b-cdn.net/', bunnyCdnUrl + '/').replace('https://cdn.basheer-ab.com/', bunnyCdnUrl + '/')
  }));
  
  const filesHtml = normalizedFiles.length > 0 ? `
    <div class="section" style="margin-top: 25px;">
      <div class="section-title">ملفات البوليصة</div>
      <div class="section-content">
        <div class="files-grid">
          ${normalizedFiles.map((file, index) => {
            const isImage = file.mime_type?.startsWith('image/');
            const isPdf = file.mime_type === 'application/pdf';
            return `
              <div class="file-item">
                ${isImage ? `
                  <a href="javascript:void(0)" onclick="openLightbox('${file.cdn_url}')" class="file-link">
                    <img src="${file.cdn_url}" alt="${file.original_name}" class="file-preview-image" />
                  </a>
                ` : isPdf ? `
                  <a href="${file.cdn_url}" target="_blank" class="file-link pdf-link">
                    <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                    <span class="pdf-label">PDF</span>
                  </a>
                ` : `
                  <a href="${file.cdn_url}" target="_blank" class="file-link">
                    <div class="file-icon">📎</div>
                  </a>
                `}
                <a href="${file.cdn_url}" target="_blank" class="file-name">${file.original_name}</a>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    </div>
  ` : '';

  // Build contact footer
  const whatsappNormalized = normalizePhoneForWhatsapp(companySettings.company_whatsapp || '');
  const phonesDisplay = companySettings.company_phones?.join(' | ') || '';
  
  const contactFooterHtml = `
    <div class="contact-info">
      ${companySettings.company_email ? `
      <div class="contact-row">
        <span>📧</span>
        <a href="mailto:${companySettings.company_email}">${companySettings.company_email}</a>
      </div>
      ` : ''}
      ${companySettings.company_phones && companySettings.company_phones.length > 0 ? `
      <div class="contact-row">
        <span>📞</span>
        ${companySettings.company_phones.map((phone: string) => 
          `<a href="tel:${phone.replace(/[^0-9+]/g, '')}">${phone}</a>`
        ).join(' | ')}
      </div>
      ` : ''}
      ${companySettings.company_whatsapp ? `
      <div class="contact-row">
        <span>💬</span>
        <a href="https://wa.me/${whatsappNormalized}">${companySettings.company_whatsapp}</a>
      </div>
      ` : ''}
      ${companySettings.company_location ? `
      <div class="contact-row">
        <span>📍</span>
        <span>${companySettings.company_location}</span>
      </div>
      ` : ''}
    </div>
  `;

  return `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap" rel="stylesheet">
  <title>فاتورة - ${client.full_name || 'عميل'}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    @page { size: A4; margin: 15mm; }
    body {
      font-family: 'Tajawal', 'Segoe UI', Tahoma, Arial, sans-serif;
      font-size: 14px;
      line-height: 1.7;
      color: #2d3748;
      background: #122143;
      min-height: 100vh;
      padding: 24px 16px;
      direction: rtl;
    }
    .container { max-width: 800px; margin: 0 auto; background: #ffffff; border-radius: 20px; box-shadow: 0 8px 40px rgba(0,0,0,0.25); overflow: hidden; }
    .header {
      text-align: center;
      margin-bottom: 0;
      padding: 30px 25px;
      background: linear-gradient(135deg, #122143 0%, #1a3260 100%);
      border-radius: 0;
      border-bottom: none;
      color: white;
    }
    .header h1 { 
      color: white; 
      font-size: 32px; 
      font-weight: 800;
      margin-bottom: 8px;
      letter-spacing: 1px;
    }
    .header .english-name {
      color: rgba(255,255,255,0.8);
      font-size: 18px;
      font-weight: 500;
      letter-spacing: 2px;
      margin-bottom: 10px;
    }
    .header p { color: rgba(255,255,255,0.85); font-size: 15px; font-weight: 500; }
    .invoice-meta {
      display: flex;
      justify-content: space-between;
      margin-bottom: 30px;
      background: linear-gradient(135deg, #f7fafc 0%, #edf2f7 100%);
      padding: 20px;
      border-radius: 12px;
      flex-wrap: wrap;
      gap: 15px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.05);
    }
    .invoice-meta div { text-align: center; flex: 1; min-width: 120px; }
    .invoice-meta strong { display: block; color: #1e3a5f; font-size: 13px; margin-bottom: 8px; font-weight: 600; }
    .section { margin-bottom: 28px; }
    .section-title {
      background: linear-gradient(135deg, #1e3a5f 0%, #2d4a6f 100%);
      color: white;
      padding: 12px 18px;
      font-size: 17px;
      font-weight: 700;
      border-radius: 8px 8px 0 0;
      letter-spacing: 0.5px;
    }
    .section-content {
      border: 1px solid #e2e8f0;
      border-top: none;
      padding: 18px;
      border-radius: 0 0 8px 8px;
      background: #fafbfc;
    }
    .info-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
    .info-item {
      display: flex;
      justify-content: space-between;
      padding: 10px 12px;
      border-bottom: 1px dashed #e2e8f0;
      background: white;
      border-radius: 6px;
    }
    .info-item:last-child { border-bottom: none; }
    .info-label { color: #718096; font-weight: 500; }
    .info-value { color: #1e3a5f; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th {
      background: linear-gradient(135deg, #edf2f7 0%, #e2e8f0 100%);
      padding: 12px;
      border: 1px solid #ddd;
      text-align: right;
      font-weight: 700;
      color: #1e3a5f;
    }
    td { padding: 10px 12px; border: 1px solid #e2e8f0; text-align: right; background: white; }
    .total-row { background: #f0f4f8; font-weight: bold; }
    .total-row td { color: #1e3a5f; }
    .status-badge {
      display: inline-block;
      padding: 6px 18px;
      border-radius: 25px;
      font-size: 14px;
      font-weight: 700;
    }
    .status-paid { background: #c6f6d5; color: #22543d; }
    .status-partial { background: #feebc8; color: #744210; }
    .status-unpaid { background: #fed7d7; color: #822727; }
    .summary-box {
      background: linear-gradient(135deg, #1e3a5f 0%, #2d5a8a 100%);
      color: white;
      padding: 25px;
      border-radius: 14px;
      margin-top: 30px;
      box-shadow: 0 4px 15px rgba(30, 58, 95, 0.3);
    }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 25px;
      text-align: center;
    }
    .summary-item strong { display: block; font-size: 13px; opacity: 0.85; margin-bottom: 8px; font-weight: 500; }
    .summary-item span { font-size: 26px; font-weight: 800; }
    .footer {
      margin-top: 45px;
      padding-top: 25px;
      border-top: 2px solid #e2e8f0;
      text-align: center;
      color: #718096;
      font-size: 13px;
    }
    .footer .thank-you {
      font-size: 16px;
      font-weight: 700;
      color: #1e3a5f;
      margin-bottom: 12px;
    }
    .contact-info {
      margin: 15px auto;
      padding: 15px;
      background: #f1f5f9;
      border-radius: 10px;
      display: inline-block;
      text-align: center;
    }
    .contact-row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 5px 0;
      color: #1e3a5f;
      font-size: 13px;
    }
    .contact-row a {
      color: #2563eb;
      text-decoration: none;
    }
    .contact-row a:hover { text-decoration: underline; }
    .action-buttons {
      display: flex;
      gap: 10px;
      justify-content: center;
      flex-wrap: wrap;
      margin-top: 15px;
    }
    .print-button {
      display: inline-block;
      padding: 12px 25px;
      background: linear-gradient(135deg, #1e3a5f 0%, #2d5a8a 100%);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 700;
      cursor: pointer;
      font-family: 'Tajawal', sans-serif;
    }
    .share-button {
      display: inline-block;
      padding: 12px 25px;
      background: linear-gradient(135deg, #25D366 0%, #128C7E 100%);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 700;
      cursor: pointer;
      font-family: 'Tajawal', sans-serif;
    }
    .print-button:hover, .share-button:hover { opacity: 0.9; }
    .signature-section { margin-top: 40px; display: flex; justify-content: center; }
    .signature-box { width: 50%; text-align: center; }
    .signature-line { border-top: 2px solid #1e3a5f; margin-top: 60px; padding-top: 12px; font-weight: 600; color: #1e3a5f; }
    .company-signature { font-family: 'Tajawal', cursive; font-size: 28px; font-weight: 800; color: #1e3a5f; margin-top: 15px; }
    @media print { 
      body { padding: 0; font-size: 12px; } 
      .no-print { display: none !important; }
    }
    @media (max-width: 600px) {
      .info-grid { grid-template-columns: 1fr; }
      .summary-grid { grid-template-columns: 1fr; gap: 12px; }
      .files-grid { grid-template-columns: repeat(2, 1fr); }
    }
    .files-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 15px;
      margin-top: 15px;
    }
    .file-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 12px;
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      transition: all 0.2s;
      cursor: pointer;
    }
    .file-item:hover {
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      transform: translateY(-2px);
    }
    .file-link {
      display: block;
      width: 100%;
      text-align: center;
      cursor: pointer;
    }
    .file-preview-image {
      max-width: 100%;
      max-height: 150px;
      object-fit: contain;
      border-radius: 6px;
      border: 1px solid #e2e8f0;
      cursor: pointer;
    }
    .pdf-link {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100px;
      background: linear-gradient(135deg, #dc2626 0%, #ef4444 100%);
      border-radius: 8px;
      color: white;
      text-decoration: none;
    }
    .pdf-icon { font-size: 36px; }
    .pdf-label { font-size: 14px; font-weight: 700; margin-top: 5px; }
    .file-name {
      font-size: 11px;
      color: #1e3a5f;
      text-align: center;
      word-break: break-word;
      text-decoration: none;
      font-weight: 500;
    }
    .file-name:hover { text-decoration: underline; }
    .file-icon { font-size: 36px; }
    /* Lightbox styles */
    .lightbox-overlay {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.9);
      z-index: 9999;
      justify-content: center;
      align-items: center;
      flex-direction: column;
    }
    .lightbox-overlay.active { display: flex; }
    .lightbox-image {
      max-width: 95%;
      max-height: 85vh;
      object-fit: contain;
      border-radius: 8px;
    }
    .lightbox-close {
      position: absolute;
      top: 20px;
      right: 30px;
      font-size: 40px;
      color: white;
      background: none;
      border: none;
      cursor: pointer;
      z-index: 10000;
    }
    .lightbox-download {
      margin-top: 15px;
      padding: 10px 25px;
      background: #22c55e;
      color: white;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 700;
      display: inline-block;
      z-index: 10000;
    }
    .lightbox-download:hover { opacity: 0.9; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      ${branding.logoUrl ? `<img src="${branding.logoUrl}" alt="${branding.companyName}" style="max-height:60px;object-fit:contain;margin:0 auto 8px auto;display:block;" />` : ''}
      <h1>${branding.companyName}</h1>
      ${branding.companyNameEn ? `<p class="english-name">${branding.companyNameEn}</p>` : ''}
      <p>بوليصة تأمين</p>
    </div>

    <div class="invoice-meta">
      <div>
        <strong>تاريخ الإصدار</strong>
        <span>${formatDate(new Date().toISOString())}</span>
      </div>
      <div>
        <strong>رقم الوثيقة</strong>
        <span>${policy.policy_number || policy.id.slice(0, 8)}</span>
      </div>
      <div>
        <strong>حالة الدفع</strong>
        <span class="status-badge ${isPaid ? 'status-paid' : remaining < (policy.insurance_price || 0) ? 'status-partial' : 'status-unpaid'}">
          ${isPaid ? 'مدفوعة' : remaining < (policy.insurance_price || 0) ? 'مدفوع جزئي' : 'غير مدفوعة'}
        </span>
      </div>
    </div>

    <div class="section">
      <div class="section-title">بيانات العميل</div>
      <div class="section-content">
        <div class="info-grid">
          <div class="info-item">
            <span class="info-label">الاسم الكامل:</span>
            <span class="info-value">${client.full_name || '-'}</span>
          </div>
          <div class="info-item">
            <span class="info-label">رقم الهوية:</span>
            <span class="info-value">${client.id_number || '-'}</span>
          </div>
          <div class="info-item">
            <span class="info-label">رقم الهاتف:</span>
            <span class="info-value">${client.phone_number || '-'}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">بيانات المركبة</div>
      <div class="section-content">
        <div class="info-grid">
          <div class="info-item">
            <span class="info-label">رقم المركبة:</span>
            <span class="info-value">${car.car_number || '-'}</span>
          </div>
          <div class="info-item">
            <span class="info-label">الشركة المصنعة:</span>
            <span class="info-value">${car.manufacturer_name || '-'}</span>
          </div>
          <div class="info-item">
            <span class="info-label">الموديل:</span>
            <span class="info-value">${car.model || '-'}</span>
          </div>
          <div class="info-item">
            <span class="info-label">سنة الصنع:</span>
            <span class="info-value">${car.year || '-'}</span>
          </div>
          <div class="info-item">
            <span class="info-label">نوع المركبة:</span>
            <span class="info-value">${carType}</span>
          </div>
          <div class="info-item">
            <span class="info-label">اللون:</span>
            <span class="info-value">${car.color || '-'}</span>
          </div>
        </div>
      </div>
    </div>

    ${additionalDriversHtml}

    <div class="section">
      <div class="section-title">تفاصيل التأمين</div>
      <div class="section-content">
        <div class="info-grid">
          <div class="info-item">
            <span class="info-label">شركة التأمين:</span>
            <span class="info-value">${company.name_ar || company.name || '-'}</span>
          </div>
          <div class="info-item">
            <span class="info-label">نوع التأمين:</span>
            <span class="info-value">${insuranceType}</span>
          </div>
          <div class="info-item">
            <span class="info-label">تاريخ البداية:</span>
            <span class="info-value">${formatDate(policy.start_date)}</span>
          </div>
          <div class="info-item">
            <span class="info-label">تاريخ الانتهاء:</span>
            <span class="info-value">${formatDate(policy.end_date)}</span>
          </div>
          <div class="info-item">
            <span class="info-label">أقل من 24 سنة:</span>
            <span class="info-value">${policy.is_under_24 ? 'نعم' : 'لا'}</span>
          </div>
          <div class="info-item">
            <span class="info-label">الموظف:</span>
            <span class="info-value">${createdBy.full_name || '-'}</span>
          </div>
        </div>
      </div>
    </div>

    ${payments.length > 0 ? `
    <div class="section">
      <div class="section-title">سجل المدفوعات</div>
      <div class="section-content" style="padding: 0;">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>التاريخ</th>
              <th>طريقة الدفع</th>
              <th>المبلغ</th>
            </tr>
          </thead>
          <tbody>
            ${paymentRows}
            <tr class="total-row">
              <td colspan="3">إجمالي المدفوعات</td>
              <td>₪${totalPaid.toLocaleString()}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    ` : ''}

    <div class="summary-box">
      <div class="summary-grid">
        <div class="summary-item">
          <strong>سعر التأمين</strong>
          <span>₪${(policy.insurance_price || 0).toLocaleString()}</span>
        </div>
        <div class="summary-item">
          <strong>المدفوع</strong>
          <span>₪${totalPaid.toLocaleString()}</span>
        </div>
        <div class="summary-item">
          <strong>المتبقي</strong>
          <span>₪${remaining.toLocaleString()}</span>
        </div>
      </div>
    </div>

    ${filesHtml}

    ${policy.notes ? `
    <div class="section" style="margin-top: 25px;">
      <div class="section-title">ملاحظات</div>
      <div class="section-content">
        <p>${policy.notes}</p>
      </div>
    </div>
    ` : ''}

    <div class="signature-section">
      <div class="signature-box">
        <div class="company-signature">${branding.companyName}</div>
        <div class="signature-line">التوقيع المعتمد</div>
      </div>
    </div>

    <div class="footer">
      <p class="thank-you">شكراً لثقتكم بنا 🙏</p>
      ${contactFooterHtml}
      <p style="margin-top: 10px;">هذه الفاتورة تم إنشاؤها إلكترونياً وهي صالحة بدون توقيع</p>
      <div class="action-buttons no-print">
        <button class="print-button" onclick="window.print()">🖨️ طباعة الفاتورة</button>
        <button class="share-button" onclick="shareInvoice()">📲 مشاركة الفاتورة</button>
      </div>
    </div>
  </div>
  
  <!-- Lightbox Modal -->
  <div class="lightbox-overlay" id="lightbox" onclick="closeLightbox()">
    <button class="lightbox-close" onclick="closeLightbox()">×</button>
    <img src="" alt="صورة مكبرة" class="lightbox-image" id="lightbox-image" onclick="event.stopPropagation()" />
    <a href="" target="_blank" download class="lightbox-download" id="lightbox-download" onclick="event.stopPropagation()">⬇️ تحميل الصورة</a>
  </div>
  
  <script>
    function openLightbox(imageUrl) {
      const overlay = document.getElementById('lightbox');
      const img = document.getElementById('lightbox-image');
      const download = document.getElementById('lightbox-download');
      img.src = imageUrl;
      download.href = imageUrl;
      overlay.classList.add('active');
      document.body.style.overflow = 'hidden';
    }
    
    function closeLightbox() {
      const overlay = document.getElementById('lightbox');
      overlay.classList.remove('active');
      document.body.style.overflow = 'auto';
    }
    
    // Close on Escape key
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') closeLightbox();
    });
    
    function shareInvoice() {
      const currentUrl = window.location.href;
      const shareText = 'فاتورة التأمين: ' + currentUrl;
      if (navigator.share) {
        navigator.share({ title: 'فاتورة التأمين', text: 'فاتورة التأمين الخاصة بك', url: currentUrl }).catch(console.error);
      } else {
        window.open('https://wa.me/?text=' + encodeURIComponent(shareText), '_blank');
      }
    }
  </script>
</body>
</html>
  `.trim();
}
