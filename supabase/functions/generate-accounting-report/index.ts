import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import { buildBunnyStorageUploadUrl, normalizeBunnyCdnUrl, resolveBunnyStorageZone } from "../_shared/bunny-storage.ts";
import { getAgentBranding, resolveAgentId, DEFAULT_BRANDING, type AgentBranding } from "../_shared/agent-branding.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type StatTone = 'primary' | 'destructive' | 'success' | 'amber' | 'emerald';
type CellAlign = 'right' | 'left' | 'center';

interface StatPayload {
  label: string;
  value: string;
  tone?: StatTone;
}

interface ColumnPayload {
  key: string;
  label: string;
  align?: CellAlign;
}

interface RowPayload {
  [key: string]: string | number | null | undefined;
}

interface AccountingReportRequest {
  // Document title — printed big like "سند قبض" on the receipt template.
  title: string;
  // Free-text context line under the title (e.g. "شركات التأمين — كل الإصدارات").
  subtitle?: string;
  // Optional date range / filter line shown as the meta-rows panel.
  meta?: { label: string; value: string }[];
  stats: StatPayload[];
  columns: ColumnPayload[];
  rows: RowPayload[];
  // When true, the printed report ends with a totals bar that sums the
  // `total_key` column across all rows (used for settlements lists).
  total_key?: string | null;
  total_label?: string | null;
}

const TONE_CLASS: Record<StatTone, string> = {
  primary: 'tone-primary',
  destructive: 'tone-destructive',
  success: 'tone-success',
  amber: 'tone-amber',
  emerald: 'tone-emerald',
};

