import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface GenerateReportRequest {
  month: string;
  days_filter?: number | null;
  policy_type?: string | null;
  created_by?: string | null;
  search?: string | null;
  branch_id?: string | null;
}

const POLICY_TYPE_LABELS: Record<string, string> = {
  ELZAMI: 'إلزامي',
  THIRD_FULL: 'ثالث/شامل',
  FULL: 'شامل',
  THIRD: 'ثالث',
  ROAD_SERVICE: 'خدمات الطريق',
  ACCIDENT_FEE_EXEMPTION: 'إعفاء رسوم حادث',
  HEALTH: 'تأمين صحي',
  LIFE: 'تأمين حياة',
  PROPERTY: 'تأمين ممتلكات',
  TRAVEL: 'تأمين سفر',
  BUSINESS: 'تأمين أعمال',
  OTHER: 'أخرى',
  PACKAGE: 'باقة',
};

const RENEWAL_STATUS_LABELS: Record<string, string> = {
  not_contacted: 'لم يتم التواصل',
  sms_sent: 'تم إرسال SMS',
  called: 'تم الاتصال',
  renewed: 'تم التجديد',
  not_interested: 'غير مهتم',
};

interface RenewalClientRow {
  client_id: string;
  client_name: string;
  client_file_number: string | null;
  client_phone: string | null;
  policies_count: number;
  earliest_end_date: string;
  days_remaining: number;
  total_insurance_price: number;
  policy_types: string[] | null;
  policy_ids: string[] | null;
  car_numbers: string[] | null;
  worst_renewal_status: string;
  renewal_notes: string | null;
}

interface PolicyRow {
  id: string;
  client_id: string;
  group_id: string | null;
  policy_type_parent: string;
  policy_type_child: string | null;
  start_date: string | null;
  end_date: string | null;
  insurance_price: number | null;
  cars: { car_number: string | null } | null;
  insurance_companies: { name_ar: string | null; name: string | null } | null;
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
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const bunnyApiKey = Deno.env.get("BUNNY_API_KEY");
    const bunnyStorageZone = Deno.env.get("BUNNY_STORAGE_ZONE");
    const bunnyCdnUrl = Deno.env.get('BUNNY_CDN_URL') || 'https://kareem.b-cdn.net';

    // Service-role client: direct table reads (policies, profiles).
    const service = createClient(supabaseUrl, supabaseServiceKey);
    // Caller client: carries the user JWT so report_renewals can resolve
    // auth.uid() for is_super_admin / get_user_agent_id checks.
    const caller = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await service.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid authentication" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body: GenerateReportRequest = await req.json();
    const { month, days_filter, policy_type, created_by, search, branch_id } = body;

