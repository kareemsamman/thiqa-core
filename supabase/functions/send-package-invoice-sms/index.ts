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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

  // Brand block: agent logo if present, otherwise the Thiqa wordmark SVG.
  // Inline SVG (just the path data — kept tiny by stripping the icon pattern).
  const thiqaLogoSvg = `<svg class="logo logo-svg" viewBox="38 0 117 41" xmlns="http://www.w3.org/2000/svg" aria-label="Thiqa"><path d="M38.9929 0.762817H61.7057V4.06803H52.2561V30.5098H48.6119V4.06803H38.9929V0.762817ZM66.0596 7.47764e-05H69.492V13.3481C70.509 11.0175 73.6871 8.55974 77.2889 8.55974C83.179 8.55974 85.3401 12.3311 85.3401 18.1788V30.5098H81.9501V18.772C81.9501 14.5769 80.5094 11.8226 76.3143 11.8226C73.0514 11.8226 69.7886 14.4922 69.492 17.9669V30.5098H66.0596V7.47764e-05ZM93.2565 0.42382C94.4006 0.42382 95.3329 1.44081 95.3329 2.54255C95.3329 3.72904 94.4006 4.66128 93.2565 4.66128C92.0276 4.66128 91.0954 3.72904 91.0954 2.54255C91.0954 1.44081 91.9853 0.42382 93.2565 0.42382ZM91.4344 9.02586H94.8667V30.5098H91.4344V9.02586ZM119.954 13.5176V9.02586H123.387V40.044H119.954V26.0181C118.387 29.069 115.505 30.9759 111.649 30.9759C105.335 30.9759 100.759 26.2723 100.759 19.8737V19.789C100.759 13.3904 105.293 8.55974 111.649 8.55974C115.505 8.55974 118.387 10.4666 119.954 13.5176ZM119.573 19.8314V19.7466C119.573 15.0854 116.056 11.865 111.861 11.865C107.623 11.865 104.233 15.0854 104.233 19.7466V19.8314C104.233 24.4502 107.751 27.713 111.946 27.713C116.183 27.713 119.573 24.4502 119.573 19.8314ZM147.548 14.4498V9.02586H150.98V30.5098H147.548V25.1282C146.234 28.73 143.31 30.9759 138.819 30.9759C132.547 30.9759 128.437 26.1028 128.437 19.8314V19.7466C128.437 13.4752 132.547 8.55974 138.776 8.55974C143.268 8.55974 146.192 10.7632 147.548 14.4498ZM139.624 27.713C143.861 27.6707 147.251 24.3655 147.251 19.7042C147.251 15.1702 144.031 11.8226 139.539 11.8226C135.132 11.8226 131.996 15.1702 131.996 19.7042V19.789C131.996 24.4078 135.344 27.6707 139.624 27.713Z" fill="currentColor"/></svg>`;
  const brandBlock = branding.logoUrl
    ? `<img class="logo" src="${branding.logoUrl}" alt="${branding.companyName}" />`
    : thiqaLogoSvg;

  // Group additional drivers per policy so each item row can show its own.
  const driversByPolicy: Record<string, string[]> = {};
  policyChildren.forEach((pc: any) => {
    const name = pc?.child?.full_name;
    if (!name || !pc.policy_id) return;
    if (!driversByPolicy[pc.policy_id]) driversByPolicy[pc.policy_id] = [];
    driversByPolicy[pc.policy_id].push(name);
  });

  // Unique car numbers across all policies in this invoice.
  const carNumbers = Array.from(new Set(
    policies.map((p: any) => p.car?.car_number).filter(Boolean)
  )).join('، ');

  // Smarter invoice title based on the policy types in this package.
  const policyTypeKinds = new Set<string>();
  policies.forEach((p: any) => {
    if (p.policy_type_parent === 'ROAD_SERVICE') policyTypeKinds.add('road');
    else if (p.policy_type_parent === 'ACCIDENT_FEE_EXEMPTION') policyTypeKinds.add('accident_fee');
    else policyTypeKinds.add('insurance');
  });
  let invoiceTitle = 'فاتورة';
  let invoiceSubtitle = '';
  if (policyTypeKinds.size === 1) {
    if (policyTypeKinds.has('insurance')) invoiceSubtitle = 'تأمين سيارة';
    else if (policyTypeKinds.has('road')) invoiceSubtitle = 'خدمات الطريق';
    else if (policyTypeKinds.has('accident_fee')) invoiceSubtitle = 'إعفاء رسوم';
  } else {
    invoiceSubtitle = 'وثائق التأمين والخدمات';
  }

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

    // Car details: "Toyota Corolla 2020 — سيارة خاصة"
    const carParts: string[] = [];
    if (p.car?.manufacturer_name) carParts.push(p.car.manufacturer_name);
    if (p.car?.model) carParts.push(p.car.model);
    if (p.car?.year) carParts.push(String(p.car.year));
    const carTypeLabel = p.car?.car_type ? CAR_TYPE_LABELS[p.car.car_type] || '' : '';
    const carDetails = carParts.join(' ') + (carTypeLabel ? ` — ${carTypeLabel}` : '');
    const carDetailsLine = carDetails.trim()
      ? `<div class="item-meta">${carDetails}</div>`
      : '';

    // Period
    const periodLine = (p.start_date && p.end_date)
      ? `<div class="item-period">المدة: ${formatDate(p.start_date)} → ${formatDate(p.end_date)}</div>`
      : '';

    const policyDrivers = driversByPolicy[p.id] || [];
    const driversLine = policyDrivers.length > 0
      ? `<div class="item-drivers">سائقون إضافيون: ${policyDrivers.join('، ')}</div>`
      : '';

    return `
      <tr>
        <td class="num">${i + 1}</td>
        <td>
          <div class="item-title">${policyType}${carLine}</div>
          <div class="item-meta">${companyName}</div>
          ${carDetailsLine}
          ${periodLine}
          ${driversLine}
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

  // Contact footer — prefer values explicitly set in branding settings,
  // fall back to the SMS settings row so existing agents still see contact
  // info without needing to re-enter it.
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

  return `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>فاتورة - ${client.full_name || 'عميل'}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@300;400;500;600;700&display=swap');

    * { box-sizing: border-box; margin: 0; padding: 0; }
    @page { size: A4; margin: 14mm; }
    html, body {
      font-family: 'IBM Plex Sans Arabic', 'Tajawal', system-ui, -apple-system, 'Segoe UI', sans-serif;
      font-size: 13px;
      line-height: 1.6;
      color: #000;
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
      border: 1.5px solid #000;
    }
    a { color: inherit; text-decoration: none; }
    a:hover { color: #18181b; }

    /* ── Header ── */
    .invoice-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 24px;
      padding-bottom: 22px;
      border-bottom: 1.5px solid #000;
      margin-bottom: 24px;
    }
    .brand { max-width: 55%; }
    .brand .logo {
      max-height: 64px;
      max-width: 220px;
      object-fit: contain;
      display: block;
      margin-bottom: 10px;
    }
    .brand .logo-svg {
      height: 38px;
      width: auto;
      display: block;
      margin-bottom: 10px;
      color: #000;
    }
    .brand .name { font-size: 15px; font-weight: 700; color: #000; }
    .brand .tagline { font-size: 12px; color: #52525b; margin-top: 2px; font-weight: 400; }
    .brand .address { font-size: 12px; color: #52525b; margin-top: 8px; max-width: 320px; line-height: 1.55; }

    .invoice-meta { text-align: left; min-width: 240px; }
    .invoice-meta h1 {
      font-size: 30px;
      font-weight: 700;
      letter-spacing: 0.5px;
      margin-bottom: 14px;
      color: #000;
      line-height: 1;
    }
    .meta-rows {
      width: 100%;
      border: 1.5px solid #000;
      font-size: 12px;
    }
    .meta-rows .row { display: flex; }
    .meta-rows .row + .row { border-top: 1px solid #000; }
    .meta-rows .label {
      flex: 0 0 110px;
      padding: 7px 12px;
      background: #f4f4f5;
      font-weight: 600;
      color: #18181b;
      font-size: 11.5px;
      text-align: right;
      border-left: 1px solid #000;
      letter-spacing: 0.3px;
    }
    .meta-rows .val {
      flex: 1;
      padding: 7px 12px;
      text-align: left;
      direction: ltr;
      font-weight: 700;
      color: #000;
      font-variant-numeric: tabular-nums;
    }

    /* ── Customer info ── */
    .customer {
      margin-bottom: 20px;
      border: 1.5px solid #000;
    }
    .section-title {
      padding: 8px 14px;
      border-bottom: 1.5px solid #000;
      background: #f4f4f5;
      font-size: 11px;
      font-weight: 700;
      color: #000;
      letter-spacing: 1.5px;
      text-transform: uppercase;
    }
    .customer-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
    }
    .customer-grid .cell {
      padding: 9px 14px;
    }
    .customer-grid .cell:nth-child(odd) { border-left: 1px solid #000; }
    .customer-grid .cell:nth-child(n+3) { border-top: 1px solid #000; }
    .customer-grid .cell.full { grid-column: 1 / -1; }
    .customer-grid .label {
      font-size: 10px;
      font-weight: 600;
      color: #52525b;
      margin-bottom: 3px;
      letter-spacing: 0.8px;
      text-transform: uppercase;
    }
    .customer-grid .value {
      font-size: 14px;
      font-weight: 700;
      color: #000;
    }
    .customer-grid .value.tabular {
      font-variant-numeric: tabular-nums;
      direction: ltr;
      text-align: right;
    }

    /* ── Items table ── */
    .items {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
      border: 1.5px solid #000;
    }
    .items thead th {
      background: #f4f4f5;
      color: #000;
      padding: 8px 12px;
      text-align: right;
      font-size: 11px;
      letter-spacing: 1.5px;
      font-weight: 700;
      text-transform: uppercase;
      border-bottom: 1.5px solid #000;
      border-left: 1px solid #000;
    }
    .items thead th:last-child { border-left: none; }
    .items tbody td {
      padding: 9px 12px;
      border-top: 1px solid #000;
      border-left: 1px solid #000;
      font-size: 13px;
      color: #000;
      text-align: right;
      vertical-align: top;
    }
    .items tbody td:last-child { border-left: none; }
    .items tbody tr:first-child td { border-top: none; }
    .items tbody td.num {
      text-align: left;
      direction: ltr;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
      font-weight: 700;
      color: #000;
    }
    .items tbody .item-title { font-weight: 700; font-size: 14px; color: #000; }
    .items tbody .item-meta { color: #52525b; font-size: 11.5px; margin-top: 2px; font-weight: 500; }
    .items tbody .item-period {
      color: #18181b;
      font-size: 11.5px;
      margin-top: 4px;
      font-weight: 600;
      direction: ltr;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .items tbody .item-drivers {
      color: #18181b;
      font-size: 11.5px;
      margin-top: 5px;
      padding-top: 4px;
      border-top: 1px dashed #a1a1aa;
      font-weight: 500;
    }

    /* ── Privacy / terms ── */
    .privacy {
      margin-bottom: 20px;
      border: 1.5px solid #000;
    }
    .privacy .body {
      padding: 11px 14px;
      font-size: 12px;
      color: #18181b;
      line-height: 1.7;
      white-space: pre-wrap;
    }

    /* ── Brand subtitle / owner / tax ── */
    .invoice-meta .subtitle {
      font-size: 12px;
      font-weight: 500;
      color: #52525b;
      margin-top: -8px;
      margin-bottom: 14px;
      letter-spacing: 0.5px;
    }
    .brand .owner {
      font-size: 12px;
      color: #27272a;
      margin-top: 4px;
      font-weight: 600;
    }
    .brand .tax {
      font-size: 12px;
      color: #52525b;
      margin-top: 2px;
      direction: ltr;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    /* ── Bottom row ── */
    .bottom {
      display: flex;
      justify-content: space-between;
      gap: 18px;
      align-items: stretch;
      margin-bottom: 20px;
    }
    .notes {
      flex: 1;
      font-size: 12px;
      display: flex;
      flex-direction: column;
      border: 1.5px solid #000;
    }
    .notes .body {
      padding: 11px 14px;
      flex: 1;
      min-height: 120px;
    }
    .notes-line { margin-bottom: 5px; color: #000; }
    .notes-line.muted { color: #71717a; }
    .notes-list {
      list-style: none;
      padding: 0;
      margin: 5px 0 0 0;
    }
    .notes-list li {
      padding: 5px 0;
      border-bottom: 1px dashed #a1a1aa;
      font-size: 12px;
      color: #18181b;
      font-variant-numeric: tabular-nums;
    }
    .notes-list li:last-child { border-bottom: none; }

    .totals {
      width: 290px;
      border-collapse: collapse;
      font-size: 13px;
      align-self: flex-start;
      border: 1.5px solid #000;
    }
    .totals td {
      padding: 9px 14px;
      border-top: 1px solid #000;
      border-left: 1px solid #000;
    }
    .totals tr:first-child td { border-top: none; }
    .totals td:last-child { border-left: none; }
    .totals td.label {
      font-weight: 600;
      background: #f4f4f5;
      color: #000;
      font-size: 11.5px;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }
    .totals td.val {
      text-align: left;
      direction: ltr;
      font-weight: 700;
      color: #000;
      font-variant-numeric: tabular-nums;
    }
    .totals tr.total td {
      font-weight: 800;
      background: #000;
      color: #fff;
      font-size: 15px;
      border-top: 1.5px solid #000;
      padding: 12px 14px;
    }
    .totals tr.total td.label {
      text-transform: uppercase;
      font-size: 12px;
      letter-spacing: 0.5px;
    }
    .totals tr.total td.val { color: #fff; }

    /* ── Files ── */
    .files-section { margin-bottom: 22px; }
    .section-label {
      font-weight: 700;
      font-size: 11px;
      color: #000;
      padding: 7px 0;
      border-bottom: 1.5px solid #000;
      margin-bottom: 12px;
      letter-spacing: 1.5px;
      text-transform: uppercase;
    }
    .files-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
    }
    .file-link {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      padding: 9px;
      border: 1px solid #000;
      font-size: 10.5px;
      text-align: center;
      word-break: break-word;
      background: #fff;
      color: #18181b;
    }
    .file-link:hover { background: #f4f4f5; }
    .file-link img {
      max-width: 100%;
      max-height: 88px;
      object-fit: contain;
    }
    .file-placeholder {
      width: 100%;
      height: 68px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid #000;
      font-weight: 700;
      font-size: 12px;
      letter-spacing: 1px;
      color: #fff;
      background: #000;
    }

    /* ── Footer ── */
    .footer {
      margin-top: 28px;
      padding-top: 18px;
      border-top: 1.5px solid #000;
      text-align: center;
      font-size: 12px;
    }
    .footer .thanks {
      font-weight: 700;
      font-size: 14px;
      color: #000;
      margin-bottom: 8px;
      letter-spacing: 0.3px;
    }
    .footer .contact { color: #18181b; margin-top: 8px; font-weight: 500; line-height: 1.7; }
    .footer .contact a { color: #18181b; }
    .footer .issued {
      color: #71717a;
      margin-top: 10px;
      font-size: 11px;
      font-variant-numeric: tabular-nums;
    }

    /* ── Actions ── */
    .actions {
      text-align: center;
      margin-top: 28px;
    }
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
        border: 1.5px solid #000;
      }
      .items thead th,
      .meta-rows .label,
      .section-title,
      .totals td.label,
      .totals tr.total td,
      .file-placeholder {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }

    @media (max-width: 640px) {
      body { padding: 14px 8px; font-size: 12px; }
      .invoice { padding: 24px 20px; }
      .invoice-top { flex-direction: column; gap: 18px; }
      .invoice-meta { text-align: right; min-width: 0; }
      .invoice-meta h1 { font-size: 24px; }
      .customer-grid { grid-template-columns: 1fr; }
      .customer-grid .cell:nth-child(odd) { border-left: none; }
      .customer-grid .cell:nth-child(n+2) { border-top: 1px solid #f4f4f5; }
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
        ${branding.ownerName ? `<div class="owner">${branding.ownerName}</div>` : ''}
        ${branding.taxNumber ? `<div class="tax">رقم المشغل: ${branding.taxNumber}</div>` : ''}
        ${branding.siteDescription ? `<div class="tagline">${branding.siteDescription}</div>` : ''}
        ${effectiveAddress ? `<div class="address">${effectiveAddress}</div>` : ''}
      </div>
      <div class="invoice-meta">
        <h1>${invoiceTitle}</h1>
        ${invoiceSubtitle ? `<div class="subtitle">${invoiceSubtitle}</div>` : ''}
        <div class="meta-rows">
          <div class="row">
            <div class="label">التاريخ</div>
            <div class="val">${formatDate(today.toISOString())}</div>
          </div>
          <div class="row">
            <div class="label">رقم الفاتورة</div>
            <div class="val">${invoiceNumber}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Customer info -->
    <div class="customer">
      <div class="section-title">معلومات العميل</div>
      <div class="customer-grid">
        <div class="cell">
          <div class="label">الاسم</div>
          <div class="value">${client.full_name || '-'}</div>
        </div>
        <div class="cell">
          <div class="label">رقم الهوية</div>
          <div class="value tabular">${client.id_number || '-'}</div>
        </div>
        <div class="cell">
          <div class="label">رقم الهاتف</div>
          <div class="value tabular">${client.phone_number || '-'}</div>
        </div>
        <div class="cell">
          <div class="label">${policies.length > 1 ? 'السيارات' : 'السيارة'}</div>
          <div class="value tabular">${carNumbers || '-'}</div>
        </div>
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
        <div class="section-title">ملاحظات</div>
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

    ${branding.invoicePrivacyText ? `
    <div class="privacy">
      <div class="section-title">سياسة الخصوصية والشروط</div>
      <div class="body">${escapeHtml(branding.invoicePrivacyText)}</div>
    </div>
    ` : ''}

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
