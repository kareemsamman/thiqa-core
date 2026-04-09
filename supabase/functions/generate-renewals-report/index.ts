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
}

const POLICY_TYPE_LABELS: Record<string, string> = {
  ELZAMI: 'إلزامي',
  THIRD_FULL: 'ثالث/شامل',
  ROAD_SERVICE: 'خدمات الطريق',
  ACCIDENT_FEE_EXEMPTION: 'إعفاء رسوم حادث',
};

const RENEWAL_STATUS_LABELS: Record<string, string> = {
  not_contacted: 'لم يتم التواصل',
  sms_sent: 'تم إرسال SMS',
  called: 'تم الاتصال',
  renewed: 'تم التجديد',
  not_interested: 'غير مهتم',
};

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
    const bunnyApiKey = Deno.env.get("BUNNY_API_KEY");
    const bunnyStorageZone = Deno.env.get("BUNNY_STORAGE_ZONE");
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

    const { month, days_filter, policy_type }: GenerateReportRequest = await req.json();

    if (!month) {
      return new Response(
        JSON.stringify({ error: "month is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[generate-renewals-report] Generating detailed report for month: ${month}`);

    // Fetch detailed renewals data - individual policies per client
    const { data: policies, error: policiesError } = await supabase.rpc('report_renewals_service_detailed', {
      p_end_month: `${month}-01`,
      p_days_remaining: days_filter,
      p_policy_type: policy_type
    });

    if (policiesError) {
      console.error('[generate-renewals-report] Error fetching policies:', policiesError);
      throw policiesError;
    }

    console.log(`[generate-renewals-report] Found ${policies?.length || 0} policies`);

    // Group policies by client
    const clientsMap = new Map<string, {
      client_id: string;
      client_name: string;
      client_file_number: string | null;
      client_phone: string | null;
      policies: Array<{
        policy_id: string;
        car_number: string | null;
        policy_type_parent: string;
        company_name_ar: string | null;
        end_date: string;
        days_remaining: number;
        insurance_price: number;
        renewal_status: string;
      }>;
      earliest_end_date: string;
      min_days_remaining: number;
      total_price: number;
    }>();

    for (const policy of (policies || [])) {
      const clientId = policy.client_id;
      
      if (!clientsMap.has(clientId)) {
        clientsMap.set(clientId, {
          client_id: clientId,
          client_name: policy.client_name,
          client_file_number: policy.client_file_number,
          client_phone: policy.client_phone,
          policies: [],
          earliest_end_date: policy.end_date,
          min_days_remaining: policy.days_remaining,
          total_price: 0
        });
      }
      
      const client = clientsMap.get(clientId)!;
      client.policies.push({
        policy_id: policy.policy_id,
        car_number: policy.car_number,
        policy_type_parent: policy.policy_type_parent,
        company_name_ar: policy.company_name_ar,
        end_date: policy.end_date,
        days_remaining: policy.days_remaining,
        insurance_price: policy.insurance_price,
        renewal_status: policy.renewal_status
      });
      
      client.total_price += policy.insurance_price || 0;
      
      if (policy.days_remaining < client.min_days_remaining) {
        client.min_days_remaining = policy.days_remaining;
        client.earliest_end_date = policy.end_date;
      }
    }

    const clients = Array.from(clientsMap.values());
    console.log(`[generate-renewals-report] Grouped into ${clients.length} unique clients`);

    // Get user info for footer
    const { data: userProfile } = await supabase
      .from('profiles')
      .select('full_name, email')
      .eq('id', user.id)
      .single();

    // Generate HTML report with detailed policies
    const monthName = new Date(`${month}-01`).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long' });
    const html = buildDetailedReportHtml(clients, policies?.length || 0, monthName, userProfile?.full_name || userProfile?.email || 'Unknown');

    if (!bunnyApiKey || !bunnyStorageZone) {
      return new Response(
        JSON.stringify({ error: 'Storage not configured' }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Upload to Bunny Storage
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
      throw new Error(`Failed to upload report: ${uploadResponse.status}`);
    }

    const reportUrl = `${bunnyCdnUrl}/${storagePath}`;
    console.log(`[generate-renewals-report] Report generated: ${reportUrl}`);

    return new Response(
      JSON.stringify({ success: true, url: reportUrl }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("[generate-renewals-report] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

interface ClientWithPolicies {
  client_id: string;
  client_name: string;
  client_file_number: string | null;
  client_phone: string | null;
  policies: Array<{
    policy_id: string;
    car_number: string | null;
    policy_type_parent: string;
    company_name_ar: string | null;
    end_date: string;
    days_remaining: number;
    insurance_price: number;
    renewal_status: string;
  }>;
  earliest_end_date: string;
  min_days_remaining: number;
  total_price: number;
}

function buildDetailedReportHtml(clients: ClientWithPolicies[], totalPolicies: number, monthName: string, generatedBy: string): string {
  const now = new Date().toLocaleDateString('en-GB', { 
    year: 'numeric', month: '2-digit', day: '2-digit', 
    hour: '2-digit', minute: '2-digit' 
  });

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-GB');
  };

  // Calculate totals
  const totalCustomers = clients.length;
  const urgentCount = clients.filter(c => c.min_days_remaining <= 7).length;
  const warningCount = clients.filter(c => c.min_days_remaining > 7 && c.min_days_remaining <= 14).length;
  const totalPrice = clients.reduce((sum, c) => sum + (c.total_price || 0), 0);

  // Build unified table rows - client header rows + policy rows
  let policyCounter = 0;
  const tableRows = clients.map((client, clientIndex) => {
    const isUrgent = client.min_days_remaining <= 7;
    const isWarning = client.min_days_remaining > 7 && client.min_days_remaining <= 14;
    const urgentClass = isUrgent ? 'urgent' : isWarning ? 'warning' : 'normal';
    const daysLabel = client.min_days_remaining === 0 ? 'اليوم!' : 
                      client.min_days_remaining === 1 ? 'غداً!' : 
                      `${client.min_days_remaining} يوم`;
    
    // Client header row
    const clientRow = `
      <tr class="client-row ${urgentClass}">
        <td class="client-num">${clientIndex + 1}</td>
        <td colspan="4" class="client-info">
          <span class="client-name">${client.client_name}</span>
          ${client.client_phone ? `<span class="client-phone" dir="ltr">${client.client_phone}</span>` : ''}
          ${client.client_file_number ? `<span class="client-file">#${client.client_file_number}</span>` : ''}
        </td>
        <td class="client-days ${urgentClass}">${daysLabel}</td>
        <td class="client-count">${client.policies.length} وثيقة</td>
        <td class="client-total">₪${(client.total_price || 0).toLocaleString('en-US')}</td>
      </tr>`;
    
    // Policy rows under this client
    const policyRows = client.policies.map((policy) => {
      policyCounter++;
      const policyUrgent = policy.days_remaining <= 7;
      const policyWarning = policy.days_remaining > 7 && policy.days_remaining <= 14;
      const policyDaysClass = policyUrgent ? 'urgent' : policyWarning ? 'warning' : 'normal';
      const policyDaysLabel = policy.days_remaining === 0 ? 'اليوم!' : 
                              policy.days_remaining === 1 ? 'غداً!' : 
                              `${policy.days_remaining} يوم`;
      
      return `
        <tr class="policy-row">
          <td class="policy-num">${policyCounter}</td>
          <td class="policy-car"><span class="car-badge" dir="ltr">${policy.car_number || '-'}</span></td>
          <td class="policy-type"><span class="type-badge">${POLICY_TYPE_LABELS[policy.policy_type_parent] || policy.policy_type_parent}</span></td>
          <td class="policy-company">${policy.company_name_ar || '-'}</td>
          <td class="policy-date" dir="ltr">${formatDate(policy.end_date)}</td>
          <td class="policy-days ${policyDaysClass}"><span class="days-badge">${policyDaysLabel}</span></td>
          <td></td>
          <td class="policy-price">₪${(policy.insurance_price || 0).toLocaleString('en-US')}</td>
        </tr>`;
    }).join('');
    
    return clientRow + policyRows;
  }).join('');

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>تقرير التجديدات - ${monthName}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap');
    
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    body {
      font-family: 'Cairo', 'Segoe UI', Tahoma, Arial, sans-serif;
      background: #122143;
      color: #1e293b;
      line-height: 1.5;
      min-height: 100vh;
      padding: 24px 16px;
    }
    
    .container {
      max-width: 1200px;
      margin: 0 auto;
      background: white;
      border-radius: 20px;
      box-shadow: 0 8px 40px rgba(0,0,0,0.25);
      overflow: hidden;
    }
    
    /* Header */
    .report-header {
      background: linear-gradient(135deg, #122143 0%, #1a3260 100%);
      color: white;
      padding: 24px 32px;
      border-radius: 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
    }
    .header-title h1 {
      font-size: 24px;
      font-weight: 800;
      margin-bottom: 2px;
    }
    .header-title p {
      opacity: 0.9;
      font-size: 14px;
    }
    .header-stats {
      display: flex;
      gap: 24px;
    }
    .header-stat {
      text-align: center;
    }
    .header-stat .stat-value {
      font-size: 28px;
      font-weight: 800;
      display: block;
    }
    .header-stat .stat-label {
      font-size: 11px;
      opacity: 0.85;
    }
    
    /* Summary Bar */
    .summary-bar {
      background: white;
      padding: 16px 24px;
      display: flex;
      gap: 32px;
      border-bottom: 2px solid #e2e8f0;
      flex-wrap: wrap;
    }
    .summary-item {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .summary-dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
    }
    .summary-dot.urgent { background: #dc2626; }
    .summary-dot.warning { background: #f59e0b; }
    .summary-dot.normal { background: #10b981; }
    .summary-item span {
      font-size: 13px;
      color: #475569;
    }
    .summary-item strong {
      font-size: 15px;
      color: #1e293b;
    }
    
    /* Main Table */
    .main-table {
      width: 100%;
      border-collapse: collapse;
      background: white;
      font-size: 13px;
    }
    
    .main-table thead th {
      background: #f1f5f9;
      padding: 14px 12px;
      text-align: right;
      font-weight: 700;
      color: #475569;
      font-size: 12px;
      border-bottom: 2px solid #e2e8f0;
      position: sticky;
      top: 0;
    }
    .main-table thead th:first-child { width: 50px; text-align: center; }
    .main-table thead th:nth-child(2) { width: 120px; }
    .main-table thead th:nth-child(3) { width: 100px; }
    .main-table thead th:nth-child(5) { width: 100px; }
    .main-table thead th:nth-child(6) { width: 90px; }
    .main-table thead th:nth-child(7) { width: 80px; }
    .main-table thead th:last-child { width: 90px; text-align: left; }
    
    /* Client Row (Header) */
    .client-row {
      background: #f8fafc;
      border-top: 2px solid #e2e8f0;
    }
    .client-row.urgent {
      background: linear-gradient(to left, #fef2f2, #fff5f5);
      border-right: 4px solid #dc2626;
    }
    .client-row.warning {
      background: linear-gradient(to left, #fffbeb, #fefce8);
      border-right: 4px solid #f59e0b;
    }
    .client-row.normal {
      background: linear-gradient(to left, #f0fdf4, #f7fee7);
      border-right: 4px solid #10b981;
    }
    .client-row td {
      padding: 12px;
      font-weight: 700;
    }
    .client-row .client-num {
      text-align: center;
      font-size: 14px;
      color: #64748b;
    }
    .client-row .client-info {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .client-row .client-name {
      font-size: 15px;
      color: #1e293b;
    }
    .client-row .client-phone {
      background: #ecfdf5;
      color: #0f766e;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-family: 'Consolas', monospace;
    }
    .client-row .client-file {
      background: #f1f5f9;
      color: #64748b;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
    }
    .client-row .client-days {
      text-align: center;
      font-size: 13px;
    }
    .client-row .client-days.urgent { color: #dc2626; }
    .client-row .client-days.warning { color: #d97706; }
    .client-row .client-days.normal { color: #059669; }
    .client-row .client-count {
      text-align: center;
      color: #2563eb;
      font-size: 12px;
    }
    .client-row .client-total {
      text-align: left;
      color: #0f766e;
      font-size: 14px;
      font-family: 'Consolas', monospace;
    }
    
    /* Policy Row */
    .policy-row {
      background: white;
    }
    .policy-row:hover {
      background: #fafafa;
    }
    .policy-row td {
      padding: 10px 12px;
      border-bottom: 1px solid #f1f5f9;
      vertical-align: middle;
    }
    .policy-row .policy-num {
      text-align: center;
      color: #94a3b8;
      font-size: 12px;
    }
    .policy-row .car-badge {
      background: linear-gradient(135deg, #0f766e, #14b8a6);
      color: white;
      padding: 3px 10px;
      border-radius: 6px;
      font-family: 'Consolas', monospace;
      font-size: 12px;
      font-weight: 600;
      display: inline-block;
    }
    .policy-row .type-badge {
      background: #eff6ff;
      color: #2563eb;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
    }
    .policy-row .policy-company {
      color: #475569;
    }
    .policy-row .policy-date {
      font-family: 'Consolas', monospace;
      color: #64748b;
      font-size: 12px;
    }
    .policy-row .policy-days {
      text-align: center;
    }
    .policy-row .days-badge {
      padding: 3px 10px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 700;
    }
    .policy-row .policy-days.urgent .days-badge {
      background: #fee2e2;
      color: #dc2626;
    }
    .policy-row .policy-days.warning .days-badge {
      background: #fef3c7;
      color: #d97706;
    }
    .policy-row .policy-days.normal .days-badge {
      background: #d1fae5;
      color: #059669;
    }
    .policy-row .policy-price {
      text-align: left;
      font-weight: 600;
      color: #0f766e;
      font-family: 'Consolas', monospace;
    }
    
    /* Footer */
    .report-footer {
      background: #f8fafc;
      padding: 16px 24px;
      border-top: 2px solid #e2e8f0;
      border-radius: 0 0 12px 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
    }
    .report-footer p {
      color: #64748b;
      font-size: 12px;
    }
    .report-footer strong {
      color: #475569;
    }
    
    /* Print */
    @media print {
      body { padding: 0; background: white; }
      .report-header { border-radius: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .report-footer { border-radius: 0; }
      .client-row { page-break-inside: avoid; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .policy-row { page-break-inside: avoid; }
      .main-table thead { display: table-header-group; }
    }
    
    @media (max-width: 768px) {
      body { padding: 8px; }
      .report-header { padding: 16px; flex-direction: column; text-align: center; }
      .header-title h1 { font-size: 20px; }
      .header-stats { gap: 16px; }
      .summary-bar { padding: 12px; gap: 16px; }
      .main-table { font-size: 11px; }
      .main-table thead th, .main-table td { padding: 8px 6px; }
      .client-row .client-info { gap: 6px; }
      .client-row .client-name { font-size: 13px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <div class="report-header">
      <div class="header-title">
        <h1>📋 تقرير الوثائق المنتهية</h1>
        <p>${monthName}</p>
      </div>
      <div class="header-stats">
        <div class="header-stat">
          <span class="stat-value">${totalCustomers}</span>
          <span class="stat-label">عميل</span>
        </div>
        <div class="header-stat">
          <span class="stat-value">${totalPolicies}</span>
          <span class="stat-label">وثيقة</span>
        </div>
        <div class="header-stat">
          <span class="stat-value">₪${totalPrice.toLocaleString('en-US')}</span>
          <span class="stat-label">إجمالي</span>
        </div>
      </div>
    </div>
    
    <!-- Summary Bar -->
    <div class="summary-bar">
      <div class="summary-item">
        <span class="summary-dot urgent"></span>
        <span>عاجل (≤7 أيام):</span>
        <strong>${urgentCount}</strong>
      </div>
      <div class="summary-item">
        <span class="summary-dot warning"></span>
        <span>تحذير (8-14):</span>
        <strong>${warningCount}</strong>
      </div>
      <div class="summary-item">
        <span class="summary-dot normal"></span>
        <span>عادي (15+):</span>
        <strong>${totalCustomers - urgentCount - warningCount}</strong>
      </div>
    </div>
    
    <!-- Unified Table -->
    <table class="main-table">
      <thead>
        <tr>
          <th>#</th>
          <th>رقم السيارة</th>
          <th>النوع</th>
          <th>الشركة</th>
          <th>تاريخ الانتهاء</th>
          <th>المتبقي</th>
          <th></th>
          <th>السعر</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows || '<tr><td colspan="8" style="text-align:center;padding:40px;color:#64748b;">لا يوجد وثائق منتهية في هذه الفترة</td></tr>'}
      </tbody>
    </table>
    
    <!-- Footer -->
    <div class="report-footer">
      <p>تم إنشاء التقرير: <strong>${now}</strong></p>
      <p>بواسطة: <strong>${generatedBy}</strong></p>
    </div>
  </div>
</body>
</html>`;
}