    if (!month) {
      return new Response(
        JSON.stringify({ error: "month is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Mirror the page's date-range logic exactly.
    let startDate: string;
    let endDate: string;
    if (!days_filter) {
      const [y, m] = month.split('-').map(Number);
      const s = new Date(Date.UTC(y, m - 1, 1));
      const e = new Date(Date.UTC(y, m, 0));
      startDate = s.toISOString().slice(0, 10);
      endDate = e.toISOString().slice(0, 10);
    } else {
      const today = new Date();
      const e = new Date(today);
      e.setDate(today.getDate() + days_filter);
      startDate = today.toISOString().slice(0, 10);
      endDate = e.toISOString().slice(0, 10);
    }

    console.log(`[generate-renewals-report] range=${startDate}..${endDate} type=${policy_type ?? 'all'} branch=${branch_id ?? '-'} user=${user.id}`);

    // Fetch all clients in one go (large page size). report_renewals
    // already counts a package as ONE معاملة (DISTINCT group_id|id) and
    // honours the new "renewed only via followup click" rule.
    const { data: clientRows, error: rpcError } = await caller.rpc('report_renewals', {
      p_start_date: startDate,
      p_end_date: endDate,
      p_policy_type: policy_type || null,
      p_created_by: created_by || null,
      p_search: search || null,
      p_page_size: 5000,
      p_page: 1,
      p_branch_id: branch_id || null,
    });

    if (rpcError) {
      console.error('[generate-renewals-report] report_renewals failed:', rpcError);
      return new Response(
        JSON.stringify({ error: rpcError.message || 'Failed to load renewals' }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const clients = (clientRows || []) as RenewalClientRow[];
    console.log(`[generate-renewals-report] ${clients.length} clients`);

    // Batch-fetch every policy referenced by the report so we can render
    // package vs single, with company / car / dates / price details.
    const allPolicyIds = clients.flatMap(c => c.policy_ids || []).filter(Boolean);
    let policiesById = new Map<string, PolicyRow>();
    if (allPolicyIds.length > 0) {
      const { data: policies, error: polError } = await service
        .from('policies')
        .select('id, client_id, group_id, policy_type_parent, policy_type_child, start_date, end_date, insurance_price, cars(car_number), insurance_companies(name_ar, name)')
        .in('id', allPolicyIds);
      if (polError) {
        console.error('[generate-renewals-report] policies fetch failed:', polError);
        return new Response(
          JSON.stringify({ error: polError.message || 'Failed to load policy details' }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      policiesById = new Map((policies as unknown as PolicyRow[]).map(p => [p.id, p]));
    }

    // Resolve issuer name for the footer.
    const { data: userProfile } = await service
      .from('profiles')
      .select('full_name, email')
      .eq('id', user.id)
      .single();
    const generatedBy = userProfile?.full_name || userProfile?.email || 'Unknown';

    // Branch label (optional — only when filter is applied).
    let branchLabel: string | null = null;
    if (branch_id) {
      const { data: branchRow } = await service
        .from('branches')
        .select('name_ar, name')
        .eq('id', branch_id)
        .single();
      branchLabel = (branchRow?.name_ar as string | null) || (branchRow?.name as string | null) || null;
    }

    const html = buildReportHtml({
      clients,
      policiesById,
      month,
      startDate,
      endDate,
      daysFilter: days_filter ?? null,
      policyType: policy_type || null,
      generatedBy,
      branchLabel,
    });

    if (!bunnyApiKey || !bunnyStorageZone) {
      return new Response(
        JSON.stringify({ error: 'Storage not configured (BUNNY_API_KEY / BUNNY_STORAGE_ZONE missing)' }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const now = new Date();
    const year = now.getFullYear();
    const monthNum = String(now.getMonth() + 1).padStart(2, '0');
    const timestamp = Date.now();
    const randomId = crypto.randomUUID().slice(0, 8);
    const storagePath = `reports/${year}/${monthNum}/renewals_report_${month}_${timestamp}_${randomId}.html`;
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
      const text = await uploadResponse.text().catch(() => '');
      console.error(`[generate-renewals-report] Bunny upload failed ${uploadResponse.status}: ${text}`);
      return new Response(
        JSON.stringify({ error: `Failed to upload report (Bunny ${uploadResponse.status})` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const reportUrl = `${bunnyCdnUrl}/${storagePath}`;
    console.log(`[generate-renewals-report] OK ${reportUrl}`);

    return new Response(
      JSON.stringify({ success: true, url: reportUrl }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Internal server error';
    console.error("[generate-renewals-report] Error:", error);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(d: string | null | undefined): string {
  if (!d) return '-';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '-';
  return dt.toLocaleDateString('en-GB');
}

function formatMoney(n: number | null | undefined): string {
  return `₪${(n || 0).toLocaleString('en-US')}`;
}

function policyTypeLabel(parent: string | null, child: string | null): string {
  if (parent === 'THIRD_FULL' && child) {
    return POLICY_TYPE_LABELS[child] || child;
  }
  return POLICY_TYPE_LABELS[parent || ''] || parent || '-';
}

function daysRemainingText(days: number): string {
  if (days < 0) return `منتهية منذ ${Math.abs(days)} يوم`;
  if (days === 0) return 'اليوم!';
  if (days === 1) return 'غداً!';
  return `${days} يوم`;
}

function urgencyClass(days: number): 'urgent' | 'warning' | 'normal' {
  if (days <= 7) return 'urgent';
  if (days <= 14) return 'warning';
  return 'normal';
}

interface BuildArgs {
  clients: RenewalClientRow[];
  policiesById: Map<string, PolicyRow>;
  month: string;
  startDate: string;
  endDate: string;
  daysFilter: number | null;
  policyType: string | null;
  generatedBy: string;
  branchLabel: string | null;
}

function buildReportHtml(args: BuildArgs): string {
  const { clients, policiesById, month, startDate, endDate, daysFilter, policyType, generatedBy, branchLabel } = args;

  const generatedAt = new Date().toLocaleString('en-GB', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });

  const rangeLabel = daysFilter
    ? `الـ ${daysFilter} يوم القادمة`
    : new Date(`${month}-01`).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long' });

  // Summary stats — all derived from the same client rows so they match
  // exactly what the page shows.
  const totalClients = clients.length;
  let totalTransactions = 0;     // packages count as 1
  let totalPackages = 0;
  let totalSingles = 0;
  let totalValue = 0;
  for (const c of clients) {
    totalTransactions += c.policies_count || 0;
    totalValue += Number(c.total_insurance_price || 0);
    // Per-client package vs single: walk the policies, group by group_id.
    const polIds = c.policy_ids || [];
    const groupSet = new Set<string>();
    let singles = 0;
    for (const pid of polIds) {
      const p = policiesById.get(pid);
      if (!p) continue;
      if (p.group_id) groupSet.add(p.group_id); else singles += 1;
    }
    totalPackages += groupSet.size;
    totalSingles += singles;
  }

  const clientSections = clients.map((client, idx) => renderClientSection(client, policiesById, idx + 1)).join('\n');

  const filtersBadges: string[] = [];
  if (policyType) filtersBadges.push(`النوع: ${escapeHtml(POLICY_TYPE_LABELS[policyType] || policyType)}`);
  if (branchLabel) filtersBadges.push(`الفرع: ${escapeHtml(branchLabel)}`);

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>تقرير التجديدات - ${escapeHtml(rangeLabel)}</title>
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
    }
    body { padding: 32px 16px; }
    .report {
      max-width: 920px;
      margin: 0 auto;
      background: #ffffff;
      padding: 40px 44px;
      border: 1px solid #1a1a1a;
    }

    /* ── Header ── */
    .report-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 24px;
      padding-bottom: 22px;
      border-bottom: 1px solid #1a1a1a;
      margin-bottom: 24px;
    }
    .brand .name { font-size: 18px; font-weight: 700; }
    .brand .sub { font-size: 12px; margin-top: 4px; font-weight: 500; }
    .report-meta { text-align: left; min-width: 260px; }
    .report-meta .doc-title {
      font-size: 38px; font-weight: 800; letter-spacing: 0.5px; line-height: 1; margin-bottom: 4px;
    }
    .report-meta .subtitle {
      font-size: 12px; font-weight: 600; margin-top: -6px; margin-bottom: 14px; letter-spacing: 0.5px;
    }
    .meta-rows { width: 100%; border: 1px solid #1a1a1a; font-size: 12px; }
    .meta-rows .row { display: flex; }
    .meta-rows .row + .row { border-top: 1px solid #1a1a1a; }
    .meta-rows .label {
      flex: 0 0 110px; padding: 7px 12px; background: #f4f4f5; font-weight: 700;
      font-size: 11.5px; text-align: right; border-left: 1px solid #1a1a1a; letter-spacing: 0.3px;
    }
    .meta-rows .val {
      flex: 1; padding: 7px 12px; text-align: left; direction: ltr; font-weight: 700;
      font-variant-numeric: tabular-nums;
    }

    /* ── Section frame ── */
    .section { margin-bottom: 20px; border: 1px solid #1a1a1a; }
    .section-title {
      padding: 8px 14px; border-bottom: 1px solid #1a1a1a; background: #f4f4f5;
      font-size: 11px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase;
    }

    /* ── Summary grid ── */
    .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); }
    .summary-grid .cell { padding: 10px 14px; text-align: center; }
    .summary-grid .cell:not(:nth-child(4n+1)) { border-right: 1px solid #1a1a1a; }
    .summary-grid .label {
      font-size: 10px; font-weight: 700; margin-bottom: 4px;
      letter-spacing: 0.8px; text-transform: uppercase; opacity: 0.85;
    }
    .summary-grid .value { font-size: 18px; font-weight: 800; font-variant-numeric: tabular-nums; }

    .filters-line {
      padding: 8px 14px; border-top: 1px solid #1a1a1a; background: #fbfbfc;
      font-size: 11px; font-weight: 600; letter-spacing: 0.3px;
    }
    .filters-line .chip {
      display: inline-block; border: 1px solid #1a1a1a; padding: 2px 8px; margin-left: 6px;
      background: #fff; font-size: 10.5px;
    }

    /* ── Client section ── */
    .client { margin-bottom: 20px; border: 1px solid #1a1a1a; page-break-inside: avoid; }
    .client-head {
      display: flex; justify-content: space-between; align-items: center; gap: 12px;
      padding: 10px 14px; background: #f4f4f5; border-bottom: 1px solid #1a1a1a; flex-wrap: wrap;
    }
    .client-head .left { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .client-head .num {
      display: inline-flex; align-items: center; justify-content: center;
      width: 26px; height: 26px; background: #1a1a1a; color: #fff;
      font-size: 12px; font-weight: 700; border-radius: 4px;
    }
    .client-head .name { font-size: 15px; font-weight: 700; }
    .client-head .chip {
      display: inline-block; border: 1px solid #1a1a1a; background: #fff;
      padding: 2px 8px; font-size: 11px; font-weight: 600; letter-spacing: 0.2px;
    }
    .client-head .chip.phone { font-variant-numeric: tabular-nums; direction: ltr; }
    .client-head .chip.file { background: #fbfbfc; }
    .client-head .right { display: flex; align-items: center; gap: 10px; }
    .client-head .days {
      padding: 4px 10px; border: 1px solid #1a1a1a; font-size: 11px; font-weight: 700;
      letter-spacing: 0.3px;
    }
    .client-head .days.urgent { background: #1a1a1a; color: #fff; }
    .client-head .days.warning { background: #fef3c7; }
    .client-head .days.normal { background: #ecfdf5; }
    .client-head .total {
      font-size: 14px; font-weight: 800; font-variant-numeric: tabular-nums; direction: ltr;
    }
    .client-notes {
      padding: 8px 14px; border-bottom: 1px solid #1a1a1a; background: #fffbeb;
      font-size: 11.5px; font-weight: 500;
    }

    /* ── Items table (policies) ── */
    .data-table { width: 100%; border-collapse: collapse; }
    .data-table thead th {
      background: #f4f4f5; padding: 8px 12px; text-align: right;
      font-size: 11px; letter-spacing: 1.5px; font-weight: 700; text-transform: uppercase;
      border-bottom: 1px solid #1a1a1a; border-left: 1px solid #1a1a1a;
    }
    .data-table thead th:last-child { border-left: none; }
    .data-table tbody td {
      padding: 9px 12px; border-top: 1px solid #1a1a1a; border-left: 1px solid #1a1a1a;
      font-size: 13px; text-align: right; font-weight: 500; vertical-align: top;
    }
    .data-table tbody td:last-child { border-left: none; }
    .data-table tbody tr:first-child td { border-top: none; }
    .data-table tbody td.num {
      text-align: center; font-variant-numeric: tabular-nums; font-weight: 700;
    }
    .data-table tbody td.tabular {
      direction: ltr; text-align: right; font-variant-numeric: tabular-nums;
    }
    .data-table tbody td.amount {
      direction: ltr; text-align: left; font-variant-numeric: tabular-nums; font-weight: 700;
    }
    .data-table tbody td.period {
      direction: ltr; text-align: right; font-variant-numeric: tabular-nums;
      font-size: 12px; white-space: nowrap;
    }
    .item-title { font-weight: 700; font-size: 14px; }
    .item-meta { font-size: 11.5px; margin-top: 3px; font-weight: 500; opacity: 0.85; }

    /* Package row pattern — header row spans description, with indented
       components beneath. Matches the invoice's items table. */
    tr.package-header td {
      background: #f4f4f5; padding: 10px 12px; border-top: 2px solid #1a1a1a !important;
    }
    tr.package-header + tr td { border-top: 1px solid #1a1a1a; }
    tr.package-header .package-title {
      display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
      font-size: 13px; font-weight: 700;
    }
    .package-badge {
      display: inline-flex; align-items: center; gap: 4px;
      background: #1a1a1a; color: #ffffff; padding: 3px 10px;
      font-size: 11px; font-weight: 700; letter-spacing: 0.5px;
    }
    tr.package-component td { background: #fbfbfc; padding-top: 8px; padding-bottom: 8px; }
    tr.package-component td.num { font-size: 11px; opacity: 0.7; }

    /* Empty state */
    .empty {
      padding: 40px; text-align: center; font-size: 13px; opacity: 0.7;
    }

    /* Footer */
    .footer {
      margin-top: 28px; padding-top: 18px; border-top: 1px solid #1a1a1a;
      display: flex; justify-content: space-between; flex-wrap: wrap; gap: 12px;
      font-size: 12px;
    }
    .footer strong { font-weight: 700; }

    .actions { text-align: center; margin-top: 28px; }
    .actions button {
      background: #18181b; color: #fff; border: 1px solid #18181b;
      padding: 10px 26px; font-size: 12px; font-weight: 600; letter-spacing: 0.5px;
      cursor: pointer; font-family: inherit; margin: 0 5px; border-radius: 4px;
    }
    .actions button:hover { background: #fff; color: #18181b; }

    @media print {
      @page { size: A4; margin: 10mm; }
      html, body { background: #fff; }
      body { padding: 0; }
      .no-print { display: none !important; }
      .report { max-width: 100%; padding: 16px 20px; border: 1px solid #1a1a1a; }
      .client { page-break-inside: avoid; }
      tr.package-header td, .package-badge, .section-title,
      .meta-rows .label, .data-table thead th, .summary-grid .cell,
      .client-head, .client-notes {
        -webkit-print-color-adjust: exact; print-color-adjust: exact;
      }
    }

    @media (max-width: 640px) {
      body { padding: 14px 8px; font-size: 12px; }
      .report { padding: 22px 18px; }
      .report-top { flex-direction: column; align-items: stretch; gap: 16px; }
      .report-meta { text-align: right; min-width: 0; }
      .report-meta .doc-title { font-size: 32px; }
      .summary-grid { grid-template-columns: repeat(2, 1fr); }
      .summary-grid .cell:not(:nth-child(4n+1)) { border-right: none; }
      .summary-grid .cell:nth-child(2n+1) { border-right: 1px solid #1a1a1a; }
      .summary-grid .cell:nth-child(n+3) { border-top: 1px solid #1a1a1a; }
      .client-head { flex-direction: column; align-items: stretch; }
      .client-head .right { justify-content: space-between; }
    }
  </style>
</head>
<body>
  <div class="report">

    <!-- Header -->
    <div class="report-top">
      <div class="brand">
        <div class="name">تقرير التجديدات</div>
        <div class="sub">${escapeHtml(rangeLabel)}</div>
      </div>
      <div class="report-meta">
        <div class="doc-title">تقرير</div>
        <div class="subtitle">المعاملات المنتهية</div>
        <div class="meta-rows">
          <div class="row">
            <div class="label">من تاريخ</div>
            <div class="val">${formatDate(startDate)}</div>
          </div>
          <div class="row">
            <div class="label">إلى تاريخ</div>
            <div class="val">${formatDate(endDate)}</div>
          </div>
          <div class="row">
            <div class="label">تاريخ الإصدار</div>
            <div class="val">${escapeHtml(generatedAt)}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Summary -->
    <div class="section">
      <div class="section-title">ملخص التقرير</div>
      <div class="summary-grid">
        <div class="cell">
          <div class="label">العملاء</div>
          <div class="value">${totalClients}</div>
        </div>
        <div class="cell">
          <div class="label">المعاملات</div>
          <div class="value">${totalTransactions}</div>
        </div>
        <div class="cell">
          <div class="label">باقات</div>
          <div class="value">${totalPackages}</div>
        </div>
        <div class="cell">
          <div class="label">إجمالي</div>
          <div class="value">${formatMoney(totalValue)}</div>
        </div>
      </div>
      ${filtersBadges.length > 0 ? `<div class="filters-line">المرشحات: ${filtersBadges.map(b => `<span class="chip">${b}</span>`).join('')}</div>` : ''}
    </div>

    <!-- Clients -->
    ${clients.length === 0
      ? `<div class="section"><div class="empty">لا يوجد معاملات منتهية في هذه الفترة</div></div>`
      : clientSections}

    <!-- Footer -->
    <div class="footer">
      <div>تم إنشاء التقرير: <strong>${escapeHtml(generatedAt)}</strong></div>
      <div>بواسطة: <strong>${escapeHtml(generatedBy)}</strong></div>
    </div>

    <div class="actions no-print">
      <button type="button" onclick="window.print()">طباعة</button>
    </div>
  </div>
</body>
</html>`;
}

function renderClientSection(
  client: RenewalClientRow,
  policiesById: Map<string, PolicyRow>,
  index: number,
): string {
  const days = client.days_remaining;
  const urg = urgencyClass(days);
  const daysLabel = daysRemainingText(days);

  // Resolve and group policies for this client.
  const policies = (client.policy_ids || [])
    .map(id => policiesById.get(id))
    .filter((p): p is PolicyRow => Boolean(p));

  // Bucket: standalone[] + Map<group_id, PolicyRow[]>.
  const groups = new Map<string, PolicyRow[]>();
  const singles: PolicyRow[] = [];
  for (const p of policies) {
    if (p.group_id) {
      const arr = groups.get(p.group_id) || [];
      arr.push(p);
      groups.set(p.group_id, arr);
    } else {
      singles.push(p);
    }
  }
  // Stable order: earliest end_date first.
  const earliest = (arr: PolicyRow[]) => arr.reduce((min, p) => {
    const d = p.end_date || '9999-12-31';
    return d < min ? d : min;
  }, '9999-12-31');
  const sortedGroups = Array.from(groups.entries()).sort((a, b) => earliest(a[1]).localeCompare(earliest(b[1])));
  singles.sort((a, b) => (a.end_date || '').localeCompare(b.end_date || ''));

  // Build rows. Counter is per-معاملة (package = 1, single = 1).
  let counter = 0;
  const rows: string[] = [];

  // Render packages first to mirror the invoice convention.
  for (const [, members] of sortedGroups) {
    counter += 1;
    const memberTypes = Array.from(new Set(members.map(m => policyTypeLabel(m.policy_type_parent, m.policy_type_child))));
    const carNumbers = Array.from(new Set(members.map(m => m.cars?.car_number).filter(Boolean) as string[]));
    const minStart = members.reduce((m, p) => (p.start_date && (!m || p.start_date < m)) ? p.start_date : m, '' as string);
    const maxEnd = members.reduce((m, p) => (p.end_date && (!m || p.end_date > m)) ? p.end_date : m, '' as string);
    const total = members.reduce((s, p) => s + Number(p.insurance_price || 0), 0);

    rows.push(`
      <tr class="package-header">
        <td class="num">${counter}</td>
        <td colspan="3">
          <div class="package-title">
            <span class="package-badge">باقة</span>
            <span>${escapeHtml(memberTypes.join(' + '))}</span>
            ${carNumbers.length > 0 ? `<span class="item-meta">السيارة: <span class="tabular">${escapeHtml(carNumbers.join(', '))}</span></span>` : ''}
          </div>
          <div class="item-meta">${formatDate(minStart)} → ${formatDate(maxEnd)} · المجموع ${formatMoney(total)}</div>
        </td>
      </tr>`);

    for (const m of members) {
      rows.push(`
        <tr class="package-component">
          <td class="num">·</td>
          <td>
            <div class="item-title">${escapeHtml(policyTypeLabel(m.policy_type_parent, m.policy_type_child))}</div>
            <div class="item-meta">${escapeHtml(m.insurance_companies?.name_ar || m.insurance_companies?.name || '-')}</div>
          </td>
          <td class="period">${formatDate(m.start_date)} → ${formatDate(m.end_date)}</td>
          <td class="amount">${formatMoney(m.insurance_price)}</td>
        </tr>`);
    }
  }

  // Then singles.
  for (const p of singles) {
    counter += 1;
    rows.push(`
      <tr>
        <td class="num">${counter}</td>
        <td>
          <div class="item-title">${escapeHtml(policyTypeLabel(p.policy_type_parent, p.policy_type_child))}</div>
          <div class="item-meta">${escapeHtml(p.insurance_companies?.name_ar || p.insurance_companies?.name || '-')}</div>
          ${p.cars?.car_number ? `<div class="item-meta">السيارة: <span class="tabular">${escapeHtml(p.cars.car_number)}</span></div>` : ''}
        </td>
        <td class="period">${formatDate(p.start_date)} → ${formatDate(p.end_date)}</td>
        <td class="amount">${formatMoney(p.insurance_price)}</td>
      </tr>`);
  }

  const itemsTable = rows.length > 0
    ? `<table class="data-table">
        <thead>
          <tr>
            <th style="width:48px;">#</th>
            <th>الوصف</th>
            <th style="width:180px;">المدة</th>
            <th style="width:110px;">المبلغ</th>
          </tr>
        </thead>
        <tbody>${rows.join('')}</tbody>
      </table>`
    : '<div class="empty">لا توجد تفاصيل</div>';

  const statusLabel = RENEWAL_STATUS_LABELS[client.worst_renewal_status] || client.worst_renewal_status;

  return `
    <div class="client">
      <div class="client-head">
        <div class="left">
          <span class="num">${index}</span>
          <span class="name">${escapeHtml(client.client_name)}</span>
          ${client.client_phone ? `<span class="chip phone">${escapeHtml(client.client_phone)}</span>` : ''}
          ${client.client_file_number ? `<span class="chip file">#${escapeHtml(client.client_file_number)}</span>` : ''}
          <span class="chip">${escapeHtml(statusLabel)}</span>
        </div>
        <div class="right">
          <span class="days ${urg}">${escapeHtml(daysLabel)}</span>
          <span class="chip">${client.policies_count} معاملة</span>
          <span class="total">${formatMoney(client.total_insurance_price)}</span>
        </div>
      </div>
      ${client.renewal_notes ? `<div class="client-notes">ملاحظات: ${escapeHtml(client.renewal_notes)}</div>` : ''}
      ${itemsTable}
    </div>`;
}