function escapeHtml(str: string | number | null | undefined): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function buildAccountingReportHtml(
  payload: AccountingReportRequest,
  branding: AgentBranding,
  contact: { company_email?: string; company_phone_links?: { phone: string; href: string }[]; company_location?: string },
): string {
  const today = new Date();
  const issuedAt = formatDate(today);

  const statsHtml = payload.stats
    .map((s) => {
      const cls = s.tone ? TONE_CLASS[s.tone] : '';
      return `
        <div class="stat ${cls}">
          <div class="stat-label">${escapeHtml(s.label)}</div>
          <div class="stat-value">${escapeHtml(s.value)}</div>
        </div>
      `;
    })
    .join('');

  const metaRowsHtml = (payload.meta ?? [])
    .map(
      (m) => `
        <div class="row">
          <div class="label">${escapeHtml(m.label)}</div>
          <div class="val">${escapeHtml(m.value)}</div>
        </div>
      `,
    )
    .join('');

  const headerCellsHtml = payload.columns
    .map(
      (c) => `<th class="align-${c.align ?? 'right'}">${escapeHtml(c.label)}</th>`,
    )
    .join('');

  // Per-cell linking: when a row has `<key>_url` set to a non-empty
  // string, wrap that cell in an <a target="_blank">. The .cell-link
  // class shows the link in the browser (dashed blue underline) but
  // is reset to plain text under @media print, so the printed paper
  // doesn't reveal it as a hyperlink.
  const tableBodyHtml = payload.rows
    .map((row) => {
      const cells = payload.columns
        .map((c) => {
          const raw = row[c.key];
          const val = raw === null || raw === undefined || raw === '' ? '—' : raw;
          const urlRaw = row[`${c.key}_url`];
          const href = typeof urlRaw === 'string' && urlRaw.length > 0 ? urlRaw : null;
          const inner = escapeHtml(val);
          const content = href
            ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" class="cell-link">${inner}</a>`
            : inner;
          return `<td class="align-${c.align ?? 'right'}">${content}</td>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');

  // Totals row — only rendered when the caller specifies a numeric
  // column to sum. Each row's value is expected to already be a string
  // like "₪1,014" so we strip non-digit/decimal characters before
  // summing and re-format with Intl.
  let totalsRowHtml = '';
  if (payload.total_key) {
    const numericTotal = payload.rows.reduce((sum, row) => {
      const raw = row[payload.total_key as string];
      if (raw === null || raw === undefined) return sum;
      const numeric = Number(String(raw).replace(/[^\d.-]/g, ''));
      return sum + (Number.isFinite(numeric) ? numeric : 0);
    }, 0);
    const formatted = `₪${numericTotal.toLocaleString('en-US')}`;
    const colspan = payload.columns.length - 1;
    const totalLabel = payload.total_label || 'الإجمالي';
    totalsRowHtml = `
      <tr class="totals-row">
        <td class="align-right" colspan="${colspan}">${escapeHtml(totalLabel)}</td>
        <td class="align-right total-cell">${escapeHtml(formatted)}</td>
      </tr>
    `;
  }

  const phoneLinksHtml = (contact.company_phone_links || [])
    .map((link) => `<a href="${link.href}">${escapeHtml(link.phone)}</a>`)
    .join(' / ');
  const contactLines: string[] = [];
  if (phoneLinksHtml) contactLines.push(`هاتف: ${phoneLinksHtml}`);
  if (contact.company_email) {
    contactLines.push(`بريد: <a href="mailto:${contact.company_email}">${escapeHtml(contact.company_email)}</a>`);
  }
  if (contact.company_location) {
    contactLines.push(`عنوان: ${escapeHtml(contact.company_location)}`);
  }
  const contactFooterHtml = contactLines.length > 0
    ? `<div class="contact">${contactLines.join(' · ')}</div>`
    : '';

  const rowCount = payload.rows.length;

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap" rel="stylesheet">
  <title>${escapeHtml(payload.title)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    @page { size: A4 landscape; margin: 0; }
    @media print {
      html, body { background: #ffffff; }
      body { padding: 8mm 6mm; }
      .no-print { display: none !important; }
      .invoice { border: 1px solid #1a1a1a; }
      thead { display: table-header-group; }
      tr { page-break-inside: avoid; }
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
      max-width: 1200px;
      margin: 0 auto;
      background: #ffffff;
      border: 1px solid #1a1a1a;
      padding: 28px 30px;
    }

    /* Header */
    .invoice-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 28px;
      padding-bottom: 18px;
      border-bottom: 1px solid #1a1a1a;
      margin-bottom: 22px;
    }
    .brand { max-width: 380px; }
    .brand .logo { max-height: 70px; max-width: 200px; margin-bottom: 10px; display: block; }
    .brand .name { font-size: 16px; font-weight: 700; }
    .brand .tax {
      font-size: 12px;
      margin-top: 2px;
      direction: ltr;
      text-align: right;
      font-variant-numeric: tabular-nums;
      font-weight: 500;
    }
    .brand .address { font-size: 12px; margin-top: 8px; line-height: 1.55; font-weight: 500; }
    .invoice-meta { text-align: left; min-width: 280px; }
    .invoice-meta .doc-title {
      font-size: 36px;
      font-weight: 800;
      letter-spacing: 0.5px;
      line-height: 1;
      margin-bottom: 4px;
    }
    .invoice-meta .subtitle {
      font-size: 12px;
      margin-bottom: 12px;
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
      flex: 0 0 130px;
      padding: 7px 12px;
      background: #f4f4f5;
      font-weight: 700;
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
      font-variant-numeric: tabular-nums;
    }

    /* Stats grid — same five-pill bar shown on the page itself, made
       printable with a uniform dark border and big monospaced figures. */
    .stats {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      border: 1px solid #1a1a1a;
      margin-bottom: 22px;
    }
    .stats .stat {
      padding: 12px 14px;
      border-left: 1px solid #1a1a1a;
      background: #ffffff;
    }
    .stats .stat:last-child { border-left: 0; }
    .stat-label {
      font-size: 10.5px;
      font-weight: 700;
      letter-spacing: 0.4px;
      opacity: 0.7;
      margin-bottom: 4px;
    }
    .stat-value {
      font-size: 18px;
      font-weight: 800;
      font-variant-numeric: tabular-nums;
      direction: ltr;
      text-align: right;
    }
    .stat.tone-primary .stat-value { color: #1a1a1a; }
    .stat.tone-destructive .stat-value { color: #b91c1c; }
    .stat.tone-success .stat-value { color: #047857; }
    .stat.tone-emerald .stat-value { color: #059669; }
    .stat.tone-amber .stat-value { color: #b45309; }

    /* Section title above the data table */
    .section-title {
      padding: 8px 14px;
      border: 1px solid #1a1a1a;
      border-bottom: 0;
      background: #f4f4f5;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 1.5px;
      text-transform: uppercase;
    }

    /* Data table */
    table.data {
      width: 100%;
      border-collapse: collapse;
      border: 1px solid #1a1a1a;
      font-size: 12px;
    }
    table.data thead th {
      background: #f4f4f5;
      color: #1a1a1a;
      padding: 8px 10px;
      font-weight: 700;
      font-size: 11px;
      letter-spacing: 0.4px;
      border-bottom: 1px solid #1a1a1a;
      border-left: 1px solid #e5e7eb;
    }
    table.data thead th:last-child { border-left: 0; }
    table.data tbody td {
      padding: 7px 10px;
      border-top: 1px solid #e5e7eb;
      border-left: 1px solid #e5e7eb;
      font-variant-numeric: tabular-nums;
      vertical-align: middle;
    }
    table.data tbody td:last-child { border-left: 0; }
    table.data tbody tr:nth-child(even) td { background: #fafafa; }
    table.data .align-right { text-align: right; }
    table.data .align-left { text-align: left; direction: ltr; }
    table.data .align-center { text-align: center; }
    table.data tr.totals-row td {
      background: #1a1a1a !important;
      color: #ffffff;
      font-weight: 800;
      font-size: 13px;
      padding: 10px 12px;
    }
    table.data tr.totals-row .total-cell {
      direction: ltr;
      text-align: left;
    }
    /* In-cell clickable voucher numbers — visible only on screen.
       On paper the link styling is reset so the cell prints as plain
       text and nothing hints at it being a hyperlink. */
    table.data .cell-link {
      color: #1d4ed8;
      text-decoration: none;
      border-bottom: 1px dashed #1d4ed8;
    }
    table.data .cell-link:hover { border-bottom-style: solid; }
    @media print {
      table.data .cell-link {
        color: inherit;
        border-bottom: none;
      }
    }

    .empty {
      padding: 40px 20px;
      text-align: center;
      border: 1px solid #1a1a1a;
      border-top: 0;
      font-size: 13px;
      opacity: 0.6;
    }

    /* Footer */
    .footer {
      padding-top: 16px;
      border-top: 1px solid #1a1a1a;
      margin-top: 22px;
      font-size: 12px;
      text-align: center;
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

    @media (max-width: 900px) {
      .stats { grid-template-columns: repeat(2, 1fr); }
      .stats .stat { border-left: 1px solid #1a1a1a; border-top: 1px solid #1a1a1a; }
      .stats .stat:nth-child(-n+2) { border-top: 0; }
      .stats .stat:nth-child(2n) { border-left: 0; }
      .invoice-top { flex-direction: column; align-items: stretch; }
      .invoice-meta { text-align: right; }
      .invoice-meta .doc-title { font-size: 28px; }
      table.data { font-size: 11px; }
      table.data thead th { padding: 6px 6px; font-size: 10px; }
      table.data tbody td { padding: 6px 6px; }
    }
  </style>
</head>
<body>
  <div class="invoice">
    <div class="invoice-top">
      <div class="brand">
        ${branding.logoUrl ? `<img class="logo" src="${branding.logoUrl}" alt="${escapeHtml(branding.companyName)}" />` : ''}
        <div class="name">${escapeHtml(branding.companyName)}</div>
        ${branding.taxNumber ? `<div class="tax">رقم المشغل: ${escapeHtml(branding.taxNumber)}</div>` : ''}
        ${branding.invoiceAddress ? `<div class="address">${escapeHtml(branding.invoiceAddress)}</div>`
          : (contact.company_location ? `<div class="address">${escapeHtml(contact.company_location)}</div>` : '')}
      </div>
      <div class="invoice-meta">
        <div class="doc-title">${escapeHtml(payload.title)}</div>
        ${payload.subtitle ? `<div class="subtitle">${escapeHtml(payload.subtitle)}</div>` : ''}
        <div class="meta-rows">
          <div class="row">
            <div class="label">تاريخ الإصدار</div>
            <div class="val">${escapeHtml(issuedAt)}</div>
          </div>
          <div class="row">
            <div class="label">عدد السجلات</div>
            <div class="val">${rowCount}</div>
          </div>
          ${metaRowsHtml}
        </div>
      </div>
    </div>

    ${payload.stats.length > 0 ? `<div class="stats">${statsHtml}</div>` : ''}

    <div class="section-title">${escapeHtml(payload.title)}</div>
    ${rowCount > 0
      ? `<table class="data">
          <thead><tr>${headerCellsHtml}</tr></thead>
          <tbody>${tableBodyHtml}${totalsRowHtml}</tbody>
        </table>`
      : `<div class="empty">لا توجد سجلات لطباعتها.</div>`
    }

    <div class="footer">
      ${contactFooterHtml}
      <div class="issued">تاريخ الإصدار: ${escapeHtml(issuedAt)}</div>
    </div>

    <div class="actions no-print">
      <button type="button" onclick="window.print()">طباعة</button>
    </div>
  </div>
</body>
</html>`;
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
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const bunnyApiKey = Deno.env.get('BUNNY_API_KEY');
    const rawBunnyStorageZone = Deno.env.get('BUNNY_STORAGE_ZONE');
    const bunnyCdnUrl = normalizeBunnyCdnUrl(Deno.env.get('BUNNY_CDN_URL'));
    const bunnyStorageZone = resolveBunnyStorageZone(rawBunnyStorageZone, bunnyCdnUrl);

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid authentication" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const agentId = await resolveAgentId(supabase, user.id);
    const branding = await getAgentBranding(supabase, agentId);

    const payload = await req.json() as AccountingReportRequest;
    if (!payload || typeof payload.title !== 'string' || !Array.isArray(payload.columns) || !Array.isArray(payload.rows)) {
      return new Response(
        JSON.stringify({ error: "title, columns, and rows are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: smsSettings } = await supabase
      .from("sms_settings")
      .select("company_email, company_phone_links, company_location")
      .limit(1)
      .maybeSingle();

    const contact = {
      company_email: smsSettings?.company_email || '',
      company_phone_links: (smsSettings?.company_phone_links as { phone: string; href: string }[] | null) || [],
      company_location: smsSettings?.company_location || '',
    };

    const html = buildAccountingReportHtml(payload, branding ?? DEFAULT_BRANDING, contact);

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
    const titleSafe = (payload.title || 'report').replace(/[^a-zA-Z0-9؀-ۿ]/g, '_');
    const storagePath = `accounting/${year}/${month}/report_${titleSafe}_${timestamp}_${randomId}.html`;

    const uploadUrl = buildBunnyStorageUploadUrl(bunnyStorageZone, storagePath);
    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'AccessKey': bunnyApiKey,
        'Content-Type': 'text/html; charset=utf-8',
      },
      body: html,
    });
    if (!uploadResponse.ok) {
      // Fall back to inline HTML so the user still sees the report.
      return new Response(html, {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
      });
    }

    const reportUrl = `${bunnyCdnUrl}/${storagePath}`;
    return new Response(
      JSON.stringify({ success: true, report_url: reportUrl }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: unknown) {
    console.error("[generate-accounting-report] Fatal error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
