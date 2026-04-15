import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAgentBranding, resolveAgentId, type AgentBranding } from "../_shared/agent-branding.ts";
import { THIQA_LOGO_SVG } from "../_shared/thiqa-logo.ts";
import {
  buildBunnyStorageUploadUrl,
  normalizeBunnyCdnUrl,
  resolveBunnyStorageZone,
} from "../_shared/bunny-storage.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ClientReportRequest {
  client_id: string;
}

const POLICY_TYPE_LABELS: Record<string, string> = {
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
  THIRD: 'ثالث',
  FULL: 'شامل',
};

const PAYMENT_TYPE_LABELS: Record<string, string> = {
  cash: 'نقدي',
  cheque: 'شيك',
  visa: 'فيزا',
  transfer: 'تحويل',
};

const CAR_TYPE_LABELS: Record<string, string> = {
  car: 'سيارة خاصة',
  cargo: 'شحن',
  small: 'اوتوبس زعير',
  taxi: 'تاكسي',
  tjeradown4: 'تجارة أقل من 4 طن',
  tjeraup4: 'تجارة أكثر من 4 طن',
};

const ACCIDENT_STATUS_LABELS: Record<string, string> = {
  open: 'مفتوح',
  under_review: 'قيد المراجعة',
  closed: 'مغلق',
};

const REFUND_TYPE_LABELS: Record<string, string> = {
  refund: 'إلغاء تأمين',
  transfer_refund_owed: 'تحويل تأمين',
  manual_refund: 'مرتجع يدوي',
};

