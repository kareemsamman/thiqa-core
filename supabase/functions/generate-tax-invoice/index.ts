import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TaxInvoiceParams {
  company_id?: string | null;
  company_ids?: string[] | null;
  start_date?: string | null;
  end_date?: string | null;
  policy_type?: string | null;
  policy_types?: string[] | null;
  broker_ids?: string[] | null;
  include_cancelled?: boolean;
  profit_percent: number;
}

interface InvoiceRow {
  clientName: string;
  phone: string;
  idNumber: string;
  insuranceType: string;
  fullAmount: number;
  profit: number;
  policyCount: number;
  carNumbers: string;
  paymentDates: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const bunnyApiKey = Deno.env.get("BUNNY_API_KEY");
    const bunnyStorageZone = Deno.env.get("BUNNY_STORAGE_ZONE") || "kareem";
    const bunnyCdnUrl = Deno.env.get('BUNNY_CDN_URL') || "https://kareem.b-cdn.net";

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body: TaxInvoiceParams = await req.json();
    const { company_id, company_ids, start_date, end_date, policy_type, policy_types, broker_ids, include_cancelled, profit_percent } = body;

    const effectiveCompanyIds = company_ids?.length ? company_ids : (company_id ? [company_id] : null);
    const effectivePolicyTypes = policy_types?.length ? policy_types : (policy_type && policy_type !== 'all' ? [policy_type] : null);

    console.log(`[generate-tax-invoice] companies: ${effectiveCompanyIds?.length || 'ALL'}, types: ${effectivePolicyTypes || 'ALL'}, brokers: ${broker_ids?.length || 'ALL'}, profit: ${profit_percent}%`);

