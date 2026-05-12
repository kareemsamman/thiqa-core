import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import { getAgentBranding, resolveAgentId, DEFAULT_BRANDING, type AgentBranding } from "../_shared/agent-branding.ts";

// Renders a سند صرف (disbursement voucher) for printing — the cash
// receipt the agency hands over when paying a client (refund on
// cancel / transfer, manual disbursement). Mirrors the layout of
// generate-cancellation-voucher / generate-credit-note-voucher so
// the four printable documents (سند قبض / سند إلغاء / اشعار دائن /
// سند صرف) feel like one family. Navy accent — same as the agency's
// receipt branding — to signal "money actually moved" rather than
// the green-tinted credit balance.
//
// Inputs: `voucher_receipt_id` = the receipts.id of a row where
// receipt_type='disbursement'. The receipt is mirrored from a
// client_settlements row by the AFTER INSERT trigger; we join back
// through client_settlement_id to pull the actual payment-line
// detail (cash / cheque + bank / transfer reference / etc.) and to
// resolve siblings on the same settlement_session_id when the
// disbursement was a split payment.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface DisbursementVoucherRequest {
  voucher_receipt_id: string;
}

const PAYMENT_TYPE_LABELS: Record<string, string> = {
  cash: 'نقدي',
  cheque: 'شيك',
  customer_cheque: 'شيك عميل',
  visa: 'بطاقة ائتمان',
  bank_transfer: 'تحويل بنكي',
};

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
  "26": "يو بنك",
  "31": "البنك الدولي الأول لإسرائيل",
  "34": "البنك العربي الإسرائيلي",
  "46": "بنك مسد",
  "54": "بنك القدس (يروشلايم)",
  "89": "بنك فلسطين",
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

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function buildHtml(
  voucher: {
    voucher_number: string;
    settlement_date: string;
    total_amount: number;
    notes: string | null;
  },
  lines: Array<{
    payment_type: string;
    cheque_number: string | null;
    cheque_due_date: string | null;
    cheque_issue_date: string | null;
    payment_date: string | null;
    bank_code: string | null;
    branch_code: string | null;
    bank_reference: string | null;
    notes: string | null;
    amount: number;
  }>,
  source: { policy_document_number: string | null; policy_number: string | null } | null,
  client: { full_name: string; id_number: string | null; phone_number: string | null; phone_number_2: string | null },
  companySettings: { company_email?: string; company_phone_links?: PhoneLink[]; company_location?: string },
  branding: AgentBranding = DEFAULT_BRANDING,
): string {
  const today = new Date();

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

  const phoneDisplay = [client?.phone_number, client?.phone_number_2].filter(Boolean).join(' / ') || '-';

  // Navy accent — matches the bulk سند قبض template so سند صرف
  // reads as the natural mirror of "money in".
  const accent = '#1e3a5f';
  const accentBg = '#eef4fb';

  const anyNotes = lines.some((l) => typeof l.notes === 'string' && l.notes.trim().length > 0);
  // Date-cell renderer. Cheques (both kinds) need the maturity date
  // because that's what determines when the money actually settles,
  // and the agency-written cheque additionally shows the issue date.
  // Non-cheque rows keep the single-date layout.
  const renderDateCell = (line: typeof lines[number]): string => {
    if (line.payment_type === 'cheque') {
      const issue = line.cheque_issue_date ? formatDate(line.cheque_issue_date) : '—';
      const due = line.cheque_due_date ? formatDate(line.cheque_due_date) : '—';
      return `
        <div>
          <div class="date-label">تاريخ الاستحقاق</div>
          <div class="date-value">${due}</div>
        </div>
        <div style="margin-top: 5px;">
          <div class="date-label">تاريخ الإصدار</div>
          <div class="date-value">${issue}</div>
        </div>`;
    }
    if (line.payment_type === 'customer_cheque') {
      const due = line.cheque_due_date ? formatDate(line.cheque_due_date) : '—';
      return `
        <div class="date-label">تاريخ الاستحقاق</div>
        <div class="date-value">${due}</div>`;
    }
    const dateValue = line.payment_date || '';
    const dateLabel = line.payment_type === 'bank_transfer'
      ? 'تاريخ التحويل'
      : 'تاريخ الصرف';
    return `
      <div class="date-label">${dateLabel}</div>
      <div class="date-value">${dateValue ? formatDate(dateValue) : '—'}</div>`;
  };
  const linesHtml = lines.length
    ? lines.map((line) => {
        const methodLabel = PAYMENT_TYPE_LABELS[line.payment_type] || line.payment_type;
        const chequeExtra = line.cheque_number ? ` · ${escapeHtml(String(line.cheque_number))}` : '';
        const amount = Number(line.amount || 0).toLocaleString('en-US');
        const bankLabel = getBankLabel(line.bank_code);
        const branchLabel = line.branch_code ? `فرع ${escapeHtml(String(line.branch_code))}` : '';
        const bankRefLabel = line.bank_reference
          ? `مرجع: ${escapeHtml(String(line.bank_reference))}`
          : '';
        const supplementBits = [
          bankLabel ? escapeHtml(bankLabel) : '',
          branchLabel,
          bankRefLabel,
        ].filter(Boolean);
        const bankLine = supplementBits.length
          ? `<div class="cheque-bank-line">${supplementBits.join(' · ')}</div>`
          : '';
        const notesCell = anyNotes
          ? `<td class="notes">${escapeHtml(line.notes || '').replace(/\n/g, '<br>') || '—'}</td>`
          : '';
        return `
          <tr>
            <td>
              <div>${escapeHtml(methodLabel)}${chequeExtra}</div>
              ${bankLine}
            </td>
            <td class="date">${renderDateCell(line)}</td>
            <td class="line-amount">₪${amount}</td>
            ${notesCell}
          </tr>`;
      }).join('')
    : '';

  return `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap" rel="stylesheet">
  <title>سند صرف - ${escapeHtml(client?.full_name || 'عميل')}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
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
      max-width: 800px; margin: 0 auto;
      background: #ffffff; border: 1px solid ${accent};
      padding: 32px 34px;
    }
    .invoice-top {
      display: flex; justify-content: space-between; align-items: flex-start;
      gap: 28px; padding-bottom: 20px;
      border-bottom: 1px solid ${accent}; margin-bottom: 24px;
    }
    .brand { max-width: 340px; }
    .brand .logo { max-height: 70px; max-width: 180px; margin-bottom: 10px; display: block; }
    .brand .name { font-size: 15px; font-weight: 700; }
    .brand .tax { font-size: 12px; margin-top: 2px; direction: ltr; text-align: right; font-weight: 500; }
    .brand .address { font-size: 12px; margin-top: 8px; line-height: 1.55; font-weight: 500; }
    .invoice-meta { text-align: left; min-width: 240px; }
    .invoice-meta .doc-title {
      font-size: 42px; font-weight: 800; letter-spacing: 0.5px;
      color: ${accent}; line-height: 1; margin-bottom: 4px;
    }
    .invoice-meta .subtitle { font-size: 12px; color: ${accent}; margin-bottom: 14px; }
    .meta-rows { width: 100%; border: 1px solid ${accent}; font-size: 12px; }
    .meta-rows .row { display: flex; }
    .meta-rows .row + .row { border-top: 1px solid ${accent}; }
    .meta-rows .label {
      flex: 0 0 130px; padding: 7px 12px;
      background: ${accentBg}; font-weight: 700; color: ${accent};
      font-size: 11.5px; text-align: right;
      border-left: 1px solid ${accent}; letter-spacing: 0.3px;
    }
    .meta-rows .val {
      flex: 1; padding: 7px 12px;
      text-align: left; direction: ltr;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }

    .customer { margin-bottom: 22px; border: 1px solid #1a1a1a; }
    .section-title {
      padding: 8px 14px;
      border-bottom: 1px solid #1a1a1a;
      background: #f4f4f5;
      font-size: 11px; font-weight: 700;
      letter-spacing: 1.5px; text-transform: uppercase;
    }
    .customer-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; }
    .customer-grid .cell { padding: 9px 14px; }
    .customer-grid .cell:not(:nth-child(3n+1)) { border-right: 1px solid #1a1a1a; }
    .customer-grid .cell:nth-child(n+4) { border-top: 1px solid #1a1a1a; }
    .customer-grid .label {
      font-size: 10px; font-weight: 700;
      letter-spacing: 0.3px; margin-bottom: 3px; opacity: 0.75;
    }
    .customer-grid .value { font-size: 13px; font-weight: 600; }

    .body-section { margin-bottom: 22px; border: 1px solid #1a1a1a; padding: 14px 16px; }
    .body-section .row { display: flex; padding: 6px 0; }
    .body-section .row + .row { border-top: 1px dashed #d4d4d8; }
    .body-section .label { flex: 0 0 140px; font-weight: 700; font-size: 12px; }
    .body-section .val { flex: 1; text-align: right; direction: rtl; font-weight: 500; color: #1a1a1a; }

    .lines-section { margin-bottom: 22px; border: 1px solid #1a1a1a; }
    .lines { width: 100%; border-collapse: collapse; font-size: 12px; }
    .lines thead th {
      background: ${accentBg}; color: ${accent};
      font-size: 11px; font-weight: 700;
      letter-spacing: 1px; text-transform: uppercase;
      padding: 9px 12px; text-align: right;
      border-bottom: 1px solid #1a1a1a;
      border-left: 1px solid #1a1a1a;
    }
    .lines thead th:last-child { border-left: none; }
    .lines tbody td {
      padding: 10px 12px;
      border-top: 1px solid #1a1a1a;
      border-left: 1px solid #1a1a1a;
      font-size: 12px; color: #1a1a1a; font-weight: 500;
    }
    .lines tbody td:last-child { border-left: none; }
    .lines tbody tr:first-child td { border-top: none; }
    .lines td.line-amount {
      direction: ltr; text-align: left;
      font-variant-numeric: tabular-nums; font-weight: 700;
    }
    .lines td.notes {
      text-align: right; font-weight: 500; color: #1a1a1a;
      max-width: 200px; white-space: normal; word-break: break-word;
    }
    .lines td.date {
      text-align: right; font-weight: 500;
    }
    .lines td.date .date-label {
      font-size: 10px; color: #6b7280; font-weight: 600;
      margin-bottom: 2px; letter-spacing: 0.2px;
    }
    .lines td.date .date-value {
      direction: ltr; text-align: left;
      font-variant-numeric: tabular-nums; font-weight: 700; color: #1a1a1a;
    }
    .lines .cheque-bank-line {
      font-size: 10.5px; font-weight: 500; color: #6b7280; margin-top: 2px;
    }

    .total-row {
      display: flex; justify-content: flex-end;
      gap: 12px; margin-bottom: 20px;
    }
    .total-row .box {
      border: 1px solid ${accent};
      display: flex; align-items: stretch;
    }
    .total-row .box .label {
      padding: 14px 20px;
      background: ${accent}; color: #ffffff;
      font-size: 12px; font-weight: 700;
      letter-spacing: 1.2px; text-transform: uppercase;
      display: flex; align-items: center;
    }
    .total-row .box .val {
      padding: 14px 28px;
      font-size: 28px; font-weight: 800;
      color: ${accent};
      direction: ltr;
      font-variant-numeric: tabular-nums;
    }

    .footer {
      padding-top: 16px; border-top: 1px solid #1a1a1a;
      font-size: 12px; text-align: center;
    }
    .footer .thanks { font-weight: 700; margin-bottom: 6px; }
    .footer .contact { line-height: 1.8; }
    .footer .contact a { color: #1a1a1a; text-decoration: none; }
    .footer .issued { margin-top: 10px; opacity: 0.7; }

    .actions { margin-top: 18px; display: flex; gap: 10px; justify-content: center; }
    .actions button {
      padding: 10px 22px;
      background: ${accent}; color: #ffffff;
      border: none; font-family: inherit;
      font-size: 13px; font-weight: 700;
      cursor: pointer; letter-spacing: 0.5px;
    }
    .actions button:hover { opacity: 0.85; }
  </style>
</head>
<body>
  <div class="invoice">
    <div class="invoice-top">
      <div class="brand">
        ${branding.logoUrl ? `<img class="logo" src="${branding.logoUrl}" alt="${escapeHtml(branding.companyName)}" />` : ''}
        <div class="name">${escapeHtml(branding.companyName)}</div>
        ${(branding as any).taxNumber ? `<div class="tax">رقم المشغل: ${escapeHtml((branding as any).taxNumber)}</div>` : ''}
        ${(branding as any).invoiceAddress ? `<div class="address">${escapeHtml((branding as any).invoiceAddress)}</div>`
          : (companySettings.company_location ? `<div class="address">${escapeHtml(companySettings.company_location)}</div>` : '')}
      </div>
      <div class="invoice-meta">
        <div class="doc-title">سند صرف</div>
        <div class="subtitle">صرف مبلغ للعميل</div>
        <div class="meta-rows">
          <div class="row">
            <div class="label">رقم سند الصرف</div>
            <div class="val">${escapeHtml(voucher.voucher_number)}</div>
          </div>
          ${source?.policy_document_number ? `
          <div class="row">
            <div class="label">يتعلق بمعاملة</div>
            <div class="val">${escapeHtml(source.policy_document_number)}</div>
          </div>
          ` : ''}
          ${source?.policy_number ? `
          <div class="row">
            <div class="label">رقم البوليصة</div>
            <div class="val">${escapeHtml(source.policy_number)}</div>
          </div>
          ` : ''}
          <div class="row">
            <div class="label">تاريخ الصرف</div>
            <div class="val">${formatDate(voucher.settlement_date)}</div>
          </div>
        </div>
      </div>
    </div>

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
          <div class="label">${[client?.phone_number, client?.phone_number_2].filter(Boolean).length > 1 ? 'أرقام الهاتف' : 'رقم الهاتف'}</div>
          <div class="value">${escapeHtml(phoneDisplay)}</div>
        </div>
      </div>
    </div>

    <div class="lines-section">
      <div class="section-title">تفاصيل الصرف</div>
      <table class="lines">
        <thead>
          <tr>
            <th style="width: 170px;">طريقة الدفع</th>
            <th style="width: 130px;">التاريخ</th>
            <th style="width: 110px;">المبلغ</th>
            ${anyNotes ? '<th>ملاحظات</th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${linesHtml || `<tr><td colspan="${anyNotes ? 4 : 3}" style="text-align:center;color:#6b7280;padding:14px;">لا توجد تفاصيل</td></tr>`}
        </tbody>
      </table>
    </div>

    ${voucher.notes ? `
    <div class="body-section">
      <div class="row">
        <div class="label">ملاحظات</div>
        <div class="val">${escapeHtml(voucher.notes).replace(/\n/g, '<br>')}</div>
      </div>
    </div>
    ` : ''}

    <div class="total-row">
      <div class="box">
        <div class="label">المجموع المصروف</div>
        <div class="val">₪${Number(voucher.total_amount || 0).toLocaleString('en-US')}</div>
      </div>
    </div>

    <div class="footer">
      <div class="thanks">تم صرف المبلغ أعلاه للعميل بالكامل.</div>
      ${contactFooterHtml}
      <div class="issued">تاريخ الإصدار: ${formatDate(today.toISOString())}</div>
    </div>

    <div class="actions no-print">
      <button type="button" onclick="window.print()">طباعة</button>
    </div>
  </div>
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

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid authentication" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const agentId = await resolveAgentId(supabase, user.id);
    const branding = await getAgentBranding(supabase, agentId);

    const { voucher_receipt_id }: DisbursementVoucherRequest = await req.json();
    if (!voucher_receipt_id) {
      return new Response(
        JSON.stringify({ error: "voucher_receipt_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Pull the receipt row to get the link back to its
    // client_settlement source. From there we can resolve the full
    // multi-line settlement (if the disbursement spanned several
    // payment methods sharing one settlement_session_id).
    const { data: receiptRow, error: receiptErr } = await supabase
      .from('receipts')
      .select(`
        id, voucher_number, receipt_type, client_id, policy_id,
        client_settlement_id
      `)
      .eq('id', voucher_receipt_id)
      .maybeSingle();

    if (receiptErr || !receiptRow) {
      return new Response(
        JSON.stringify({ error: "voucher not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (receiptRow.receipt_type !== 'disbursement') {
      return new Response(
        JSON.stringify({ error: "row is not a disbursement voucher" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Resolve the originating client_settlement + its session siblings
    // for the full payment-line breakdown.
    let lines: Array<{
      payment_type: string;
      cheque_number: string | null;
      cheque_due_date: string | null;
      cheque_issue_date: string | null;
      payment_date: string | null;
      bank_code: string | null;
      branch_code: string | null;
      bank_reference: string | null;
      notes: string | null;
      amount: number;
    }> = [];
    let voucherTotal = 0;
    let voucherNumber = (receiptRow.voucher_number as string) ?? '';
    let voucherDate = new Date().toISOString();
    let voucherNotes: string | null = null;
    if (receiptRow.client_settlement_id) {
      const { data: anchorSettlement } = await supabase
        .from('client_settlements')
        .select('settlement_session_id, settlement_date, notes, voucher_number')
        .eq('id', receiptRow.client_settlement_id)
        .maybeSingle();

      if (anchorSettlement) {
        voucherNumber = (anchorSettlement.voucher_number as string) || voucherNumber;
        voucherDate = (anchorSettlement.settlement_date as string) || voucherDate;
        voucherNotes = (anchorSettlement.notes as string | null) ?? null;

        // Fetch siblings sharing the session id (or just the anchor
        // when this disbursement was a single-line event with no
        // session id).
        const filterCol = anchorSettlement.settlement_session_id
          ? 'settlement_session_id'
          : 'id';
        const filterVal = anchorSettlement.settlement_session_id
          ? anchorSettlement.settlement_session_id
          : receiptRow.client_settlement_id;
        const { data: siblings } = await supabase
          .from('client_settlements')
          .select(`
            payment_type, cheque_number, cheque_due_date,
            cheque_issue_date, settlement_date, bank_code,
            branch_code, bank_reference, notes, total_amount,
            customer_cheque_ids
          `)
          .eq(filterCol, filterVal);

        const rows = (siblings ?? []) as Array<{
          payment_type: string | null;
          cheque_number: string | null;
          cheque_due_date: string | null;
          cheque_issue_date: string | null;
          settlement_date: string | null;
          bank_code: string | null;
          branch_code: string | null;
          bank_reference: string | null;
          notes: string | null;
          total_amount: number;
          customer_cheque_ids: string[] | null;
        }>;

        // Customer cheque expansion. When the agent picked several
        // شيك عميل in a single payment line, we stored them as one
        // settlement row with customer_cheque_ids = [id1, id2, ...]
        // and total_amount = sum. The voucher needs to print each
        // cheque on its own row (number / bank / due date / amount),
        // so first we batch-fetch every referenced policy_payments
        // row, then expand on the way into `lines`.
        const allCustomerChequeIds: string[] = [];
        for (const r of rows) {
          if (
            r.payment_type === 'customer_cheque' &&
            Array.isArray(r.customer_cheque_ids)
          ) {
            allCustomerChequeIds.push(...r.customer_cheque_ids);
          }
        }
        const customerChequeMap = new Map<
          string,
          {
            cheque_number: string | null;
            payment_date: string | null;
            bank_code: string | null;
            branch_code: string | null;
            amount: number;
          }
        >();
        if (allCustomerChequeIds.length > 0) {
          const { data: pps } = await supabase
            .from('policy_payments')
            .select('id, cheque_number, payment_date, bank_code, branch_code, amount')
            .in('id', allCustomerChequeIds);
          for (const pp of (pps ?? []) as Array<{
            id: string;
            cheque_number: string | null;
            payment_date: string | null;
            bank_code: string | null;
            branch_code: string | null;
            amount: number | null;
          }>) {
            customerChequeMap.set(pp.id, {
              cheque_number: pp.cheque_number,
              payment_date: pp.payment_date,
              bank_code: pp.bank_code,
              branch_code: pp.branch_code,
              amount: Number(pp.amount || 0),
            });
          }
        }

        for (const r of rows) {
          if (!r.payment_type) continue;
          if (
            r.payment_type === 'customer_cheque' &&
            Array.isArray(r.customer_cheque_ids) &&
            r.customer_cheque_ids.length > 0
          ) {
            // Expand into one line per referenced cheque. payment_date
            // on policy_payments is the cheque's due date (when it
            // can be cashed), so we map it onto cheque_due_date for
            // the template renderer.
            for (const cid of r.customer_cheque_ids) {
              const cheque = customerChequeMap.get(cid);
              if (!cheque) continue;
              voucherTotal += cheque.amount;
              lines.push({
                payment_type: 'customer_cheque',
                cheque_number: cheque.cheque_number,
                cheque_due_date: cheque.payment_date,
                cheque_issue_date: null,
                payment_date: cheque.payment_date,
                bank_code: cheque.bank_code,
                branch_code: cheque.branch_code,
                bank_reference: null,
                notes: r.notes,
                amount: cheque.amount,
              });
            }
            continue;
          }
          const amt = Number(r.total_amount || 0);
          voucherTotal += amt;
          lines.push({
            payment_type: r.payment_type,
            cheque_number: r.cheque_number,
            cheque_due_date: r.cheque_due_date,
            cheque_issue_date: r.cheque_issue_date,
            payment_date: r.settlement_date,
            bank_code: r.bank_code,
            branch_code: r.branch_code,
            bank_reference: r.bank_reference,
            notes: r.notes,
            amount: amt,
          });
        }
      }
    }

    // Fallback if the settlement chain was somehow broken — read
    // amount + date straight off the receipts row. The /receipts page
    // should keep working even if the trigger back-link goes missing.
    if (lines.length === 0) {
      const { data: receiptFull } = await supabase
        .from('receipts')
        .select('amount, receipt_date, payment_method, cheque_number, notes')
        .eq('id', voucher_receipt_id)
        .maybeSingle();
      if (receiptFull) {
        voucherTotal = Number((receiptFull as any).amount || 0);
        voucherDate = (receiptFull as any).receipt_date || voucherDate;
        voucherNotes = ((receiptFull as any).notes as string | null) ?? null;
        lines.push({
          payment_type: (receiptFull as any).payment_method || 'cash',
          cheque_number: (receiptFull as any).cheque_number ?? null,
          cheque_due_date: null,
          cheque_issue_date: null,
          payment_date: (receiptFull as any).receipt_date ?? null,
          bank_code: null,
          branch_code: null,
          bank_reference: null,
          notes: (receiptFull as any).notes ?? null,
          amount: voucherTotal,
        });
      }
    }

    // Resolve client info — receipts.client_id is the primary source
    // since the modal sets it explicitly. Fall back through policy
    // when client_id is missing on legacy receipts.
    let client = {
      full_name: '',
      id_number: null as string | null,
      phone_number: null as string | null,
      phone_number_2: null as string | null,
    };
    if (receiptRow.client_id) {
      const { data: c } = await supabase
        .from('clients')
        .select('full_name, id_number, phone_number, phone_number_2')
        .eq('id', receiptRow.client_id)
        .maybeSingle();
      if (c) {
        client = {
          full_name: c.full_name || '',
          id_number: c.id_number ?? null,
          phone_number: c.phone_number ?? null,
          phone_number_2: c.phone_number_2 ?? null,
        };
      }
    } else if (receiptRow.policy_id) {
      const { data: pol } = await supabase
        .from('policies')
        .select('client:clients(full_name, id_number, phone_number, phone_number_2)')
        .eq('id', receiptRow.policy_id)
        .maybeSingle();
      const cr = Array.isArray((pol as any)?.client) ? (pol as any).client[0] : (pol as any)?.client;
      if (cr) {
        client = {
          full_name: cr.full_name || '',
          id_number: cr.id_number ?? null,
          phone_number: cr.phone_number ?? null,
          phone_number_2: cr.phone_number_2 ?? null,
        };
      }
    }

    let source: { policy_document_number: string | null; policy_number: string | null } | null = null;
    if (receiptRow.policy_id) {
      const { data: pol } = await supabase
        .from('policies')
        .select('document_number, policy_number')
        .eq('id', receiptRow.policy_id)
        .maybeSingle();
      if (pol) {
        source = {
          policy_document_number: (pol as any).document_number ?? null,
          policy_number: (pol as any).policy_number ?? null,
        };
      }
    }

    const { data: smsSettings } = await supabase
      .from('sms_settings')
      .select('company_email, company_phone_links, company_location')
      .limit(1)
      .maybeSingle();

    const companySettings = {
      company_email: smsSettings?.company_email || '',
      company_phone_links: (smsSettings?.company_phone_links as PhoneLink[]) || [],
      company_location: smsSettings?.company_location || '',
    };

    const html = buildHtml(
      {
        voucher_number: voucherNumber,
        settlement_date: voucherDate,
        total_amount: voucherTotal,
        notes: voucherNotes,
      },
      lines,
      source,
      client,
      companySettings,
      branding,
    );

    if (!bunnyApiKey || !bunnyStorageZone) {
      return new Response(html, {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
      });
    }

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const timestamp = Date.now();
    const randomId = crypto.randomUUID().slice(0, 8);
    const clientNameSafe = client?.full_name?.replace(/[^a-zA-Z0-9؀-ۿ]/g, '_') || 'customer';
    const storagePath = `vouchers/${year}/${month}/disbursement_${clientNameSafe}_${timestamp}_${randomId}.html`;
    const bunnyUploadUrl = `https://storage.bunnycdn.com/${bunnyStorageZone}/${storagePath}`;

    const uploadResponse = await fetch(bunnyUploadUrl, {
      method: 'PUT',
      headers: {
        'AccessKey': bunnyApiKey,
        'Content-Type': 'text/html; charset=utf-8',
      },
      body: html,
    });
    if (!uploadResponse.ok) {
      console.error('[generate-disbursement-voucher] Bunny upload failed');
      return new Response(html, {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
      });
    }

    const receiptUrl = `${bunnyCdnUrl}/${storagePath}`;
    return new Response(
      JSON.stringify({ success: true, receipt_url: receiptUrl }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: unknown) {
    console.error("[generate-disbursement-voucher] Fatal:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
