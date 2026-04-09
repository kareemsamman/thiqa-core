import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import { buildBunnyStorageUploadUrl, normalizeBunnyCdnUrl, resolveBunnyStorageZone } from "../_shared/bunny-storage.ts";
import { getAgentBranding, resolveAgentId, type AgentBranding } from "../_shared/agent-branding.ts";

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

    // Fetch SMS settings for this agent
    const packageAgentId = policies?.[0]?.agent_id;
    const { data: smsSettingsData, error: smsSettingsError } = await supabase
      .from("sms_settings")
      .select("*")
      .eq("agent_id", packageAgentId)
      .maybeSingle();

    if (smsSettingsError) {
      console.error("[send-package-invoice-sms] Error fetching SMS settings:", smsSettingsError);
    }

    // For SMS sending, require enabled settings
    if (!skip_sms) {
      if (!smsSettingsData || !smsSettingsData.is_enabled) {
        return new Response(
          JSON.stringify({ error: "خدمة الرسائل غير مفعلة" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const companySettings = {
      company_email: smsSettingsData?.company_email || '',
      company_phones: smsSettingsData?.company_phones || [],
      company_whatsapp: smsSettingsData?.company_whatsapp || '',
      company_location: smsSettingsData?.company_location || '',
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
  const isPaid = remaining <= 0;

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

  // Build files HTML section with lightbox for images
  // Normalize CDN URLs
  const normalizedFiles = policyFiles.map(f => ({
    ...f,
    cdn_url: f.cdn_url.replace('https://basheer-ab.b-cdn.net/', bunnyCdnUrl + '/').replace('https://cdn.basheer-ab.com/', bunnyCdnUrl + '/')
  }));
  
  const filesHtml = normalizedFiles.length > 0 ? `
    <div class="section">
      <div class="section-title">📄 ملفات البوليصة</div>
      <div class="section-content">
        <div class="files-grid">
          ${normalizedFiles.map((file) => {
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
                    <div class="pdf-icon">📄</div>
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

  // Build policy rows
  const policyRows = policies.map((p, i) => {
    const policyPayments = paymentsByPolicy[p.id] || [];
    const policyPaid = policyPayments.reduce((sum: number, pay: any) => sum + (pay.amount || 0), 0);
    const policyRemaining = (p.insurance_price || 0) - policyPaid;
    
    // Use policy_type_child for THIRD_FULL, road service name for ROAD_SERVICE, etc.
    let policyType = '';
    if (p.policy_type_parent === 'ROAD_SERVICE' && p.road_service) {
      policyType = `خدمات الطريق - ${(p.road_service as any).name_ar || (p.road_service as any).name || ''}`;
    } else if (p.policy_type_parent === 'ACCIDENT_FEE_EXEMPTION' && p.accident_fee_service) {
      policyType = `إعفاء رسوم - ${(p.accident_fee_service as any).name_ar || (p.accident_fee_service as any).name || ''}`;
    } else if (p.policy_type_child && POLICY_TYPE_LABELS[p.policy_type_child]) {
      // Use child type (THIRD or FULL) when available
      policyType = POLICY_TYPE_LABELS[p.policy_type_child];
    } else {
      policyType = POLICY_TYPE_LABELS[p.policy_type_parent] || p.policy_type_parent;
    }
    
    return `
      <tr>
        <td style="padding: 12px; border: 1px solid #e2e8f0;">${i + 1}</td>
        <td style="padding: 12px; border: 1px solid #e2e8f0;">${policyType}</td>
        <td style="padding: 12px; border: 1px solid #e2e8f0;">${p.company?.name_ar || p.company?.name || '-'}</td>
        <td style="padding: 12px; border: 1px solid #e2e8f0;">${p.car?.car_number || '-'}</td>
        <td style="padding: 12px; border: 1px solid #e2e8f0;">₪${(p.insurance_price || 0).toLocaleString()}</td>
        <td style="padding: 12px; border: 1px solid #e2e8f0; color: #22c55e;">₪${policyPaid.toLocaleString()}</td>
        <td style="padding: 12px; border: 1px solid #e2e8f0; color: ${policyRemaining > 0 ? '#ef4444' : '#22c55e'};">₪${policyRemaining.toLocaleString()}</td>
      </tr>
    `;
  }).join('');

  // Build all payments table - for packages, merge all payments without showing policy column
  const allPaymentsRows: string[] = [];
  const allPaymentsList: any[] = [];
  policies.forEach(p => {
    const policyPayments = paymentsByPolicy[p.id] || [];
    policyPayments.forEach(pay => allPaymentsList.push(pay));
  });
  
  // Sort by payment date
  allPaymentsList.sort((a, b) => new Date(a.payment_date).getTime() - new Date(b.payment_date).getTime());
  
  allPaymentsList.forEach((pay) => {
    allPaymentsRows.push(`
      <tr>
        <td style="padding: 10px; border: 1px solid #e2e8f0;">${formatDate(pay.payment_date)}</td>
        <td style="padding: 10px; border: 1px solid #e2e8f0;">${PAYMENT_TYPE_LABELS[pay.payment_type] || pay.payment_type}</td>
        <td style="padding: 10px; border: 1px solid #e2e8f0;">₪${(pay.amount || 0).toLocaleString()}</td>
      </tr>
    `);
  });

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
  <title>فاتورة باقة - ${client.full_name || 'عميل'}</title>
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
    .container-body { padding: 24px 30px; }
    .header {
      text-align: center;
      margin-bottom: 0;
      padding: 30px 20px;
      background: linear-gradient(135deg, #122143 0%, #1a3260 100%);
      border-radius: 0;
      border-bottom: none;
      color: white;
    }
    .header h1 { color: white; font-size: 26px; font-weight: 800; margin-bottom: 8px; }
    .header .english-name { color: rgba(255,255,255,0.8); font-size: 16px; font-weight: 500; letter-spacing: 2px; margin-bottom: 10px; }
    .header p { color: rgba(255,255,255,0.85); font-size: 14px; }
    .package-badge {
      display: inline-block;
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      color: white;
      padding: 8px 20px;
      border-radius: 20px;
      font-weight: 700;
      margin-top: 15px;
    }
    .summary-cards {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 25px;
      flex-wrap: wrap;
    }
    .summary-card {
      flex: 1;
      min-width: 100px;
      text-align: center;
      padding: 16px 12px;
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.05);
    }
    .summary-card.total { background: linear-gradient(135deg, #f0f4f8 0%, #e2e8f0 100%); }
    .summary-card.paid { background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%); }
    .summary-card.remaining { background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%); }
    .summary-card strong { display: block; font-size: 12px; color: #4a5568; margin-bottom: 6px; }
    .summary-card .value { font-size: 20px; font-weight: 800; }
    .summary-card.total .value { color: #1e3a5f; }
    .summary-card.paid .value { color: #059669; }
    .summary-card.remaining .value { color: #dc2626; }
    .section { margin-bottom: 24px; }
    .section-title {
      background: linear-gradient(135deg, #1e3a5f 0%, #2d4a6f 100%);
      color: white;
      padding: 10px 16px;
      font-size: 15px;
      font-weight: 700;
      border-radius: 8px 8px 0 0;
    }
    .section-content {
      border: 1px solid #e2e8f0;
      border-top: none;
      padding: 16px;
      border-radius: 0 0 8px 8px;
      background: #ffffff;
    }
    .info-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
    .info-item {
      display: flex;
      justify-content: space-between;
      padding: 8px 10px;
      background: white;
      border-radius: 6px;
      border-bottom: 1px dashed #e2e8f0;
    }
    .info-label { color: #718096; font-weight: 500; font-size: 13px; }
    .info-value { color: #1e3a5f; font-weight: 700; font-size: 13px; }
    .table-wrapper {
      width: 100%;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
    }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; min-width: 500px; }
    th {
      background: linear-gradient(135deg, #edf2f7 0%, #e2e8f0 100%);
      padding: 10px 8px;
      border: 1px solid #ddd;
      text-align: right;
      font-weight: 700;
      color: #1e3a5f;
      font-size: 12px;
      white-space: nowrap;
    }
    td { 
      padding: 8px; 
      border: 1px solid #e2e8f0; 
      text-align: right; 
      background: white; 
      font-size: 12px;
      white-space: nowrap;
    }
    .total-row { background: #f0f4f8; font-weight: bold; }
    .status-badge {
      display: inline-block;
      padding: 6px 16px;
      border-radius: 20px;
      font-weight: 700;
      font-size: 13px;
    }
    .status-paid { background: #d1fae5; color: #065f46; }
    .status-partial { background: #fef3c7; color: #92400e; }
    .status-unpaid { background: #fee2e2; color: #991b1b; }
    .footer {
      text-align: center;
      margin-top: 30px;
      padding-top: 20px;
      border-top: 2px solid #e2e8f0;
      color: #718096;
      font-size: 12px;
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
    .signature { text-align: left; margin-top: 15px; font-style: italic; color: #1e3a5f; font-weight: 600; }
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
      max-height: 120px;
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
      height: 80px;
      background: linear-gradient(135deg, #dc2626 0%, #ef4444 100%);
      border-radius: 8px;
      color: white;
      text-decoration: none;
    }
    .pdf-icon { font-size: 28px; }
    .pdf-label { font-size: 12px; font-weight: 700; margin-top: 4px; }
    .file-name {
      font-size: 10px;
      color: #1e3a5f;
      text-align: center;
      word-break: break-word;
      text-decoration: none;
      font-weight: 500;
    }
    .file-name:hover { text-decoration: underline; }
    .file-icon { font-size: 28px; }
    /* Lightbox styles */
    .lightbox-overlay {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.9);
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
    @media print { .no-print { display: none !important; } }
    @media (max-width: 600px) {
      body { padding: 12px; }
      .header { padding: 20px 15px; }
      .header h1 { font-size: 22px; }
      .summary-cards { flex-direction: column; gap: 10px; }
      .summary-card { min-width: auto; }
      .summary-card .value { font-size: 18px; }
      .info-grid { grid-template-columns: 1fr; }
      .section-content { padding: 12px; }
      .section-title { padding: 8px 12px; font-size: 14px; }
      .files-grid { grid-template-columns: repeat(2, 1fr); gap: 10px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      ${branding.logoUrl ? `<img src="${branding.logoUrl}" alt="${branding.companyName}" style="max-height:60px;object-fit:contain;margin:0 auto 8px auto;display:block;" />` : ''}
      <h1>${branding.companyName}</h1>
      ${branding.companyNameEn ? `<p class="english-name">${branding.companyNameEn}</p>` : ''}
      <p>فاتورة باقة تأمين</p>
      <div class="package-badge">📦 باقة ${policies.length} وثائق</div>
    </div>

    <div class="container-body">
    <div class="summary-cards">
      <div class="summary-card total">
        <strong>إجمالي الباقة</strong>
        <div class="value">₪${totalPrice.toLocaleString()}</div>
      </div>
      <div class="summary-card paid">
        <strong>المدفوع</strong>
        <div class="value">₪${totalPaid.toLocaleString()}</div>
      </div>
      <div class="summary-card remaining">
        <strong>المتبقي</strong>
        <div class="value">₪${remaining.toLocaleString()}</div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">📋 بيانات العميل</div>
      <div class="section-content">
        <div class="info-grid">
          <div class="info-item">
            <span class="info-label">الاسم</span>
            <span class="info-value">${client.full_name || '-'}</span>
          </div>
          <div class="info-item">
            <span class="info-label">رقم الهوية</span>
            <span class="info-value">${client.id_number || '-'}</span>
          </div>
        </div>
      </div>
    </div>

    ${additionalDriversHtml}

    <div class="section">
      <div class="section-title">📦 وثائق الباقة</div>
      <div class="section-content">
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>نوع التأمين</th>
                <th>الشركة</th>
                <th>السيارة</th>
                <th>السعر</th>
                <th>المدفوع</th>
                <th>المتبقي</th>
              </tr>
            </thead>
            <tbody>
              ${policyRows}
              <tr class="total-row">
                <td colspan="4" style="text-align: center; font-weight: bold;">الإجمالي</td>
                <td style="font-weight: bold;">₪${totalPrice.toLocaleString()}</td>
                <td style="font-weight: bold; color: #22c55e;">₪${totalPaid.toLocaleString()}</td>
                <td style="font-weight: bold; color: ${remaining > 0 ? '#ef4444' : '#22c55e'};">₪${remaining.toLocaleString()}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    ${allPaymentsRows.length > 0 ? `
    <div class="section">
      <div class="section-title">💳 سجل الدفعات</div>
      <div class="section-content">
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>طريقة الدفع</th>
                <th>المبلغ</th>
              </tr>
            </thead>
            <tbody>
              ${allPaymentsRows.join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
    ` : ''}

    ${filesHtml}

    <div class="section">
      <div class="section-title">📊 حالة الدفع</div>
      <div class="section-content" style="text-align: center; padding: 30px;">
        <span class="status-badge ${isPaid ? 'status-paid' : remaining < totalPrice ? 'status-partial' : 'status-unpaid'}">
          ${isPaid ? '✓ مدفوعة بالكامل' : remaining < totalPrice ? `⏳ مدفوع جزئياً (${Math.round((totalPaid / totalPrice) * 100)}%)` : '⏱️ غير مدفوعة'}
        </span>
      </div>
    </div>

    <div class="footer">
      <p class="thank-you">شكراً لثقتكم بنا 🙏</p>
      ${contactFooterHtml}
      <p style="margin-top: 10px;">تاريخ الإصدار: ${formatDate(new Date().toISOString())}</p>
      <p class="signature">${branding.companyName}</p>
      <div class="action-buttons no-print">
        <button class="print-button" onclick="window.print()">🖨️ طباعة الفاتورة</button>
        <button class="share-button" onclick="shareInvoice()">📲 مشاركة الفاتورة</button>
      </div>
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
      const shareText = 'فاتورة باقة التأمين: ' + currentUrl;
      if (navigator.share) {
        navigator.share({ title: 'فاتورة باقة التأمين', text: 'فاتورة باقة التأمين الخاصة بك', url: currentUrl }).catch(console.error);
      } else {
        window.open('https://wa.me/?text=' + encodeURIComponent(shareText), '_blank');
      }
    }
  </script>
</body>
</html>
  `;
}
