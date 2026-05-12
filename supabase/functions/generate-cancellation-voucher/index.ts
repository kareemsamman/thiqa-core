import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import { getAgentBranding, resolveAgentId, DEFAULT_BRANDING, type AgentBranding } from "../_shared/agent-branding.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Renders the *cancellation* side of a cancelled سند قبض as its own
// printable document. The user's rule: a سند قبض and a سند إلغاء are
// two different papers with two different links — never the same
// receipt stamped "cancelled". So this function only ever produces
// HTML with the "سند إلغاء" title, the voucher's own R-number, the
// linked-original-receipt reference, the reason, and the customer info.
// Inputs: `voucher_receipt_id` = the canonical cancellation row from
// the receipts table (one per cancelled session).

interface CancellationVoucherRequest {
  voucher_receipt_id: string;
}

const PAYMENT_TYPE_LABELS: Record<string, string> = {
  cash: 'نقدي',
  cheque: 'شيك',
  visa: 'بطاقة ائتمان',
  visa_external: 'فيزا خارجي',
  transfer: 'تحويل بنكي',
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
    receipt_number: string | number;
    receipt_date: string;
    amount: number;
    reason: string | null;
    cancelled_at: string | null;
  },
  source: {
    receipt_number: string | null;
    // Per-cancelled-row breakdown: shows method + cheque number + amount
    // so the bookkeeper sees EXACTLY which cheques landed in this إلغاء
    // (just "شيك + نقدي" hides the cheque numbers — the bookkeeper
    // can't tell which physical paper got voided).
    lines: Array<{
      payment_type: string;
      cheque_number: string | null;
      amount: number;
    }>;
  } | null,
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
  // Render each cancelled payment row in its own table line so cheque
  // numbers stay visible. Cash / transfer rows render with a "—" cheque
  // column so the layout stays aligned.
  const linesHtml = source?.lines?.length
    ? source.lines.map((line) => {
        const methodLabel = PAYMENT_TYPE_LABELS[line.payment_type] || line.payment_type;
        const chequeCell = line.cheque_number ? escapeHtml(String(line.cheque_number)) : '—';
        const amount = Number(line.amount || 0).toLocaleString('en-US');
        return `
          <tr>
            <td class="method">${escapeHtml(methodLabel)}</td>
            <td class="cheque-num">${chequeCell}</td>
            <td class="line-amount">₪${amount}</td>
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
  <title>سند إلغاء - ${escapeHtml(client?.full_name || 'عميل')}</title>
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
      background: #ffffff; border: 1px solid #7f1d1d;
      padding: 32px 34px;
    }
    .invoice-top {
      display: flex; justify-content: space-between; align-items: flex-start;
      gap: 28px; padding-bottom: 20px;
      border-bottom: 1px solid #7f1d1d; margin-bottom: 24px;
    }
    .brand { max-width: 340px; }
    .brand .logo { max-height: 70px; max-width: 180px; margin-bottom: 10px; display: block; }
    .brand .name { font-size: 15px; font-weight: 700; }
    .brand .tax { font-size: 12px; margin-top: 2px; direction: ltr; text-align: right; font-weight: 500; }
    .brand .address { font-size: 12px; margin-top: 8px; line-height: 1.55; font-weight: 500; }
    .invoice-meta { text-align: left; min-width: 240px; }
    .invoice-meta .doc-title {
      font-size: 42px; font-weight: 800; letter-spacing: 0.5px;
      color: #7f1d1d; line-height: 1; margin-bottom: 4px;
    }
    .invoice-meta .subtitle { font-size: 12px; color: #7f1d1d; margin-bottom: 14px; }
    .meta-rows { width: 100%; border: 1px solid #7f1d1d; font-size: 12px; }
    .meta-rows .row { display: flex; }
    .meta-rows .row + .row { border-top: 1px solid #7f1d1d; }
    .meta-rows .label {
      flex: 0 0 130px; padding: 7px 12px;
      background: #fef2f2; font-weight: 700; color: #7f1d1d;
      font-size: 11.5px; text-align: right;
      border-left: 1px solid #7f1d1d; letter-spacing: 0.3px;
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
    .body-section .val { flex: 1; text-align: left; direction: ltr; font-weight: 600; font-variant-numeric: tabular-nums; }
    .body-section .val.reason { text-align: right; direction: rtl; font-weight: 500; color: #1a1a1a; }

    .lines-section { margin-bottom: 22px; border: 1px solid #1a1a1a; }
    .lines { width: 100%; border-collapse: collapse; font-size: 12px; }
    .lines thead th {
      background: #fef2f2; color: #7f1d1d;
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
    .lines td.cheque-num,
    .lines td.line-amount {
      direction: ltr; text-align: left;
      font-variant-numeric: tabular-nums; font-weight: 700;
    }

    .total-row {
      display: flex; justify-content: flex-end;
      gap: 12px; margin-bottom: 20px;
    }
    .total-row .box {
      border: 1px solid #7f1d1d;
      display: flex; align-items: stretch;
    }
    .total-row .box .label {
      padding: 14px 20px;
      background: #7f1d1d; color: #ffffff;
      font-size: 12px; font-weight: 700;
      letter-spacing: 1.2px; text-transform: uppercase;
      display: flex; align-items: center;
    }
    .total-row .box .val {
      padding: 14px 28px;
      font-size: 28px; font-weight: 800;
      color: #7f1d1d;
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
      background: #7f1d1d; color: #ffffff;
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
        <div class="doc-title">سند إلغاء</div>
        <div class="subtitle">إلغاء سند قبض سبق إصداره</div>
        <div class="meta-rows">
          <div class="row">
            <div class="label">رقم سند الإلغاء</div>
            <div class="val">R${escapeHtml(String(voucher.receipt_number))}/${new Date(voucher.cancelled_at || voucher.receipt_date || today).getFullYear()}</div>
          </div>
          ${source?.receipt_number ? `
          <div class="row">
            <div class="label">يلغي سند قبض رقم</div>
            <div class="val">${escapeHtml(source.receipt_number)}</div>
          </div>
          ` : ''}
          <div class="row">
            <div class="label">تاريخ الإلغاء</div>
            <div class="val">${formatDate(voucher.cancelled_at || voucher.receipt_date)}</div>
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
      <div class="section-title">الدفعات الملغاة</div>
      <table class="lines">
        <thead>
          <tr>
            <th>طريقة الدفع</th>
            <th>رقم الشيك</th>
            <th>المبلغ</th>
          </tr>
        </thead>
        <tbody>
          ${linesHtml || '<tr><td colspan="3" style="text-align:center;color:#6b7280;padding:14px;">لا توجد تفاصيل</td></tr>'}
        </tbody>
      </table>
    </div>

    ${voucher.reason ? `
    <div class="body-section">
      <div class="row">
        <div class="label">سبب الإلغاء</div>
        <div class="val reason">${escapeHtml(voucher.reason).replace(/\n/g, '<br>')}</div>
      </div>
    </div>
    ` : ''}

    <div class="total-row">
      <div class="box">
        <div class="label">المبلغ الملغى</div>
        <div class="val">₪${Number(voucher.amount || 0).toLocaleString('en-US')}</div>
      </div>
    </div>

    <div class="footer">
      <div class="thanks">رصيد العميل أُعيد إلى ما كان عليه قبل سند القبض الملغى.</div>
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

    const { voucher_receipt_id }: CancellationVoucherRequest = await req.json();
    if (!voucher_receipt_id) {
      return new Response(
        JSON.stringify({ error: "voucher_receipt_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Pull the voucher row + the policy it's tied to (for client info)
    // + the linked original receipt's payment_id so we can resolve every
    // sibling payment of the cancelled session (the voucher row only
    // references ONE of them through payment_id; the session might span
    // multiple methods that share a session_id / batch_id).
    const { data: voucherRow, error: voucherErr } = await supabase
      .from('receipts')
      .select(`
        id, receipt_number, amount, receipt_date, cancellation_reason,
        cancelled_at, cancels_receipt_id, payment_id, policy_id,
        receipt_type
      `)
      .eq('id', voucher_receipt_id)
      .maybeSingle();

    if (voucherErr || !voucherRow) {
      return new Response(
        JSON.stringify({ error: "voucher not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (voucherRow.receipt_type !== 'cancellation') {
      return new Response(
        JSON.stringify({ error: "row is not a cancellation voucher" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Client + policy: dig out client info from the policy join. The
    // voucher row carries policy_id directly (the trigger copies it
    // off the original policy_payments row).
    let client = { full_name: '', id_number: null as string | null, phone_number: null as string | null, phone_number_2: null as string | null };
    if (voucherRow.policy_id) {
      const { data: pol } = await supabase
        .from('policies')
        .select('client:clients(full_name, id_number, phone_number, phone_number_2)')
        .eq('id', voucherRow.policy_id)
        .maybeSingle();
      const c = (pol as any)?.client;
      const cr = Array.isArray(c) ? c[0] : c;
      if (cr) {
        client = {
          full_name: cr.full_name || '',
          id_number: cr.id_number ?? null,
          phone_number: cr.phone_number ?? null,
          phone_number_2: cr.phone_number_2 ?? null,
        };
      }
    }

    // Resolve the original session's R-number + each cancelled row's
    // detail (method, cheque number, amount). The session's payment
    // rows all share a payment_session_id / batch_id; we look up the
    // voucher's payment_id first to get those keys, then sweep
    // siblings. Refused rows are still in the table (we only mark
    // them refused, never DELETE for printed cancellations).
    //
    // To collapse multi-policy cheque splits — one physical cheque
    // sliced across N policies via batch_id — we group siblings by
    // batch_id (or by row id when batch_id is null) and sum amounts,
    // so the printed line shows the cheque's face value once instead
    // of N partial slices.
    let source: { receipt_number: string | null; lines: Array<{ payment_type: string; cheque_number: string | null; amount: number }> } | null = null;
    let totalAmount = Number(voucherRow.amount || 0);
    if (voucherRow.payment_id) {
      const { data: src } = await supabase
        .from('policy_payments')
        .select('id, receipt_number, payment_type, payment_session_id, batch_id')
        .eq('id', voucherRow.payment_id)
        .maybeSingle();
      if (src) {
        const groupKey = src.payment_session_id || src.batch_id || src.id;
        const filterCol = src.payment_session_id
          ? 'payment_session_id'
          : (src.batch_id ? 'batch_id' : 'id');
        const { data: siblings } = await supabase
          .from('policy_payments')
          .select('id, receipt_number, payment_type, cheque_number, amount, batch_id, refused')
          .eq(filterCol, groupKey)
          .eq('refused', true);
        const rows = (siblings ?? []) as Array<{
          id: string;
          receipt_number: string | null;
          payment_type: string | null;
          cheque_number: string | null;
          amount: number;
          batch_id: string | null;
        }>;

        // Canonical original سند number = smallest R-number.
        let canonical: string | null = null;
        for (const r of rows) {
          if (!r.receipt_number) continue;
          if (!canonical || r.receipt_number < canonical) {
            canonical = r.receipt_number;
          }
        }

        // Collapse multi-policy splits of one physical cheque
        // (shared batch_id) into a single printed line at face value.
        const groupedByBatch = new Map<string, { payment_type: string; cheque_number: string | null; amount: number }>();
        const standalone: Array<{ payment_type: string; cheque_number: string | null; amount: number }> = [];
        for (const r of rows) {
          if (!r.payment_type) continue;
          if (r.batch_id) {
            const existing = groupedByBatch.get(r.batch_id);
            if (existing) {
              existing.amount += Number(r.amount || 0);
            } else {
              groupedByBatch.set(r.batch_id, {
                payment_type: r.payment_type,
                cheque_number: r.cheque_number,
                amount: Number(r.amount || 0),
              });
            }
          } else {
            standalone.push({
              payment_type: r.payment_type,
              cheque_number: r.cheque_number,
              amount: Number(r.amount || 0),
            });
          }
        }
        const lines = [...Array.from(groupedByBatch.values()), ...standalone];

        source = {
          receipt_number: canonical || src.receipt_number,
          lines,
        };

        // Total = sum of collapsed lines (matches the visible body).
        totalAmount = lines.reduce((s, l) => s + l.amount, 0);
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
        receipt_number: voucherRow.receipt_number ?? '—',
        receipt_date: voucherRow.receipt_date as string,
        amount: totalAmount,
        reason: voucherRow.cancellation_reason ?? null,
        cancelled_at: voucherRow.cancelled_at as string | null,
      },
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
    const storagePath = `vouchers/${year}/${month}/cancellation_${clientNameSafe}_${timestamp}_${randomId}.html`;
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
      console.error('[generate-cancellation-voucher] Bunny upload failed');
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
    console.error("[generate-cancellation-voucher] Fatal:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