// Minimal bank registry — mirrors src/lib/banks.ts so the printed report
// can resolve a stored bank_code to an Arabic name under each cheque row.
// Codes are zero-padded 2-digit strings. Unknown codes are rendered as the
// raw code in the report.
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
  "24": "بنك هبوعليم (الأمريكي الإسرائيلي سابقاً)",
  "25": "BNP Paribas إسرائيل",
  "26": "يو بنك",
  "27": "باركليز بنك",
  "28": "هبوعليم (كونتيننتال سابقاً)",
  "30": "البنك للتجارة",
  "31": "البنك الدولي الأول لإسرائيل",
  "32": "بنك للتمويل والتجارة",
  "33": "بنك ديسكونت (مركنتيل سابقاً)",
  "34": "البنك العربي الإسرائيلي",
  "37": "بنك الأردن",
  "38": "البنك التجاري الفلسطيني",
  "39": "بنك الدولة الهندي (SBI)",
  "43": "البنك الأهلي الأردني",
  "46": "بنك مسد",
  "48": "بنك أوتسار هحيال (عوفيد لئومي سابقاً)",
  "49": "البنك العربي",
  "50": "مسب - مركز المقاصة البنكي",
  "52": "بنك بوعلي أغودات يسرائيل (فاغي)",
  "54": "بنك القدس (يروشلايم)",
  "59": "شبا - خدمات بنكية آلية",
  "60": "كاردكوم",
  "61": "ترانزيلا",
  "65": "حيسخ - صندوق توفير للتعليم",
  "66": "بنك القاهرة عمّان",
  "67": "بنك الأراضي العربية",
  "68": "بنك دكسيا / البنك البلدي",
  "71": "البنك التجاري الأردني",
  "73": "البنك الإسلامي العربي",
  "74": "البنك البريطاني للشرق الأوسط",
  "76": "بنك فلسطين للاستثمار",
  "77": "بنك لئومي للرهن العقاري",
  "82": "القدس للتنمية والاستثمار",
  "83": "بنك الاتحاد",
  "84": "بنك الإسكان",
  "89": "بنك فلسطين",
  "90": "بنك ديسكونت للرهن العقاري",
  "93": "بنك الأردن الكويت",
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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Track which step the function was on when something threw, so the top
  // catch can tell the client exactly where it failed. Without this, any
  // null-deref or query error just bubbles up as "An error occurred..." and
  // we have no idea which table/call blew up.
  let currentStep = "init";

  try {
    currentStep = "read env";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const bunnyApiKey = Deno.env.get("BUNNY_API_KEY");
    const rawBunnyStorageZone = Deno.env.get("BUNNY_STORAGE_ZONE");
    const bunnyCdnUrl = normalizeBunnyCdnUrl(Deno.env.get("BUNNY_CDN_URL"));
    const bunnyStorageZone = resolveBunnyStorageZone(rawBunnyStorageZone, bunnyCdnUrl);

    if (!bunnyApiKey || !bunnyStorageZone) {
      console.error("Bunny storage env not configured", {
        hasApiKey: !!bunnyApiKey,
        hasZone: !!bunnyStorageZone,
        rawBunnyStorageZone,
      });
      return new Response(
        JSON.stringify({
          error: "إعدادات Bunny CDN غير مكتملة",
          detail: "BUNNY_API_KEY / BUNNY_STORAGE_ZONE is missing",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    currentStep = "create supabase client";
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    currentStep = "auth header";
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    currentStep = "verify user";
    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    currentStep = "parse body";
    const { client_id }: ClientReportRequest = await req.json();

    if (!client_id) {
      return new Response(JSON.stringify({ error: "client_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve branding the same way the package invoice does — logo,
    // owner name, tax number, invoice phones/address all come from
    // site_settings for this agent.
    currentStep = "resolve agent branding";
    const agentId = await resolveAgentId(supabase, user.id);
    const branding = await getAgentBranding(supabase, agentId);

    // Fetch client
    currentStep = "fetch client";
    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("*")
      .eq("id", client_id)
      .single();

    if (clientError || !client) {
      return new Response(JSON.stringify({ error: "Client not found", detail: clientError?.message }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch cars
    currentStep = "fetch cars";
    const { data: cars, error: carsError } = await supabase
      .from("cars")
      .select("id, car_number, manufacturer_name, model, year, color, car_type, car_value, license_expiry")
      .eq("client_id", client_id)
      .is("deleted_at", null);
    if (carsError) throw new Error(`cars query: ${carsError.message}`);

    // Fetch policies (including office_commission + notes + broker link so
    // we can surface "من الوسيط / إلى الوسيط" on the items table)
    currentStep = "fetch policies";
    const { data: policies, error: policiesError } = await supabase
      .from("policies")
      .select(`
        id, policy_number, policy_type_parent, policy_type_child, start_date, end_date,
        insurance_price, office_commission, cancelled, transferred, group_id, notes,
        broker_id, broker_direction,
        company:insurance_companies(name, name_ar),
        car:cars(id, car_number),
        broker:brokers(id, name)
      `)
      .eq("client_id", client_id)
      .is("deleted_at", null)
      .order("start_date", { ascending: false });
    if (policiesError) throw new Error(`policies query: ${policiesError.message}`);

    const policyIds = (policies || []).map((p: any) => p.id);

    // Fetch related records in parallel
    currentStep = "fetch related records (files/drivers/payments/accidents/refunds/branch/sms)";
    const [
      filesRes,
      childrenRes,
      paymentsRes,
      accidentsRes,
      refundsRes,
      branchRes,
      smsSettingsRes,
    ] = await Promise.all([
      policyIds.length
        ? supabase
            .from("media_files")
            .select("id, cdn_url, original_name, mime_type, entity_id")
            .in("entity_type", ["policy", "policy_insurance"])
            .in("entity_id", policyIds)
            .is("deleted_at", null)
        : Promise.resolve({ data: [] }),
      policyIds.length
        ? supabase
            .from("policy_children")
            .select(`
              policy_id,
              child:client_children(full_name, id_number, relation, phone, birth_date)
            `)
            .in("policy_id", policyIds)
        : Promise.resolve({ data: [] }),
      policyIds.length
        ? supabase
            .from("policy_payments")
            .select("id, policy_id, amount, payment_date, payment_type, cheque_number, cheque_date, bank_code, branch_code, receipt_number, refused, locked, batch_id")
            .in("policy_id", policyIds)
            .or("refused.eq.false,refused.is.null")
            .order("payment_date", { ascending: true })
        : Promise.resolve({ data: [] }),
      supabase
        .from("accident_reports")
        .select(`
          id, accident_date, status, report_number,
          car:cars(car_number),
          company:insurance_companies(name, name_ar)
        `)
        .eq("client_id", client_id)
        .order("accident_date", { ascending: false }),
      supabase
        .from("customer_wallet_transactions")
        .select(`
          id, amount, transaction_type, description, refund_date, payment_method,
          car:cars(car_number)
        `)
        .eq("client_id", client_id)
        .in("transaction_type", ["refund", "transfer_refund_owed", "manual_refund"])
        .order("refund_date", { ascending: false, nullsFirst: false }),
      client.branch_id
        ? supabase.from("branches").select("name_ar, name").eq("id", client.branch_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("sms_settings")
        .select("company_email, company_phones, company_whatsapp, company_location")
        .limit(1)
        .maybeSingle(),
    ]);

    // Bubble up specific query errors so the top catch can name the step.
    const relatedErrors: string[] = [];
    if ((filesRes as any).error) relatedErrors.push(`media_files: ${(filesRes as any).error.message}`);
    if ((childrenRes as any).error) relatedErrors.push(`policy_children: ${(childrenRes as any).error.message}`);
    if ((paymentsRes as any).error) relatedErrors.push(`policy_payments: ${(paymentsRes as any).error.message}`);
    if ((accidentsRes as any).error) relatedErrors.push(`accident_reports: ${(accidentsRes as any).error.message}`);
    if ((refundsRes as any).error) relatedErrors.push(`customer_wallet_transactions: ${(refundsRes as any).error.message}`);
    if (relatedErrors.length > 0) throw new Error(relatedErrors.join(' | '));

    const policyFiles = (filesRes.data || []) as any[];
    const policyChildrenRows = (childrenRes.data || []) as any[];
    const allPayments = (paymentsRes.data || []) as any[];
    const accidents = (accidentsRes.data || []) as any[];
    const refunds = (refundsRes.data || []) as any[];
    const branchName = (branchRes.data as any)?.name_ar || (branchRes.data as any)?.name || null;

    const companySettings = {
      company_email: (smsSettingsRes.data as any)?.company_email || '',
      company_phones: (smsSettingsRes.data as any)?.company_phones || [],
      company_whatsapp: (smsSettingsRes.data as any)?.company_whatsapp || '',
      company_location: (smsSettingsRes.data as any)?.company_location || '',
    };

    // Totals: only ACTIVE policies (not cancelled, not transferred) count
    // toward the money cards. This mirrors `fetchPaymentSummary` in
    // ClientDetails so the printed report reconciles with the in-app modal
    // — total − paid − refund = remaining, with no phantom debt from
    // historical cancelled/transferred rows. The items table still shows
    // the cancelled/transferred rows (tagged) for history; only the math
    // is filtered.
    const activePolicies = (policies || []).filter(
      (p: any) => !p.cancelled && !p.transferred
    );
    const activePolicyIdSet = new Set(activePolicies.map((p: any) => p.id));
    let totalInsurance = 0;
    for (const p of activePolicies) {
      totalInsurance += (p.insurance_price || 0) + ((p as any).office_commission || 0);
    }
    const totalPaid = allPayments
      .filter((p: any) => activePolicyIdSet.has(p.policy_id))
      .reduce((sum, p) => sum + (p.amount || 0), 0);

    // Wallet balance (net refund we owe the client)
    const { data: walletData } = await supabase
      .from("customer_wallet_transactions")
      .select("amount, transaction_type")
      .eq("client_id", client_id);

    const weOwe = (walletData || [])
      .filter((t: any) =>
        t.transaction_type === 'refund' ||
        t.transaction_type === 'transfer_refund_owed' ||
        t.transaction_type === 'manual_refund'
      )
      .reduce((sum: number, t: any) => sum + (t.amount || 0), 0);
    const customerOwes = (walletData || [])
      .filter((t: any) => t.transaction_type === 'transfer_adjustment_due')
      .reduce((sum: number, t: any) => sum + (t.amount || 0), 0);
    const walletBalance = Math.max(0, weOwe - customerOwes);

    const grossRemaining = Math.max(0, totalInsurance - totalPaid);
    const netRemaining = Math.max(0, grossRemaining - walletBalance);

    // Generate HTML
    currentStep = "build html";
    const html = generateReportHtml({
      client,
      cars: cars || [],
      policies: policies || [],
      policyFiles,
      policyChildrenRows,
      allPayments,
      accidents,
      refunds,
      totalInsurance,
      totalPaid,
      grossRemaining,
      netRemaining,
      walletBalance,
      branchName,
      branding,
      companySettings,
    });

    // Upload to Bunny CDN
    currentStep = "upload to bunny";
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const timestamp = now.getTime();
    const fileName = `client_report_${client.id_number}_${timestamp}.html`;
    const storagePath = `uploads/${year}/${month}/${fileName}`;

    const uploadUrl = buildBunnyStorageUploadUrl(bunnyStorageZone, storagePath);

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
      console.error("Bunny upload error:", uploadResponse.status, errorText);
      throw new Error(`Bunny upload failed (${uploadResponse.status}): ${errorText}`);
    }

    const cdnUrl = `${bunnyCdnUrl}/${storagePath}`;

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
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error && error.stack ? error.stack : undefined;
    console.error(`[generate-client-report] failed at step "${currentStep}":`, message, stack);
    return new Response(
      JSON.stringify({
        error: `فشل في توليد التقرير (${currentStep}): ${message}`,
        step: currentStep,
        detail: message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

// ---------- Helpers ----------

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-GB");
}

function escapeHtml(text: string): string {
  return (text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizePhoneForWhatsapp(phone: string): string {
  if (!phone) return '';
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('0')) {
    digits = '972' + digits.substring(1);
  }
  return digits;
}

function getPolicyTypeLabel(parent: string, child: string | null): string {
  if (parent === 'THIRD_FULL' && child) {
    return POLICY_TYPE_LABELS[child] || POLICY_TYPE_LABELS[parent] || parent;
  }
  return POLICY_TYPE_LABELS[parent] || parent;
}

function paymentTypeLabel(p: { payment_type: string; locked?: boolean | null }): string {
  if (p.locked && p.payment_type === 'visa') return 'فيزا خارجي';
  return PAYMENT_TYPE_LABELS[p.payment_type] || p.payment_type;
}

// ---------- HTML generation ----------

interface GenerateReportArgs {
  client: any;
  cars: any[];
  policies: any[];
  policyFiles: any[];
  policyChildrenRows: any[];
  allPayments: any[];
  accidents: any[];
  refunds: any[];
  totalInsurance: number;
  totalPaid: number;
  grossRemaining: number;
  netRemaining: number;
  walletBalance: number;
  branchName: string | null;
  branding: AgentBranding;
  companySettings: {
    company_email: string;
    company_phones: string[];
    company_whatsapp: string;
    company_location: string;
  };
}

function generateReportHtml(args: GenerateReportArgs): string {
  const {
    client,
    cars,
    policies,
    policyFiles,
    policyChildrenRows,
    allPayments,
    accidents,
    refunds,
    totalInsurance,
    totalPaid,
    grossRemaining,
    netRemaining,
    walletBalance,
    branchName,
    branding,
    companySettings,
  } = args;

  const today = new Date();

  // Brand block (logo or bundled SVG)
  const brandBlock = branding.logoUrl
    ? `<img class="logo" src="${branding.logoUrl}" alt="${branding.companyName}" />`
    : `<div class="logo logo-svg">${THIQA_LOGO_SVG}</div>`;

  // Unique extra drivers across the whole client — same dedup rule as the
  // invoice (by id_number, fallback to full_name).
  const driversMap = new Map<string, { name: string; id_number: string; phone: string; relation: string; birth_date: string }>();
  for (const row of policyChildrenRows) {
    const child = Array.isArray(row.child) ? row.child[0] : row.child;
    if (!child?.full_name) continue;
    const key = child.id_number || child.full_name;
    if (!driversMap.has(key)) {
      driversMap.set(key, {
        name: child.full_name,
        id_number: child.id_number || '',
        phone: child.phone || '',
        relation: child.relation || '',
        birth_date: child.birth_date || '',
      });
    }
  }
  const uniqueDrivers = Array.from(driversMap.values());

  // Car table
  const carsHtml = cars.length > 0
    ? `
    <div class="customer">
      <div class="section-title">السيارات</div>
      <table class="data-table">
        <thead>
          <tr>
            <th style="width: 40px;">#</th>
            <th>رقم السيارة</th>
            <th>الشركة والموديل</th>
            <th>النوع</th>
            <th>اللون</th>
            <th>انتهاء الرخصة</th>
          </tr>
        </thead>
        <tbody>
          ${cars.map((car, i) => `
            <tr>
              <td class="num">${i + 1}</td>
              <td class="tabular">${car.car_number || '-'}</td>
              <td>${[car.manufacturer_name, car.model, car.year].filter(Boolean).join(' ') || '-'}</td>
              <td>${car.car_type ? (CAR_TYPE_LABELS[car.car_type] || car.car_type) : '-'}</td>
              <td>${car.color || '-'}</td>
              <td class="tabular">${car.license_expiry ? formatDate(car.license_expiry) : '-'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `
    : '';

  // Extra drivers table (same layout as the invoice)
  const driversHtml = uniqueDrivers.length > 0
    ? `
    <div class="drivers">
      <div class="section-title">السائقون الإضافيون</div>
      <table class="drivers-table">
        <thead>
          <tr>
            <th style="width: 40px;">#</th>
            <th>الاسم</th>
            <th>رقم الهوية</th>
            <th>تاريخ الميلاد</th>
            <th>رقم الهاتف</th>
            <th>صلة القرابة</th>
          </tr>
        </thead>
        <tbody>
          ${uniqueDrivers.map((d, i) => `
            <tr>
              <td class="num">${i + 1}</td>
              <td>${escapeHtml(d.name)}</td>
              <td class="tabular">${d.id_number || '-'}</td>
              <td class="tabular">${d.birth_date ? formatDate(d.birth_date) : '-'}</td>
              <td class="tabular">${d.phone || '-'}</td>
              <td>${d.relation || '-'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `
    : '';

  // Cards print poorly (page breaks split them mid-chip, backgrounds drop,
  // the grid layout collapses on A4). The printed report stays as a plain
  // 4-column table that matches the cars/drivers/payments `.data-table`
  // styling elsewhere in the document. The interactive modal still uses
  // rich cards — only the HTML export switches to a table. Columns:
  //   # | الوصف (type + company + broker + notes) | المدة | المبلغ
  const getCarNumber = (p: any) => {
    const car = Array.isArray(p.car) ? p.car[0] : p.car;
    return car?.car_number || '-';
  };
  const getCompanyName = (p: any) => {
    const company = Array.isArray(p.company) ? p.company[0] : p.company;
    return company?.name_ar || company?.name || '-';
  };

  // Group policies into packages (by group_id) vs singles, preserving the
  // order of the first member in the original list.
  type PackageItem = { kind: 'package'; groupId: string; policies: any[] };
  type SingleItem = { kind: 'single'; policy: any };
  const policyItems: (PackageItem | SingleItem)[] = [];
  const seenGroups = new Set<string>();
  for (const p of policies) {
    if (p.group_id) {
      if (seenGroups.has(p.group_id)) continue;
      seenGroups.add(p.group_id);
      const members = policies.filter(x => x.group_id === p.group_id);
      policyItems.push({ kind: 'package', groupId: p.group_id, policies: members });
    } else {
      policyItems.push({ kind: 'single', policy: p });
    }
  }

  const lineTotalFor = (p: any) => (p.insurance_price || 0) + (p.office_commission || 0);
  const periodFor = (p: any) => (p.start_date && p.end_date)
    ? `${formatDate(p.start_date)} → ${formatDate(p.end_date)}`
    : '-';

  // Build a "<label>: <name>" tag for a policy that's linked to a broker.
  const brokerLineFor = (p: any): string => {
    const broker = Array.isArray(p.broker) ? p.broker[0] : p.broker;
    if (!broker || !p.broker_id) return '';
    const direction = p.broker_direction === 'from_broker'
      ? 'من الوسيط'
      : p.broker_direction === 'to_broker'
        ? 'إلى الوسيط'
        : 'وسيط';
    return `<div class="item-broker">${direction}: ${escapeHtml(broker.name)}</div>`;
  };

  // One row = one policy. Used for standalone policies and for each member
  // of a package (indented under a package header row).
  const renderPolicyRow = (
    p: any,
    index: string,
    variant: 'single' | 'component'
  ): string => {
    const typeLabel = getPolicyTypeLabel(p.policy_type_parent, p.policy_type_child);
    const companyName = getCompanyName(p);
    const carNumber = getCarNumber(p);
    const commission = p.office_commission || 0;
    const commissionLine = commission > 0
      ? `<div class="item-commission">عمولة المكتب: ₪${commission.toLocaleString('en-US')}</div>`
      : '';
    const cancelledTag = p.cancelled ? `<span class="cancelled-tag">ملغاة</span>` : '';
    const transferredTag = p.transferred && !p.cancelled
      ? `<span class="cancelled-tag">محولة</span>`
      : '';
    const notesLine = p.notes
      ? `<div class="item-meta">${escapeHtml(p.notes)}</div>`
      : '';
    const carLine = carNumber && carNumber !== '-'
      ? `<div class="item-meta">السيارة: <span class="tabular">${escapeHtml(carNumber)}</span></div>`
      : '';
    const rowClass = [
      variant === 'component' ? 'package-component' : '',
      p.cancelled || p.transferred ? 'cancelled-row' : '',
    ].filter(Boolean).join(' ');

    return `
      <tr class="${rowClass}">
        <td class="num">${index}</td>
        <td>
          <div class="item-title">${typeLabel} ${cancelledTag} ${transferredTag}</div>
          <div class="item-meta">${companyName}</div>
          ${carLine}
          ${commissionLine}
          ${brokerLineFor(p)}
          ${notesLine}
        </td>
        <td class="period">${periodFor(p)}</td>
        <td class="num">₪${lineTotalFor(p).toLocaleString('en-US')}</td>
      </tr>
    `;
  };

  // Package rendering: a header row that spans the description/period
  // columns (باقة chip + combined member types + car), then one indented
  // component row per policy underneath.
  const renderPackageBlock = (pkg: PackageItem, index: number): string => {
    const members = pkg.policies;
    const first = members[0];
    const carNumber = getCarNumber(first);
    const total = members.reduce((s, p) => s + lineTotalFor(p), 0);
    const allCancelled = members.every(p => p.cancelled);

    const combinedTypeLabel = members
      .map(m => getPolicyTypeLabel(m.policy_type_parent, m.policy_type_child))
      .join(' + ');

    const headerRow = `
      <tr class="package-header ${allCancelled ? 'cancelled-row' : ''}">
        <td class="num">${index}</td>
        <td colspan="2">
          <div class="package-title">
            <span class="package-badge">باقة</span>
            <span class="package-types">${escapeHtml(combinedTypeLabel)}</span>
            ${carNumber && carNumber !== '-' ? `<span class="package-car">السيارة: <span class="tabular">${escapeHtml(carNumber)}</span></span>` : ''}
          </div>
        </td>
        <td class="num">₪${total.toLocaleString('en-US')}</td>
      </tr>
    `;

    const componentRows = members
      .map((m, j) => renderPolicyRow(m, `${index}.${j + 1}`, 'component'))
      .join('');

    return headerRow + componentRows;
  };

  const policyRowsHtml = policyItems.length > 0
    ? policyItems.map((item, i) => {
        if (item.kind === 'single') {
          return renderPolicyRow(item.policy, String(i + 1), 'single');
        }
        return renderPackageBlock(item, i + 1);
      }).join('')
    : `<tr><td colspan="4" class="empty-cell">لا توجد وثائق مسجلة</td></tr>`;

  // Payment history table — one row per payment, sorted oldest → newest,
  // showing receipt number, method, date, and amount.
  const paymentsTableHtml = allPayments.length > 0
    ? `
    <table class="payments">
      <thead>
        <tr>
          <th style="width: 120px;">رقم سند القبض</th>
          <th style="width: 150px;">طريقة الدفع</th>
          <th style="width: 130px;">تاريخ الدفع</th>
          <th>المبلغ</th>
        </tr>
      </thead>
      <tbody>
        ${allPayments.map(p => {
          const bankLabel = getBankLabel(p.bank_code);
          const branchLabel = p.branch_code ? `فرع ${escapeHtml(String(p.branch_code))}` : '';
          const bankLine = (bankLabel || branchLabel)
            ? `<div class="payment-bank-line">${[bankLabel, branchLabel].filter(Boolean).join(' · ')}</div>`
            : '';
          const chequeLine = p.cheque_number
            ? ` · <span class="tabular">${escapeHtml(String(p.cheque_number))}</span>`
            : '';
          return `
          <tr>
            <td class="num">${p.receipt_number || '—'}</td>
            <td>
              <div>${paymentTypeLabel(p)}${chequeLine}</div>
              ${bankLine}
            </td>
            <td class="date">${formatDate(p.payment_date)}</td>
            <td class="amount">₪${(p.amount || 0).toLocaleString('en-US')}</td>
          </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `
    : `<div class="payments-empty">لا توجد دفعات مسجلة.</div>`;

  // Accidents table
  const accidentsHtml = accidents.length > 0
    ? `
    <div class="customer">
      <div class="section-title">بلاغات الحوادث</div>
      <table class="data-table">
        <thead>
          <tr>
            <th style="width: 40px;">#</th>
            <th>رقم البلاغ</th>
            <th>تاريخ الحادث</th>
            <th>السيارة</th>
            <th>الشركة</th>
            <th>الحالة</th>
          </tr>
        </thead>
        <tbody>
          ${accidents.map((a, i) => {
            const car = Array.isArray(a.car) ? a.car[0] : a.car;
            const company = Array.isArray(a.company) ? a.company[0] : a.company;
            return `
              <tr>
                <td class="num">${i + 1}</td>
                <td class="num">${a.report_number || '-'}</td>
                <td class="tabular">${formatDate(a.accident_date)}</td>
                <td class="tabular">${car?.car_number || '-'}</td>
                <td>${company?.name_ar || company?.name || '-'}</td>
                <td>${ACCIDENT_STATUS_LABELS[a.status] || a.status}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `
    : '';

  // Refunds table
  const refundsHtml = refunds.length > 0
    ? `
    <div class="customer">
      <div class="section-title">المرتجعات</div>
      <table class="data-table">
        <thead>
          <tr>
            <th style="width: 40px;">#</th>
            <th>النوع</th>
            <th>السيارة</th>
            <th>طريقة الدفع</th>
            <th>التاريخ</th>
            <th>الوصف</th>
            <th style="width: 110px;">المبلغ</th>
          </tr>
        </thead>
        <tbody>
          ${refunds.map((r, i) => {
            const car = Array.isArray(r.car) ? r.car[0] : r.car;
            return `
              <tr>
                <td class="num">${i + 1}</td>
                <td>${REFUND_TYPE_LABELS[r.transaction_type] || r.transaction_type}</td>
                <td class="tabular">${car?.car_number || '-'}</td>
                <td>${r.payment_method ? (PAYMENT_TYPE_LABELS[r.payment_method] || r.payment_method) : '-'}</td>
                <td class="tabular">${formatDate(r.refund_date)}</td>
                <td>${escapeHtml(r.description || '-')}</td>
                <td class="num">₪${(r.amount || 0).toLocaleString('en-US')}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `
    : '';

  // Attached files grid (reuses the invoice look — image thumbnails + PDF
  // placeholders).
  const filesHtml = policyFiles.length > 0
    ? `
    <div class="files-section">
      <div class="section-label">الملفات المرفقة</div>
      <div class="files-grid">
        ${policyFiles.map(file => {
          const isImage = file.mime_type?.startsWith('image/');
          const safeName = escapeHtml(file.original_name || 'ملف');
          return `
            <a href="${file.cdn_url}" target="_blank" class="file-link" ${isImage ? `onclick="event.preventDefault();openLightbox('${file.cdn_url}')"` : ''}>
              ${isImage
                ? `<img src="${file.cdn_url}" alt="${safeName}" />`
                : `<div class="file-placeholder">PDF</div>`}
              <span>${safeName}</span>
            </a>
          `;
        }).join('')}
      </div>
    </div>
  `
    : '';

  // Contact footer — same merge strategy the invoice uses (branding first,
  // fall back to sms_settings).
  const effectivePhones = branding.invoicePhones.length > 0
    ? branding.invoicePhones
    : (companySettings.company_phones || []);
  const effectiveAddress = branding.invoiceAddress || companySettings.company_location || '';
  const whatsappNormalized = normalizePhoneForWhatsapp(companySettings.company_whatsapp || '');
  const contactLines: string[] = [];
  if (effectivePhones.length > 0) {
    contactLines.push(
      `هاتف: ${effectivePhones
        .map((phone: string) => `<a href="tel:${phone.replace(/[^0-9+]/g, '')}">${phone}</a>`)
        .join(' / ')}`,
    );
  }
  if (companySettings.company_whatsapp) {
    contactLines.push(`واتساب: <a href="https://wa.me/${whatsappNormalized}">${companySettings.company_whatsapp}</a>`);
  }
  if (companySettings.company_email) {
    contactLines.push(`بريد: <a href="mailto:${companySettings.company_email}">${companySettings.company_email}</a>`);
  }
  if (effectiveAddress) {
    contactLines.push(effectiveAddress);
  }
  const contactFooterHtml = contactLines.length > 0
    ? `<div class="contact">${contactLines.join(' &nbsp;•&nbsp; ')}</div>`
    : '';

  const reportNumber = `RPT-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}-${(client.id_number || '').slice(-4)}`;

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>تقرير العميل - ${escapeHtml(client.full_name || '')}</title>
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
      font-feature-settings: "kern" 1, "liga" 1;
    }
    body { padding: 32px 16px; }
    .invoice {
      max-width: 820px;
      margin: 0 auto;
      background: #ffffff;
      padding: 40px 44px;
      border: 1px solid #1a1a1a;
    }
    a { color: inherit; text-decoration: none; }
    a:hover { color: #18181b; }

    /* ── Header ── */
    .invoice-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 24px;
      padding-bottom: 22px;
      border-bottom: 1px solid #1a1a1a;
      margin-bottom: 24px;
    }
    .brand { max-width: 55%; }
    .brand .logo {
      max-height: 60px;
      max-width: 220px;
      object-fit: contain;
      display: block;
      margin-bottom: 10px;
    }
    .brand .logo-svg { display: block; margin-bottom: 10px; }
    .brand .logo-svg svg { height: 44px; width: auto; display: block; }
    .brand .name { font-size: 15px; font-weight: 700; color: #1a1a1a; }
    .brand .owner { font-size: 12px; color: #1a1a1a; margin-top: 4px; font-weight: 600; }
    .brand .tax { font-size: 12px; color: #1a1a1a; margin-top: 2px; direction: ltr; text-align: right; font-variant-numeric: tabular-nums; font-weight: 500; }
    .brand .tagline { font-size: 12px; color: #1a1a1a; margin-top: 2px; font-weight: 500; }
    .brand .address { font-size: 12px; color: #1a1a1a; margin-top: 8px; max-width: 320px; line-height: 1.55; font-weight: 500; }

    .invoice-meta { text-align: left; min-width: 240px; }
    .invoice-meta .doc-title {
      font-size: 42px;
      font-weight: 800;
      letter-spacing: 0.5px;
      color: #1a1a1a;
      line-height: 1;
      margin-bottom: 4px;
    }
    .invoice-meta .subtitle {
      font-size: 12px;
      font-weight: 600;
      color: #1a1a1a;
      margin-top: -8px;
      margin-bottom: 14px;
      letter-spacing: 0.5px;
    }
    .meta-rows { width: 100%; border: 1px solid #1a1a1a; font-size: 12px; }
    .meta-rows .row { display: flex; }
    .meta-rows .row + .row { border-top: 1px solid #1a1a1a; }
    .meta-rows .label {
      flex: 0 0 110px;
      padding: 7px 12px;
      background: #f4f4f5;
      font-weight: 700;
      color: #1a1a1a;
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
      color: #1a1a1a;
      font-variant-numeric: tabular-nums;
    }

    /* ── Section container (customer / cars / accidents / refunds) ── */
    .customer { margin-bottom: 20px; border: 1px solid #1a1a1a; }
    .section-title {
      padding: 8px 14px;
      border-bottom: 1px solid #1a1a1a;
      background: #f4f4f5;
      font-size: 11px;
      font-weight: 700;
      color: #1a1a1a;
      letter-spacing: 1.5px;
      text-transform: uppercase;
    }
    .customer-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; }
    .customer-grid .cell { padding: 9px 14px; }
    .customer-grid .cell:not(:nth-child(3n+1)) { border-right: 1px solid #1a1a1a; }
    .customer-grid .cell:nth-child(n+4) { border-top: 1px solid #1a1a1a; }
    .customer-grid .cell.full { grid-column: 1 / -1; }
    .customer-grid .label {
      font-size: 10px;
      font-weight: 700;
      color: #1a1a1a;
      margin-bottom: 3px;
      letter-spacing: 0.8px;
      text-transform: uppercase;
    }
    .customer-grid .value { font-size: 14px; font-weight: 700; color: #1a1a1a; }
    .customer-grid .value.tabular { font-variant-numeric: tabular-nums; direction: ltr; text-align: right; }

    /* ── Items table (policies) — rides on top of .data-table so the
       cars / drivers / policies sections all share the same frame. This
       block only adds what's policy-specific: vertical-align, the
       multi-line description cell, the broker tag, and the package
       header / component indentation. */
    .items tbody td { vertical-align: top; }
    .items tbody td.num {
      text-align: left;
      direction: ltr;
      white-space: nowrap;
      font-weight: 700;
    }
    .items tbody td.period {
      direction: ltr;
      text-align: right;
      font-variant-numeric: tabular-nums;
      font-size: 12px;
      white-space: nowrap;
    }
    .items tbody .item-title { font-weight: 700; font-size: 14px; color: #1a1a1a; }
    .items tbody .item-meta {
      color: #1a1a1a;
      font-size: 11.5px;
      margin-top: 3px;
      font-weight: 500;
    }
    .items tbody .item-commission {
      color: #1a1a1a;
      font-size: 11.5px;
      margin-top: 3px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .items tbody .item-broker {
      display: inline-block;
      color: #78350f;
      background: #fef3c7;
      border: 1px solid #fcd34d;
      font-size: 11px;
      padding: 2px 8px;
      margin-top: 4px;
      font-weight: 700;
      letter-spacing: 0.2px;
    }
    .items tbody td.empty-cell {
      text-align: center;
      font-weight: 500;
      opacity: 0.7;
    }

    /* Package rows — header row that spans two columns, indented
       component rows underneath. */
    .items tbody tr.package-header td {
      background: #f4f4f5;
      padding: 10px 12px;
      border-top: 2px solid #1a1a1a;
    }
    .items tbody tr.package-header + tr td { border-top: 1px solid #1a1a1a; }
    .items tbody tr.package-header .package-title {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      font-size: 13px;
      font-weight: 700;
      color: #1a1a1a;
    }
    .items tbody tr.package-header .package-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: #1a1a1a;
      color: #ffffff;
      padding: 3px 10px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.5px;
    }
    .items tbody tr.package-header .package-types {
      font-size: 13px;
      font-weight: 700;
      color: #1a1a1a;
    }
    .items tbody tr.package-header .package-car {
      font-size: 11px;
      font-weight: 600;
      color: #1a1a1a;
      opacity: 0.8;
    }
    .items tbody tr.package-component td {
      background: #fbfbfc;
      padding-top: 8px;
      padding-bottom: 8px;
    }
    .items tbody tr.package-component td.num {
      font-size: 11px;
      color: #1a1a1a;
      opacity: 0.7;
    }

    /* ── Generic data table (cars, accidents, refunds) — same look as .items ── */
    .data-table {
      width: 100%;
      border-collapse: collapse;
    }
    .data-table thead th {
      background: #f4f4f5;
      color: #1a1a1a;
      padding: 8px 12px;
      text-align: right;
      font-size: 11px;
      letter-spacing: 1.5px;
      font-weight: 700;
      text-transform: uppercase;
      border-bottom: 1px solid #1a1a1a;
      border-left: 1px solid #1a1a1a;
    }
    .data-table thead th:last-child { border-left: none; }
    .data-table tbody td {
      padding: 9px 12px;
      border-top: 1px solid #1a1a1a;
      border-left: 1px solid #1a1a1a;
      font-size: 13px;
      color: #1a1a1a;
      text-align: right;
      font-weight: 500;
    }
    .data-table tbody td:last-child { border-left: none; }
    .data-table tbody tr:first-child td { border-top: none; }
    .data-table tbody td.num {
      text-align: center;
      font-variant-numeric: tabular-nums;
      font-weight: 700;
    }
    .data-table tbody td.tabular {
      direction: ltr;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    /* ── Extra drivers table ── */
    .drivers { margin-bottom: 20px; border: 1px solid #1a1a1a; }
    .drivers-table { width: 100%; border-collapse: collapse; }
    .drivers-table thead th {
      background: #f4f4f5;
      color: #1a1a1a;
      padding: 8px 12px;
      text-align: right;
      font-size: 11px;
      letter-spacing: 1.5px;
      font-weight: 700;
      text-transform: uppercase;
      border-bottom: 1px solid #1a1a1a;
      border-left: 1px solid #1a1a1a;
    }
    .drivers-table thead th:last-child { border-left: none; }
    .drivers-table tbody td {
      padding: 9px 12px;
      border-top: 1px solid #1a1a1a;
      border-left: 1px solid #1a1a1a;
      font-size: 13px;
      color: #1a1a1a;
      text-align: right;
      font-weight: 500;
    }
    .drivers-table tbody td:last-child { border-left: none; }
    .drivers-table tbody tr:first-child td { border-top: none; }
    .drivers-table tbody td.num {
      text-align: center;
      font-variant-numeric: tabular-nums;
      font-weight: 700;
    }
    .drivers-table tbody td.tabular {
      direction: ltr;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    /* ── Payments table ── */
    .payments-section { margin-bottom: 20px; }
    .payments { width: 100%; border-collapse: collapse; font-size: 12px; border: 1px solid #1a1a1a; }
    .payments thead th {
      background: #f4f4f5;
      color: #1a1a1a;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 1px;
      text-transform: uppercase;
      padding: 9px 12px;
      text-align: right;
      border-bottom: 1px solid #1a1a1a;
      border-left: 1px solid #1a1a1a;
    }
    .payments thead th:last-child { border-left: none; }
    .payments tbody td {
      padding: 9px 12px;
      border-top: 1px solid #1a1a1a;
      border-left: 1px solid #1a1a1a;
      font-size: 12px;
      color: #1a1a1a;
      font-weight: 500;
      vertical-align: middle;
    }
    .payments tbody td:last-child { border-left: none; }
    .payments tbody tr:first-child td { border-top: none; }
    .payments tbody td.num,
    .payments tbody td.date,
    .payments tbody td.amount {
      direction: ltr;
      text-align: left;
      font-variant-numeric: tabular-nums;
      font-weight: 700;
    }
    /* Small secondary line under the payment-method cell showing the
       cheque's bank + branch (when available). Muted gray, slightly
       smaller font, so it reads as a detail of the row above without
       stealing attention. */
    .payments tbody .payment-bank-line {
      font-size: 10.5px;
      font-weight: 500;
      color: #6b7280;
      margin-top: 2px;
    }
    .payments-empty {
      padding: 14px;
      border: 1px solid #1a1a1a;
      font-size: 12px;
      color: #1a1a1a;
      opacity: 0.75;
      text-align: center;
    }

    /* ── Totals ── */
    .bottom {
      display: flex;
      justify-content: flex-end;
      gap: 18px;
      align-items: stretch;
      margin-bottom: 20px;
    }
    .totals {
      width: 330px;
      border-collapse: collapse;
      font-size: 13px;
      align-self: flex-start;
      border: 1px solid #1a1a1a;
    }
    .totals td {
      padding: 9px 14px;
      border-top: 1px solid #1a1a1a;
      border-left: 1px solid #1a1a1a;
    }
    .totals tr:first-child td { border-top: none; }
    .totals td:last-child { border-left: none; }
    .totals td.label {
      font-weight: 700;
      background: #f4f4f5;
      color: #1a1a1a;
      font-size: 11.5px;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }
    .totals td.val {
      text-align: left;
      direction: ltr;
      font-weight: 700;
      color: #1a1a1a;
      font-variant-numeric: tabular-nums;
    }
    .totals tr.total td {
      font-weight: 800;
      background: #1a1a1a;
      color: #ffffff;
      font-size: 15px;
      border-top: 1px solid #1a1a1a;
      padding: 12px 14px;
    }
    .totals tr.total td.label { text-transform: uppercase; font-size: 12px; letter-spacing: 0.5px; }
    .totals tr.total td.val { color: #ffffff; }

    /* ── Cancelled row ── */
    .cancelled-row td { color: #9ca3af; text-decoration: line-through; }
    .cancelled-row td .cancelled-tag { text-decoration: none; }
    .cancelled-tag {
      display: inline-block;
      background: #fee2e2;
      color: #991b1b;
      font-size: 9px;
      font-weight: 700;
      padding: 2px 6px;
      margin-right: 6px;
      border: 1px solid #fca5a5;
      letter-spacing: 0.3px;
      vertical-align: middle;
    }

    /* ── Files ── */
    .files-section { margin-bottom: 22px; }
    .section-label {
      font-weight: 700;
      font-size: 11px;
      color: #1a1a1a;
      padding: 7px 0;
      border-bottom: 1px solid #1a1a1a;
      margin-bottom: 12px;
      letter-spacing: 1.5px;
      text-transform: uppercase;
    }
    .files-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
    .file-link {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      padding: 9px;
      border: 1px solid #1a1a1a;
      font-size: 10.5px;
      text-align: center;
      word-break: break-word;
      background: #fff;
      color: #1a1a1a;
      font-weight: 500;
    }
    .file-link:hover { background: #f4f4f5; }
    .file-link img { max-width: 100%; max-height: 88px; object-fit: contain; }
    .file-placeholder {
      width: 100%;
      height: 68px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid #1a1a1a;
      font-weight: 700;
      font-size: 12px;
      letter-spacing: 1px;
      color: #ffffff;
      background: #1a1a1a;
    }

    /* ── Footer ── */
    .footer {
      margin-top: 28px;
      padding-top: 18px;
      border-top: 1px solid #1a1a1a;
      text-align: center;
      font-size: 12px;
    }
    .footer .thanks { font-weight: 700; font-size: 14px; color: #1a1a1a; margin-bottom: 8px; letter-spacing: 0.3px; }
    .footer .contact { color: #1a1a1a; margin-top: 8px; font-weight: 600; line-height: 1.7; }
    .footer .contact a { color: #1a1a1a; }
    .footer .issued { color: #1a1a1a; margin-top: 10px; font-size: 11px; font-variant-numeric: tabular-nums; opacity: 0.7; }

    /* ── Actions ── */
    .actions { text-align: center; margin-top: 28px; }
    .actions button {
      background: #18181b;
      color: #fff;
      border: 1px solid #18181b;
      padding: 10px 26px;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.5px;
      cursor: pointer;
      font-family: inherit;
      margin: 0 5px;
      border-radius: 4px;
      transition: background 0.15s, color 0.15s;
    }
    .actions button:hover { background: #fff; color: #18181b; }

    /* ── Lightbox ── */
    .lightbox {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.94);
      z-index: 9999;
      justify-content: center;
      align-items: center;
    }
    .lightbox.active { display: flex; }
    .lightbox img { max-width: 94%; max-height: 90vh; object-fit: contain; }
    .lightbox .close {
      position: absolute;
      top: 18px;
      right: 22px;
      background: none;
      border: none;
      color: #fff;
      font-size: 36px;
      cursor: pointer;
    }

    @media print {
      @page { size: A4; margin: 0; }
      html, body { background: #fff; }
      body { padding: 12mm 10mm; }
      .no-print { display: none !important; }
      .invoice { max-width: 100%; padding: 16px 20px; border: 1px solid #1a1a1a; }
      .items thead th,
      .items tbody tr.package-header td,
      .items tbody tr.package-header .package-badge,
      .items tbody tr.package-component td,
      .items tbody .item-broker,
      .meta-rows .label,
      .section-title,
      .totals td.label,
      .totals tr.total td,
      .file-placeholder,
      .data-table thead th,
      .drivers-table thead th,
      .payments thead th {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }

    @media (max-width: 640px) {
      body { padding: 14px 8px; font-size: 12px; }
      .invoice { padding: 22px 18px; }
      /* Stack + center header on mobile with a bigger logo cap. */
      .invoice-top {
        flex-direction: column;
        align-items: center;
        gap: 16px;
        text-align: center;
      }
      .brand {
        max-width: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
      }
      .brand .logo {
        max-height: 110px;
        max-width: 260px;
        margin-left: auto;
        margin-right: auto;
      }
      .brand .logo-svg { margin-left: auto; margin-right: auto; }
      .brand .logo-svg svg { height: 72px; }
      .brand .address { max-width: 100%; text-align: center; }
      .invoice-meta {
        text-align: center;
        min-width: 0;
        width: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
      }
      .invoice-meta .doc-title { font-size: 36px; }
      .invoice-meta .subtitle { text-align: center; }
      .meta-rows { width: 100%; max-width: 320px; }
      .customer-grid { grid-template-columns: 1fr; }
      .customer-grid .cell:not(:nth-child(3n+1)) { border-right: none; }
      .customer-grid .cell:nth-child(n+2) { border-top: 1px solid #1a1a1a; }
      .bottom { flex-direction: column; }
      .totals { width: 100%; }
      .files-grid { grid-template-columns: repeat(2, 1fr); }
    }
  </style>
</head>
<body>
  <div class="invoice">

    <!-- Header: brand right, report metadata left -->
    <div class="invoice-top">
      <div class="brand">
        ${brandBlock}
        <div class="name">${escapeHtml(branding.companyName)}</div>
        ${branding.ownerName && branding.ownerName.trim() !== branding.companyName.trim() ? `<div class="owner">${escapeHtml(branding.ownerName)}</div>` : ''}
        ${branding.taxNumber ? `<div class="tax">رقم المشغل: ${escapeHtml(branding.taxNumber)}</div>` : ''}
        ${branding.siteDescription ? `<div class="tagline">${escapeHtml(branding.siteDescription)}</div>` : ''}
        ${effectiveAddress ? `<div class="address">${escapeHtml(effectiveAddress)}</div>` : ''}
      </div>
      <div class="invoice-meta">
        <div class="doc-title">تقرير</div>
        <div class="subtitle">تقرير العميل الشامل</div>
        <div class="meta-rows">
          <div class="row">
            <div class="label">رقم التقرير</div>
            <div class="val">${reportNumber}</div>
          </div>
          <div class="row">
            <div class="label">التاريخ</div>
            <div class="val">${formatDate(today.toISOString())}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Customer info -->
    <div class="customer">
      <div class="section-title">معلومات العميل</div>
      <div class="customer-grid">
        <div class="cell">
          <div class="label">الاسم</div>
          <div class="value">${escapeHtml(client.full_name || '-')}</div>
        </div>
        <div class="cell">
          <div class="label">رقم الهوية</div>
          <div class="value tabular">${client.id_number || '-'}</div>
        </div>
        <div class="cell">
          <div class="label">رقم الهاتف</div>
          <div class="value tabular">${client.phone_number || '-'}</div>
        </div>
        <div class="cell">
          <div class="label">رقم الملف</div>
          <div class="value">${client.file_number || '-'}</div>
        </div>
        <div class="cell">
          <div class="label">تاريخ الميلاد</div>
          <div class="value tabular">${formatDate(client.birth_date)}</div>
        </div>
        <div class="cell">
          <div class="label">تاريخ الانضمام</div>
          <div class="value tabular">${formatDate(client.date_joined)}</div>
        </div>
        ${branchName ? `
        <div class="cell full">
          <div class="label">الفرع</div>
          <div class="value">${escapeHtml(branchName)}</div>
        </div>
        ` : ''}
      </div>
    </div>

    ${carsHtml}
    ${driversHtml}

    <!-- Policies items table — same 4-column .data-table look as the
         cars / drivers / payments sections above so the whole report
         reads consistently on paper. Packages render as an indented
         block (header row + one component row per member). -->
    <div class="customer">
      <div class="section-title">الوثائق</div>
      <table class="data-table items">
        <thead>
          <tr>
            <th style="width: 40px;">#</th>
            <th>الوصف</th>
            <th style="width: 170px;">المدة</th>
            <th style="width: 120px;">المبلغ</th>
          </tr>
        </thead>
        <tbody>
          ${policyRowsHtml}
        </tbody>
      </table>
    </div>

    <!-- Payments log -->
    <div class="payments-section">
      <div class="section-title">سجل الدفعات</div>
      ${paymentsTableHtml}
    </div>

    ${accidentsHtml}
    ${refundsHtml}

    <!-- Totals: include wallet credit if the client has one -->
    <div class="bottom">
      <table class="totals">
        <tr>
          <td class="label">إجمالي التأمينات</td>
          <td class="val">₪${totalInsurance.toLocaleString('en-US')}</td>
        </tr>
        <tr>
          <td class="label">المدفوع</td>
          <td class="val">₪${totalPaid.toLocaleString('en-US')}</td>
        </tr>
        ${walletBalance > 0 ? `
        <tr>
          <td class="label">مرتجع للعميل</td>
          <td class="val">−₪${walletBalance.toLocaleString('en-US')}</td>
        </tr>
        ` : ''}
        <tr class="total">
          <td class="label">المتبقي</td>
          <td class="val">₪${netRemaining.toLocaleString('en-US')}</td>
        </tr>
      </table>
    </div>

    ${branding.invoicePrivacyText ? `
    <div class="customer">
      <div class="section-title">سياسة الخصوصية والشروط</div>
      <div style="padding: 11px 14px; font-size: 12px; color: #1a1a1a; line-height: 1.7; white-space: pre-wrap; font-weight: 500;">${escapeHtml(branding.invoicePrivacyText)}</div>
    </div>
    ` : ''}

    ${filesHtml}

    <!-- Footer: thanks + agent contact details + issued date -->
    <div class="footer">
      <div class="thanks">شكراً لثقتكم</div>
      ${contactFooterHtml}
      <div class="issued">تاريخ الإصدار: ${formatDate(today.toISOString())}</div>
    </div>

    <div class="actions no-print">
      <button type="button" onclick="window.print()">طباعة</button>
      <button type="button" onclick="shareReport()">مشاركة</button>
    </div>
  </div>

  <!-- Lightbox for attachment previews -->
  <div class="lightbox" id="lightbox" onclick="closeLightbox()">
    <button class="close" type="button" onclick="closeLightbox()">×</button>
    <img id="lightbox-img" alt="" onclick="event.stopPropagation()" />
  </div>

  <script>
    function openLightbox(src) {
      var box = document.getElementById('lightbox');
      document.getElementById('lightbox-img').src = src;
      box.classList.add('active');
      document.body.style.overflow = 'hidden';
    }
    function closeLightbox() {
      document.getElementById('lightbox').classList.remove('active');
      document.body.style.overflow = '';
    }
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeLightbox();
    });
    function shareReport() {
      var url = window.location.href;
      if (navigator.share) {
        navigator.share({ title: 'تقرير العميل', url: url }).catch(function(){});
      } else {
        window.open('https://wa.me/?text=' + encodeURIComponent(url), '_blank');
      }
    }
  </script>
</body>
</html>`;
}
