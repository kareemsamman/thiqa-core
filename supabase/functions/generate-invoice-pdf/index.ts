import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GenerateInvoicePdfRequest {
  policy_id: string;
  invoice_id?: string; // If provided, regenerate for this specific invoice
}

// Map policy types to Arabic labels
const POLICY_TYPE_LABELS = {
  ELZAMI: 'إلزامي',
  THIRD_FULL: 'ثالث/شامل',
  ROAD_SERVICE: 'خدمات الطريق',
  ACCIDENT_FEE_EXEMPTION: 'إعفاء رسوم حادث',
  THIRD: 'ثالث',
  FULL: 'شامل',
};

const PAYMENT_TYPE_LABELS = {
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

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
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

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
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

    if (!bunnyApiKey || !bunnyStorageZone) {
      console.error('[generate-invoice-pdf] Missing Bunny configuration');
      return new Response(
        JSON.stringify({ error: 'Storage not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { policy_id, invoice_id } = await req.json() as GenerateInvoicePdfRequest;

    if (!policy_id) {
      return new Response(
        JSON.stringify({ error: 'policy_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[generate-invoice-pdf] Starting for policy: ${policy_id}`);

    // Fetch policy with all related data
    const { data: policy, error: policyError } = await supabase
      .from('policies')
      .select(`
        *,
        client:clients(full_name, id_number, phone_number, signature_url),
        car:cars(car_number, manufacturer_name, model, year, car_type, color, license_type),
        company:insurance_companies(name, name_ar),
        broker:brokers(name),
        created_by:profiles!policies_created_by_admin_id_fkey(full_name, email)
      `)
      .eq('id', policy_id)
      .single();

    if (policyError || !policy) {
      console.error(`[generate-invoice-pdf] Policy not found: ${policy_id}`, policyError);
      return new Response(
        JSON.stringify({ error: 'Policy not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch additional drivers (policy_children)
    const { data: policyChildren } = await supabase
      .from('policy_children')
      .select(`
        id,
        child:client_children(id, full_name, id_number, relation, phone)
      `)
      .eq('policy_id', policy_id);

    const additionalDrivers = (policyChildren || [])
      .filter(pc => pc.child)
      .map(pc => pc.child);

    console.log(`[generate-invoice-pdf] Found ${additionalDrivers.length} additional drivers`);

    // Get payment details
    const { data: payments } = await supabase
      .from('policy_payments')
      .select('payment_type, amount, payment_date')
      .eq('policy_id', policy_id)
      .eq('refused', false)
      .order('created_at', { ascending: true });

    const paymentType = payments?.[0]?.payment_type || 'cash';
    const totalPaid = payments?.reduce((sum, p) => sum + (p.amount || 0), 0) || 0;
    const remaining = (policy.insurance_price || 0) - totalPaid;

    // Build comprehensive invoice HTML
    const htmlContent = buildAbInvoiceHtml(policy, payments || [], paymentType, additionalDrivers);

    // Convert HTML to PDF using an external service or generate as HTML file
    // For now, we'll create an HTML file that can be printed as PDF
    // In production, you could use a service like html2pdf.app, pdfshift.io, or self-hosted Puppeteer

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const timestamp = Date.now();
    const randomId = crypto.randomUUID().slice(0, 8);
    const fileName = `invoice_${policy.client?.full_name?.replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '_') || 'customer'}_${timestamp}`;
    const storagePath = `invoices/${year}/${month}/${fileName}_${randomId}.html`;

    // Upload HTML to Bunny Storage
    const bunnyUploadUrl = `https://storage.bunnycdn.com/${bunnyStorageZone}/${storagePath}`;
    
    console.log(`[generate-invoice-pdf] Uploading to: ${bunnyUploadUrl}`);

    const uploadResponse = await fetch(bunnyUploadUrl, {
      method: 'PUT',
      headers: {
        'AccessKey': bunnyApiKey,
        'Content-Type': 'text/html; charset=utf-8',
      },
      body: htmlContent,
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error('[generate-invoice-pdf] Bunny upload failed:', errorText);
      return new Response(
        JSON.stringify({ error: 'Failed to upload invoice' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const cdnUrl = `${bunnyCdnUrl}/${storagePath}`;
    console.log(`[generate-invoice-pdf] Invoice uploaded: ${cdnUrl}`);

    // Update invoice record if invoice_id provided
    if (invoice_id) {
      const { error: updateError } = await supabase
        .from('invoices')
        .update({
          pdf_url: cdnUrl,
          updated_at: new Date().toISOString(),
        })
        .eq('id', invoice_id);

      if (updateError) {
        console.error('[generate-invoice-pdf] Error updating invoice:', updateError);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[generate-invoice-pdf] Completed in ${duration}ms`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        pdf_url: cdnUrl,
        duration_ms: duration
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    console.error('[generate-invoice-pdf] Error:', error);
    return new Response(
      JSON.stringify({ error: 'An error occurred while generating the invoice.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString('ar-SA');
}

function getInsuranceTypeLabel(parent: string, child: string | null): string {
  const parentLabel = POLICY_TYPE_LABELS[parent as keyof typeof POLICY_TYPE_LABELS] || parent;
  if (child && POLICY_TYPE_LABELS[child as keyof typeof POLICY_TYPE_LABELS]) {
    return `${parentLabel} - ${POLICY_TYPE_LABELS[child as keyof typeof POLICY_TYPE_LABELS]}`;
  }
  return parentLabel;
}

function buildAbInvoiceHtml(
  policy: any,
  payments: any[],
  paymentType: string,
  additionalDrivers: any[] = []
): string {
  const client = policy.client || {};
  const car = policy.car || {};
  const company = policy.company || {};
  const broker = policy.broker || {};
  const createdBy = policy.created_by || {};

  const totalPaid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
  const remaining = (policy.insurance_price || 0) - totalPaid;
  const isPaid = remaining <= 0;

  const insuranceType = getInsuranceTypeLabel(policy.policy_type_parent, policy.policy_type_child);
  const carType = CAR_TYPE_LABELS[car.car_type] || car.car_type || '-';
  const paymentLabel = PAYMENT_TYPE_LABELS[paymentType as keyof typeof PAYMENT_TYPE_LABELS] || paymentType;

  // Build payments table rows
  const paymentRows = payments.map((p, i) => `
    <tr>
      <td style="padding: 8px; border: 1px solid #ddd;">${i + 1}</td>
      <td style="padding: 8px; border: 1px solid #ddd;">${formatDate(p.payment_date)}</td>
      <td style="padding: 8px; border: 1px solid #ddd;">${PAYMENT_TYPE_LABELS[p.payment_type as keyof typeof PAYMENT_TYPE_LABELS] || p.payment_type}</td>
      <td style="padding: 8px; border: 1px solid #ddd;">₪${p.amount?.toLocaleString() || 0}</td>
    </tr>
  `).join('');

  return `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>فاتورة - ${client.full_name || 'عميل'}</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    @page {
      size: A4;
      margin: 15mm;
    }
    body {
      font-family: 'Segoe UI', Tahoma, Arial, sans-serif;
      font-size: 14px;
      line-height: 1.6;
      color: #333;
      background: #fff;
      padding: 20px;
      direction: rtl;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
    }
    .header {
      text-align: center;
      margin-bottom: 30px;
      padding-bottom: 20px;
      border-bottom: 3px solid #1a365d;
    }
    .header h1 {
      color: #1a365d;
      font-size: 28px;
      margin-bottom: 5px;
    }
    .header p {
      color: #666;
      font-size: 14px;
    }
    .invoice-meta {
      display: flex;
      justify-content: space-between;
      margin-bottom: 25px;
      background: #f8fafc;
      padding: 15px;
      border-radius: 8px;
    }
    .invoice-meta div {
      text-align: center;
    }
    .invoice-meta strong {
      display: block;
      color: #1a365d;
      font-size: 12px;
      margin-bottom: 5px;
    }
    .section {
      margin-bottom: 25px;
    }
    .section-title {
      background: #1a365d;
      color: white;
      padding: 10px 15px;
      font-size: 16px;
      font-weight: bold;
      border-radius: 5px 5px 0 0;
    }
    .section-content {
      border: 1px solid #e2e8f0;
      border-top: none;
      padding: 15px;
      border-radius: 0 0 5px 5px;
    }
    .info-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 15px;
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
      color: #666;
      font-weight: 500;
    }
    .info-value {
      color: #1a365d;
      font-weight: 600;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
    }
    th {
      background: #f1f5f9;
      padding: 10px;
      border: 1px solid #ddd;
      text-align: right;
      font-weight: 600;
      color: #1a365d;
    }
    td {
      padding: 8px 10px;
      border: 1px solid #ddd;
      text-align: right;
    }
    .total-row {
      background: #f8fafc;
      font-weight: bold;
    }
    .total-row td {
      color: #1a365d;
    }
    .status-badge {
      display: inline-block;
      padding: 5px 15px;
      border-radius: 20px;
      font-size: 14px;
      font-weight: bold;
    }
    .status-paid {
      background: #dcfce7;
      color: #166534;
    }
    .status-partial {
      background: #fef3c7;
      color: #92400e;
    }
    .status-unpaid {
      background: #fee2e2;
      color: #991b1b;
    }
    .summary-box {
      background: linear-gradient(135deg, #1a365d 0%, #2d4a7c 100%);
      color: white;
      padding: 20px;
      border-radius: 10px;
      margin-top: 25px;
    }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 20px;
      text-align: center;
    }
    .summary-item strong {
      display: block;
      font-size: 12px;
      opacity: 0.8;
      margin-bottom: 5px;
    }
    .summary-item span {
      font-size: 22px;
      font-weight: bold;
    }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 2px solid #e2e8f0;
      text-align: center;
      color: #666;
      font-size: 12px;
    }
    .signature-section {
      margin-top: 30px;
      display: flex;
      justify-content: space-between;
    }
    .signature-box {
      width: 45%;
      text-align: center;
    }
    .signature-line {
      border-top: 1px solid #333;
      margin-top: 50px;
      padding-top: 10px;
    }
    @media print {
      body {
        padding: 0;
        font-size: 12px;
      }
      .no-print {
        display: none;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${companyName}</h1>
      <p>بوليصة تأمين</p>
    </div>

    <div class="invoice-meta">
      <div>
        <strong>تاريخ الإصدار</strong>
        ${formatDate(new Date().toISOString())}
      </div>
      <div>
        <strong>رقم البوليصة</strong>
        ${policy.policy_number || '-'}
      </div>
      <div>
        <strong>حالة الدفع</strong>
        <span class="status-badge ${isPaid ? 'status-paid' : remaining < (policy.insurance_price || 0) ? 'status-partial' : 'status-unpaid'}">
          ${isPaid ? 'مدفوع' : remaining < (policy.insurance_price || 0) ? 'دفع جزئي' : 'غير مدفوع'}
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
          <div class="info-item">
            <span class="info-label">الوسيط:</span>
            <span class="info-value">${broker.name || '-'}</span>
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

    ${additionalDrivers.length > 0 ? `
    <div class="section">
      <div class="section-title">السائقين الإضافيين (${additionalDrivers.length})</div>
      <div class="section-content" style="padding: 0;">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>الاسم</th>
              <th>رقم الهوية</th>
              <th>الصلة</th>
            </tr>
          </thead>
          <tbody>
            ${additionalDrivers.map((driver: any, i: number) => `
              <tr>
                <td style="padding: 8px; border: 1px solid #ddd;">${i + 1}</td>
                <td style="padding: 8px; border: 1px solid #ddd;">${driver.full_name || '-'}</td>
                <td style="padding: 8px; border: 1px solid #ddd;">${driver.id_number || '-'}</td>
                <td style="padding: 8px; border: 1px solid #ddd;">${driver.relation || '-'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
    ` : ''}

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
        <div class="signature-line">توقيع العميل</div>
        ${client.signature_url ? `<img src="${client.signature_url}" alt="توقيع العميل" style="max-height: 60px; margin-top: 10px;">` : ''}
      </div>
      <div class="signature-box">
        <div class="signature-line">توقيع الموظف</div>
      </div>
    </div>

    <div class="footer">
      <p>شكراً لثقتكم بنا - ${companyName}</p>
      <p style="margin-top: 5px;">هذه الفاتورة تم إنشاؤها إلكترونياً وهي صالحة بدون توقيع</p>
    </div>
  </div>
</body>
</html>
  `.trim();
}
