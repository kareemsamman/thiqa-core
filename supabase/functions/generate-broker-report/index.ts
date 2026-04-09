import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface BrokerReportRequest {
  broker_id: string;
  start_date?: string;
  end_date?: string;
  direction_filter?: 'from_broker' | 'to_broker' | 'all';
}

const policyTypeLabels: Record<string, string> = {
  ELZAMI: 'إلزامي',
  THIRD_FULL: 'ثالث/شامل',
  ROAD_SERVICE: 'خدمات الطريق',
  ACCIDENT_FEE_EXEMPTION: 'إعفاء رسوم حادث',
  HEALTH: 'تأمين صحي',
  LIFE: 'تأمين حياة',
  PROPERTY: 'تأمين ممتلكات',
  TRAVEL: 'تأمين سفر',
  BUSINESS: 'تأمين أعمال',
  OTHER: 'أخرى',
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const bunnyApiKey = Deno.env.get("BUNNY_API_KEY")!;
    const bunnyStorageZone = Deno.env.get("BUNNY_STORAGE_ZONE")!;
    const bunnyCdnUrl = Deno.env.get('BUNNY_CDN_URL') || "https://kareem.b-cdn.net";

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { broker_id, start_date, end_date, direction_filter }: BrokerReportRequest = await req.json();

    if (!broker_id) {
      return new Response(JSON.stringify({ error: "broker_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Generating report for broker: ${broker_id}`);

    // Fetch broker data
    const { data: broker, error: brokerError } = await supabase
      .from("brokers")
      .select("*")
      .eq("id", broker_id)
      .single();

    if (brokerError || !broker) {
      console.error("Broker fetch error:", brokerError);
      return new Response(JSON.stringify({ error: "Broker not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build policies query with filters
    let query = supabase
      .from("policies")
      .select(`
        id, policy_number, policy_type_parent, policy_type_child, start_date, end_date, 
        insurance_price, profit, broker_direction,
        client:clients(full_name),
        car:cars(car_number)
      `)
      .eq("broker_id", broker_id)
      .is("deleted_at", null)
      .order("start_date", { ascending: false });

    if (start_date) {
      query = query.gte("start_date", start_date);
    }
    if (end_date) {
      query = query.lte("start_date", end_date);
    }
    if (direction_filter && direction_filter !== 'all') {
      query = query.eq("broker_direction", direction_filter);
    }

    const { data: policies } = await query;

    // Calculate payment totals for filtered policies
    const policyIds = (policies || []).map((p: any) => p.id);
    let totalCollected = 0;

    if (policyIds.length > 0) {
      const { data: payments } = await supabase
        .from("policy_payments")
        .select("amount, refused")
        .in("policy_id", policyIds);

      totalCollected = (payments || [])
        .filter((p: any) => !p.refused)
        .reduce((sum: number, p: any) => sum + (p.amount || 0), 0);
    }

    const totalPrice = (policies || []).reduce((sum: number, p: any) => sum + (p.insurance_price || 0), 0);
    const totalRemaining = totalPrice - totalCollected;

    // Calculate direction totals
    const fromBrokerTotal = (policies || [])
      .filter((p: any) => p.broker_direction === 'from_broker')
      .reduce((sum: number, p: any) => sum + (p.insurance_price || 0), 0);

    const toBrokerTotal = (policies || [])
      .filter((p: any) => p.broker_direction === 'to_broker' || !p.broker_direction)
      .reduce((sum: number, p: any) => sum + (p.insurance_price || 0), 0);

    const netBalance = toBrokerTotal - fromBrokerTotal;

    // Generate HTML
    const html = generateReportHtml(
      broker,
      policies || [],
      {
        totalCollected,
        totalRemaining,
        fromBrokerTotal,
        toBrokerTotal,
        netBalance,
        totalPrice,
      },
      { start_date, end_date, direction_filter }
    );

    // Upload to Bunny CDN
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const timestamp = now.getTime();
    const fileName = `broker_report_${broker.name.replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '_')}_${timestamp}.html`;
    const storagePath = `uploads/${year}/${month}/${fileName}`;

    const uploadUrl = `https://storage.bunnycdn.com/${bunnyStorageZone}/${storagePath}`;

    console.log(`Uploading report to: ${uploadUrl}`);

    const uploadResponse = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "AccessKey": bunnyApiKey,
        "Content-Type": "text/html; charset=utf-8",
      },
      body: html,
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error("Bunny upload error:", errorText);
      throw new Error(`Failed to upload to CDN: ${errorText}`);
    }

    const cdnUrl = `${bunnyCdnUrl}/${storagePath}`;
    console.log(`Report uploaded successfully: ${cdnUrl}`);

    return new Response(
      JSON.stringify({
        success: true,
        url: cdnUrl,
        broker_name: broker.name,
        phone: broker.phone,
        policies_count: (policies || []).length,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: unknown) {
    console.error("Error generating broker report:", error);
    return new Response(
      JSON.stringify({ error: "An error occurred while generating the report." }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

function getDisplayLabel(parent: string, child: string | null): string {
  if (parent === 'THIRD_FULL' && child) {
    const childLabels: Record<string, string> = { THIRD: 'ثالث', FULL: 'شامل' };
    return childLabels[child] || child;
  }
  return policyTypeLabels[parent] || parent;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function formatDateShort(dateStr: string | null): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("en-GB");
}

function generateReportHtml(
  broker: any,
  policies: any[],
  stats: {
    totalCollected: number;
    totalRemaining: number;
    fromBrokerTotal: number;
    toBrokerTotal: number;
    netBalance: number;
    totalPrice: number;
  },
  filters: {
    start_date?: string;
    end_date?: string;
    direction_filter?: string;
  }
): string {
  const filterText = [];
  if (filters.start_date) filterText.push(`من: ${formatDateShort(filters.start_date)}`);
  if (filters.end_date) filterText.push(`إلى: ${formatDateShort(filters.end_date)}`);
  if (filters.direction_filter && filters.direction_filter !== 'all') {
    filterText.push(filters.direction_filter === 'from_broker' ? 'عن طريق الوسيط' : 'تم تصديرها');
  }
  const filterSummary = filterText.length > 0 ? filterText.join(' | ') : 'كل الفترات';

  const policiesHtml = policies.length > 0 ? policies.map((policy, i) => {
    const direction = policy.broker_direction === 'from_broker' 
      ? '<span class="badge badge-orange">عن طريق الوسيط</span>'
      : '<span class="badge badge-green">تم تصديرها</span>';
    
    return `
    <tr class="${i % 2 === 0 ? '' : 'alt'}">
      <td>${i + 1}</td>
      <td>${direction}</td>
      <td>${policy.client?.full_name || '-'}</td>
      <td class="ltr">${policy.car?.car_number ? `<span class="car-plate">${policy.car.car_number}</span>` : '-'}</td>
      <td>${getDisplayLabel(policy.policy_type_parent, policy.policy_type_child)}</td>
      <td class="price">₪${policy.insurance_price.toLocaleString()}</td>
      <td class="ltr">${formatDateShort(policy.start_date)}</td>
      <td class="ltr">${formatDateShort(policy.end_date)}</td>
    </tr>
  `}).join('') : '<tr><td colspan="8" class="empty">لا توجد وثائق</td></tr>';

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>تقرير الوسيط - ${broker.name}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Tahoma, Arial, sans-serif;
      background: #122143;
      min-height: 100vh;
      padding: 24px 16px;
      direction: rtl;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
      background: white;
      border-radius: 20px;
      box-shadow: 0 8px 40px rgba(0,0,0,0.25);
      overflow: hidden;
    }
    .header {
      background: linear-gradient(135deg, #122143 0%, #1a3260 100%);
      color: white;
      padding: 24px 20px;
      text-align: center;
    }
    .header h1 { font-size: 24px; font-weight: 700; margin-bottom: 4px; }
    .header p { font-size: 14px; opacity: 0.85; }
    .header .filter-info { 
      margin-top: 12px; 
      padding: 8px 16px; 
      background: rgba(255,255,255,0.15); 
      border-radius: 8px;
      font-size: 13px;
    }
    
    .content { padding: 20px; }
    
    .broker-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 24px;
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .broker-avatar {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      background: linear-gradient(135deg, #1a365d 0%, #2d4a7c 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 24px;
      font-weight: 700;
    }
    .broker-info h2 { font-size: 22px; font-weight: 700; color: #1a365d; }
    .broker-info p { font-size: 14px; color: #64748b; direction: ltr; text-align: right; }
    
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 12px;
      margin-bottom: 24px;
    }
    @media (max-width: 768px) {
      .summary-grid { grid-template-columns: repeat(2, 1fr); }
    }
    .summary-card {
      padding: 16px 12px;
      border-radius: 10px;
      text-align: center;
      border: 1px solid #e2e8f0;
    }
    .summary-card.green { background: #f0fdf4; border-color: #bbf7d0; }
    .summary-card.red { background: #fef2f2; border-color: #fecaca; }
    .summary-card.orange { background: #fffbeb; border-color: #fde68a; }
    .summary-card.blue { background: #eff6ff; border-color: #bfdbfe; }
    .summary-icon { font-size: 24px; margin-bottom: 6px; }
    .summary-label { font-size: 11px; color: #64748b; margin-bottom: 4px; }
    .summary-value { font-size: 18px; font-weight: 700; }
    .summary-card.green .summary-value { color: #16a34a; }
    .summary-card.red .summary-value { color: #dc2626; }
    .summary-card.orange .summary-value { color: #d97706; }
    .summary-card.blue .summary-value { color: #1e40af; }
    
    .section { margin-bottom: 24px; }
    .section-title {
      font-size: 16px;
      font-weight: 600;
      color: #1a365d;
      padding: 10px 16px;
      background: #f1f5f9;
      border-radius: 8px;
      margin-bottom: 12px;
    }
    
    .table-container {
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      border-radius: 10px;
      border: 1px solid #e2e8f0;
    }
    table {
      width: 100%;
      min-width: 700px;
      border-collapse: collapse;
    }
    th {
      background: #1a365d;
      color: white;
      padding: 12px 10px;
      font-size: 12px;
      font-weight: 600;
      text-align: right;
      white-space: nowrap;
    }
    td {
      padding: 10px;
      font-size: 12px;
      border-bottom: 1px solid #e2e8f0;
      background: white;
    }
    tr.alt td { background: #f8fafc; }
    tr:last-child td { border-bottom: none; }
    
    .car-plate {
      display: inline-block;
      background: linear-gradient(135deg, #fef08a 0%, #fde047 100%);
      border: 2px solid #1e293b;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: monospace;
      font-weight: 700;
      font-size: 10px;
      white-space: nowrap;
    }
    
    .badge {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 12px;
      font-size: 10px;
      font-weight: 600;
      white-space: nowrap;
    }
    .badge-green { background: #dcfce7; color: #16a34a; }
    .badge-orange { background: #ffedd5; color: #ea580c; }
    
    .price { font-weight: 700; color: #1a365d; white-space: nowrap; }
    .empty { text-align: center; color: #94a3b8; padding: 24px !important; }
    .ltr { direction: ltr; text-align: center; }
    
    .totals-row {
      background: #f1f5f9 !important;
      font-weight: 700;
    }
    .totals-row td { border-top: 2px solid #1a365d; }
    
    .footer {
      margin-top: 30px;
      padding-top: 20px;
      border-top: 2px solid #e2e8f0;
      text-align: center;
      color: #64748b;
      font-size: 12px;
    }
    .footer-brand { margin-bottom: 8px; }
    .footer-brand-ar { font-size: 18px; font-weight: 700; color: #1a365d; }
    .footer-brand-en { font-size: 10px; color: #94a3b8; letter-spacing: 2px; }
    .footer-date { font-size: 11px; color: #94a3b8; }
    .footer-page { margin-top: 8px; font-size: 10px; }

    @media print {
      body { background: white; padding: 0; }
      .container { box-shadow: none; border-radius: 0; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${companyName}</h1>
      <p>كشف حساب الوسيط</p>
      <div class="filter-info">${filterSummary}</div>
    </div>
    
    <div class="content">
      <div class="broker-card">
        <div class="broker-avatar">${broker.name.charAt(0)}</div>
        <div class="broker-info">
          <h2>${broker.name}</h2>
          ${broker.phone ? `<p>${broker.phone}</p>` : ''}
        </div>
      </div>

      <div class="summary-grid">
        <div class="summary-card green">
          <div class="summary-icon">💰</div>
          <div class="summary-label">المحصل</div>
          <div class="summary-value">₪${stats.totalCollected.toLocaleString()}</div>
        </div>
        <div class="summary-card red">
          <div class="summary-icon">📋</div>
          <div class="summary-label">المتبقي</div>
          <div class="summary-value">₪${stats.totalRemaining.toLocaleString()}</div>
        </div>
        <div class="summary-card orange">
          <div class="summary-icon">⬇️</div>
          <div class="summary-label">له علي</div>
          <div class="summary-value">₪${stats.fromBrokerTotal.toLocaleString()}</div>
        </div>
        <div class="summary-card green">
          <div class="summary-icon">⬆️</div>
          <div class="summary-label">علي له</div>
          <div class="summary-value">₪${stats.toBrokerTotal.toLocaleString()}</div>
        </div>
        <div class="summary-card ${stats.netBalance >= 0 ? 'green' : 'red'}">
          <div class="summary-icon">💼</div>
          <div class="summary-label">${stats.netBalance >= 0 ? 'لي عليه' : 'له علي (صافي)'}</div>
          <div class="summary-value">₪${Math.abs(stats.netBalance).toLocaleString()}</div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">📄 الوثائق (${policies.length})</div>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>الجهة</th>
                <th>العميل</th>
                <th>السيارة</th>
                <th>النوع</th>
                <th>السعر</th>
                <th>من</th>
                <th>إلى</th>
              </tr>
            </thead>
            <tbody>
              ${policiesHtml}
              <tr class="totals-row">
                <td colspan="5" style="text-align: left;">المجموع</td>
                <td class="price">₪${stats.totalPrice.toLocaleString()}</td>
                <td colspan="2"></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="footer">
        <div class="footer-brand">
          <div class="footer-brand-ar">${companyName}</div>
        </div>
        <div class="footer-date">${formatDate(new Date().toISOString())}</div>
        <div class="footer-page">صفحة 1 من 1</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}
