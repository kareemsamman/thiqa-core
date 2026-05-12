import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import { getAgentBranding, resolveAgentId, DEFAULT_BRANDING, type AgentBranding } from "../_shared/agent-branding.ts";

// Renders a credit_note ("اشعار دائن") receipt as a standalone
// printable document. Same visual family as the bulk-payment-receipt
// and cancellation-voucher functions — A4, RTL, branded header, meta
// rows on the side, customer block, and a single-line "amount" panel
// at the bottom. The difference from a سند قبض is that no money
// changes hands here: the agency owes the customer this balance,
// to be auto-applied against future payments.
//
// Inputs: `voucher_receipt_id` = the receipts.id of a row where
// receipt_type='credit_note'. The voucher_number column on that row
// holds the pre-formatted C{nn}/{year} string we display.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CreditNoteVoucherRequest {
  voucher_receipt_id: string;
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
    receipt_date: string;
    amount: number;
    description: string | null;
  },
  source: {
    // Optional reference to the policy the credit note is settling
    // (cancelled / transferred). Shown as a meta row when present.
    policy_document_number: string | null;
    policy_number: string | null;
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

  // The credit-note tint is emerald — green for "we owe the customer"
  // — sitting parallel to the red used on سند إلغاء. Same structure
  // and proportions as the cancellation voucher so the two documents
  // read like a matched pair.
  const accent = '#047857';        // emerald-700
  const accentBg = '#ecfdf5';       // emerald-50

  return `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap" rel="stylesheet">
  <title>اشعار دائن - ${escapeHtml(client?.full_name || 'عميل')}</title>
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
        <div class="doc-title">اشعار دائن</div>
        <div class="subtitle">رصيد للعميل عند الشركة</div>
        <div class="meta-rows">
          <div class="row">
            <div class="label">رقم الإشعار</div>
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
            <div class="label">تاريخ الإصدار</div>
            <div class="val">${formatDate(voucher.receipt_date)}</div>
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

    ${voucher.description ? `
    <div class="body-section">
      <div class="row">
        <div class="label">التفاصيل</div>
        <div class="val">${escapeHtml(voucher.description).replace(/\n/g, '<br>')}</div>
      </div>
    </div>
    ` : ''}

    <div class="total-row">
      <div class="box">
        <div class="label">رصيد العميل</div>
        <div class="val">₪${Number(voucher.amount || 0).toLocaleString('en-US')}</div>
      </div>
    </div>

    <div class="footer">
      <div class="thanks">هذا المبلغ يُحسم تلقائياً من أي دفعة قادمة للعميل.</div>
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

    const { voucher_receipt_id }: CreditNoteVoucherRequest = await req.json();
    if (!voucher_receipt_id) {
      return new Response(
        JSON.stringify({ error: "voucher_receipt_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Pull the credit_note row + linked client + (optional) policy
    // for the meta header reference. client_id is on the receipts row
    // directly; we still fall back to policy → clients if the receipt
    // somehow lacks a client_id (defensive — the modal sets it).
    const { data: voucherRow, error: voucherErr } = await supabase
      .from('receipts')
      .select(`
        id, voucher_number, amount, receipt_date, notes,
        receipt_type, client_id, policy_id
      `)
      .eq('id', voucher_receipt_id)
      .maybeSingle();

    if (voucherErr || !voucherRow) {
      return new Response(
        JSON.stringify({ error: "voucher not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (voucherRow.receipt_type !== 'credit_note') {
      return new Response(
        JSON.stringify({ error: "row is not a credit note" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let client = {
      full_name: '',
      id_number: null as string | null,
      phone_number: null as string | null,
      phone_number_2: null as string | null,
    };
    if (voucherRow.client_id) {
      const { data: c } = await supabase
        .from('clients')
        .select('full_name, id_number, phone_number, phone_number_2')
        .eq('id', voucherRow.client_id)
        .maybeSingle();
      if (c) {
        client = {
          full_name: c.full_name || '',
          id_number: c.id_number ?? null,
          phone_number: c.phone_number ?? null,
          phone_number_2: c.phone_number_2 ?? null,
        };
      }
    } else if (voucherRow.policy_id) {
      const { data: pol } = await supabase
        .from('policies')
        .select('client:clients(full_name, id_number, phone_number, phone_number_2)')
        .eq('id', voucherRow.policy_id)
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
    if (voucherRow.policy_id) {
      const { data: pol } = await supabase
        .from('policies')
        .select('document_number, policy_number')
        .eq('id', voucherRow.policy_id)
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
        voucher_number: voucherRow.voucher_number as string,
        receipt_date: voucherRow.receipt_date as string,
        amount: Number(voucherRow.amount || 0),
        description: (voucherRow.notes as string | null) ?? null,
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
    const storagePath = `vouchers/${year}/${month}/credit_note_${clientNameSafe}_${timestamp}_${randomId}.html`;
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
      console.error('[generate-credit-note-voucher] Bunny upload failed');
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
    console.error("[generate-credit-note-voucher] Fatal:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
