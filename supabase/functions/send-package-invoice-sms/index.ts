import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import { buildBunnyStorageUploadUrl, normalizeBunnyCdnUrl, resolveBunnyStorageZone } from "../_shared/bunny-storage.ts";
import { getAgentBranding, resolveAgentId, DEFAULT_BRANDING, type AgentBranding } from "../_shared/agent-branding.ts";
import { appendSmsFooter } from "../_shared/sms-footer.ts";
import { THIQA_LOGO_SVG } from "../_shared/thiqa-logo.ts";
import { resolveSmsSettings } from "../_shared/sms-settings.ts";
import { sendSms, normalizePhoneFor } from "../_shared/sms-sender.ts";
import { checkUsageLimit, limitReachedResponse, logUsage } from "../_shared/usage-limits.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface SendPackageInvoiceSmsRequest {
  policy_ids: string[];
  skip_sms?: boolean;
  // When true, build the same message body that an SMS would carry, but
  // do NOT actually send anything. Returns the message text + a
  // wa.me-ready phone so the client can open WhatsApp with the prefilled
  // text instead. Skips SMS settings/quota and does not mark the policy
  // as sent.
  whatsapp_mode?: boolean;
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
  visa_external: 'فيزا خارجي',
  transfer: 'تحويل',
};

// Minimal bank registry — mirrors src/lib/banks.ts so the printed
// invoice can resolve a stored bank_code to an Arabic name under
// each cheque row in the payments table. Unknown codes pass
// through as the raw code string.
const BANK_LABELS: Record<string, string> = {
  "01": "ماكس إت فايننشلز",
  "02": "بنك بوعلي أغودات يسرائيل (فاغي)",
  "04": "بنك يهاف",
  "05": "يسراكارت",
  "06": "بنك أدانيم",
  "07": "كال - بطاقات ائتمان لإسرائيل",
  "08": "بنك هسفنوت",
  "09": "بنك البريد",
  "10": "بنك لئومي",
  "11": "بنك ديسكونت",
  "12": "بنك هبوعليم",
  "13": "بنك إيغود",
  "14": "بنك أوتسار هحيال",
  "17": "بنك مركنتيل ديسكونت",
  "18": "وان زيرو - البنك الرقمي الأول",
  "20": "بنك مزراحي طفحوت",
  "22": "سيتي بنك",
  "23": "HSBC",
  "24": "بنك هبوعليم (الأمريكي الإسرائيلي سابقاً)",
  "25": "BNP Paribas إسرائيل",
  "26": "يو بنك",
  "27": "باركليز بنك",
  "28": "هبوعليم (كونتيننتال سابقاً)",
  "30": "البنك للتجارة",
  "31": "البنك الدولي الأول لإسرائيل",
  "32": "بنك للتمويل والتجارة",
  "33": "بنك ديسكونت (مركنتيل سابقاً)",
  "34": "البنك العربي الإسرائيلي",
  "37": "بنك الأردن",
  "38": "البنك التجاري الفلسطيني",
  "39": "بنك الدولة الهندي (SBI)",
  "43": "البنك الأهلي الأردني",
  "46": "بنك مسد",
  "48": "بنك أوتسار هحيال (عوفيد لئومي سابقاً)",
  "49": "البنك العربي",
  "50": "مسب - مركز المقاصة البنكي",
  "52": "بنك بوعلي أغودات يسرائيل (فاغي)",
  "54": "بنك القدس (يروشلايم)",
  "59": "شبا - خدمات بنكية آلية",
  "60": "كاردكوم",
  "61": "ترانزيلا",
  "65": "حيسخ - صندوق توفير للتعليم",
  "66": "بنك القاهرة عمّان",
  "67": "بنك الأراضي العربية",
  "68": "بنك دكسيا / البنك البلدي",
  "71": "البنك التجاري الأردني",
  "73": "البنك الإسلامي العربي",
  "74": "البنك البريطاني للشرق الأوسط",
  "76": "بنك فلسطين للاستثمار",
  "77": "بنك لئومي للرهن العقاري",
  "82": "القدس للتنمية والاستثمار",
  "83": "بنك الاتحاد",
  "84": "بنك الإسكان",
  "89": "بنك فلسطين",
  "90": "بنك ديسكونت للرهن العقاري",
  "93": "بنك الأردن الكويت",
  "99": "بنك إسرائيل (البنك المركزي)",
};

const normalizeBankCode = (raw: string | null | undefined): string => {
  if (!raw) return "";
  const trimmed = String(raw).trim();
  if (!trimmed) return "";
  if (/^\d$/.test(trimmed)) return trimmed.padStart(2, "0");
  return trimmed;
};

const getBankLabel = (code: string | null | undefined): string => {
  const norm = normalizeBankCode(code);
  if (!norm) return "";
  return BANK_LABELS[norm] || norm;
};

