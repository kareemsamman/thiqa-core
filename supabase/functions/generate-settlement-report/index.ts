import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface FilterParams {
  company_id: string;
  start_date?: string | null;
  end_date?: string | null;
  policy_type?: string | null;
  include_cancelled?: boolean;
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

    // Verify auth
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

    const body: FilterParams = await req.json();
    const { company_id, start_date, end_date, policy_type, include_cancelled } = body;

    if (!company_id) {
      return new Response(JSON.stringify({ error: "company_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[generate-settlement-report] Generating report for company: ${company_id}`);

    // Fetch company info
    const { data: company, error: companyError } = await supabase
      .from("insurance_companies")
      .select("id, name, name_ar")
      .eq("id", company_id)
      .single();

    if (companyError || !company) {
      return new Response(JSON.stringify({ error: "Company not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build query for policies
    let query = supabase
      .from("policies")
      .select(`
        id,
        policy_type_parent,
        policy_type_child,
        insurance_price,
        payed_for_company,
        profit,
        start_date,
        end_date,
        cancelled,
        transferred,
        transferred_to_car_number,
        clients (full_name),
        cars (car_number, manufacturer_name, car_type, car_value)
      `)
      .eq("company_id", company_id)
      .is("deleted_at", null);

    // Apply date filters
    if (start_date) {
      query = query.gte("start_date", start_date);
    }
    if (end_date) {
      query = query.lte("start_date", end_date);
    }

    // Apply policy type filter
    if (policy_type && policy_type !== "all") {
      query = query.eq("policy_type_parent", policy_type);
    }

    // Apply cancelled filter
    if (!include_cancelled) {
      query = query.eq("cancelled", false);
    }

    const { data: policies, error: policiesError } = await query.order("start_date", { ascending: false });

    if (policiesError) {
      console.error("[generate-settlement-report] Error fetching policies:", policiesError);
      return new Response(JSON.stringify({ error: "Failed to fetch policies" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Calculate summary
    const summary = (policies || []).reduce(
      (acc: any, p: any) => ({
        totalPolicies: acc.totalPolicies + 1,
        totalInsurancePrice: acc.totalInsurancePrice + (Number(p.insurance_price) || 0),
        totalCompanyPayment: acc.totalCompanyPayment + (Number(p.payed_for_company) || 0),
        totalProfit: acc.totalProfit + (Number(p.profit) || 0),
      }),
      { totalPolicies: 0, totalInsurancePrice: 0, totalCompanyPayment: 0, totalProfit: 0 }
    );

    // Generate HTML report
    const html = generateReportHtml(company, policies || [], summary, {
      start_date,
      end_date,
      policy_type,
      include_cancelled,
    });

    // Upload to Bunny CDN
    if (bunnyApiKey) {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const timestamp = Date.now();
      const companyNameSafe = (company.name_ar || company.name).replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, "_");
      const storagePath = `reports/${year}/${month}/settlement_${companyNameSafe}_${timestamp}.html`;

      const bunnyUploadUrl = `https://storage.bunnycdn.com/${bunnyStorageZone}/${storagePath}`;

      const uploadResponse = await fetch(bunnyUploadUrl, {
        method: "PUT",
        headers: {
          AccessKey: bunnyApiKey,
          "Content-Type": "text/html; charset=utf-8",
        },
        body: html,
      });

      if (uploadResponse.ok) {
        const cdnUrl = `${bunnyCdnUrl}/${storagePath}?v=${timestamp}`;
        console.log(`[generate-settlement-report] Report uploaded: ${cdnUrl}`);

        return new Response(
          JSON.stringify({
            success: true,
            url: cdnUrl,
            company_name: company.name_ar || company.name,
            policy_count: summary.totalPolicies,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Fallback: return HTML directly
    return new Response(html, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="settlement-report.html"`,
      },
    });
  } catch (error: unknown) {
    console.error("[generate-settlement-report] Fatal error:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function formatNumber(num: number): string {
  return num.toLocaleString("en-US");
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function formatDateShort(dateStr: string): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("en-GB");
}

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

const CAR_TYPE_LABELS: Record<string, string> = {
  car: "خصوصي",
  cargo: "شحن",
  small: "اوتوبس زعير",
  taxi: "تاكسي",
  tjeradown4: "تجاري < 4 طن",
  tjeraup4: "تجاري > 4 طن",
};

function generateReportHtml(
  company: any,
  policies: any[],
  summary: any,
  filters: any
): string {
  const companyName = company.name_ar || company.name;
  const today = formatDate(new Date().toISOString());
  
  // Filter description
  let filterDesc = "";
  if (filters.start_date && filters.end_date) {
    filterDesc = `الفترة: ${formatDateShort(filters.start_date)} - ${formatDateShort(filters.end_date)}`;
  } else {
    filterDesc = "كل الفترات";
  }
  if (filters.policy_type && filters.policy_type !== "all") {
    filterDesc += ` | النوع: ${POLICY_TYPE_LABELS[filters.policy_type] || filters.policy_type}`;
  }
  if (filters.include_cancelled) {
    filterDesc += " | شامل الملغية";
  }

  const isFullPolicy = (p: any) => p.policy_type_parent === 'THIRD_FULL' && p.policy_type_child === 'FULL';

  const policyRows = policies.map((p: any, index: number) => `
    <tr>
      <td style="text-align: center; border: 1px solid #e2e8f0; padding: 8px;">${index + 1}</td>
      <td style="border: 1px solid #e2e8f0; padding: 8px;">${p.clients?.full_name || "-"}</td>
      <td style="border: 1px solid #e2e8f0; padding: 8px; direction: ltr; text-align: center;">${p.cars?.car_number || "-"}</td>
      <td style="border: 1px solid #e2e8f0; padding: 8px; text-align: center;">${p.cars?.manufacturer_name || "-"}</td>
      <td style="border: 1px solid #e2e8f0; padding: 8px; text-align: center;">${p.cars?.car_type ? (CAR_TYPE_LABELS[p.cars.car_type] || p.cars.car_type) : "-"}</td>
      <td style="border: 1px solid #e2e8f0; padding: 8px; text-align: center;">${POLICY_TYPE_LABELS[p.policy_type_parent] || p.policy_type_parent}</td>
      <td style="border: 1px solid #e2e8f0; padding: 8px; text-align: left; direction: ltr;">${isFullPolicy(p) ? `₪${formatNumber(p.cars?.car_value || 0)}` : "-"}</td>
      <td style="border: 1px solid #e2e8f0; padding: 8px; text-align: center; direction: ltr;">${formatDateShort(p.start_date)}</td>
      <td style="border: 1px solid #e2e8f0; padding: 8px; text-align: center; direction: ltr;">${formatDateShort(p.end_date)}</td>
      <td style="border: 1px solid #e2e8f0; padding: 8px; text-align: left; direction: ltr;">₪${formatNumber(p.insurance_price || 0)}</td>
      <td style="border: 1px solid #e2e8f0; padding: 8px; text-align: left; direction: ltr; color: #dc2626;">₪${formatNumber(p.payed_for_company || 0)}</td>
      <td style="border: 1px solid #e2e8f0; padding: 8px; text-align: left; direction: ltr; color: #16a34a;">₪${formatNumber(p.profit || 0)}</td>
      <td style="border: 1px solid #e2e8f0; padding: 8px; text-align: center;">${p.cancelled ? '<span style="color: #dc2626;">ملغية</span>' : p.transferred ? `<span style="color: #f59e0b;">محولة ← ${p.transferred_to_car_number || ''}</span>` : '<span style="color: #16a34a;">فعالة</span>'}</td>
    </tr>
  `).join("");

  return `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>تقرير تسوية - ${companyName}</title>
  <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Tajawal', 'Segoe UI', Tahoma, Arial, sans-serif;
      background: #122143;
      color: #1e293b;
      line-height: 1.6;
      min-height: 100vh;
      padding: 24px 16px;
    }
    .container {
      max-width: 1100px;
      margin: 0 auto;
      background: white;
      border-radius: 20px;
      box-shadow: 0 8px 40px rgba(0,0,0,0.25);
      overflow: hidden;
    }
    .header {
      background: linear-gradient(135deg, #122143 0%, #1a3260 100%);
      color: white;
      padding: 30px;
      text-align: center;
    }
    .header h1 {
      font-size: 28px;
      font-weight: 800;
      margin-bottom: 5px;
    }
    .header .subtitle {
      opacity: 0.9;
      font-size: 16px;
    }
    .header .company-name {
      font-size: 24px;
      font-weight: 700;
      margin-top: 15px;
      background: rgba(255,255,255,0.15);
      display: inline-block;
      padding: 8px 24px;
      border-radius: 8px;
    }
    .meta {
      display: flex;
      justify-content: space-between;
      padding: 15px 30px;
      background: #f1f5f9;
      border-bottom: 1px solid #e2e8f0;
      font-size: 14px;
      color: #64748b;
    }
    .summary-cards {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 15px;
      padding: 25px 30px;
    }
    .summary-card {
      background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
      border-radius: 12px;
      padding: 20px;
      text-align: center;
      border: 1px solid #e2e8f0;
    }
    .summary-card .label {
      font-size: 13px;
      color: #64748b;
      margin-bottom: 8px;
    }
    .summary-card .value {
      font-size: 22px;
      font-weight: 800;
      color: #1e3a5f;
    }
    .summary-card.highlight .value {
      color: #dc2626;
    }
    .summary-card.profit .value {
      color: #16a34a;
    }
    .content {
      padding: 0 30px 30px;
    }
    .section-title {
      font-size: 18px;
      font-weight: 700;
      color: #1e3a5f;
      margin-bottom: 15px;
      padding-bottom: 10px;
      border-bottom: 2px solid #e2e8f0;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th {
      background: #1e3a5f;
      color: white;
      padding: 12px 8px;
      text-align: right;
      font-weight: 600;
    }
    th:first-child { border-radius: 0 8px 0 0; }
    th:last-child { border-radius: 8px 0 0 0; }
    tr:nth-child(even) {
      background: #f8fafc;
    }
    tr:hover {
      background: #f1f5f9;
    }
    .footer {
      text-align: center;
      padding: 20px;
      background: #f8fafc;
      border-top: 1px solid #e2e8f0;
      font-size: 12px;
      color: #94a3b8;
    }
    .print-btn {
      display: inline-block;
      background: linear-gradient(135deg, #1e3a5f 0%, #2d4a6f 100%);
      color: white;
      padding: 12px 30px;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 700;
      margin: 20px auto;
      cursor: pointer;
      border: none;
      font-size: 16px;
    }
    .print-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 15px rgba(30,58,95,0.3);
    }
    .actions {
      text-align: center;
      padding: 20px;
    }
    @media print {
      body { padding: 0; background: white; }
      .container { box-shadow: none; border-radius: 0; }
      .actions { display: none; }
      .print-btn { display: none; }
    }
    @media (max-width: 768px) {
      .summary-cards { grid-template-columns: repeat(2, 1fr); }
      table { font-size: 11px; }
      th, td { padding: 6px 4px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>تقرير تسوية الشركة</h1>
      <div class="subtitle">${agentName}</div>
      <div class="company-name">${companyName}</div>
    </div>
    
    <div class="meta">
      <span>تاريخ التقرير: ${today}</span>
      <span>${filterDesc}</span>
    </div>
    
    <div class="summary-cards">
      <div class="summary-card">
        <div class="label">عدد الوثائق</div>
        <div class="value">${formatNumber(summary.totalPolicies)}</div>
      </div>
      <div class="summary-card">
        <div class="label">إجمالي المحصل</div>
        <div class="value">₪${formatNumber(summary.totalInsurancePrice)}</div>
      </div>
      <div class="summary-card highlight">
        <div class="label">المستحق للشركة</div>
        <div class="value">₪${formatNumber(summary.totalCompanyPayment)}</div>
      </div>
      <div class="summary-card profit">
        <div class="label">الربح</div>
        <div class="value">₪${formatNumber(summary.totalProfit)}</div>
      </div>
    </div>
    
    <div class="content">
      <h2 class="section-title">تفاصيل الوثائق (${formatNumber(policies.length)} وثيقة)</h2>
      <div style="overflow-x: auto;">
        <table>
           <thead>
            <tr>
              <th style="width: 40px;">#</th>
              <th>العميل</th>
              <th>رقم السيارة</th>
              <th>الشركة المصنعة</th>
              <th>تصنيف السيارة</th>
              <th>النوع</th>
              <th>قيمة السيارة</th>
              <th>بداية</th>
              <th>نهاية</th>
              <th>سعر التأمين</th>
              <th>للشركة</th>
              <th>الربح</th>
              <th>الحالة</th>
            </tr>
          </thead>
          <tbody>
            ${policyRows || '<tr><td colspan="13" style="text-align: center; padding: 30px;">لا توجد وثائق</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
    
    <div class="actions">
      <button class="print-btn" onclick="window.print()">🖨️ طباعة التقرير</button>
    </div>
    
    <div class="footer">
      © ${agentName} - جميع الحقوق محفوظة | تم إنشاء هذا التقرير تلقائياً
    </div>
  </div>
</body>
</html>`;
}
