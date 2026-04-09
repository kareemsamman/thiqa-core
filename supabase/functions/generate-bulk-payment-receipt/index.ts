import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import { getAgentBranding, resolveAgentId, type AgentBranding } from "../_shared/agent-branding.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface BulkReceiptRequest {
  payment_ids: string[];
  total_amount?: number; // optional verification
}

const PAYMENT_TYPE_LABELS: Record<string, string> = {
  cash: 'نقدي',
  cheque: 'شيك',
  visa: 'بطاقة ائتمان',
  transfer: 'تحويل بنكي',
};

const POLICY_TYPE_LABELS: Record<string, string> = {
  ELZAMI: 'إلزامي',
  THIRD_FULL: 'ثالث/شامل',
  ROAD_SERVICE: 'خدمات الطريق',
  ACCIDENT_FEE_EXEMPTION: 'إعفاء رسوم حادث',
  THIRD: 'ثالث',
  FULL: 'شامل',
  HEALTH: 'تأمين صحي',
  LIFE: 'تأمين حياة',
  PROPERTY: 'تأمين ممتلكات',
  TRAVEL: 'تأمين سفر',
  BUSINESS: 'تأمين أعمال',
  OTHER: 'أخرى',
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

interface PhoneLink {
  phone: string;
  href: string;
}

function buildBulkReceiptHtml(
  payments: any[],
  totalAmount: number,
  client: any,
  car: any,
  policyTypes: string[],
  paymentDate: string,
  paymentType: string,
  companySettings: { company_email?: string; company_phone_links?: PhoneLink[]; company_location?: string }
): string {
  const paymentTypeLabel = PAYMENT_TYPE_LABELS[paymentType] || paymentType;
  
  // Get unique policy type labels
  const uniquePolicyLabels = [...new Set(policyTypes)].map(type => 
    POLICY_TYPE_LABELS[type] || type
  );
  
  const policyTypesText = uniquePolicyLabels.join(' + ');
  
  // Build phone links section
  const phoneLinksHtml = (companySettings.company_phone_links || []).map(
    (link: PhoneLink) => `<a href="${link.href}">${link.phone}</a>`
  ).join(' | ');

  // Receipt ID from first payment
  const receiptId = payments[0]?.id?.slice(0, 8).toUpperCase() || crypto.randomUUID().slice(0, 8);

  return `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap" rel="stylesheet">
  <title>إيصال دفع - ${client?.full_name || 'عميل'}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    @page { size: A5; margin: 10mm; }
    @media print {
      body { padding: 0; }
      .no-print { display: none !important; }
    }
    body {
      font-family: 'Tajawal', 'Segoe UI', Tahoma, Arial, sans-serif;
      font-size: 14px;
      line-height: 1.6;
      color: #2d3748;
      background: #122143;
      min-height: 100vh;
      padding: 24px 16px;
      direction: rtl;
    }
    .container { 
      max-width: 500px; 
      margin: 0 auto; 
      background: white;
      border-radius: 20px;
      box-shadow: 0 8px 40px rgba(0,0,0,0.25);
      overflow: hidden;
    }
    .header {
      text-align: center;
      padding: 25px 20px;
      background: linear-gradient(135deg, #122143 0%, #1a3260 100%);
      color: white;
    }
    .header h1 { 
      font-size: 24px; 
      font-weight: 800;
      margin-bottom: 5px;
    }
    .header .english-name {
      font-size: 12px;
      letter-spacing: 2px;
      opacity: 0.8;
      margin-bottom: 10px;
    }
    .header .receipt-title {
      font-size: 18px;
      font-weight: 700;
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid rgba(255,255,255,0.3);
    }
    .receipt-number {
      background: rgba(255,255,255,0.15);
      padding: 8px 16px;
      border-radius: 20px;
      font-size: 12px;
      display: inline-block;
      margin-top: 10px;
    }
    .amount-section {
      text-align: center;
      padding: 30px 20px;
      background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%);
    }
    .amount-label {
      font-size: 14px;
      color: #065f46;
      font-weight: 500;
      margin-bottom: 8px;
    }
    .amount-value {
      font-size: 42px;
      font-weight: 800;
      color: #047857;
    }
    .amount-currency {
      font-size: 24px;
    }
    .section {
      padding: 20px;
      border-bottom: 1px solid #e2e8f0;
    }
    .section:last-child {
      border-bottom: none;
    }
    .section-title {
      font-size: 14px;
      font-weight: 700;
      color: #1e3a5f;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .section-icon {
      font-size: 16px;
    }
    .info-item {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px dashed #e2e8f0;
    }
    .info-item:last-child {
      border-bottom: none;
    }
    .info-label {
      color: #718096;
      font-weight: 500;
      font-size: 13px;
    }
    .info-value {
      color: #1e3a5f;
      font-weight: 700;
      font-size: 13px;
    }
    .payment-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 700;
    }
    .badge-cash { background: #d1fae5; color: #065f46; }
    .badge-visa { background: #dbeafe; color: #1e40af; }
    .badge-cheque { background: #fef3c7; color: #92400e; }
    .badge-transfer { background: #e9d5ff; color: #6b21a8; }
    .package-badge {
      display: inline-block;
      padding: 8px 16px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 700;
      margin-top: 10px;
    }
    .footer {
      text-align: center;
      padding: 20px;
      background: #f8fafc;
      color: #718096;
      font-size: 12px;
    }
    .thank-you {
      font-size: 16px;
      font-weight: 700;
      color: #1e3a5f;
      margin-bottom: 12px;
    }
    .contact-info {
      margin: 15px 0;
      padding: 12px;
      background: #f1f5f9;
      border-radius: 8px;
      display: inline-block;
      text-align: center;
    }
    .contact-row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 4px 0;
      color: #1e3a5f;
      font-size: 12px;
    }
    .contact-row a {
      color: #2563eb;
      text-decoration: none;
    }
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
    .print-button:hover, .share-button:hover {
      opacity: 0.9;
    }
    @media (max-width: 500px) {
      body { padding: 10px; }
      .container { border-radius: 12px; }
      .amount-value { font-size: 36px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      ${branding.logoUrl ? `<img src="${branding.logoUrl}" alt="${branding.companyName}" style="max-height:50px;object-fit:contain;margin:0 auto 8px auto;display:block;" />` : ''}
      <h1>${branding.companyName}</h1>
      ${branding.companyNameEn ? `<p class="english-name">${branding.companyNameEn}</p>` : ''}
      <p class="receipt-title">إيصال دفع</p>
      <div class="receipt-number">رقم: ${receiptId}</div>
    </div>

    <div class="amount-section">
      <p class="amount-label">المبلغ المدفوع</p>
      <p class="amount-value">
        <span class="amount-currency">₪</span>${totalAmount.toLocaleString()}
      </p>
    </div>

    <div class="section">
      <div class="section-title">
        <span class="section-icon">💳</span>
        تفاصيل الدفع
      </div>
      <div class="info-item">
        <span class="info-label">تاريخ الدفع:</span>
        <span class="info-value">${formatDate(paymentDate)}</span>
      </div>
      <div class="info-item">
        <span class="info-label">طريقة الدفع:</span>
        <span class="info-value">
          <span class="payment-badge badge-${paymentType}">${paymentTypeLabel}</span>
        </span>
      </div>
    </div>

    <div class="section">
      <div class="section-title">
        <span class="section-icon">👤</span>
        بيانات العميل
      </div>
      <div class="info-item">
        <span class="info-label">الاسم:</span>
        <span class="info-value">${client?.full_name || '-'}</span>
      </div>
      <div class="info-item">
        <span class="info-label">رقم الهوية:</span>
        <span class="info-value">${client?.id_number || '-'}</span>
      </div>
      ${car?.car_number ? `
      <div class="info-item">
        <span class="info-label">رقم السيارة:</span>
        <span class="info-value">${car.car_number}</span>
      </div>
      ` : ''}
    </div>

    <div class="section">
      <div class="section-title">
        <span class="section-icon">📦</span>
        باقة التأمين
      </div>
      <div style="text-align: center;">
        <span class="package-badge">📋 ${policyTypesText}</span>
      </div>
    </div>

    <div class="footer">
      <p class="thank-you">شكراً لتعاملكم معنا 🙏</p>
      <div class="contact-info">
        ${companySettings.company_email ? `
        <div class="contact-row">
          <span>📧</span>
          <a href="mailto:${companySettings.company_email}">${companySettings.company_email}</a>
        </div>
        ` : ''}
        ${companySettings.company_phone_links && companySettings.company_phone_links.length > 0 ? `
        <div class="contact-row">
          <span>📞</span>
          ${phoneLinksHtml}
        </div>
        ` : ''}
        ${companySettings.company_location ? `
        <div class="contact-row">
          <span>📍</span>
          <span>${companySettings.company_location}</span>
        </div>
        ` : ''}
      </div>
      <p>تم إصدار هذا الإيصال بتاريخ ${formatDate(new Date().toISOString())}</p>
      <div class="action-buttons no-print">
        <button class="print-button" onclick="window.print()">🖨️ طباعة الإيصال</button>
        <button class="share-button" onclick="shareInvoice()">📲 مشاركة</button>
      </div>
    </div>
  </div>
  <script>
    function shareInvoice() {
      const currentUrl = window.location.href;
      const shareText = 'إيصال دفع التأمين: ' + currentUrl;
      if (navigator.share) {
        navigator.share({ title: 'إيصال دفع', text: 'إيصال دفع التأمين الخاص بك', url: currentUrl }).catch(console.error);
      } else {
        window.open('https://wa.me/?text=' + encodeURIComponent(shareText), '_blank');
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
    const bunnyStorageZone = Deno.env.get('BUNNY_STORAGE_ZONE');
    const bunnyCdnUrl = Deno.env.get('BUNNY_CDN_URL') || 'https://kareem.b-cdn.net';

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

    const { payment_ids, total_amount }: BulkReceiptRequest = await req.json();

    if (!payment_ids || payment_ids.length === 0) {
      return new Response(
        JSON.stringify({ error: "payment_ids is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[generate-bulk-payment-receipt] Processing ${payment_ids.length} payments`);

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

    // Fetch all payments with policy info
    const { data: payments, error: paymentsError } = await supabase
      .from("policy_payments")
      .select(`
        id,
        amount,
        payment_type,
        payment_date,
        policy:policies(
          id,
          policy_type_parent,
          policy_type_child,
          client:clients(id, full_name, id_number, phone_number),
          car:cars(car_number, manufacturer_name, model, year)
        )
      `)
      .in("id", payment_ids);

    if (paymentsError || !payments || payments.length === 0) {
      console.error("[generate-bulk-payment-receipt] Payments not found:", paymentsError);
      return new Response(
        JSON.stringify({ error: "Payments not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Calculate total from payments
    const calculatedTotal = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
    const finalTotal = total_amount || calculatedTotal;

    // Get client and car info from first payment
    const firstPolicy = (payments[0] as any).policy;
    const client = firstPolicy?.client?.[0] || firstPolicy?.client || {};
    const car = firstPolicy?.car?.[0] || firstPolicy?.car || {};

    // Collect all policy types
    const policyTypes: string[] = [];
    for (const payment of payments) {
      const policy = (payment as any).policy;
      if (policy?.policy_type_parent) {
        // Use child type for THIRD_FULL
        if (policy.policy_type_parent === 'THIRD_FULL' && policy.policy_type_child) {
          policyTypes.push(policy.policy_type_child);
        } else {
          policyTypes.push(policy.policy_type_parent);
        }
      }
    }

    // Get payment date and type from first payment
    const paymentDate = payments[0].payment_date || new Date().toISOString();
    const paymentType = payments[0].payment_type || 'cash';

    console.log(`[generate-bulk-payment-receipt] Total: ${finalTotal}, Policy types: ${policyTypes.join(', ')}`);

    // Generate receipt HTML
    const receiptHtml = buildBulkReceiptHtml(
      payments,
      finalTotal,
      client,
      car,
      policyTypes,
      paymentDate,
      paymentType,
      companySettings
    );

    if (!bunnyApiKey || !bunnyStorageZone) {
      // Return HTML directly without storing
      return new Response(receiptHtml, {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" }
      });
    }

    // Upload to Bunny CDN
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const timestamp = Date.now();
    const randomId = crypto.randomUUID().slice(0, 8);
    const clientNameSafe = client?.full_name?.replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '_') || 'customer';
    const storagePath = `receipts/${year}/${month}/bulk_receipt_${clientNameSafe}_${timestamp}_${randomId}.html`;

    const bunnyUploadUrl = `https://storage.bunnycdn.com/${bunnyStorageZone}/${storagePath}`;
    
    console.log(`[generate-bulk-payment-receipt] Uploading receipt to: ${bunnyUploadUrl}`);

    const uploadResponse = await fetch(bunnyUploadUrl, {
      method: 'PUT',
      headers: {
        'AccessKey': bunnyApiKey,
        'Content-Type': 'text/html; charset=utf-8',
      },
      body: receiptHtml,
    });

    if (!uploadResponse.ok) {
      console.error('[generate-bulk-payment-receipt] Bunny upload failed');
      // Return HTML directly as fallback
      return new Response(receiptHtml, {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" }
      });
    }

    const receiptUrl = `${bunnyCdnUrl}/${storagePath}`;
    console.log(`[generate-bulk-payment-receipt] Receipt uploaded: ${receiptUrl}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        receipt_url: receiptUrl,
        total_amount: finalTotal,
        payment_count: payments.length
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    console.error("[generate-bulk-payment-receipt] Fatal error:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
