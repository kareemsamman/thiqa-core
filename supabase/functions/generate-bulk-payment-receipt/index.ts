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

function escapeHtml(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function paymentTypeLabel(p: { payment_type: string; locked?: boolean | null }): string {
  if (p.locked && p.payment_type === 'visa') return 'فيزا خارجي';
  return PAYMENT_TYPE_LABELS[p.payment_type] || p.payment_type;
}

function buildBulkReceiptHtml(
  payments: any[],
  totalAmount: number,
  client: any,
  car: any,
  _policyTypes: string[],
  _paymentDate: string,
  _paymentType: string,
  companySettings: { company_email?: string; company_phone_links?: PhoneLink[]; company_location?: string },
  branding: AgentBranding = { companyName: 'وكالة التأمين', companyNameEn: '', logoUrl: null, siteDescription: '' } as AgentBranding,
): string {
  const today = new Date();
  const primaryDocumentNumber = payments
    .map((p: any) => p.policy?.document_number)
    .find((n: string | null) => typeof n === 'string' && n.length > 0) || '—';

  // Sum office_commission once per unique policy. Multiple payment rows
  // may reference the same policy — we don't want to count its
  // commission N times. Policies with a null / zero commission simply
  // don't contribute; the whole row is suppressed when the total is 0.
  const uniquePolicyCommissions = new Map<string, number>();
  for (const p of payments) {
    const policy = (p as any).policy;
    const pid = policy?.id;
    const commission = Number(policy?.office_commission) || 0;
    if (pid && commission > 0 && !uniquePolicyCommissions.has(pid)) {
      uniquePolicyCommissions.set(pid, commission);
    }
  }
  const totalCommission = Array.from(uniquePolicyCommissions.values()).reduce(
    (s, c) => s + c,
    0,
  );

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

  // Rows for the receipts table. Refused rows are tagged and styled
  // with a strikethrough; their amounts are excluded from the total
  // so they don't count toward what the client actually paid. A
  // dedicated ملاحظات column surfaces per-payment notes at the end —
  // only rendered when at least one payment actually has notes, so
  // the table stays compact otherwise.
  const anyNotes = payments.some(
    (p: any) => typeof p.notes === 'string' && p.notes.trim().length > 0,
  );
  const receiptRows = payments.map((p: any) => {
    const num = p.receipt_number || '—';
    const typeLbl = paymentTypeLabel(p);
    const extra = p.cheque_number ? ` · ${p.cheque_number}` : '';
    const refused = !!p.refused;
    const rowClass = refused ? ' class="refused"' : '';
    const refusedBadge = refused
      ? ' <span class="refused-tag">مرفوضة</span>'
      : '';
    const amount = Number(p.amount || 0).toLocaleString('en-US');
    const amountCell = refused
      ? `<span class="struck">₪${amount}</span>`
      : `₪${amount}`;
    const notesCell = anyNotes
      ? `<td class="notes">${escapeHtml(p.notes || '').replace(/\n/g, '<br>') || '—'}</td>`
      : '';
    return `
      <tr${rowClass}>
        <td class="num">${escapeHtml(num)}</td>
        <td>${escapeHtml(typeLbl)}${extra}${refusedBadge}</td>
        <td class="date">${formatDate(p.payment_date)}</td>
        <td class="amount">${amountCell}</td>
        ${notesCell}
      </tr>
    `;
  }).join('');

  return `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap" rel="stylesheet">
  <title>سندات قبض - ${escapeHtml(client?.full_name || 'عميل')}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    /* margin:0 on @page removes Chrome's default print header/footer
       (date, title, URL, page number) since they're drawn in the page
       margin area and have no room to render. */
    @page { size: A4; margin: 0; }
    @media print {
      html, body { background: #ffffff; }
      body { padding: 10mm 8mm; }
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
      font-size: 12px; color: #1a1a1a; margin-top: 2px;
      direction: ltr; text-align: right;
      font-variant-numeric: tabular-nums; font-weight: 500;
    }
    .brand .address { font-size: 12px; color: #1a1a1a; margin-top: 8px; line-height: 1.55; font-weight: 500; }
    .invoice-meta { text-align: left; min-width: 240px; }
    .invoice-meta .doc-title {
      font-size: 42px; font-weight: 800; letter-spacing: 0.5px;
      color: #1a1a1a; line-height: 1; margin-bottom: 4px;
    }
    .invoice-meta .subtitle {
      font-size: 12px; color: #1a1a1a; margin-bottom: 14px; opacity: 0.7;
    }
    .meta-rows { width: 100%; border: 1px solid #1a1a1a; font-size: 12px; }
    .meta-rows .row { display: flex; }
    .meta-rows .row + .row { border-top: 1px solid #1a1a1a; }
    .meta-rows .label {
      flex: 0 0 110px; padding: 7px 12px;
      background: #f4f4f5; font-weight: 700; color: #1a1a1a;
      font-size: 11.5px; text-align: right;
      border-left: 1px solid #1a1a1a; letter-spacing: 0.3px;
    }
    .meta-rows .val {
      flex: 1; padding: 7px 12px;
      text-align: left; direction: ltr;
      font-weight: 700; color: #1a1a1a;
      font-variant-numeric: tabular-nums;
    }

    .customer { margin-bottom: 22px; border: 1px solid #1a1a1a; }
    .section-title {
      padding: 8px 14px;
      border-bottom: 1px solid #1a1a1a;
      background: #f4f4f5;
      font-size: 11px; font-weight: 700; color: #1a1a1a;
      letter-spacing: 1.5px; text-transform: uppercase;
    }
    .customer-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; }
    .customer-grid .cell { padding: 9px 14px; }
    .customer-grid .cell:not(:nth-child(3n+1)) { border-right: 1px solid #1a1a1a; }
    .customer-grid .cell:nth-child(n+4) { border-top: 1px solid #1a1a1a; }
    .customer-grid .label {
      font-size: 10px; font-weight: 700; color: #1a1a1a;
      letter-spacing: 0.3px; margin-bottom: 3px; opacity: 0.75;
    }
    .customer-grid .value { font-size: 13px; font-weight: 600; color: #1a1a1a; }

    /* Receipts table */
    .receipts-section { margin-bottom: 22px; }
    .receipts {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      border: 1px solid #1a1a1a;
    }
    .receipts thead th {
      background: #f4f4f5;
      color: #1a1a1a;
      font-size: 11px; font-weight: 700;
      letter-spacing: 1px; text-transform: uppercase;
      padding: 9px 12px; text-align: right;
      border-bottom: 1px solid #1a1a1a;
      border-left: 1px solid #1a1a1a;
    }
    .receipts thead th:last-child { border-left: none; }
    .receipts tbody td {
      padding: 10px 12px;
      border-top: 1px solid #1a1a1a;
      border-left: 1px solid #1a1a1a;
      font-size: 12px; color: #1a1a1a; font-weight: 500;
      vertical-align: middle;
    }
    .receipts tbody td:last-child { border-left: none; }
    .receipts tbody tr:first-child td { border-top: none; }
    .receipts tbody td.num,
    .receipts tbody td.date,
    .receipts tbody td.amount {
      direction: ltr; text-align: left;
      font-variant-numeric: tabular-nums; font-weight: 700;
    }
    .receipts tbody td.notes {
      text-align: right; font-weight: 500; color: #1a1a1a;
      max-width: 200px; white-space: normal; word-break: break-word;
    }
    .receipts tbody tr.refused td { background: #fef2f2; color: #7f1d1d; }
    .receipts tbody tr.refused .struck {
      text-decoration: line-through;
      text-decoration-thickness: 1.5px;
      color: #7f1d1d;
    }
    .refused-tag {
      display: inline-block;
      margin-right: 4px;
      padding: 1px 6px;
      border: 1px solid #7f1d1d;
      border-radius: 10px;
      background: #fee2e2;
      color: #7f1d1d;
      font-size: 10px;
      font-weight: 700;
    }

    .total-row {
      display: flex; justify-content: flex-end;
      gap: 12px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }
    .total-row .box {
      border: 1px solid #1a1a1a;
      display: flex; align-items: stretch;
    }
    .total-row .box .label {
      padding: 14px 20px;
      background: #1a1a1a; color: #ffffff;
      font-size: 12px; font-weight: 700;
      letter-spacing: 1.2px; text-transform: uppercase;
      display: flex; align-items: center;
    }
    .total-row .box .val {
      padding: 14px 28px;
      font-size: 28px; font-weight: 800;
      color: #1a1a1a;
      direction: ltr;
      font-variant-numeric: tabular-nums;
    }
    /* Commission box — inverted palette (amber label on white) so it
       reads as supporting info and doesn't compete with the main total. */
    .total-row .box.commission-box {
      border-color: #b45309;
    }
    .total-row .box.commission-box .label {
      background: #fef3c7;
      color: #78350f;
    }
    .total-row .box.commission-box .val {
      font-size: 22px;
      color: #78350f;
    }

    .policy-note {
      border: 1px solid #1a1a1a;
      padding: 12px 16px; margin-bottom: 24px;
      font-size: 12px; color: #1a1a1a; background: #f9fafb;
    }
    .policy-note strong {
      font-weight: 700; font-variant-numeric: tabular-nums;
      direction: ltr; display: inline-block;
    }

    .footer {
      padding-top: 16px; border-top: 1px solid #1a1a1a;
      font-size: 12px; color: #1a1a1a; text-align: center;
    }
    .footer .thanks { font-weight: 700; margin-bottom: 6px; }
    .footer .contact { line-height: 1.8; }
    .footer .contact a { color: #1a1a1a; text-decoration: none; }
    .footer .issued { margin-top: 10px; opacity: 0.7; }

    .actions {
      margin-top: 18px;
      display: flex; gap: 10px; justify-content: center;
    }
    .actions button {
      padding: 10px 22px;
      background: #1a1a1a; color: #ffffff;
      border: none; font-family: inherit;
      font-size: 13px; font-weight: 700;
      cursor: pointer; letter-spacing: 0.5px;
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
      .total-row .box .val { font-size: 22px; padding: 12px 18px; }
    }
  </style>
</head>
<body>
  <div class="invoice">
    <!-- Header -->
    <div class="invoice-top">
      <div class="brand">
        ${branding.logoUrl ? `<img class="logo" src="${branding.logoUrl}" alt="${escapeHtml(branding.companyName)}" />` : ''}
        <div class="name">${escapeHtml(branding.companyName)}</div>
        ${(branding as any).taxNumber ? `<div class="tax">رقم المشغل: ${escapeHtml((branding as any).taxNumber)}</div>` : ''}
        ${(branding as any).invoiceAddress ? `<div class="address">${escapeHtml((branding as any).invoiceAddress)}</div>`
          : (companySettings.company_location ? `<div class="address">${escapeHtml(companySettings.company_location)}</div>` : '')}
      </div>
      <div class="invoice-meta">
        <div class="doc-title">سندات قبض</div>
        <div class="subtitle">${payments.length} ${payments.length === 1 ? 'سند قبض' : 'سندات قبض'}</div>
        <div class="meta-rows">
          <div class="row">
            <div class="label">رقم الوثيقة</div>
            <div class="val">${escapeHtml(primaryDocumentNumber)}</div>
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
          <div class="value">${escapeHtml(client?.full_name || '-')}</div>
        </div>
        <div class="cell">
          <div class="label">رقم الهوية</div>
          <div class="value">${escapeHtml(client?.id_number || '-')}</div>
        </div>
        <div class="cell">
          <div class="label">رقم الهاتف</div>
          <div class="value">${escapeHtml(client?.phone_number || '-')}</div>
        </div>
      </div>
    </div>

    <!-- Receipts table -->
    <div class="receipts-section">
      <div class="section-title">سندات القبض</div>
      <table class="receipts">
        <thead>
          <tr>
            <th style="width: 110px;">رقم سند القبض</th>
            <th style="width: 150px;">طريقة الدفع</th>
            <th style="width: 120px;">تاريخ الدفع</th>
            <th style="width: 110px;">المبلغ</th>
            ${anyNotes ? '<th>ملاحظات</th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${receiptRows}
        </tbody>
      </table>
    </div>

    <!-- Totals — optional commission line on top, then the grand total -->
    <div class="total-row">
      ${totalCommission > 0 ? `
      <div class="box commission-box">
        <div class="label">عمولة المكتب</div>
        <div class="val">₪${totalCommission.toLocaleString('en-US')}</div>
      </div>
      ` : ''}
      <div class="box">
        <div class="label">المجموع</div>
        <div class="val">₪${totalAmount.toLocaleString('en-US')}</div>
      </div>
    </div>

    <!-- Policy-link note -->
    <div class="policy-note">
      هذه السندات تخص الوثيقة رقم <strong>${escapeHtml(primaryDocumentNumber)}</strong>.
    </div>

    <!-- Footer -->
    <div class="footer">
      <div class="thanks">شكراً لثقتكم</div>
      ${contactFooterHtml}
      <div class="issued">تاريخ الإصدار: ${formatDate(today.toISOString())}</div>
    </div>

    <div class="actions no-print">
      <button type="button" onclick="window.print()">طباعة</button>
      <button type="button" onclick="shareReceipts()">مشاركة</button>
    </div>
  </div>

  <script>
    function shareReceipts() {
      var url = window.location.href;
      if (navigator.share) {
        navigator.share({ title: 'سندات قبض', url: url }).catch(function(){});
      } else {
        window.open('https://wa.me/?text=' + encodeURIComponent('سندات قبض: ' + url), '_blank');
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
        cheque_number,
        card_last_four,
        locked,
        refused,
        notes,
        receipt_number,
        policy:policies(
          id,
          policy_type_parent,
          policy_type_child,
          document_number,
          office_commission,
          client:clients(id, full_name, id_number, phone_number),
          car:cars(car_number, manufacturer_name, model, year)
        )
      `)
      .in("id", payment_ids)
      .order('payment_date', { ascending: true });

    if (paymentsError || !payments || payments.length === 0) {
      console.error("[generate-bulk-payment-receipt] Payments not found:", paymentsError);
      return new Response(
        JSON.stringify({ error: "Payments not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Calculate total from payments — refused payments are excluded
    // entirely (neither added nor subtracted), since they represent
    // money the client never actually paid.
    const calculatedTotal = payments.reduce((sum, p: any) => {
      if (p.refused) return sum;
      return sum + Number(p.amount || 0);
    }, 0);
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
      companySettings,
      branding,
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
