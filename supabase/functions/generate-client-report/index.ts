import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ClientReportRequest {
  client_id: string;
}

interface PolicyData {
  id: string;
  policy_number: string | null;
  policy_type_parent: string;
  policy_type_child: string | null;
  start_date: string;
  end_date: string;
  insurance_price: number;
  cancelled: boolean | null;
  transferred: boolean | null;
  company: { name: string; name_ar: string | null } | { name: string; name_ar: string | null }[] | null;
  car: { id: string; car_number: string } | { id: string; car_number: string }[] | null;
}

interface CarData {
  id: string;
  car_number: string;
  manufacturer_name: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  car_type: string | null;
}

interface MediaFile {
  id: string;
  cdn_url: string;
  original_name: string;
  mime_type: string;
  entity_id: string;
}

const policyTypeLabels: Record<string, string> = {
  ELZAMI: 'إلزامي',
  THIRD_FULL: 'ثالث/شامل',
  ROAD_SERVICE: 'خدمات طريق',
  ACCIDENT_FEE_EXEMPTION: 'إعفاء رسوم',
  HEALTH: 'صحي',
  LIFE: 'حياة',
  PROPERTY: 'ممتلكات',
  TRAVEL: 'سفر',
  BUSINESS: 'أعمال',
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

    const { client_id }: ClientReportRequest = await req.json();

    if (!client_id) {
      return new Response(JSON.stringify({ error: "client_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Generating report for client: ${client_id}`);

    // Fetch client data
    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("*")
      .eq("id", client_id)
      .single();

    if (clientError || !client) {
      console.error("Client fetch error:", clientError);
      return new Response(JSON.stringify({ error: "Client not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch cars
    const { data: cars } = await supabase
      .from("cars")
      .select("id, car_number, manufacturer_name, model, year, color, car_type")
      .eq("client_id", client_id)
      .is("deleted_at", null);

    // Fetch policies
    const { data: policies } = await supabase
      .from("policies")
      .select(`
        id, policy_number, policy_type_parent, policy_type_child, start_date, end_date, 
        insurance_price, cancelled, transferred,
        company:insurance_companies(name, name_ar),
        car:cars(id, car_number)
      `)
      .eq("client_id", client_id)
      .is("deleted_at", null)
      .order("start_date", { ascending: false });

    // Fetch policy files
    const policyIds = (policies || []).map((p: any) => p.id);
    let policyFiles: MediaFile[] = [];
    let policyChildren: Record<string, { full_name: string; id_number: string; relation: string | null }[]> = {};
    
    if (policyIds.length > 0) {
      const { data: files } = await supabase
        .from("media_files")
        .select("id, cdn_url, original_name, mime_type, entity_id")
        .in("entity_type", ["policy", "policy_insurance"])
        .in("entity_id", policyIds)
        .is("deleted_at", null);
      policyFiles = files || [];

      // Fetch policy children (additional drivers) for all policies
      const { data: childrenData } = await supabase
        .from("policy_children")
        .select(`
          policy_id,
          child:client_children(full_name, id_number, relation)
        `)
        .in("policy_id", policyIds);

      // Group children by policy_id
      for (const pc of (childrenData || [])) {
        const child = Array.isArray(pc.child) ? pc.child[0] : pc.child;
        if (child) {
          if (!policyChildren[pc.policy_id]) {
            policyChildren[pc.policy_id] = [];
          }
          policyChildren[pc.policy_id].push({
            full_name: child.full_name,
            id_number: child.id_number,
            relation: child.relation
          });
        }
      }
    }

    // Calculate payment summary
    let totalPaid = 0;
    let totalInsurance = (policies || []).filter((p: any) => !p.cancelled).reduce((sum: number, p: any) => sum + (p.insurance_price || 0), 0);

    if (policyIds.length > 0) {
      const { data: payments } = await supabase
        .from("policy_payments")
        .select("amount, refused")
        .in("policy_id", policyIds);

      totalPaid = (payments || [])
        .filter((p: any) => !p.refused)
        .reduce((sum: number, p: any) => sum + (p.amount || 0), 0);
    }

    const totalRemaining = Number(totalInsurance) - totalPaid;

    // Fetch wallet balance
    const { data: walletData } = await supabase
      .from("customer_wallet_transactions")
      .select("amount, transaction_type")
      .eq("client_id", client_id);

    const weOweCustomer = (walletData || [])
      .filter((t: any) => t.transaction_type === 'refund' || t.transaction_type === 'transfer_refund_owed')
      .reduce((sum: number, t: any) => sum + (t.amount || 0), 0);

    const customerOwesUs = (walletData || [])
      .filter((t: any) => t.transaction_type === 'transfer_adjustment_due')
      .reduce((sum: number, t: any) => sum + (t.amount || 0), 0);

    const walletBalance = weOweCustomer - customerOwesUs;

    // Fetch branch name
    let branchName = null;
    if (client.branch_id) {
      const { data: branch } = await supabase
        .from("branches")
        .select("name_ar, name")
        .eq("id", client.branch_id)
        .single();
      branchName = branch?.name_ar || branch?.name || null;
    }

    // Fetch company settings for contact info
    const { data: smsSettings } = await supabase
      .from("sms_settings")
      .select("company_email, company_phones, company_whatsapp, company_location")
      .limit(1)
      .maybeSingle();

    const companySettings = {
      company_email: smsSettings?.company_email || '',
      company_phones: smsSettings?.company_phones || [],
      company_whatsapp: smsSettings?.company_whatsapp || '',
      company_location: smsSettings?.company_location || '',
    };

    // Generate HTML
    const html = generateReportHtml(
      client,
      cars || [],
      policies || [],
      policyFiles,
      policyChildren,
      { totalPaid, totalRemaining, totalInsurance },
      walletBalance,
      branchName,
      companySettings
    );

    // Upload to Bunny CDN
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const timestamp = now.getTime();
    const fileName = `client_report_${client.id_number}_${timestamp}.html`;
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
        client_name: client.full_name,
        phone_number: client.phone_number,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: unknown) {
    console.error("Error generating report:", error);
    return new Response(
      JSON.stringify({ error: "An error occurred while generating the report." }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

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

function getPolicyStatus(policy: PolicyData): { label: string; class: string; icon: string } {
  if (policy.cancelled) return { label: "ملغاة", class: "status-cancelled", icon: "❌" };
  if (policy.transferred) return { label: "محولة", class: "status-transferred", icon: "🔄" };
  const endDate = new Date(policy.end_date);
  const today = new Date();
  if (endDate < today) return { label: "منتهية", class: "status-expired", icon: "⏰" };
  return { label: "سارية", class: "status-active", icon: "✅" };
}

function normalizePhoneForWhatsapp(phone: string): string {
  if (!phone) return '';
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('0')) {
    digits = '972' + digits.substring(1);
  }
  return digits;
}

function generateReportHtml(
  client: any,
  cars: CarData[],
  policies: PolicyData[],
  policyFiles: MediaFile[],
  policyChildren: Record<string, { full_name: string; id_number: string; relation: string | null }[]>,
  paymentSummary: { totalPaid: number; totalRemaining: number; totalInsurance: number },
  walletBalance: number,
  branchName: string | null,
  companySettings: { company_email?: string; company_phones?: string[]; company_whatsapp?: string; company_location?: string }
): string {
  const activePolicies = policies.filter(p => {
    const endDate = new Date(p.end_date);
    return !p.cancelled && !p.transferred && endDate >= new Date();
  });

  // Helper to get company name
  const getCompanyName = (policy: PolicyData) => {
    const company = Array.isArray(policy.company) ? policy.company[0] : policy.company;
    return company?.name_ar || company?.name || '-';
  };
  
  // Helper to get car id
  const getCarId = (policy: PolicyData) => {
    const car = Array.isArray(policy.car) ? policy.car[0] : policy.car;
    return car?.id;
  };

  // Group policies by car
  const policiesByCar = cars.map(car => ({
    car,
    policies: policies.filter(p => getCarId(p) === car.id),
  }));
  const policiesNoCar = policies.filter(p => !getCarId(p));

  // Helper to get files for a policy
  const getFilesForPolicy = (policyId: string) => policyFiles.filter(f => f.entity_id === policyId);

  // Helper to get children for a policy
  const getChildrenForPolicy = (policyId: string) => policyChildren[policyId] || [];

  const getTypeLabel = (policy: PolicyData) => {
    if (policy.policy_type_parent === 'THIRD_FULL' && policy.policy_type_child) {
      const childLabels: Record<string, string> = { FULL: 'شامل', THIRD: 'ثالث' };
      return childLabels[policy.policy_type_child] || policyTypeLabels[policy.policy_type_parent] || policy.policy_type_parent;
    }
    return policyTypeLabels[policy.policy_type_parent] || policy.policy_type_parent;
  };

  const renderPolicyCard = (policy: PolicyData) => {
    const status = getPolicyStatus(policy);
    const typeLabel = getTypeLabel(policy);

    // Cancelled policies: show minimal one-line summary only
    if (policy.cancelled) {
      return `
        <div class="policy-card" style="opacity:0.6;padding:8px 10px;">
          <div class="policy-header" style="margin-bottom:0;">
            <div class="policy-type">${typeLabel}</div>
            <span class="status status-cancelled">❌ ملغاة</span>
          </div>
        </div>
      `;
    }

    const files = getFilesForPolicy(policy.id);
    const children = getChildrenForPolicy(policy.id);
    const companyName = getCompanyName(policy);
    
    // Files section at the end with proper display
    const filesHtml = files.length > 0 ? `
      <div class="policy-files-section">
        <div class="files-label">📎 ملفات البوليصة (${files.length})</div>
        <div class="files-list">
          ${files.map(f => {
            const isPdf = f.mime_type?.includes('pdf');
            const icon = isPdf ? '📄' : '🖼️';
            const shortName = f.original_name?.length > 20 
              ? f.original_name.substring(0, 20) + '...' 
              : (f.original_name || 'ملف');
            return `<a href="${f.cdn_url}" target="_blank" class="file-item">
              <span class="file-icon">${icon}</span>
              <span class="file-name">${shortName}</span>
            </a>`;
          }).join('')}
        </div>
      </div>
    ` : '';

    // Children section (additional drivers)
    const childrenHtml = children.length > 0 ? `
      <div class="policy-children-section">
        <div class="children-label">👥 السائقين الإضافيين (${children.length})</div>
        <div class="children-list">
          ${children.map(c => `
            <div class="child-item">
              <span class="child-name">${c.full_name}</span>
              <span class="child-id">${c.id_number}</span>
              ${c.relation ? `<span class="child-relation">${c.relation}</span>` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    ` : '';

    return `
      <div class="policy-card">
        <div class="policy-header">
          <div class="policy-type">${typeLabel}</div>
          <span class="status ${status.class}">${status.icon} ${status.label}</span>
        </div>
        <div class="policy-details">
          <span class="company">${companyName}</span>
          <span class="dates">${formatDateShort(policy.start_date)} - ${formatDateShort(policy.end_date)}</span>
        </div>
        <div class="policy-footer">
          <span class="price">₪${policy.insurance_price.toLocaleString()}</span>
        </div>
        ${childrenHtml}
        ${filesHtml}
      </div>
    `;
  };

  const carsHtml = policiesByCar.map(({ car, policies: carPolicies }) => {
    const nonCancelledPolicies = carPolicies.filter(p => !p.cancelled);
    const allCancelled = nonCancelledPolicies.length === 0 && carPolicies.length > 0;
    const totalPrice = nonCancelledPolicies.reduce((s, p) => s + p.insurance_price, 0);
    const activeCount = nonCancelledPolicies.filter(p => !p.transferred && new Date(p.end_date) >= new Date()).length;

    // If all policies for this car are cancelled, show abbreviated section
    if (allCancelled) {
      return `
        <div class="car-section" style="opacity:0.5;">
          <div class="car-header">
            <div class="car-plate">${car.car_number}</div>
            <div class="car-info">
              <span class="car-name">${car.manufacturer_name || ''} ${car.model || ''} ${car.year || ''}</span>
              <span class="car-meta" style="color:#dc2626;">جميع الوثائق ملغاة</span>
            </div>
          </div>
        </div>
      `;
    }
    
    return `
      <div class="car-section">
        <div class="car-header">
          <div class="car-plate">${car.car_number}</div>
          <div class="car-info">
            <span class="car-name">${car.manufacturer_name || ''} ${car.model || ''} ${car.year || ''}</span>
            <span class="car-meta">${nonCancelledPolicies.length} وثائق ${activeCount > 0 ? `• <span class="active-badge">${activeCount} سارية</span>` : ''}</span>
          </div>
          <div class="car-total">₪${totalPrice.toLocaleString()}</div>
        </div>
        <div class="car-policies">
          ${carPolicies.map(renderPolicyCard).join('')}
        </div>
      </div>
    `;
  }).join('');

  const noCarPoliciesHtml = policiesNoCar.length > 0 ? `
    <div class="car-section">
      <div class="car-header no-car">
        <div class="car-info">
          <span class="car-name">وثائق أخرى</span>
          <span class="car-meta">${policiesNoCar.length} وثائق</span>
        </div>
      </div>
      <div class="car-policies">
        ${policiesNoCar.map(renderPolicyCard).join('')}
      </div>
    </div>
  ` : '';

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>تقرير التأمينات - ${client.full_name}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #122143;
      min-height: 100vh;
      padding: 24px 16px;
      direction: rtl;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background: white;
      border-radius: 20px;
      box-shadow: 0 8px 40px rgba(0,0,0,0.25);
      overflow: hidden;
    }
    
    /* Header */
    .header {
      background: linear-gradient(135deg, #122143 0%, #1a3260 100%);
      color: white;
      padding: 20px 16px;
      text-align: center;
    }
    .header h1 { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
    .header p { font-size: 12px; opacity: 0.85; }
    
    .content { padding: 16px; }
    
    /* Client Card */
    .client-card {
      background: linear-gradient(135deg, #f0fdfa 0%, #ccfbf1 100%);
      border-radius: 16px;
      padding: 16px;
      margin-bottom: 16px;
      border: 1px solid #99f6e4;
    }
    .client-name {
      font-size: 18px;
      font-weight: 700;
      color: #0f766e;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .client-name::before { content: '👤'; font-size: 20px; }
    .client-info {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 8px;
    }
    .info-item {
      background: white;
      padding: 10px;
      border-radius: 10px;
      border: 1px solid #e2e8f0;
    }
    .info-label { font-size: 10px; color: #64748b; margin-bottom: 2px; }
    .info-value { font-size: 13px; font-weight: 600; color: #0f172a; }
    
    /* Summary */
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      margin-bottom: 16px;
    }
    .summary-card {
      padding: 12px 8px;
      border-radius: 12px;
      text-align: center;
      border: 1px solid;
    }
    .summary-card.primary { background: #f0fdfa; border-color: #99f6e4; }
    .summary-card.success { background: #f0fdf4; border-color: #bbf7d0; }
    .summary-card.danger { background: #fef2f2; border-color: #fecaca; }
    .summary-label { font-size: 10px; color: #64748b; margin-bottom: 4px; }
    .summary-value { font-size: 16px; font-weight: 700; }
    .summary-card.primary .summary-value { color: #0d9488; }
    .summary-card.success .summary-value { color: #16a34a; }
    .summary-card.danger .summary-value { color: #dc2626; }
    
    /* Wallet */
    .wallet-banner {
      background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
      border: 1px solid #fcd34d;
      border-radius: 12px;
      padding: 12px;
      text-align: center;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    .wallet-banner span { font-size: 13px; color: #92400e; }
    .wallet-banner strong { font-size: 15px; color: #b45309; font-weight: 700; }
    
    /* Active Summary */
    .active-summary {
      display: flex;
      justify-content: center;
      gap: 24px;
      padding: 16px;
      background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%);
      border-radius: 12px;
      border: 1px solid #86efac;
      margin-bottom: 16px;
    }
    .active-stat { text-align: center; }
    .active-stat .number { font-size: 28px; font-weight: 700; color: #16a34a; }
    .active-stat .label { font-size: 11px; color: #15803d; }
    .active-stat.muted .number { color: #6b7280; }
    .active-stat.muted .label { color: #9ca3af; }
    .divider { width: 1px; background: #86efac; }
    
    /* Car Section */
    .section-title {
      font-size: 14px;
      font-weight: 700;
      color: #0d9488;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .car-section {
      border: 1px solid #e2e8f0;
      border-radius: 14px;
      overflow: hidden;
      margin-bottom: 12px;
    }
    .car-header {
      background: #f8fafc;
      padding: 12px;
      display: flex;
      align-items: center;
      gap: 10px;
      border-bottom: 1px solid #e2e8f0;
    }
    .car-header.no-car { background: #fafafa; }
    .car-plate {
      background: linear-gradient(135deg, #fef08a 0%, #fde047 100%);
      border: 2px solid #1e293b;
      padding: 4px 10px;
      border-radius: 6px;
      font-family: monospace;
      font-weight: 700;
      font-size: 13px;
    }
    .car-info { flex: 1; }
    .car-name { font-size: 13px; font-weight: 600; color: #1e293b; display: block; }
    .car-meta { font-size: 11px; color: #64748b; }
    .active-badge { color: #16a34a; font-weight: 600; }
    .car-total { font-size: 14px; font-weight: 700; color: #0d9488; }
    
    .car-policies { padding: 8px; }
    
    /* Policy Card */
    .policy-card {
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 10px;
      margin-bottom: 8px;
    }
    .policy-card:last-child { margin-bottom: 0; }
    .policy-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
    }
    .policy-type {
      font-size: 12px;
      font-weight: 600;
      color: #1e293b;
      background: #f1f5f9;
      padding: 3px 8px;
      border-radius: 6px;
    }
    .status {
      font-size: 10px;
      font-weight: 600;
      padding: 3px 8px;
      border-radius: 10px;
    }
    .status-active { background: #dcfce7; color: #16a34a; }
    .status-expired { background: #f3f4f6; color: #6b7280; }
    .status-cancelled { background: #fee2e2; color: #dc2626; }
    .status-transferred { background: #fef3c7; color: #d97706; }
    
    .policy-details {
      display: flex;
      gap: 12px;
      font-size: 11px;
      color: #64748b;
      margin-bottom: 6px;
    }
    .policy-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .price { font-size: 14px; font-weight: 700; color: #0d9488; }
    
    /* Files Section */
    .policy-files-section {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px dashed #e2e8f0;
    }
    .files-label {
      font-size: 11px;
      font-weight: 600;
      color: #0d9488;
      margin-bottom: 6px;
    }
    .files-list {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .file-item {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      background: #f0fdfa;
      border: 1px solid #99f6e4;
      border-radius: 6px;
      text-decoration: none;
      font-size: 11px;
      color: #0f766e;
      transition: all 0.2s;
    }
    .file-item:hover { 
      background: #ccfbf1; 
      border-color: #14b8a6;
    }
    .file-icon { font-size: 14px; }
    .file-name { max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    
    /* Children/Additional Drivers Section */
    .policy-children-section {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px dashed #fcd34d;
      background: #fefce8;
      margin: 8px -12px -12px -12px;
      padding: 8px 12px 12px 12px;
      border-radius: 0 0 10px 10px;
    }
    .children-label {
      font-size: 11px;
      font-weight: 600;
      color: #92400e;
      margin-bottom: 6px;
    }
    .children-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .child-item {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 11px;
      color: #78350f;
    }
    .child-name { font-weight: 600; }
    .child-id { font-family: monospace; font-size: 10px; color: #a16207; }
    .child-relation { 
      font-size: 10px; 
      background: #fef3c7; 
      padding: 2px 6px; 
      border-radius: 4px; 
      color: #92400e;
    }
    
    /* Footer */
    .footer {
      padding: 16px;
      border-top: 1px solid #e2e8f0;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .footer-brand { text-align: center; }
    .footer-brand-ar { font-size: 14px; font-weight: 700; color: #0d9488; }
    .footer-brand-en { font-size: 9px; color: #94a3b8; letter-spacing: 1px; }
    .footer-date { font-size: 10px; color: #94a3b8; }
    
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
      <p>تقرير تأميناتك الشامل</p>
    </div>
    
    <div class="content">
      <div class="client-card">
        <div class="client-name">${client.full_name}</div>
        <div class="client-info">
          <div class="info-item">
            <div class="info-label">رقم الهوية</div>
            <div class="info-value" style="direction:ltr;text-align:right">${client.id_number}</div>
          </div>
          <div class="info-item">
            <div class="info-label">الهاتف</div>
            <div class="info-value" style="direction:ltr;text-align:right">${client.phone_number || '-'}</div>
          </div>
          <div class="info-item">
            <div class="info-label">رقم الملف</div>
            <div class="info-value">${client.file_number || '-'}</div>
          </div>
          <div class="info-item">
            <div class="info-label">تاريخ الانضمام</div>
            <div class="info-value">${formatDate(client.date_joined)}</div>
          </div>
          ${branchName ? `
          <div class="info-item">
            <div class="info-label">الفرع</div>
            <div class="info-value">${branchName}</div>
          </div>
          ` : ''}
        </div>
      </div>

      <div class="summary-grid">
        <div class="summary-card primary">
          <div class="summary-label">إجمالي التأمينات</div>
          <div class="summary-value">₪${paymentSummary.totalInsurance.toLocaleString()}</div>
        </div>
        <div class="summary-card success">
          <div class="summary-label">المدفوع</div>
          <div class="summary-value">₪${paymentSummary.totalPaid.toLocaleString()}</div>
        </div>
        <div class="summary-card ${paymentSummary.totalRemaining > 0 ? 'danger' : 'success'}">
          <div class="summary-label">المتبقي</div>
          <div class="summary-value">₪${paymentSummary.totalRemaining.toLocaleString()}</div>
        </div>
      </div>

      ${walletBalance > 0 ? `
      <div class="wallet-banner">
        <span>💰 رصيد لك:</span>
        <strong>₪${walletBalance.toLocaleString()}</strong>
      </div>
      ` : ''}

      <div class="active-summary">
        <div class="active-stat">
          <div class="number">${activePolicies.length}</div>
          <div class="label">وثائق سارية</div>
        </div>
        <div class="divider"></div>
        <div class="active-stat muted">
          <div class="number">${cars.length}</div>
          <div class="label">سيارات</div>
        </div>
      </div>

      <div class="section-title">🚗 السيارات والوثائق</div>
      ${carsHtml}
      ${noCarPoliciesHtml}

      <div class="footer">
        <div class="footer-brand">
          <div class="footer-brand-ar">${companyName}</div>
        </div>
        ${(companySettings.company_email || (companySettings.company_phones && companySettings.company_phones.length > 0) || companySettings.company_whatsapp || companySettings.company_location) ? `
        <div class="contact-info" style="margin: 12px 0; padding: 10px; background: #f0fdfa; border-radius: 8px; display: inline-block; text-align: center;">
          ${companySettings.company_email ? `<div style="padding: 4px 0;">📧 <a href="mailto:${companySettings.company_email}" style="color: #0d9488; text-decoration: none;">${companySettings.company_email}</a></div>` : ''}
          ${companySettings.company_phones && companySettings.company_phones.length > 0 ? `<div style="padding: 4px 0;">📞 ${companySettings.company_phones.map((phone: string) => `<a href="tel:${phone.replace(/[^0-9+]/g, '')}" style="color: #0d9488; text-decoration: none;">${phone}</a>`).join(' | ')}</div>` : ''}
          ${companySettings.company_whatsapp ? `<div style="padding: 4px 0;">💬 <a href="https://wa.me/${normalizePhoneForWhatsapp(companySettings.company_whatsapp)}" style="color: #0d9488; text-decoration: none;">${companySettings.company_whatsapp}</a></div>` : ''}
          ${companySettings.company_location ? `<div style="padding: 4px 0;">📍 ${companySettings.company_location}</div>` : ''}
        </div>
        ` : ''}
        <div class="footer-date">${formatDate(new Date().toISOString())}</div>
        <div class="action-buttons no-print" style="margin-top: 15px; display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
          <button onclick="window.print()" style="display: inline-block; padding: 12px 25px; background: linear-gradient(135deg, #14b8a6 0%, #0d9488 100%); color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: 700; cursor: pointer; font-family: 'Tajawal', sans-serif;">🖨️ طباعة التقرير</button>
          <button onclick="shareReport()" style="display: inline-block; padding: 12px 25px; background: linear-gradient(135deg, #25D366 0%, #128C7E 100%); color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: 700; cursor: pointer; font-family: 'Tajawal', sans-serif;">📲 مشاركة</button>
        </div>
      </div>
    </div>
  </div>
  <script>
    function shareReport() {
      const currentUrl = window.location.href;
      const shareText = 'تقرير التأمينات: ' + currentUrl;
      if (navigator.share) {
        navigator.share({ title: 'تقرير التأمينات', text: 'تقرير التأمينات الخاص بك', url: currentUrl }).catch(console.error);
      } else {
        window.open('https://wa.me/?text=' + encodeURIComponent(shareText), '_blank');
      }
    }
  </script>
    </div>
  </div>
</body>
</html>`;
}