// Label a payment method. ELZAMI premiums are paid directly on the
// insurance company's portal (visa flow) and stored with locked=true —
// surface them as "فيزا خارجي" so the customer sees they didn't pay it
// through the agency.
function paymentTypeLabel(p: { payment_type: string; locked?: boolean | null }): string {
  if (p.locked && p.payment_type === 'visa') return 'فيزا خارجي';
  return PAYMENT_TYPE_LABELS[p.payment_type] || p.payment_type;
}

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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const bunnyApiKey = Deno.env.get('BUNNY_API_KEY');
    const rawBunnyStorageZone = Deno.env.get('BUNNY_STORAGE_ZONE');
    const bunnyCdnUrl = normalizeBunnyCdnUrl(Deno.env.get('BUNNY_CDN_URL'));
    const bunnyStorageZone = resolveBunnyStorageZone(rawBunnyStorageZone, bunnyCdnUrl);

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const { policy_ids, skip_sms, whatsapp_mode, internal_token }:
      SendPackageInvoiceSmsRequest & { internal_token?: string } = body;

    if (!policy_ids || policy_ids.length === 0) {
      return new Response(
        JSON.stringify({ error: "policy_ids is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Two auth paths:
    //   • External callers (the wizard) send a user JWT in Authorization
    //     and we resolve the agent from that user.
    //   • Internal callers (the green-api-webhook) send the service-role
    //     key as `internal_token` in the body — body field rather than
    //     header because the platform mangles auth headers for
    //     cross-function calls in a way that defeated header comparison.
    let agentId: string | null = null;
    const isInternalCall = !!internal_token && internal_token === supabaseServiceKey;

    if (isInternalCall) {
      // Derive agent from the first policy's client's agent_id. All
      // policies in a package belong to one client (and therefore one
      // agent), so the first policy is enough.
      const { data: firstPolicyClient } = await supabase
        .from("policies")
        .select("client:clients(agent_id)")
        .eq("id", policy_ids[0])
        .single();
      const derivedAgentId = (firstPolicyClient?.client as any)?.agent_id;
      if (!derivedAgentId) {
        return new Response(
          JSON.stringify({ error: "Could not resolve agent from policy_ids" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      agentId = derivedAgentId;
    } else {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(
          JSON.stringify({ error: "Missing authorization header" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const token = authHeader.replace("Bearer ", "");
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) {
        return new Response(
          JSON.stringify({ error: "Invalid authentication" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      agentId = await resolveAgentId(supabase, user.id);
    }

    const branding = await getAgentBranding(supabase, agentId);

    console.log(`[send-package-invoice-sms] Processing ${policy_ids.length} policies, skip_sms: ${skip_sms}`);

    // Get all policies with related data
    const { data: policies, error: policiesError } = await supabase
      .from("policies")
      .select(`
        *,
        client:clients(id, full_name, phone_number, phone_number_2, id_number, signature_url),
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
    
    // Only require phone number when actually sending SMS or building a
    // WhatsApp link (wa.me URL needs a destination number).
    if ((!skip_sms || whatsapp_mode) && !client?.phone_number) {
      return new Response(
        JSON.stringify({ error: "رقم هاتف العميل مطلوب" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get insurance files for all policies (main + add-ons)
    const { data: insuranceFiles, error: filesError } = await supabase
      .from("media_files")
      .select("id, cdn_url, original_name, mime_type, entity_id, stream_video_guid, stream_library_id")
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

    // For SMS sending, require enabled settings + quota. WhatsApp mode
    // bypasses both since no SMS leaves our system.
    if (!skip_sms && !whatsapp_mode) {
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

    // Get payments for all policies (include refused=null for pending Visa
    // payments). Use "*" so newly-added columns like receipt_number are
    // picked up when present and the query doesn't error out on older
    // deploys where the column still doesn't exist.
    const { data: allPayments, error: allPaymentsError } = await supabase
      .from('policy_payments')
      .select('*')
      .in('policy_id', policy_ids)
      .or('refused.eq.false,refused.is.null')
      .order('created_at', { ascending: true });
    if (allPaymentsError) {
      console.error('[send-package-invoice-sms] payments fetch error:', allPaymentsError);
    }

    // Get policy children (additional drivers) for all policies
    const { data: policyChildren, error: childrenError } = await supabase
      .from('policy_children')
      .select(`
        policy_id,
        child:client_children(full_name, id_number, relation, phone, birth_date)
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

    // Calculate totals — include every row (even cancelled ones) so the
    // الإجمالي line matches the sum of the items table. The refund the
    // office owes back is surfaced separately in the cancellation
    // banner, and المتبقي is clamped to zero so a fully-paid cancelled
    // package doesn't show a misleading negative "remaining" balance —
    // the customer owes nothing, the refund is a SEPARATE obligation on
    // the office and lives in its own red banner above the totals.
    const totalPrice = policies.reduce(
      (sum, p) => sum + (p.insurance_price || 0) + (p.office_commission || 0),
      0,
    );
    const totalPaid = (allPayments || []).reduce((sum, p) => sum + (p.amount || 0), 0);
    const totalRemaining = Math.max(0, totalPrice - totalPaid);

    // Cancellation snapshot — if any sibling in this package is cancelled,
    // the invoice gets a big red footer banner with the refund owed. The
    // refund lives on customer_wallet_transactions so we pull every "refund"
    // row attached to any of the policies in this package and sum them.
    const cancelledPolicies = policies.filter((p: any) => p.cancelled);
    let cancellationInfo: {
      isCancelled: boolean;
      date: string;
      note: string;
      refundAmount: number;
    } = {
      isCancelled: cancelledPolicies.length > 0,
      date: '',
      note: '',
      refundAmount: 0,
    };
    if (cancelledPolicies.length > 0) {
      // Pick the earliest cancellation_date / first non-empty note so the
      // banner has *something* to show even if only one sibling carries
      // the full metadata.
      const firstDated = cancelledPolicies.find((p: any) => p.cancellation_date);
      cancellationInfo.date = firstDated?.cancellation_date || '';
      const firstNoted = cancelledPolicies.find((p: any) => p.cancellation_note);
      cancellationInfo.note = firstNoted?.cancellation_note || '';

      const { data: refundRows } = await supabase
        .from('customer_wallet_transactions')
        .select('amount')
        .in('policy_id', policy_ids)
        .eq('transaction_type', 'refund');
      cancellationInfo.refundAmount = (refundRows || []).reduce(
        (sum: number, row: any) => sum + Number(row.amount || 0),
        0,
      );
      console.log(`[send-package-invoice-sms] Package has ${cancelledPolicies.length} cancelled, refund total: ${cancellationInfo.refundAmount}`);
    }

    // Transfer audit rows for any policy in this package that was created
    // via "تحويل". The customer-facing note (policy_transfers.note) is
    // rendered on the printed invoice next to the matching policy row; the
    // office_note column is intentionally NOT queried — it stays internal
    // and is only shown on the client policy card's "ملاحظات" row via
    // policies.notes. adjustment_amount + adjustment_note are pulled so
    // the invoice can surface "عمولة التحويل" as a standalone item row
    // (separate from the policy's own office_commission) with the
    // financial-adjustment reason beneath it.
    const { data: transferRows } = await supabase
      .from("policy_transfers")
      .select("new_policy_id, note, adjustment_amount, adjustment_type, adjustment_note")
      .in("new_policy_id", policy_ids);
    const transferNoteByNewPolicyId: Record<string, string> = {};
    const transferAdjustmentByNewPolicyId: Record<string, { amount: number; adjustmentNote: string | null }> = {};
    (transferRows || []).forEach((row: any) => {
      if (row?.new_policy_id && row?.note) {
        transferNoteByNewPolicyId[row.new_policy_id] = row.note;
      }
      if (
        row?.new_policy_id &&
        row?.adjustment_type === 'customer_pays' &&
        Number(row?.adjustment_amount) > 0
      ) {
        transferAdjustmentByNewPolicyId[row.new_policy_id] = {
          amount: Number(row.adjustment_amount),
          adjustmentNote: typeof row.adjustment_note === 'string' && row.adjustment_note.trim()
            ? row.adjustment_note.trim()
            : null,
        };
      }
    });

    // Generate Package Invoice HTML with files and policy children
    const packageInvoiceHtml = buildPackageInvoiceHtml(policies, paymentsByPolicy, totalPrice, totalPaid, totalRemaining, insuranceFiles || [], policyChildren || [], companySettings, branding, cancellationInfo, transferNoteByNewPolicyId, transferAdjustmentByNewPolicyId, bunnyCdnUrl);
    
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
        JSON.stringify({ error: 'فشل في رفع المعاملة' }),
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
          message: "تم توليد المعاملة",
          policy_count: policy_ids.length,
          file_count: policyFileUrls.length,
          package_invoice_url: packageInvoiceUrl,
          duration_ms: duration
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build SMS message with ALL files included
    let smsMessage = `مرحباً ${client.full_name}، تم إصدار معاملة التأمين`;

    // Include a price summary so the customer sees what they owe, including
    // office commission (the ELZAMI markup) rolled into the grand total.
    const smsTotalCommission = policies.reduce(
      (sum: number, p: any) => sum + (p.office_commission || 0),
      0,
    );
    smsMessage += `\n\nالمبلغ الإجمالي: ₪${totalPrice.toLocaleString('en-US')}`;
    if (smsTotalCommission > 0) {
      smsMessage += `\nمنها عمولة المكتب: ₪${smsTotalCommission.toLocaleString('en-US')}`;
    }
    if (totalRemaining > 0) {
      smsMessage += `\nالمتبقي: ₪${totalRemaining.toLocaleString('en-US')}`;
    }

    // Add policy files if available
    if (allPolicyUrlsText) {
      smsMessage += `\n\n${allPolicyUrlsText}`;
    }

    // Always add invoice URL
    smsMessage += `\n\nمعاملة التأمين: ${packageInvoiceUrl}`;

    smsMessage = appendSmsFooter(smsMessage, branding);

    // WhatsApp mode: hand the prepared text + wa.me-ready phone back to
    // the client and exit. No SMS goes out, no quota is consumed, and
    // the policy is not marked as sent (the user may still want to
    // follow up over real SMS).
    if (whatsapp_mode) {
      const duration = Date.now() - startTime;
      return new Response(
        JSON.stringify({
          success: true,
          mode: 'whatsapp',
          message_text: smsMessage,
          whatsapp_phone: normalizePhoneForWhatsapp(client.phone_number),
          policy_count: policy_ids.length,
          file_count: policyFileUrls.length,
          package_invoice_url: packageInvoiceUrl,
          duration_ms: duration,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Re-assert (TS narrowing was lost across earlier branches above)
    if (!smsSettingsData) {
      return new Response(
        JSON.stringify({ error: "خدمة الرسائل غير مفعلة" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const cleanPhone = normalizePhoneFor(smsSettingsData.provider, client.phone_number);

    console.log(`[send-package-invoice-sms] Sending SMS via ${smsSettingsData.provider} to ${cleanPhone} with ${policyFileUrls.length} policy files`);

    const sendResult = await sendSms(smsSettingsData, client.phone_number, smsMessage);
    console.log(`[send-package-invoice-sms] ${sendResult.provider} raw response:`, sendResult.rawResponse);

    if (!sendResult.success) {
      console.error(`[send-package-invoice-sms] SMS failed via ${sendResult.provider}: ${sendResult.error}`);
      return new Response(
        JSON.stringify({ error: sendResult.error || `خطأ في إرسال الرسالة` }),
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
        message: "تم إرسال المعاملات عبر الرسائل",
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
  policyFiles: { cdn_url: string; original_name: string; mime_type: string; entity_id: string; stream_video_guid?: string | null; stream_library_id?: string | null }[],
  policyChildren: any[] = [],
  companySettings: { company_email?: string; company_phones?: string[]; company_whatsapp?: string; company_location?: string },
  branding: AgentBranding = DEFAULT_BRANDING,
  cancellationInfo: { isCancelled: boolean; date: string; note: string; refundAmount: number } = { isCancelled: false, date: '', note: '', refundAmount: 0 },
  transferNoteByNewPolicyId: Record<string, string> = {},
  transferAdjustmentByNewPolicyId: Record<string, { amount: number; adjustmentNote: string | null }> = {},
  bunnyCdnUrl: string = ''
): string {
  const client = policies[0]?.client || {};
  const today = new Date();
  // Primary document number (رقم المعاملة). A package is one معاملة so
  // we pick a single بوليصة whose number represents the whole
  // printout. Rule (mirrors the card + payments log so all three
  // surfaces agree): THIRD_FULL > ELZAMI > addons, smallest doc
  // number breaks ties. Fallback to the legacy date-based string
  // only if no policy in the package carries a stamp.
  const documentPriority: Record<string, number> = { THIRD_FULL: 0, ELZAMI: 1 };
  const stampedForDoc = policies
    .filter((p: any) => typeof p.document_number === 'string' && p.document_number.trim().length > 0)
    .map((p: any) => ({
      doc: String(p.document_number).trim(),
      rank: documentPriority[p.policy_type_parent ?? ''] ?? 99,
    }))
    .sort((a, b) => a.rank !== b.rank ? a.rank - b.rank : a.doc.localeCompare(b.doc, 'en', { numeric: true }));
  const primaryDocumentNumber = stampedForDoc[0]?.doc
    || `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}-${(policies[0]?.id || '').slice(0, 6).toUpperCase()}`;

  // Brand block: prefer the agent's uploaded logo (from BrandingSettings
  // → agents.logo_url, exposed via getAgentBranding) so each agency's
  // invoice carries its own mark. Fall back to the bundled Thiqa SVG
  // only when the agent hasn't uploaded a logo yet.
  const brandBlock = branding.logoUrl
    ? `<div class="logo"><img src="${branding.logoUrl}" alt="${branding.companyName}" /></div>`
    : `<div class="logo logo-svg">${THIQA_LOGO_SVG}</div>`;

  // Unique additional drivers across the package. Each child may appear
  // linked to multiple policies (policy_children is a join table); we
  // deduplicate by id_number so they show once in the drivers table.
  const uniqueDriversMap = new Map<string, { name: string; id_number: string; phone: string; relation: string; birth_date: string }>();
  policyChildren.forEach((pc: any) => {
    const child = pc?.child;
    if (!child?.full_name) return;
    const key = child.id_number || child.full_name;
    if (!uniqueDriversMap.has(key)) {
      uniqueDriversMap.set(key, {
        name: child.full_name,
        id_number: child.id_number || '',
        phone: child.phone || '',
        relation: child.relation || '',
        birth_date: child.birth_date || '',
      });
    }
  });
  const uniqueDrivers = Array.from(uniqueDriversMap.values());

  // Unique car details across all policies in this invoice.
  const uniqueCarNumbers = Array.from(new Set(
    policies.map((p: any) => p.car?.car_number).filter(Boolean)
  ));
  const uniqueCarTypes = Array.from(new Set(
    policies
      .map((p: any) => p.car?.car_type ? CAR_TYPE_LABELS[p.car.car_type] || p.car.car_type : '')
      .filter(Boolean)
  ));
  const uniqueCarModels = Array.from(new Set(
    policies.map((p: any) => {
      const parts: string[] = [];
      if (p.car?.manufacturer_name) parts.push(p.car.manufacturer_name);
      if (p.car?.model) parts.push(p.car.model);
      if (p.car?.year) parts.push(String(p.car.year));
      return parts.join(' ');
    }).filter(Boolean)
  ));
  const carNumbers = uniqueCarNumbers.join('، ');
  const carTypesText = uniqueCarTypes.join('، ');
  const carModelsText = uniqueCarModels.join('، ');

  // Stamp the customer name with an "أقل من 24" chip whenever any
  // policy in the invoice was issued under that flag — matches the
  // badge the package card now shows in the in-app timeline.
  const isUnder24Customer = policies.some((p: any) => p.is_under_24);
  const under24ChipHtml = isUnder24Customer
    ? '<span class="under24-chip">أقل من 24</span>'
    : '';

  // Smarter invoice title based on the policy types in this package.
  const policyTypeKinds = new Set<string>();
  policies.forEach((p: any) => {
    if (p.policy_type_parent === 'ROAD_SERVICE') policyTypeKinds.add('road');
    else if (p.policy_type_parent === 'ACCIDENT_FEE_EXEMPTION') policyTypeKinds.add('accident_fee');
    else policyTypeKinds.add('insurance');
  });
  let invoiceSubtitle = '';
  if (policyTypeKinds.size === 1) {
    if (policyTypeKinds.has('insurance')) invoiceSubtitle = 'تأمين سيارة';
    else if (policyTypeKinds.has('road')) invoiceSubtitle = 'خدمات الطريق';
    else if (policyTypeKinds.has('accident_fee')) invoiceSubtitle = 'إعفاء رسوم';
  } else {
    invoiceSubtitle = 'معاملات التأمين والخدمات';
  }

  // Extra drivers block — dedicated table right after customer info.
  const driversHtml = uniqueDrivers.length > 0 ? `
    <div class="drivers">
      <div class="section-title">السائقون الإضافيون</div>
      <table class="drivers-table">
        <thead>
          <tr>
            <th style="width: 40px;">#</th>
            <th>الاسم</th>
            <th>رقم الهوية</th>
            <th>تاريخ الميلاد</th>
            <th>رقم الهاتف</th>
            <th>صلة القرابة</th>
          </tr>
        </thead>
        <tbody>
          ${uniqueDrivers.map((d, i) => `
            <tr>
              <td class="num">${i + 1}</td>
              <td>${d.name}</td>
              <td class="tabular">${d.id_number || '-'}</td>
              <td class="tabular">${d.birth_date ? formatDate(d.birth_date) : '-'}</td>
              <td class="tabular">${d.phone || '-'}</td>
              <td>${d.relation || '-'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  ` : '';

  // Normalize attachment CDN urls.
  const normalizedFiles = policyFiles.map(f => ({
    ...f,
    cdn_url: f.cdn_url
      .replace('https://basheer-ab.b-cdn.net/', bunnyCdnUrl + '/')
      .replace('https://cdn.basheer-ab.com/', bunnyCdnUrl + '/'),
  }));

  // Item rows — one per policy. "Description" = type + car, "Amount" = price.
  // Cancelled rows are tagged with a .cancelled-row class (strikethrough +
  // muted color) and a "ملغاة" pill so anyone reading the printed document
  // can tell which coverages are no longer in force.
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

    const companyName = p.company?.name_ar || p.company?.name || '-';
    const periodText = (p.start_date && p.end_date)
      ? `${formatDate(p.end_date)} ← ${formatDate(p.start_date)}`
      : '-';
    const commission = p.office_commission || 0;
    // Pull the transfer portion out of this policy's commission so the
    // printed row matches the in-app breakdown — the transfer fee then
    // appears as its own "عمولة التحويل" row after all policy rows.
    const transferPortion = transferAdjustmentByNewPolicyId[p.id]?.amount || 0;
    const officePortion = Math.max(0, commission - transferPortion);
    const lineTotal = (p.insurance_price || 0) + officePortion;
    const commissionLine = officePortion > 0
      ? `<div class="item-commission">عمولة المكتب: ₪${officePortion.toLocaleString('en-US')}</div>`
      : '';
    const isCancelled = !!p.cancelled;
    const cancelledTag = isCancelled
      ? `<span class="cancelled-tag">ملغاة</span>`
      : '';

    // Transfer block — when this policy was created via تحويل, spell it
    // out on the printed document: which car it came from, plus the
    // customer-facing note from policy_transfers (if any). Office notes
    // are intentionally excluded here — they only live on the card.
    const transferFromCarNumber = p.transferred_car_number
      ? String(p.transferred_car_number).trim()
      : '';
    const transferCustomerNote = transferNoteByNewPolicyId[p.id] || '';
    const transferSourceLine = transferFromCarNumber
      ? `<div class="item-transfer">محول من سيارة ${escapeHtml(transferFromCarNumber)}</div>`
      : '';
    const transferNoteLine = transferCustomerNote
      ? `<div class="item-transfer-note">ملاحظة: ${escapeHtml(transferCustomerNote)}</div>`
      : '';

    const policyNumberCell = p.policy_number && String(p.policy_number).trim()
      ? `<span class="policy-number">${escapeHtml(String(p.policy_number))}</span>`
      : `<span class="policy-number-empty">—</span>`;
    return `
      <tr class="${isCancelled ? 'cancelled-row' : ''}">
        <td class="num tabular">${policyNumberCell}</td>
        <td>
          <div class="item-title">${policyType} ${cancelledTag}</div>
          <div class="item-meta">${companyName}</div>
          ${commissionLine}
          ${transferSourceLine}
          ${transferNoteLine}
        </td>
        <td class="period">${periodText}</td>
        <td class="num">₪${lineTotal.toLocaleString('en-US')}</td>
      </tr>
    `;
  }).join('');

  // Standalone "عمولة التحويل" row(s) — the transfer fee is a
  // transfer-level charge, not tied to a specific بوليصة. We aggregate
  // it across all affected policies in the package into a single item
  // row so the printed invoice reads as: [policy rows..., عمولة التحويل]
  // → الإجمالي. The financial-adjustment reason (adjustment_note) rides
  // underneath when present. If adjustment_note differs across rows,
  // we join the distinct reasons with " • ".
  const transferAdjustmentEntries = policies
    .map((p: any) => transferAdjustmentByNewPolicyId[p.id])
    .filter((a): a is { amount: number; adjustmentNote: string | null } => !!a && a.amount > 0);
  const totalTransferFee = transferAdjustmentEntries.reduce((s, a) => s + a.amount, 0);
  const distinctAdjustmentNotes = Array.from(new Set(
    transferAdjustmentEntries.map(a => a.adjustmentNote).filter((n): n is string => !!n)
  ));
  const transferFeeRow = totalTransferFee > 0
    ? `
      <tr class="transfer-fee-row">
        <td class="num tabular">—</td>
        <td>
          <div class="item-title">عمولة التحويل</div>
          ${distinctAdjustmentNotes.length > 0
            ? `<div class="item-transfer-note">ملاحظة التعديل المالي: ${escapeHtml(distinctAdjustmentNotes.join(' • '))}</div>`
            : ''}
        </td>
        <td class="period">—</td>
        <td class="num">₪${totalTransferFee.toLocaleString('en-US')}</td>
      </tr>
    `
    : '';
  const policyRowsWithTransferFee = policyRows + transferFeeRow;

  // Broker notice — when any policy in this package was made through or
  // for a broker, the money is tracked on the broker's account, not the
  // customer's. Surface that on the invoice so whoever reads the PDF
  // understands why no payment is expected from the customer.
  const brokerPolicyForNotice = policies.find((p: any) => p.broker_id && p.broker?.name);
  const brokerNoticeHtml = brokerPolicyForNotice
    ? `
    <div class="broker-banner">
      <div class="broker-title">ملاحظة: معاملة مرتبطة بوسيط</div>
      <div class="broker-body">${
        brokerPolicyForNotice.broker_direction === 'to_broker'
          ? `صُدرت هذه المعاملة للوسيط <strong>${escapeHtml(brokerPolicyForNotice.broker.name)}</strong> — المبلغ المستحق يُتابع في حساب الوسيط، وليس على العميل.`
          : `تمت هذه المعاملة عبر الوسيط <strong>${escapeHtml(brokerPolicyForNotice.broker.name)}</strong> — المبلغ المستحق يُتابع في حساب الوسيط، وليس على العميل.`
      }</div>
    </div>
    `
    : '';

  // Cancellation banner — shown near the top when any policy in the
  // package is cancelled, so the refund obligation jumps off the page
  // instead of being buried in a line item.
  const cancellationBannerHtml = cancellationInfo.isCancelled
    ? `
    <div class="cancellation-banner">
      <div class="cancellation-main">
        <div class="cancellation-title">⊘ هذه المعاملة ملغاة</div>
        ${cancellationInfo.date ? `<div class="cancellation-meta"><strong>تاريخ الإلغاء:</strong> ${formatDate(cancellationInfo.date)}</div>` : ''}
        ${cancellationInfo.note ? `<div class="cancellation-meta"><strong>السبب:</strong> ${escapeHtml(cancellationInfo.note)}</div>` : ''}
      </div>
      ${cancellationInfo.refundAmount > 0 ? `
      <div class="refund-box">
        <div class="refund-label">مرتجع مستحق للعميل</div>
        <div class="refund-amount">₪${cancellationInfo.refundAmount.toLocaleString('en-US')}</div>
        <div class="refund-note">يتوجب على المكتب دفع هذا المبلغ للعميل</div>
      </div>
      ` : ''}
    </div>
    `
    : '';

  // Payments table rows — one per payment, sorted oldest → newest.
  const allPaymentsList: any[] = [];
  policies.forEach(p => {
    const policyPayments = paymentsByPolicy[p.id] || [];
    policyPayments.forEach(pay => allPaymentsList.push(pay));
  });
  allPaymentsList.sort((a, b) => new Date(a.payment_date).getTime() - new Date(b.payment_date).getTime());

  const paymentsTableHtml = allPaymentsList.length > 0 ? `
    <table class="payments">
      <thead>
        <tr>
          <th style="width: 120px;">رقم سند القبض</th>
          <th style="width: 130px;">طريقة الدفع</th>
          <th style="width: 130px;">تاريخ الدفع</th>
          <th>المبلغ</th>
        </tr>
      </thead>
      <tbody>
        ${allPaymentsList.map(p => {
          const chequePart = p.cheque_number
            ? ` · <span class="tabular">${escapeHtml(String(p.cheque_number))}</span>`
            : '';
          // Bank/branch detail line for cheque rows. Muted grey so
          // it reads as supporting info, not a new column.
          const bankLabel = getBankLabel(p.bank_code);
          const branchLabel = p.branch_code
            ? `فرع ${escapeHtml(String(p.branch_code))}`
            : '';
          const bankLine = (bankLabel || branchLabel)
            ? `<div class="payment-bank-line">${[escapeHtml(bankLabel), branchLabel].filter(Boolean).join(' · ')}</div>`
            : '';
          return `
          <tr>
            <td class="num">${p.receipt_number || '—'}</td>
            <td>
              <div>${paymentTypeLabel(p)}${chequePart}</div>
              ${bankLine}
            </td>
            <td class="date">${formatDate(p.payment_date)}</td>
            <td class="amount">₪${(p.amount || 0).toLocaleString('en-US')}</td>
          </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  ` : `<div class="payments-empty">لا توجد دفعات مسجلة.</div>`;

  // Attached files — simple thumbnail grid at the bottom (still useful but
  // styled flat, no gradients or rounded cards).
  const filesHtml = normalizedFiles.length > 0 ? `
    <div class="files-section">
      <div class="section-label">الملفات المرفقة</div>
      <div class="files-grid">
        ${normalizedFiles.map((file) => {
          const isImage = file.mime_type?.startsWith('image/');
          const isVideo = file.mime_type?.startsWith('video/');
          const hasStreamThumb = isVideo && file.stream_video_guid && file.stream_library_id;
          const thumbUrl = hasStreamThumb
            ? `https://vz-${file.stream_library_id}.b-cdn.net/${file.stream_video_guid}/thumbnail.jpg`
            : '';
          let preview: string;
          if (isImage) {
            preview = `<img src="${file.cdn_url}" alt="${file.original_name}" />`;
          } else if (isVideo) {
            preview = hasStreamThumb
              ? `<div class="file-video"><img src="${thumbUrl}" alt="${file.original_name}" /><span class="file-video-badge">▶ فيديو</span></div>`
              : `<div class="file-placeholder">فيديو</div>`;
          } else {
            preview = `<div class="file-placeholder">PDF</div>`;
          }
          return `
            <a href="${file.cdn_url}" target="_blank" class="file-link" ${isImage ? `onclick="event.preventDefault();openLightbox('${file.cdn_url}')"` : ''}>
              ${preview}
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
  <title>معاملة - ${client.full_name || 'عميل'}</title>
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

    /* ── Header ── */
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
    .brand .logo {
      display: block;
      margin-bottom: 10px;
    }
    .brand .logo img {
      max-height: 60px;
      max-width: 220px;
      width: auto;
      height: auto;
      object-fit: contain;
      display: block;
    }
    .brand .logo-svg {
      display: block;
      margin-bottom: 10px;
    }
    .brand .logo-svg svg {
      height: 44px;
      width: auto;
      display: block;
    }
    .brand .name { font-size: 15px; font-weight: 700; color: #1a1a1a; }
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
    .meta-rows {
      width: 100%;
      border: 1px solid #1a1a1a;
      font-size: 12px;
    }
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

    /* ── Customer info ── */
    .customer {
      margin-bottom: 20px;
      border: 1px solid #1a1a1a;
    }
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
    .customer-grid {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
    }
    .customer-grid .cell {
      padding: 9px 14px;
    }
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
    .customer-grid .value {
      font-size: 14px;
      font-weight: 700;
      color: #1a1a1a;
    }
    .customer-grid .value.tabular {
      font-variant-numeric: tabular-nums;
      direction: ltr;
      text-align: right;
    }
    .customer-grid .under24-chip {
      display: inline-block;
      margin-right: 6px;
      padding: 1px 8px;
      font-size: 11px;
      font-weight: 700;
      color: #92400e;
      background: #fef3c7;
      border: 1px solid #fcd34d;
      border-radius: 999px;
      vertical-align: middle;
    }

    /* ── Items table ── */
    .items {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
      border: 1px solid #1a1a1a;
    }
    .items thead th {
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
    .items thead th:last-child { border-left: none; }
    .items tbody td {
      padding: 9px 12px;
      border-top: 1px solid #1a1a1a;
      border-left: 1px solid #1a1a1a;
      font-size: 13px;
      color: #1a1a1a;
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
      color: #1a1a1a;
    }
    .items tbody td.num .policy-number-empty {
      color: #b0b0b0;
      font-weight: 400;
    }
    .items tbody td.period {
      direction: ltr;
      text-align: right;
      font-variant-numeric: tabular-nums;
      font-weight: 600;
      font-size: 12px;
      color: #1a1a1a;
      white-space: nowrap;
    }
    .items tbody .item-title { font-weight: 700; font-size: 14px; color: #1a1a1a; }
    .items tbody .item-meta { color: #1a1a1a; font-size: 11.5px; margin-top: 3px; font-weight: 500; }
    .items tbody .item-commission {
      color: #1a1a1a;
      font-size: 11.5px;
      margin-top: 3px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .items tbody .item-transfer {
      color: #1a1a1a;
      font-size: 11.5px;
      margin-top: 4px;
      font-weight: 700;
    }
    .items tbody .item-transfer-note {
      color: #1a1a1a;
      font-size: 11px;
      margin-top: 2px;
      font-weight: 500;
      white-space: pre-wrap;
    }

    /* ── Extra drivers table ── */
    .drivers {
      margin-bottom: 20px;
      border: 1px solid #1a1a1a;
    }
    .drivers-table {
      width: 100%;
      border-collapse: collapse;
    }
    .drivers-table thead th {
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
    .drivers-table thead th:last-child { border-left: none; }
    .drivers-table tbody td {
      padding: 9px 12px;
      border-top: 1px solid #1a1a1a;
      border-left: 1px solid #1a1a1a;
      font-size: 13px;
      color: #1a1a1a;
      text-align: right;
      font-weight: 500;
    }
    .drivers-table tbody td:last-child { border-left: none; }
    .drivers-table tbody tr:first-child td { border-top: none; }
    .drivers-table tbody td.num {
      text-align: center;
      font-variant-numeric: tabular-nums;
      font-weight: 700;
    }
    .drivers-table tbody td.tabular {
      direction: ltr;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    /* ── Privacy / terms ── */
    .privacy {
      margin-bottom: 20px;
      border: 1px solid #1a1a1a;
    }
    .privacy .body {
      padding: 11px 14px;
      font-size: 12px;
      color: #1a1a1a;
      line-height: 1.7;
      white-space: pre-wrap;
      font-weight: 500;
    }

    /* ── Brand subtitle / owner / tax ── */
    .invoice-meta .subtitle {
      font-size: 12px;
      font-weight: 600;
      color: #1a1a1a;
      margin-top: -8px;
      margin-bottom: 14px;
      letter-spacing: 0.5px;
    }
    .brand .owner {
      font-size: 12px;
      color: #1a1a1a;
      margin-top: 4px;
      font-weight: 600;
    }
    .brand .tax {
      font-size: 12px;
      color: #1a1a1a;
      margin-top: 2px;
      direction: ltr;
      text-align: right;
      font-variant-numeric: tabular-nums;
      font-weight: 500;
    }

    /* ── Payments table (سجل الدفعات) ── */
    .payments-section { margin-bottom: 20px; }
    .payments {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      border: 1px solid #1a1a1a;
    }
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
    /* Small muted line under cheque rows showing the bank name + branch. */
    .payments tbody .payment-bank-line {
      font-size: 10.5px;
      font-weight: 500;
      color: #6b7280;
      margin-top: 2px;
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
    .payments tbody td.amount { color: #1a1a1a; }
    .payments-empty {
      padding: 14px;
      border: 1px solid #1a1a1a;
      font-size: 12px;
      color: #1a1a1a;
      opacity: 0.75;
      text-align: center;
    }

    /* ── Bottom row (totals only) ── */
    .bottom {
      display: flex;
      justify-content: flex-end;
      gap: 18px;
      align-items: stretch;
      margin-bottom: 20px;
    }

    .totals {
      width: 290px;
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
    .totals tr.total td.label {
      text-transform: uppercase;
      font-size: 12px;
      letter-spacing: 0.5px;
    }
    .totals tr.total td.val { color: #ffffff; }

    /* ── Broker banner ── shown when any policy in the package is
       tied to a broker. Muted amber so it reads as informational,
       not as an alert like the cancellation banner. */
    .broker-banner {
      margin: 18px 0 14px;
      padding: 12px 16px;
      border: 1px solid #f59e0b;
      background: #fffbeb;
      border-right: 4px solid #d97706;
    }
    .broker-title {
      font-size: 13px;
      font-weight: 800;
      color: #92400e;
      margin-bottom: 4px;
    }
    .broker-body {
      font-size: 12px;
      color: #7c2d12;
      line-height: 1.7;
    }
    .broker-body strong { font-weight: 700; }

    /* ── Cancellation banner ── */
    .cancellation-banner {
      margin: 18px 0 22px;
      padding: 16px 18px;
      border: 2px solid #b91c1c;
      background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      flex-wrap: wrap;
    }
    .cancellation-main { flex: 1 1 220px; min-width: 0; }
    .cancellation-title {
      font-size: 18px;
      font-weight: 800;
      color: #991b1b;
      letter-spacing: 0.3px;
      margin-bottom: 4px;
    }
    .cancellation-meta {
      font-size: 12px;
      color: #7f1d1d;
      line-height: 1.6;
    }
    .cancellation-meta strong { font-weight: 700; }
    .refund-box {
      background: #ffffff;
      border: 1px solid #fecaca;
      padding: 12px 18px;
      text-align: center;
      min-width: 180px;
    }
    .refund-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #b91c1c;
      font-weight: 700;
    }
    .refund-amount {
      font-size: 26px;
      font-weight: 900;
      color: #b91c1c;
      margin-top: 4px;
      line-height: 1.1;
      font-variant-numeric: tabular-nums;
    }
    .refund-note {
      font-size: 10px;
      color: #7f1d1d;
      margin-top: 4px;
    }
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

    /* ── Files ── */
    .files-section { margin-bottom: 22px; }
    .section-label {
      font-weight: 700;
      font-size: 11px;
      color: #1a1a1a;
      padding: 7px 0;
      border-bottom: 1px solid #1a1a1a;
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
      border: 1px solid #1a1a1a;
      font-size: 10.5px;
      text-align: center;
      word-break: break-word;
      background: #fff;
      color: #1a1a1a;
      font-weight: 500;
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
      border: 1px solid #1a1a1a;
      font-weight: 700;
      font-size: 12px;
      letter-spacing: 1px;
      color: #ffffff;
      background: #1a1a1a;
    }
    .file-video {
      position: relative;
      width: 100%;
      height: 88px;
      background: #000;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .file-video img {
      max-width: 100%;
      max-height: 88px;
      object-fit: cover;
      width: 100%;
      height: 100%;
    }
    .file-video-badge {
      position: absolute;
      bottom: 4px;
      right: 4px;
      background: rgba(0, 0, 0, 0.7);
      color: #fff;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 10px;
      font-weight: 700;
    }

    /* ── Footer ── */
    .footer {
      margin-top: 28px;
      padding-top: 18px;
      border-top: 1px solid #1a1a1a;
      text-align: center;
      font-size: 12px;
    }
    .footer .thanks {
      font-weight: 700;
      font-size: 14px;
      color: #1a1a1a;
      margin-bottom: 8px;
      letter-spacing: 0.3px;
    }
    .footer .contact { color: #1a1a1a; margin-top: 8px; font-weight: 600; line-height: 1.7; }
    .footer .contact a { color: #1a1a1a; }
    .footer .issued {
      color: #1a1a1a;
      margin-top: 10px;
      font-size: 11px;
      font-variant-numeric: tabular-nums;
      opacity: 0.7;
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
      /* Drop browser-injected URL/date headers and footers by zeroing
         the page margin, then add equivalent padding ourselves so the
         content doesn't run to the paper edge. */
      @page { size: A4; margin: 0; }
      html, body { background: #fff; }
      body { padding: 12mm 10mm; }
      .no-print { display: none !important; }
      .invoice {
        max-width: 100%;
        padding: 16px 20px;
        border: 1px solid #1a1a1a;
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
      .invoice { padding: 22px 18px; }
      /* Stack + center the whole invoice header on mobile. Both the
         brand block and the meta block live on their own row and
         align to center, and the logo gets a much bigger cap so it
         actually reads at phone width. */
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
      .brand .logo {
        margin-left: auto;
        margin-right: auto;
      }
      .brand .logo img {
        max-height: 110px;
        max-width: 260px;
      }
      .brand .logo-svg { margin-left: auto; margin-right: auto; }
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
        ${branding.ownerName && branding.ownerName.trim() !== branding.companyName.trim() ? `<div class="owner">${branding.ownerName}</div>` : ''}
        ${branding.taxNumber ? `<div class="tax">رقم المشغل: ${branding.taxNumber}</div>` : ''}
        ${branding.siteDescription ? `<div class="tagline">${branding.siteDescription}</div>` : ''}
        ${effectiveAddress ? `<div class="address">${effectiveAddress}</div>` : ''}
      </div>
      <div class="invoice-meta">
        <div class="doc-title">معاملة</div>
        ${invoiceSubtitle ? `<div class="subtitle">${invoiceSubtitle}</div>` : ''}
        <div class="meta-rows">
          <div class="row">
            <div class="label">رقم المعاملة</div>
            <div class="val">${primaryDocumentNumber}</div>
          </div>
          <div class="row">
            <div class="label">التاريخ</div>
            <div class="val">${formatDate(today.toISOString())}</div>
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
          <div class="value">${client.full_name || '-'}${under24ChipHtml}</div>
        </div>
        <div class="cell">
          <div class="label">رقم الهوية</div>
          <div class="value tabular">${client.id_number || '-'}</div>
        </div>
        <div class="cell">
          <div class="label">${[client.phone_number, client.phone_number_2].filter(Boolean).length > 1 ? 'أرقام الهاتف' : 'رقم الهاتف'}</div>
          <div class="value tabular">${[client.phone_number, client.phone_number_2].filter(Boolean).join(' / ') || '-'}</div>
        </div>
        <div class="cell">
          <div class="label">${uniqueCarNumbers.length > 1 ? 'أرقام السيارات' : 'رقم السيارة'}</div>
          <div class="value tabular">${carNumbers || '-'}</div>
        </div>
        <div class="cell">
          <div class="label">${uniqueCarTypes.length > 1 ? 'أنواع السيارات' : 'نوع السيارة'}</div>
          <div class="value">${carTypesText || '-'}</div>
        </div>
        <div class="cell">
          <div class="label">${uniqueCarModels.length > 1 ? 'موديلات السيارات' : 'موديل السيارة'}</div>
          <div class="value">${carModelsText || '-'}</div>
        </div>
      </div>
    </div>

    ${brokerNoticeHtml}

    ${cancellationBannerHtml}

    ${driversHtml}

    <!-- Items table -->
    <table class="items">
      <thead>
        <tr>
          <th style="width: 110px;">رقم البوليصة</th>
          <th>الوصف</th>
          <th style="width: 180px;">المدة</th>
          <th style="width: 120px;">المبلغ</th>
        </tr>
      </thead>
      <tbody>
        ${policyRowsWithTransferFee}
      </tbody>
    </table>

    <!-- Payments log (سجل الدفعات) as a proper table of receipts -->
    <div class="payments-section">
      <div class="section-title">سجل الدفعات</div>
      ${paymentsTableHtml}
    </div>

    <!-- Totals -->
    <div class="bottom">
      <table class="totals">
        <tr>
          <td class="label">الإجمالي</td>
          <td class="val">₪${totalPrice.toLocaleString('en-US')}</td>
        </tr>
        <tr>
          <td class="label">المدفوع</td>
          <td class="val">₪${totalPaid.toLocaleString('en-US')}</td>
        </tr>
        <tr class="total">
          <td class="label">المتبقي</td>
          <td class="val">₪${remaining.toLocaleString('en-US')}</td>
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
        navigator.share({ title: 'معاملة', url: url }).catch(function(){});
      } else {
        window.open('https://wa.me/?text=' + encodeURIComponent(url), '_blank');
      }
    }
  </script>
</body>
</html>
  `;
}