    let companyName = "جميع الشركات";
    if (effectiveCompanyIds && effectiveCompanyIds.length > 0) {
      const { data: companies, error: companyError } = await supabase
        .from("insurance_companies")
        .select("id, name, name_ar")
        .in("id", effectiveCompanyIds);

      if (companyError || !companies || companies.length === 0) {
        return new Response(JSON.stringify({ error: "Company not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      companyName = companies.map(c => c.name_ar || c.name).join(" + ");
    }

    // Fetch policies with car data
    let query = supabase
      .from("policies")
      .select(`
        id, policy_type_parent, policy_type_child, insurance_price,
        start_date, end_date, cancelled, group_id, company_id, car_id,
        clients (full_name, phone_number, id_number),
        insurance_companies:company_id (name, name_ar),
        cars:car_id (car_number)
      `)
      .neq("policy_type_parent", "ELZAMI")
      .is("deleted_at", null);

    if (effectiveCompanyIds) query = query.in("company_id", effectiveCompanyIds);
    if (effectivePolicyTypes) query = query.in("policy_type_parent", effectivePolicyTypes);
    if (broker_ids?.length) query = query.in("broker_id", broker_ids);
    if (start_date) query = query.gte("start_date", start_date);
    if (end_date) query = query.lte("start_date", end_date);
    if (!include_cancelled) query = query.eq("cancelled", false);

    const { data: policies, error: policiesError } = await query.order("start_date", { ascending: true });

    if (policiesError) {
      console.error("[generate-tax-invoice] Error:", policiesError);
      return new Response(JSON.stringify({ error: "Failed to fetch policies" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Collect group_ids for package components
    const groupIds = [...new Set((policies || []).filter((p: any) => p.group_id).map((p: any) => p.group_id))];

    let allGroupPolicies: any[] = [];
    if (groupIds.length > 0) {
      let groupQuery = supabase
        .from("policies")
        .select(`
          id, policy_type_parent, policy_type_child, insurance_price,
          group_id, company_id, car_id,
          insurance_companies:company_id (name, name_ar),
          cars:car_id (car_number)
        `)
        .in("group_id", groupIds)
        .neq("policy_type_parent", "ELZAMI")
        .is("deleted_at", null);

      if (!include_cancelled) groupQuery = groupQuery.eq("cancelled", false);
      if (start_date) groupQuery = groupQuery.gte("start_date", start_date);
      if (end_date) groupQuery = groupQuery.lte("start_date", end_date);

      const { data: groupData } = await groupQuery;
      allGroupPolicies = groupData || [];
    }

    // Batch fetch payment dates for all policy IDs
    const allPolicyIds = [
      ...new Set([
        ...(policies || []).map((p: any) => p.id),
        ...allGroupPolicies.map((p: any) => p.id),
      ]),
    ];

    const paymentMap = new Map<string, string[]>();
    if (allPolicyIds.length > 0) {
      // Fetch in chunks of 500 to avoid query limits
      for (let i = 0; i < allPolicyIds.length; i += 500) {
        const chunk = allPolicyIds.slice(i, i + 500);
        const { data: payments } = await supabase
          .from("policy_payments")
          .select("policy_id, payment_date")
          .in("policy_id", chunk);

        for (const pay of (payments || [])) {
          const existing = paymentMap.get(pay.policy_id) || [];
          if (pay.payment_date) existing.push(pay.payment_date);
          paymentMap.set(pay.policy_id, existing);
        }
      }
    }

    // Build invoice rows
    const processedGroupIds = new Set<string>();
    const rows: InvoiceRow[] = [];

    for (const policy of (policies || [])) {
      const p = policy as any;

      if (p.group_id && processedGroupIds.has(p.group_id)) continue;

      if (p.group_id) {
        processedGroupIds.add(p.group_id);
        const components = allGroupPolicies.filter((gp: any) => gp.group_id === p.group_id);
        const totalAmount = components.reduce((sum: number, c: any) => sum + (Number(c.insurance_price) || 0), 0);
        const typeDesc = components.map((c: any) => {
          const compName = c.insurance_companies?.name_ar || c.insurance_companies?.name || "";
          const typeName = getTypeLabel(c.policy_type_parent, c.policy_type_child);
          return `${compName} - ${typeName}`;
        }).join(" + ");

        // Collect car numbers from all components
        const carNums = new Set<string>();
        const payDates = new Set<string>();
        for (const c of components) {
          if (c.cars?.car_number) carNums.add(c.cars.car_number);
          for (const d of (paymentMap.get(c.id) || [])) payDates.add(d);
        }

        rows.push({
          clientName: p.clients?.full_name || "-",
          phone: p.clients?.phone_number || "-",
          idNumber: p.clients?.id_number || "-",
          insuranceType: typeDesc,
          fullAmount: totalAmount,
          profit: Math.round(totalAmount * profit_percent / 100),
          policyCount: 1,
          carNumbers: carNums.size > 0 ? [...carNums].join(", ") : "-",
          paymentDates: payDates.size > 0 ? [...payDates].map(d => formatDateShort(d)).join(", ") : "-",
        });
      } else {
        const compName = p.insurance_companies?.name_ar || p.insurance_companies?.name || "";
        const typeName = getTypeLabel(p.policy_type_parent, p.policy_type_child);
        const amount = Number(p.insurance_price) || 0;
        const carNum = p.cars?.car_number || "-";
        const pDates = paymentMap.get(p.id) || [];

        rows.push({
          clientName: p.clients?.full_name || "-",
          phone: p.clients?.phone_number || "-",
          idNumber: p.clients?.id_number || "-",
          insuranceType: `${compName} - ${typeName}`,
          fullAmount: amount,
          profit: Math.round(amount * profit_percent / 100),
          policyCount: 1,
          carNumbers: carNum,
          paymentDates: pDates.length > 0 ? pDates.map(d => formatDateShort(d)).join(", ") : "-",
        });
      }
    }

    // Group rows by client (idNumber)
    const groupedMap = new Map<string, InvoiceRow>();
    for (const row of rows) {
      const key = row.idNumber;
      const existing = groupedMap.get(key);
      if (existing) {
        existing.fullAmount += row.fullAmount;
        existing.profit += row.profit;
        existing.policyCount += row.policyCount;
        // Merge unique insurance types
        const existingTypes = new Set(existing.insuranceType.split(" + "));
        for (const t of row.insuranceType.split(" + ")) {
          if (!existingTypes.has(t)) existing.insuranceType += ` + ${t}`;
        }
        // Merge unique car numbers
        const existingCars = new Set(existing.carNumbers.split(", ").filter(c => c !== "-"));
        for (const c of row.carNumbers.split(", ").filter(c => c !== "-")) {
          existingCars.add(c);
        }
        existing.carNumbers = existingCars.size > 0 ? [...existingCars].join(", ") : "-";
        // Merge unique payment dates
        const existingDates = new Set(existing.paymentDates.split(", ").filter(d => d !== "-"));
        for (const d of row.paymentDates.split(", ").filter(d => d !== "-")) {
          existingDates.add(d);
        }
        existing.paymentDates = existingDates.size > 0 ? [...existingDates].join(", ") : "-";
      } else {
        groupedMap.set(key, { ...row });
      }
    }
    const mergedRows = Array.from(groupedMap.values());
    const totalPolicyCount = mergedRows.reduce((s, r) => s + r.policyCount, 0);
    const totalAmount = mergedRows.reduce((s, r) => s + r.fullAmount, 0);
    const totalProfit = mergedRows.reduce((s, r) => s + r.profit, 0);

    let filterDesc = "";
    if (start_date && end_date) {
      filterDesc = `الفترة: ${formatDateShort(start_date)} - ${formatDateShort(end_date)}`;
    } else {
      filterDesc = "كل الفترات";
    }

    const html = generateHtml(companyName, mergedRows, totalAmount, totalProfit, profit_percent, filterDesc, supabaseUrl, totalPolicyCount);

    if (bunnyApiKey) {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const timestamp = Date.now();
      const nameSafe = companyName.replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, "_");
      const storagePath = `reports/${year}/${month}/tax_invoice_${nameSafe}_${timestamp}.html`;
      const bunnyUploadUrl = `https://storage.bunnycdn.com/${bunnyStorageZone}/${storagePath}`;

      const uploadResponse = await fetch(bunnyUploadUrl, {
        method: "PUT",
        headers: { AccessKey: bunnyApiKey, "Content-Type": "text/html; charset=utf-8" },
        body: html,
      });

      if (uploadResponse.ok) {
        const cdnUrl = `${bunnyCdnUrl}/${storagePath}?v=${timestamp}`;
        return new Response(JSON.stringify({ success: true, url: cdnUrl }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    return new Response(html, {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (error: unknown) {
    console.error("[generate-tax-invoice] Fatal:", error);
    const msg = error instanceof Error ? error.message : "Internal server error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

const POLICY_TYPE_LABELS: Record<string, string> = {
  ELZAMI: "إلزامي",
  THIRD_FULL: "ثالث/شامل",
  ROAD_SERVICE: "خدمات الطريق",
  ACCIDENT_FEE_EXEMPTION: "إعفاء رسوم حادث",
  HEALTH: "تأمين صحي",
  LIFE: "تأمين حياة",
  PROPERTY: "تأمين ممتلكات",
  TRAVEL: "تأمين سفر",
  BUSINESS: "تأمين أعمال",
  OTHER: "أخرى",
};

const CHILD_LABELS: Record<string, string> = {
  THIRD: "ثالث",
  FULL: "شامل",
  THIRD_PLUS: "ثالث بلس",
};

function getTypeLabel(parent: string, child: string | null): string {
  if (parent === "THIRD_FULL" && child && CHILD_LABELS[child]) {
    return CHILD_LABELS[child];
  }
  return POLICY_TYPE_LABELS[parent] || parent;
}

function formatNumber(num: number): string {
  return num.toLocaleString("en-US");
}

function formatDateShort(dateStr: string): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("en-GB");
}

function generateHtml(
  companyName: string,
  rows: InvoiceRow[],
  totalAmount: number,
  totalProfit: number,
  profitPercent: number,
  filterDesc: string,
  supabaseUrl: string,
  totalPolicyCount: number
): string {
  const today = new Date().toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });

  const tableRows = rows.map((r, i) => `
    <tr id="row-${i}">
      <td style="text-align:center;border:1px solid #e2e8f0;padding:10px;">${i + 1}</td>
      <td style="border:1px solid #e2e8f0;padding:10px;">${r.clientName}</td>
      <td style="border:1px solid #e2e8f0;padding:10px;direction:ltr;text-align:center;">${r.phone}</td>
      <td style="border:1px solid #e2e8f0;padding:10px;text-align:center;">${r.idNumber}</td>
      <td style="border:1px solid #e2e8f0;padding:10px;text-align:center;">${r.policyCount}</td>
      <td style="border:1px solid #e2e8f0;padding:10px;direction:ltr;text-align:center;">${r.carNumbers}</td>
      <td style="border:1px solid #e2e8f0;padding:10px;">${r.insuranceType}</td>
      <td style="border:1px solid #e2e8f0;padding:10px;text-align:center;direction:ltr;">${r.paymentDates}</td>
      <td style="border:1px solid #e2e8f0;padding:10px;text-align:left;direction:ltr;">₪${formatNumber(r.fullAmount)}</td>
      <td style="border:1px solid #e2e8f0;padding:10px;text-align:left;direction:ltr;color:#16a34a;">₪${formatNumber(r.profit)}</td>
      <td class="rivhit-col" style="border:1px solid #e2e8f0;padding:10px;text-align:center;display:none;">
        <span class="status-icon" id="status-${i}">⏳</span>
      </td>
    </tr>
  `).join("");

  const rowsJson = JSON.stringify(rows);

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>فاتورة ضريبية - ${companyName}</title>
  <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Tajawal', 'Segoe UI', Tahoma, Arial, sans-serif; background: #122143; color: #1e293b; line-height: 1.6; min-height: 100vh; padding: 24px 16px; }
    .container { max-width: 1200px; margin: 0 auto; background: white; border-radius: 20px; box-shadow: 0 8px 40px rgba(0,0,0,0.25); overflow: hidden; }
    .header { background: linear-gradient(135deg, #122143 0%, #1a3260 100%); color: white; padding: 30px; text-align: center; }
    .header h1 { font-size: 28px; font-weight: 800; margin-bottom: 5px; }
    .header .subtitle { opacity: 0.9; font-size: 16px; }
    .header .company-name { font-size: 24px; font-weight: 700; margin-top: 15px; background: rgba(255,255,255,0.15); display: inline-block; padding: 8px 24px; border-radius: 8px; }
    .meta { display: flex; justify-content: space-between; padding: 15px 30px; background: #f1f5f9; border-bottom: 1px solid #e2e8f0; font-size: 14px; color: #64748b; }
    .summary-cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; padding: 25px 30px; }
    .summary-card { background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border-radius: 12px; padding: 20px; text-align: center; border: 1px solid #e2e8f0; }
    .summary-card .label { font-size: 13px; color: #64748b; margin-bottom: 8px; }
    .summary-card .value { font-size: 22px; font-weight: 800; color: #1e3a5f; }
    .summary-card.profit .value { color: #16a34a; }
    .content { padding: 0 30px 30px; }
    .section-title { font-size: 18px; font-weight: 700; color: #1e3a5f; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 2px solid #e2e8f0; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { background: #1e3a5f; color: white; padding: 10px 6px; text-align: right; font-weight: 600; }
    th:first-child { border-radius: 0 8px 0 0; }
    th:last-child { border-radius: 8px 0 0 0; }
    tr:nth-child(even) { background: #f8fafc; }
    tr:hover { background: #f1f5f9; }
    .total-row { background: #1e3a5f !important; color: white; font-weight: 700; }
    .total-row td { border-color: #2d4a6f; }
    .footer { text-align: center; padding: 20px; background: #f8fafc; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8; }
    .btn { display: inline-block; padding: 12px 30px; border-radius: 8px; text-decoration: none; font-weight: 700; cursor: pointer; border: none; font-size: 16px; margin: 5px; }
    .print-btn { background: linear-gradient(135deg, #1e3a5f 0%, #2d4a6f 100%); color: white; }
    .rivhit-btn { background: linear-gradient(135deg, #16a34a 0%, #15803d 100%); color: white; }
    .rivhit-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .actions { text-align: center; padding: 20px; }
    .rivhit-status { margin-top: 15px; padding: 15px; border-radius: 8px; display: none; font-weight: 600; }
    .rivhit-status.sending { display: block; background: #fef9c3; color: #854d0e; }
    .rivhit-status.success { display: block; background: #dcfce7; color: #166534; }
    .rivhit-status.error { display: block; background: #fee2e2; color: #991b1b; }
    @media print { body { padding: 0; background: white; } .container { box-shadow: none; border-radius: 0; } .actions { display: none; } .rivhit-col { display: none !important; } .rivhit-status { display: none !important; } }
    @media (max-width: 768px) { .summary-cards { grid-template-columns: 1fr; } table { font-size: 10px; } th, td { padding: 4px 3px; } }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>فاتورة ضريبية</h1>
      <div class="subtitle">${agentName}</div>
      <div class="company-name">${companyName}</div>
    </div>
    <div class="meta">
      <span>تاريخ الفاتورة: ${today}</span>
      <span>${filterDesc}</span>
      <span>نسبة العمولة: ${profitPercent}%</span>
    </div>
    <div class="summary-cards">
      <div class="summary-card">
        <div class="label">عدد العملاء</div>
        <div class="value">${rows.length}</div>
      </div>
      <div class="summary-card">
        <div class="label">عدد الوثائق</div>
        <div class="value">${totalPolicyCount}</div>
      </div>
      <div class="summary-card">
        <div class="label">إجمالي المبلغ</div>
        <div class="value">₪${formatNumber(totalAmount)}</div>
      </div>
      <div class="summary-card profit">
        <div class="label">إجمالي المربح</div>
        <div class="value">₪${formatNumber(totalProfit)}</div>
      </div>
    </div>
    <div class="content">
      <h2 class="section-title">تفاصيل الوثائق</h2>
      <div style="overflow-x:auto;">
        <table>
          <thead>
            <tr>
              <th style="width:35px;">#</th>
              <th>العميل</th>
              <th>الهاتف</th>
              <th>رقم الهوية</th>
              <th>عدد الوثائق</th>
              <th>رقم السيارة</th>
              <th>نوع التأمين</th>
              <th>تاريخ الدفع</th>
              <th>المبلغ الكامل</th>
              <th>المربح</th>
              <th class="rivhit-col" style="display:none;">ריווחית</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows || '<tr><td colspan="10" style="text-align:center;padding:30px;">لا توجد وثائق</td></tr>'}
            <tr class="total-row">
              <td colspan="8" style="border:1px solid #2d4a6f;padding:12px;text-align:center;">الإجمالي (${rows.length} عميل / ${totalPolicyCount} وثيقة)</td>
              <td style="border:1px solid #2d4a6f;padding:12px;text-align:left;direction:ltr;">₪${formatNumber(totalAmount)}</td>
              <td style="border:1px solid #2d4a6f;padding:12px;text-align:left;direction:ltr;">₪${formatNumber(totalProfit)}</td>
              <td class="rivhit-col" style="display:none;border:1px solid #2d4a6f;padding:12px;"></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <div class="actions">
      <button class="btn print-btn" onclick="window.print()">🖨️ طباعة الفاتورة</button>
      <button class="btn rivhit-btn" id="rivhitBtn" onclick="sendToRivhit()">📤 שלח לריווחית</button>
    </div>
    <div class="rivhit-status" id="rivhitStatus"></div>
    <div class="footer">
      © ${agentName} - جميع الحقوق محفوظة | تم إنشاء هذه الفاتورة تلقائياً
    </div>
  </div>

  <script>
    const INVOICE_ROWS = ${rowsJson};
    const SUPABASE_URL = "${supabaseUrl}";

    async function sendToRivhit() {
      const btn = document.getElementById('rivhitBtn');
      const statusEl = document.getElementById('rivhitStatus');
      
      if (!confirm('هل تريد إرسال ' + INVOICE_ROWS.length + ' عملية إلى ריווחית؟')) return;

      btn.disabled = true;
      btn.textContent = '⏳ جاري الإرسال...';
      statusEl.className = 'rivhit-status sending';
      statusEl.style.display = 'block';
      statusEl.textContent = 'جاري إرسال ' + INVOICE_ROWS.length + ' عملية إلى ריווחית...';

      document.querySelectorAll('.rivhit-col').forEach(el => el.style.display = '');

      try {
        const response = await fetch(SUPABASE_URL + '/functions/v1/send-to-rivhit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: INVOICE_ROWS, document_type: 1 }),
        });

        const data = await response.json();

        if (data.error) {
          statusEl.className = 'rivhit-status error';
          statusEl.textContent = 'خطأ: ' + data.error;
          btn.disabled = false;
          btn.textContent = '📤 שלח לריווחית';
          return;
        }

        if (data.results) {
          data.results.forEach(r => {
            const icon = document.getElementById('status-' + r.index);
            if (icon) {
              icon.textContent = r.success ? '✅' : '❌';
              icon.title = r.success ? ('Doc #' + (r.doc_number || 'OK')) : (r.error || 'Error');
            }
          });
        }

        statusEl.className = 'rivhit-status success';
        statusEl.textContent = 'تم الإرسال: ' + (data.successCount || 0) + ' نجح، ' + (data.failCount || 0) + ' فشل';
        btn.textContent = '✅ تم الإرسال';
      } catch (err) {
        statusEl.className = 'rivhit-status error';
        statusEl.textContent = 'خطأ في الاتصال: ' + err.message;
        btn.disabled = false;
        btn.textContent = '📤 שלח לריווחית';
      }
    }
  </script>
</body>
</html>`;
}
