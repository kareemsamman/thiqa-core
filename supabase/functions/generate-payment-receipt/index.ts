import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import { buildBunnyStorageUploadUrl, normalizeBunnyCdnUrl, resolveBunnyStorageZone } from "../_shared/bunny-storage.ts";
import { getAgentBranding, resolveAgentId, type AgentBranding } from "../_shared/agent-branding.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface GeneratePaymentReceiptRequest {
  payment_id: string;
}

const PAYMENT_TYPE_LABELS: Record<string, string> = {
  cash: 'نقدي',
  cheque: 'شيك',
  visa: 'بطاقة ائتمان',
  transfer: 'تحويل بنكي',
};

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-GB', { 
    year: 'numeric', 
    month: '2-digit', 
    day: '2-digit',
  });
}

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

function escapeHtml(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildPaymentReceiptHtml(
  payment: any,
  policy: any,
  client: any,
  car: any,
  companySettings: { company_email?: string; company_phone_links?: PhoneLink[]; company_location?: string },
  branding: AgentBranding = { companyName: 'وكالة التأمين', companyNameEn: '', logoUrl: null, siteDescription: '' }
): string {
  const paymentTypeLabel = PAYMENT_TYPE_LABELS[payment.payment_type] || payment.payment_type;
  const policyDocumentNumber = policy?.document_number || policy?.policy_number || '—';
  const receiptNumber = payment.receipt_number || '—';
  const today = new Date();

  // Build extra payment-method details rows (cheque number, visa last four,
  // tranzila approval code, etc). Each one is a key/value row inside the
  // "تفاصيل الدفع" section when the column is actually populated.
  const extraDetailRows: string[] = [];
  if (payment.payment_type === 'visa') {
    if (payment.card_last_four) {
      extraDetailRows.push(`
        <div class="row">
          <div class="label">آخر 4 أرقام البطاقة</div>
          <div class="val">•••• ${payment.card_last_four}</div>
        </div>
      `);
    }
    if (payment.installments_count && payment.installments_count > 1) {
      extraDetailRows.push(`
        <div class="row">
          <div class="label">عدد التقسيطات</div>
          <div class="val">${payment.installments_count}</div>
        </div>
      `);
    }
    if (payment.tranzila_approval_code) {
      extraDetailRows.push(`
        <div class="row">
          <div class="label">رقم التأكيد</div>
          <div class="val">${payment.tranzila_approval_code}</div>
        </div>
      `);
    }
  } else if (payment.payment_type === 'cheque') {
    if (payment.cheque_number) {
      extraDetailRows.push(`
        <div class="row">
          <div class="label">رقم الشيك</div>
          <div class="val">${payment.cheque_number}</div>
        </div>
      `);
    }
    if (payment.cheque_date) {
      extraDetailRows.push(`
        <div class="row">
          <div class="label">تاريخ الشيك</div>
          <div class="val">${formatDate(payment.cheque_date)}</div>
        </div>
      `);
    }
  }
  const extraDetailsHtml = extraDetailRows.join('');

  // Contact footer lines — phones / whatsapp / email / address pulled from
  // the agent's sms_settings row, same as the package invoice footer.
  const phoneLinksHtml = (companySettings.company_phone_links || []).map(
    (link: PhoneLink) => `<a href="${link.href}">${link.phone}</a>`
  ).join(' / ');
  const contactLines: string[] = [];
  if (phoneLinksHtml) contactLines.push(`هاتف: ${phoneLinksHtml}`);
  if (companySettings.company_email) {
    contactLines.push(`بريد: <a href="mailto:${companySettings.company_email}">${companySettings.company_email}</a>`);
  }
  if (companySettings.company_location) {
    contactLines.push(`عنوان: ${escapeHtml(companySettings.company_location)}`);
  }
  const contactFooterHtml = contactLines.length > 0
    ? `<div class="contact">${contactLines.join(' · ')}</div>`
    : '';

  return `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap" rel="stylesheet">
  <title>سند قبض - ${escapeHtml(client.full_name || 'عميل')}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    @page { size: A4; margin: 10mm; }
    @media print {
      body { padding: 0; background: #ffffff; }
      .no-print { display: none !important; }
    }
    body {
      font-family: 'Tajawal', 'Segoe UI', Tahoma, Arial, sans-serif;
      font-size: 13px;
      line-height: 1.55;
      color: #1a1a1a;
      background: #f4f4f5;
      min-height: 100vh;
      padding: 24px 16px;
      direction: rtl;
    }
    .invoice {
      max-width: 800px;
      margin: 0 auto;
      background: #ffffff;
      border: 1px solid #1a1a1a;
      padding: 32px 34px;
    }

    /* Header */
    .invoice-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 28px;
      padding-bottom: 20px;
      border-bottom: 1px solid #1a1a1a;
      margin-bottom: 24px;
    }
    .brand { max-width: 340px; }
    .brand .logo { max-height: 70px; max-width: 180px; margin-bottom: 10px; display: block; }
    .brand .name { font-size: 15px; font-weight: 700; color: #1a1a1a; }
    .brand .tax {
      font-size: 12px;
      color: #1a1a1a;
      margin-top: 2px;
      direction: ltr;
      text-align: right;
      font-variant-numeric: tabular-nums;
      font-weight: 500;
    }
    .brand .address { font-size: 12px; color: #1a1a1a; margin-top: 8px; line-height: 1.55; font-weight: 500; }
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
      color: #1a1a1a;
      margin-bottom: 14px;
      opacity: 0.7;
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

    /* Customer info */
    .customer {
      margin-bottom: 22px;
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
    .customer-grid .cell { padding: 9px 14px; }
    .customer-grid .cell:not(:nth-child(3n+1)) { border-right: 1px solid #1a1a1a; }
    .customer-grid .cell:nth-child(n+4) { border-top: 1px solid #1a1a1a; }
    .customer-grid .label {
      font-size: 10px;
      font-weight: 700;
      color: #1a1a1a;
      letter-spacing: 0.3px;
      margin-bottom: 3px;
      opacity: 0.75;
    }
    .customer-grid .value {
      font-size: 13px;
      font-weight: 600;
      color: #1a1a1a;
    }

    /* Payment details stacked row layout (same styling as the meta box) */
    .payment-box {
      margin-bottom: 22px;
      border: 1px solid #1a1a1a;
    }
    .payment-box .body {
      display: flex;
      flex-direction: column;
    }
    .payment-box .row { display: flex; }
    .payment-box .row + .row { border-top: 1px solid #1a1a1a; }
    .payment-box .row .label {
      flex: 0 0 140px;
      padding: 9px 14px;
      background: #f4f4f5;
      font-weight: 700;
      color: #1a1a1a;
      font-size: 11.5px;
      border-left: 1px solid #1a1a1a;
    }
    .payment-box .row .val {
      flex: 1;
      padding: 9px 14px;
      font-weight: 700;
      color: #1a1a1a;
      font-variant-numeric: tabular-nums;
    }

    /* Amount hero */
    .hero {
      display: flex;
      align-items: stretch;
      border: 1px solid #1a1a1a;
      margin-bottom: 22px;
    }
    .hero .label {
      flex: 0 0 180px;
      padding: 18px 14px;
      background: #1a1a1a;
      color: #ffffff;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 1.3px;
      text-transform: uppercase;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .hero .val {
      flex: 1;
      padding: 18px 24px;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      font-size: 36px;
      font-weight: 800;
      color: #1a1a1a;
      font-variant-numeric: tabular-nums;
      direction: ltr;
    }

    /* Note linking to the policy */
    .policy-note {
      border: 1px solid #1a1a1a;
      padding: 12px 16px;
      margin-bottom: 24px;
      font-size: 12px;
      color: #1a1a1a;
      background: #f9fafb;
    }
    .policy-note strong {
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      direction: ltr;
      display: inline-block;
    }

    /* Footer */
    .footer {
      padding-top: 16px;
      border-top: 1px solid #1a1a1a;
      font-size: 12px;
      color: #1a1a1a;
      text-align: center;
    }
    .footer .thanks {
      font-weight: 700;
      margin-bottom: 6px;
    }
    .footer .contact { line-height: 1.8; }
    .footer .contact a { color: #1a1a1a; text-decoration: none; }
    .footer .issued { margin-top: 10px; opacity: 0.7; }

    .actions {
      margin-top: 18px;
      display: flex;
      gap: 10px;
      justify-content: center;
    }
    .actions button {
      padding: 10px 22px;
      background: #1a1a1a;
      color: #ffffff;
      border: none;
      font-family: inherit;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      letter-spacing: 0.5px;
    }
    .actions button:hover { opacity: 0.85; }

    @media (max-width: 640px) {
      body { padding: 14px 8px; font-size: 12px; }
      .invoice { padding: 24px 20px; }
      .invoice-top { flex-direction: column; gap: 18px; }
      .invoice-meta { text-align: right; min-width: 0; }
      .invoice-meta .doc-title { font-size: 32px; }
      .customer-grid { grid-template-columns: 1fr; }
      .customer-grid .cell:not(:nth-child(3n+1)) { border-right: none; }
      .customer-grid .cell:nth-child(n+2) { border-top: 1px solid #1a1a1a; }
      .hero .label { flex: 0 0 120px; padding: 14px 10px; font-size: 11px; }
      .hero .val { font-size: 26px; padding: 14px 14px; }
      .payment-box .row .label { flex: 0 0 110px; }
    }
  </style>
</head>
<body>
  <div class="invoice">
    <!-- Header: brand on the right, doc metadata on the left -->
    <div class="invoice-top">
      <div class="brand">
        ${branding.logoUrl ? `<img class="logo" src="${branding.logoUrl}" alt="${escapeHtml(branding.companyName)}" />` : ''}
        <div class="name">${escapeHtml(branding.companyName)}</div>
        ${branding.taxNumber ? `<div class="tax">رقم المشغل: ${escapeHtml(branding.taxNumber)}</div>` : ''}
        ${branding.invoiceAddress ? `<div class="address">${escapeHtml(branding.invoiceAddress)}</div>`
          : (companySettings.company_location ? `<div class="address">${escapeHtml(companySettings.company_location)}</div>` : '')}
      </div>
      <div class="invoice-meta">
        <div class="doc-title">سند قبض</div>
        <div class="subtitle">إيصال دفع</div>
        <div class="meta-rows">
          <div class="row">
            <div class="label">رقم السند</div>
            <div class="val">${escapeHtml(receiptNumber)}</div>
          </div>
          <div class="row">
            <div class="label">التاريخ</div>
            <div class="val">${formatDate(payment.payment_date || today.toISOString())}</div>
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
          <div class="value">${escapeHtml(client.full_name || '-')}</div>
        </div>
        <div class="cell">
          <div class="label">رقم الهوية</div>
          <div class="value">${escapeHtml(client.id_number || '-')}</div>
        </div>
        <div class="cell">
          <div class="label">رقم الهاتف</div>
          <div class="value">${escapeHtml(client.phone_number || '-')}</div>
        </div>
      </div>
    </div>

    <!-- Amount hero -->
    <div class="hero">
      <div class="label">المبلغ المدفوع</div>
      <div class="val">₪${(payment.amount || 0).toLocaleString('en-US')}</div>
    </div>

    <!-- Payment details (no وصف) -->
    <div class="payment-box">
      <div class="section-title">تفاصيل الدفع</div>
      <div class="body">
        <div class="row">
          <div class="label">طريقة الدفع</div>
          <div class="val">${escapeHtml(paymentTypeLabel)}</div>
        </div>
        <div class="row">
          <div class="label">تاريخ الدفع</div>
          <div class="val">${formatDate(payment.payment_date)}</div>
        </div>
        ${extraDetailsHtml}
      </div>
    </div>

    <!-- Policy link note -->
    <div class="policy-note">
      هذا السند يخص الوثيقة رقم <strong>${escapeHtml(policyDocumentNumber)}</strong>.
    </div>

    <!-- Footer -->
    <div class="footer">
      <div class="thanks">شكراً لثقتكم</div>
      ${contactFooterHtml}
      <div class="issued">تاريخ الإصدار: ${formatDate(today.toISOString())}</div>
    </div>

    <div class="actions no-print">
      <button type="button" onclick="window.print()">طباعة</button>
      <button type="button" onclick="shareReceipt()">مشاركة</button>
    </div>
  </div>

  <script>
    function shareReceipt() {
      var url = window.location.href;
      if (navigator.share) {
        navigator.share({ title: 'سند قبض', url: url }).catch(function(){});
      } else {
        window.open('https://wa.me/?text=' + encodeURIComponent('سند قبض: ' + url), '_blank');
      }
    }
  </script>
</body>
</html>
  `;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

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

    const { payment_id }: GeneratePaymentReceiptRequest = await req.json();

    if (!payment_id) {
      return new Response(
        JSON.stringify({ error: "payment_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[generate-payment-receipt] Processing payment: ${payment_id}`);

    // Fetch company settings for contact info
    const { data: smsSettings } = await supabase
      .from("sms_settings")
      .select("company_email, company_phone_links, company_location")
      .limit(1)
      .maybeSingle();

    const companySettings = {
      company_email: smsSettings?.company_email || '',
      company_phone_links: (smsSettings?.company_phone_links as any[]) || [],
      company_location: smsSettings?.company_location || '',
    };

    // Get payment with policy and client info
    const { data: payment, error: paymentError } = await supabase
      .from("policy_payments")
      .select(`
        id,
        amount,
        payment_type,
        payment_date,
        cheque_number,
        cheque_date,
        card_last_four,
        card_expiry,
        installments_count,
        tranzila_approval_code,
        notes,
        receipt_number,
        policy:policies(
          id,
          policy_number,
          document_number,
          policy_type_parent,
          policy_type_child,
          start_date,
          end_date,
          insurance_price,
          client:clients(id, full_name, id_number, phone_number),
          car:cars(car_number, manufacturer_name, model, year)
        )
      `)
      .eq("id", payment_id)
      .single();

    if (paymentError || !payment) {
      console.error("[generate-payment-receipt] Payment not found:", paymentError);
      return new Response(
        JSON.stringify({ error: "Payment not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const policy = (payment as any).policy;
    const client = policy?.client?.[0] || policy?.client || {};
    const car = policy?.car?.[0] || policy?.car || {};

    if (!bunnyApiKey || !bunnyStorageZone) {
      // Return HTML directly without storing
      const receiptHtml = buildPaymentReceiptHtml(payment, policy, client, car, companySettings, branding);
      return new Response(receiptHtml, {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" }
      });
    }

    // Generate receipt HTML
    const receiptHtml = buildPaymentReceiptHtml(payment, policy, client, car, companySettings, branding);
    
    // Upload to Bunny CDN
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const timestamp = Date.now();
    const randomId = crypto.randomUUID().slice(0, 8);
    const clientNameSafe = client?.full_name?.replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '_') || 'customer';
    const storagePath = `receipts/${year}/${month}/receipt_${clientNameSafe}_${timestamp}_${randomId}.html`;

    const bunnyUploadUrl = buildBunnyStorageUploadUrl(bunnyStorageZone, storagePath);
    
    console.log(`[generate-payment-receipt] Uploading receipt to: ${bunnyUploadUrl}`);

    const uploadResponse = await fetch(bunnyUploadUrl, {
      method: 'PUT',
      headers: {
        'AccessKey': bunnyApiKey,
        'Content-Type': 'text/html; charset=utf-8',
      },
      body: receiptHtml,
    });

    if (!uploadResponse.ok) {
      console.error('[generate-payment-receipt] Bunny upload failed');
      // Return HTML directly as fallback
      return new Response(receiptHtml, {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" }
      });
    }

    const receiptUrl = `${bunnyCdnUrl}/${storagePath}`;
    console.log(`[generate-payment-receipt] Receipt uploaded: ${receiptUrl}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        receipt_url: receiptUrl,
        payment_id: payment_id
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    console.error("[generate-payment-receipt] Fatal error:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
