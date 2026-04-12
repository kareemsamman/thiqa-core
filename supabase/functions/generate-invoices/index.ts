import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAgentBranding, resolveAgentId, type AgentBranding } from "../_shared/agent-branding.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface InvoiceRequest {
  policy_id: string;
  languages?: ('ar' | 'he')[];
  regenerate?: boolean;
  template_id?: string; // For regenerating with specific template
  created_by_admin_id?: string; // The logged-in user who is generating the invoice
}

// Map policy types to Arabic/Hebrew labels
const POLICY_TYPE_LABELS = {
  ar: {
    ELZAMI: 'إلزامي',
    THIRD_FULL: 'ثالث/شامل',
    ROAD_SERVICE: 'خدمات الطريق',
    ACCIDENT_FEE_EXEMPTION: 'إعفاء رسوم حادث',
    THIRD: 'ثالث',
    FULL: 'شامل',
  },
  he: {
    ELZAMI: 'חובה',
    THIRD_FULL: 'צד ג/מקיף',
    ROAD_SERVICE: 'שירותי דרך',
    ACCIDENT_FEE_EXEMPTION: 'פטור מדמי תאונה',
    THIRD: 'צד ג',
    FULL: 'מקיף',
  },
};

const PAYMENT_TYPE_LABELS = {
  ar: {
    cash: 'نقدي',
    cheque: 'شيك',
    visa: 'فيزا',
    transfer: 'تحويل',
  },
  he: {
    cash: 'מזומן',
    cheque: "צ'ק",
    visa: 'ויזה',
    transfer: 'העברה',
  },
};

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { policy_id, languages = ['ar', 'he'], regenerate = false, template_id, created_by_admin_id } = await req.json() as InvoiceRequest;

    if (!policy_id) {
      return new Response(
        JSON.stringify({ error: 'policy_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[generate-invoices] Starting for policy: ${policy_id}, languages: ${languages.join(',')}, regenerate: ${regenerate}`);

    // Fetch policy with all related data
    const { data: policy, error: policyError } = await supabase
      .from('policies')
      .select(`
        *,
        client:clients(full_name, id_number, phone_number),
        car:cars(car_number, manufacturer_name, model, year),
        company:insurance_companies(name, name_ar),
        created_by:profiles!policies_created_by_admin_id_fkey(full_name, email)
      `)
      .eq('id', policy_id)
      .single();

    if (policyError || !policy) {
      console.error(`[generate-invoices] Policy not found: ${policy_id}`, policyError);
      return new Response(
        JSON.stringify({ error: 'Policy not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Agent branding (name, logo) from site_settings — fallback to defaults
    // when the agent hasn't customized anything yet.
    const branding = await getAgentBranding(supabase, policy.agent_id);

    // Full payments list so we can show a breakdown and compute totals.
    const { data: payments } = await supabase
      .from('policy_payments')
      .select('payment_type, amount, payment_date, cheque_number, cheque_bank')
      .eq('policy_id', policy_id)
      .eq('refused', false)
      .order('payment_date', { ascending: true });

    const paymentType = payments?.[0]?.payment_type || 'cash';

    // Fetch policy children (additional drivers/dependents linked to THIS policy)
    const { data: policyChildren } = await supabase
      .from('policy_children')
      .select(`
        id,
        child:client_children(
          id,
          full_name,
          id_number,
          birth_date,
          phone,
          relation
        )
      `)
      .eq('policy_id', policy_id);

    console.log(`[generate-invoices] Found ${policyChildren?.length || 0} children for policy`);

    // Get active templates
    const { data: templates, error: templatesError } = await supabase
      .from('invoice_templates')
      .select('*')
      .eq('is_active', true);

    if (templatesError) {
      console.error('[generate-invoices] Error fetching templates:', templatesError);
    }

    const results: { language: string; invoice_id: string; status: string; error?: string }[] = [];

    for (const lang of languages) {
      try {
        // Find template for this language
        let template = template_id 
          ? templates?.find(t => t.id === template_id)
          : templates?.find(t => t.language === lang || t.language === 'both');

        if (!template) {
          console.warn(`[generate-invoices] No active template for language: ${lang}`);
          results.push({ language: lang, invoice_id: '', status: 'failed', error: 'No active template' });
          continue;
        }

        // Check if invoice already exists for this policy + language
        const { data: existingInvoice } = await supabase
          .from('invoices')
          .select('id')
          .eq('policy_id', policy_id)
          .eq('language', lang)
          .maybeSingle();

        if (existingInvoice && !regenerate) {
          console.log(`[generate-invoices] Invoice already exists for ${lang}, skipping`);
          results.push({ language: lang, invoice_id: existingInvoice.id, status: 'exists' });
          continue;
        }

        // Generate invoice number
        const { data: invoiceNumber } = await supabase.rpc('generate_invoice_number');

        // Build additional drivers list from policy_children
        const additionalDrivers = policyChildren?.map(pc => ({
          name: (pc.child as any)?.full_name || '',
          id_number: (pc.child as any)?.id_number || '',
          birth_date: (pc.child as any)?.birth_date ? formatDate((pc.child as any).birth_date, lang) : '',
          relation: (pc.child as any)?.relation || '',
          phone: (pc.child as any)?.phone || '',
        })).filter(d => d.name) || [];

        const totalPaid = (payments || []).reduce((sum, p) => sum + Number(p.amount || 0), 0);
        const totalPrice = Number(policy.insurance_price || 0);
        const remaining = Math.max(0, totalPrice - totalPaid);

        // Prepare metadata snapshot
        const metadata = {
          client_name: policy.client?.full_name || '',
          client_id_number: policy.client?.id_number || '',
          client_phone: policy.client?.phone_number || '',
          car_number: policy.car?.car_number || '',
          car_model: [policy.car?.manufacturer_name, policy.car?.model, policy.car?.year].filter(Boolean).join(' '),
          company_name: lang === 'ar' ? (policy.company?.name_ar || policy.company?.name) : policy.company?.name,
          insurance_type: getInsuranceTypeLabel(policy.policy_type_parent, policy.policy_type_child, lang),
          start_date: formatDate(policy.start_date, lang),
          end_date: formatDate(policy.end_date, lang),
          total_amount: totalPrice.toLocaleString(),
          total_paid: totalPaid.toLocaleString(),
          remaining_amount: remaining.toLocaleString(),
          total_price_num: totalPrice,
          total_paid_num: totalPaid,
          remaining_num: remaining,
          payment_method: PAYMENT_TYPE_LABELS[lang]?.[paymentType as keyof typeof PAYMENT_TYPE_LABELS['ar']] || paymentType,
          payments_list: (payments || []).map((p) => ({
            date: formatDate(p.payment_date, lang),
            type: PAYMENT_TYPE_LABELS[lang]?.[p.payment_type as keyof typeof PAYMENT_TYPE_LABELS['ar']] || p.payment_type,
            amount: Number(p.amount || 0).toLocaleString(),
          })),
          admin_name: policy.created_by?.full_name || '',
          admin_email: policy.created_by?.email || '',
          policy_number: policy.policy_number || `${policy.policy_type_parent} ${new Date(policy.start_date).getFullYear()} ${policy.car?.car_number || ''}`,
          // Additional drivers / dependents linked to this policy
          additional_drivers: additionalDrivers,
          has_additional_drivers: additionalDrivers.length > 0,
        };

        // Replace placeholders in template
        let htmlContent = buildInvoiceHtml(metadata, invoiceNumber || '', lang, branding);

        // For now, we'll store the HTML content. PDF generation can be added later with a service like Puppeteer
        // The pdf_url will be null until PDF is generated

        if (existingInvoice && regenerate) {
          // Update existing invoice - use provided creator ID (logged-in user) or keep existing
          const { error: updateError } = await supabase
            .from('invoices')
            .update({
              template_id: template.id,
              status: 'regenerated',
              metadata_json: { ...metadata, html_content: htmlContent },
              updated_at: new Date().toISOString(),
              ...(created_by_admin_id ? { created_by_admin_id } : {}),
            })
            .eq('id', existingInvoice.id);

          if (updateError) throw updateError;
          results.push({ language: lang, invoice_id: existingInvoice.id, status: 'regenerated' });
        } else {
          // Create new invoice - use provided creator ID (logged-in user) or fallback to policy creator
          const { data: newInvoice, error: insertError } = await supabase
            .from('invoices')
            .insert({
              invoice_number: invoiceNumber,
              policy_id: policy_id,
              template_id: template.id,
              language: lang,
              status: 'generated',
              created_by_admin_id: created_by_admin_id || policy.created_by_admin_id,
              metadata_json: { ...metadata, html_content: htmlContent },
            })
            .select()
            .single();

          if (insertError) throw insertError;
          results.push({ language: lang, invoice_id: newInvoice.id, status: 'generated' });
        }

        console.log(`[generate-invoices] Successfully generated invoice for ${lang}`);
      } catch (langError: any) {
        console.error(`[generate-invoices] Error generating invoice for ${lang}:`, langError);
        results.push({ language: lang, invoice_id: '', status: 'failed', error: langError.message });
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[generate-invoices] Completed in ${duration}ms`);

    return new Response(
      JSON.stringify({ success: true, results, duration_ms: duration }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    // Log full error details server-side for debugging
    console.error('[generate-invoices] Fatal error:', error);
    
    // Return generic error message to client - never expose internal details
    return new Response(
      JSON.stringify({ error: 'Failed to generate invoices. Please try again.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function getInsuranceTypeLabel(parent: string, child: string | null, lang: 'ar' | 'he'): string {
  const labels = POLICY_TYPE_LABELS[lang];
  const parentLabel = labels[parent as keyof typeof labels] || parent;
  if (child && labels[child as keyof typeof labels]) {
    return `${parentLabel} - ${labels[child as keyof typeof labels]}`;
  }
  return parentLabel;
}

function formatDate(dateStr: string, lang: 'ar' | 'he'): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString(lang === 'ar' ? 'ar-SA' : 'he-IL');
}

interface AdditionalDriver {
  name: string;
  id_number: string;
  birth_date: string;
  relation: string;
  phone: string;
}

interface PaymentRow {
  date: string;
  type: string;
  amount: string;
}

interface InvoiceMetadata {
  client_name: string;
  client_id_number: string;
  client_phone: string;
  car_number: string;
  car_model: string;
  company_name: string;
  insurance_type: string;
  start_date: string;
  end_date: string;
  total_amount: string;
  total_paid: string;
  remaining_amount: string;
  total_price_num: number;
  total_paid_num: number;
  remaining_num: number;
  payment_method: string;
  payments_list: PaymentRow[];
  admin_name: string;
  admin_email: string;
  policy_number: string;
  additional_drivers: AdditionalDriver[];
  has_additional_drivers: boolean;
}

// Labels per language so the template can flip between Arabic and Hebrew
// without us maintaining two almost-identical HTML strings.
const T = {
  ar: {
    invoice: 'فاتورة تأمين',
    invoiceNo: 'رقم الفاتورة',
    issueDate: 'تاريخ الإصدار',
    billTo: 'بيانات العميل',
    vehicle: 'بيانات المركبة',
    carNumber: 'رقم المركبة',
    carModel: 'الموديل',
    idNumber: 'رقم الهوية',
    phone: 'رقم الهاتف',
    no: '#',
    description: 'الوصف',
    qty: 'الكمية',
    price: 'السعر',
    total: 'الإجمالي',
    policyBundle: 'وثيقة تأمين',
    policyNumber: 'رقم الوثيقة',
    startDate: 'تاريخ البداية',
    endDate: 'تاريخ النهاية',
    company: 'شركة التأمين',
    subtotal: 'المجموع الفرعي',
    grandTotal: 'الإجمالي الكلي',
    paid: 'المدفوع',
    remaining: 'المتبقي',
    paymentMethod: 'طريقة الدفع',
    paymentHistory: 'سجل المدفوعات',
    additionalDrivers: 'السائقون الإضافيون / التابعون',
    termsTitle: 'الشروط والأحكام',
    terms:
      'يرجى سداد المبلغ المتبقي خلال 30 يوماً من تاريخ الإصدار. رسوم تأخير قد تُضاف على المدفوعات المتأخرة.',
    thankYou: 'شكراً لثقتكم بنا.',
    signature: 'التوقيع',
    issuer: 'المسؤول',
    paidBadge: 'مدفوع',
    partialBadge: 'دفع جزئي',
    unpaidBadge: 'غير مدفوع',
  },
  he: {
    invoice: 'חשבונית ביטוח',
    invoiceNo: 'מספר חשבונית',
    issueDate: 'תאריך הפקה',
    billTo: 'פרטי לקוח',
    vehicle: 'פרטי רכב',
    carNumber: 'מספר רכב',
    carModel: 'דגם',
    idNumber: 'תעודת זהות',
    phone: 'טלפון',
    no: '#',
    description: 'תיאור',
    qty: 'כמות',
    price: 'מחיר',
    total: 'סה"כ',
    policyBundle: 'פוליסת ביטוח',
    policyNumber: 'מספר פוליסה',
    startDate: 'תאריך התחלה',
    endDate: 'תאריך סיום',
    company: 'חברת ביטוח',
    subtotal: 'סכום ביניים',
    grandTotal: 'סה"כ כולל',
    paid: 'שולם',
    remaining: 'יתרה',
    paymentMethod: 'אמצעי תשלום',
    paymentHistory: 'היסטוריית תשלומים',
    additionalDrivers: 'נהגים נוספים / בני משפחה',
    termsTitle: 'תנאים והגבלות',
    terms:
      'יש לשלם את היתרה בתוך 30 יום מתאריך ההפקה. עיכוב בתשלום עשוי לגרור חיוב נוסף.',
    thankYou: 'תודה על האמון.',
    signature: 'חתימה',
    issuer: 'מנפיק',
    paidBadge: 'שולם',
    partialBadge: 'שולם חלקית',
    unpaidBadge: 'לא שולם',
  },
} as const;

function escapeHtml(s: string | null | undefined): string {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildInvoiceHtml(
  metadata: InvoiceMetadata,
  invoiceNumber: string,
  lang: 'ar' | 'he',
  branding: AgentBranding,
): string {
  const t = T[lang];
  const direction = 'rtl';
  const issueDate = formatDate(new Date().toISOString(), lang);

  const statusBadge =
    metadata.remaining_num <= 0
      ? { label: t.paidBadge, color: '#16a34a', bg: '#dcfce7' }
      : metadata.total_paid_num > 0
        ? { label: t.partialBadge, color: '#b45309', bg: '#fef3c7' }
        : { label: t.unpaidBadge, color: '#b91c1c', bg: '#fee2e2' };

  const logoBlock = branding.logoUrl
    ? `<img src="${escapeHtml(branding.logoUrl)}" alt="${escapeHtml(branding.companyName)}" style="height:56px;width:auto;object-fit:contain;" />`
    : `<div style="width:56px;height:56px;border-radius:12px;background:#1e3a8a;color:#fff;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800;">
         ${escapeHtml((branding.companyName || 'T').charAt(0))}
       </div>`;

  // The "items table" — for an insurance policy we list one line per
  // covered bundle (main policy) plus a row for the insurance type.
  const lineItems: Array<{ description: string; qty: string; price: string; total: string }> = [
    {
      description: `${t.policyBundle} — ${escapeHtml(metadata.insurance_type)}<br><span style="font-size:11px;color:#64748b;">${t.company}: ${escapeHtml(metadata.company_name)} · ${escapeHtml(metadata.car_number)} ${escapeHtml(metadata.car_model)}</span><br><span style="font-size:11px;color:#64748b;">${t.startDate}: ${escapeHtml(metadata.start_date)} — ${t.endDate}: ${escapeHtml(metadata.end_date)}</span>`,
      qty: '1',
      price: `₪${metadata.total_amount}`,
      total: `₪${metadata.total_amount}`,
    },
  ];

  const itemRows = lineItems
    .map(
      (item, i) => `
      <tr style="${i % 2 === 0 ? 'background:#eff6ff;' : 'background:#ffffff;'}">
        <td style="padding:14px 12px;text-align:center;font-weight:600;color:#1e3a8a;width:40px;">${i + 1}</td>
        <td style="padding:14px 12px;line-height:1.6;">${item.description}</td>
        <td style="padding:14px 12px;text-align:center;">${item.qty}</td>
        <td style="padding:14px 12px;text-align:center;font-weight:600;">${item.price}</td>
        <td style="padding:14px 12px;text-align:center;font-weight:700;color:#1e3a8a;">${item.total}</td>
      </tr>`,
    )
    .join('');

  const paymentsRows = metadata.payments_list
    .map(
      (p, i) => `
      <tr style="${i % 2 === 0 ? 'background:#f8fafc;' : ''}">
        <td style="padding:10px 12px;color:#64748b;text-align:center;">${i + 1}</td>
        <td style="padding:10px 12px;">${escapeHtml(p.date)}</td>
        <td style="padding:10px 12px;">${escapeHtml(p.type)}</td>
        <td style="padding:10px 12px;text-align:left;font-weight:600;">₪${escapeHtml(p.amount)}</td>
      </tr>`,
    )
    .join('');

  const driversBlock =
    metadata.has_additional_drivers && metadata.additional_drivers.length > 0
      ? `
    <section style="margin-top:28px;">
      <h3 style="margin:0 0 12px;font-size:14px;font-weight:700;color:#1e3a8a;letter-spacing:0.3px;">
        ${t.additionalDrivers}
      </h3>
      <div style="border:1px solid #e2e8f0;border-radius:12px;padding:14px 18px;background:#f8fafc;">
        ${metadata.additional_drivers
          .map(
            (d) => `
          <div style="display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px dashed #e2e8f0;font-size:13px;">
            <span style="font-weight:600;">${escapeHtml(d.name)}</span>
            <span style="color:#64748b;">${escapeHtml(d.id_number)}${d.relation ? ` · ${escapeHtml(d.relation)}` : ''}${d.phone ? ` · ${escapeHtml(d.phone)}` : ''}</span>
          </div>`,
          )
          .join('')}
      </div>
    </section>`
      : '';

  const paymentsBlock = metadata.payments_list.length > 0
    ? `
    <section style="margin-top:28px;">
      <h3 style="margin:0 0 12px;font-size:14px;font-weight:700;color:#1e3a8a;letter-spacing:0.3px;">
        ${t.paymentHistory}
      </h3>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;font-size:13px;">
        <thead>
          <tr style="background:#1e3a8a;color:#fff;">
            <th style="padding:10px 12px;text-align:center;width:40px;">${t.no}</th>
            <th style="padding:10px 12px;text-align:right;">${t.issueDate}</th>
            <th style="padding:10px 12px;text-align:right;">${t.paymentMethod}</th>
            <th style="padding:10px 12px;text-align:left;">₪</th>
          </tr>
        </thead>
        <tbody>${paymentsRows}</tbody>
      </table>
    </section>`
    : '';

  return `
<!DOCTYPE html>
<html dir="${direction}" lang="${lang}">
<head>
  <meta charset="UTF-8">
  <title>${t.invoice} — ${escapeHtml(invoiceNumber)}</title>
  <style>
    * { box-sizing: border-box; }
    @page { size: A4; margin: 14mm; }
    body {
      font-family: 'Segoe UI', 'Tahoma', 'Arial', 'IBM Plex Sans Arabic', sans-serif;
      margin: 0;
      padding: 0;
      color: #0f172a;
      background: #ffffff;
      direction: ${direction};
    }
    .page {
      max-width: 820px;
      margin: 0 auto;
      padding: 36px 40px;
    }
    .top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 24px;
      padding-bottom: 22px;
      border-bottom: 2px solid #e2e8f0;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .brand-text { line-height: 1.25; }
    .brand-name {
      font-size: 20px;
      font-weight: 800;
      color: #0f172a;
      letter-spacing: 0.2px;
    }
    .brand-tag {
      font-size: 11px;
      text-transform: uppercase;
      color: #64748b;
      letter-spacing: 2px;
    }
    .invoice-title {
      text-align: left;
    }
    .invoice-title h1 {
      font-size: 40px;
      color: #1e3a8a;
      margin: 0;
      font-weight: 900;
      letter-spacing: 3px;
    }
    .invoice-title .meta {
      margin-top: 6px;
      font-size: 11px;
      color: #64748b;
      letter-spacing: 1.5px;
      text-transform: uppercase;
    }
    .meta-row {
      display: flex;
      justify-content: space-between;
      gap: 32px;
      margin-top: 24px;
      font-size: 13px;
    }
    .meta-col .label {
      font-size: 10px;
      text-transform: uppercase;
      color: #64748b;
      letter-spacing: 1px;
      margin-bottom: 4px;
    }
    .meta-col .value {
      font-weight: 700;
      color: #0f172a;
    }
    .bill-to strong {
      display: block;
      font-size: 16px;
      font-weight: 800;
      color: #0f172a;
      margin-top: 2px;
    }
    .bill-to .sub {
      color: #64748b;
      font-size: 12px;
      margin-top: 2px;
    }
    .status-badge {
      display: inline-block;
      padding: 4px 14px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 700;
      background: ${statusBadge.bg};
      color: ${statusBadge.color};
      margin-top: 6px;
    }
    table.items {
      width: 100%;
      border-collapse: collapse;
      margin-top: 26px;
      font-size: 13px;
      border-radius: 12px;
      overflow: hidden;
    }
    table.items thead tr {
      background: #1e3a8a;
      color: #ffffff;
    }
    table.items thead th {
      padding: 12px;
      text-align: center;
      font-weight: 700;
      letter-spacing: 0.3px;
    }
    .totals {
      margin-top: 18px;
      display: flex;
      justify-content: flex-end;
    }
    .totals-box {
      width: 320px;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      overflow: hidden;
    }
    .totals-row {
      display: flex;
      justify-content: space-between;
      padding: 10px 16px;
      font-size: 13px;
    }
    .totals-row.grand {
      background: #1e3a8a;
      color: #ffffff;
      padding: 14px 16px;
      font-size: 15px;
      font-weight: 800;
    }
    .pay-terms {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
      margin-top: 32px;
    }
    .pay-terms h4 {
      margin: 0 0 8px;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1.2px;
      color: #ffffff;
      background: #1e3a8a;
      padding: 6px 12px;
      display: inline-block;
      border-radius: 6px;
    }
    .pay-terms p {
      margin: 0;
      font-size: 12px;
      color: #334155;
      line-height: 1.7;
    }
    .signature {
      text-align: ${direction === 'rtl' ? 'left' : 'right'};
    }
    .signature .name {
      font-size: 16px;
      font-weight: 800;
      color: #0f172a;
      margin-top: 36px;
      border-top: 1px solid #0f172a;
      display: inline-block;
      padding-top: 4px;
      min-width: 160px;
    }
    .signature .role {
      font-size: 11px;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .footer-contact {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e2e8f0;
      display: flex;
      justify-content: space-between;
      gap: 20px;
      font-size: 11px;
      color: #64748b;
    }
    .footer-contact .thanks {
      font-style: italic;
      color: #334155;
    }
    @media print {
      .page { padding: 20px 24px; }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="top">
      <div class="brand">
        ${logoBlock}
        <div class="brand-text">
          <div class="brand-name">${escapeHtml(branding.companyName)}</div>
          ${branding.companyNameEn ? `<div class="brand-tag">${escapeHtml(branding.companyNameEn)}</div>` : ''}
        </div>
      </div>
      <div class="invoice-title">
        <h1>${t.invoice}</h1>
        ${branding.siteDescription ? `<div class="meta">${escapeHtml(branding.siteDescription)}</div>` : ''}
      </div>
    </div>

    <div class="meta-row">
      <div class="meta-col bill-to">
        <div class="label">${t.billTo}</div>
        <strong>${escapeHtml(metadata.client_name) || '—'}</strong>
        <div class="sub">${t.idNumber}: ${escapeHtml(metadata.client_id_number) || '—'}</div>
        <div class="sub">${t.phone}: ${escapeHtml(metadata.client_phone) || '—'}</div>
        <span class="status-badge">${statusBadge.label}</span>
      </div>
      <div class="meta-col" style="text-align:left;">
        <div class="label">${t.invoiceNo}</div>
        <div class="value" style="font-size:16px;">#${escapeHtml(invoiceNumber) || '—'}</div>
        <div class="label" style="margin-top:10px;">${t.issueDate}</div>
        <div class="value">${issueDate}</div>
        <div class="label" style="margin-top:10px;">${t.policyNumber}</div>
        <div class="value">${escapeHtml(metadata.policy_number) || '—'}</div>
      </div>
    </div>

    <table class="items">
      <thead>
        <tr>
          <th>${t.no}</th>
          <th style="text-align:right;">${t.description}</th>
          <th>${t.qty}</th>
          <th>${t.price}</th>
          <th>${t.total}</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
      </tbody>
    </table>

    <div class="totals">
      <div class="totals-box">
        <div class="totals-row" style="border-bottom:1px solid #e2e8f0;">
          <span>${t.subtotal}</span>
          <span style="font-weight:700;">₪${metadata.total_amount}</span>
        </div>
        <div class="totals-row" style="border-bottom:1px solid #e2e8f0;">
          <span>${t.paid}</span>
          <span style="font-weight:700;color:#16a34a;">₪${metadata.total_paid}</span>
        </div>
        <div class="totals-row" style="border-bottom:1px solid #e2e8f0;">
          <span>${t.remaining}</span>
          <span style="font-weight:700;color:${metadata.remaining_num > 0 ? '#b91c1c' : '#16a34a'};">₪${metadata.remaining_amount}</span>
        </div>
        <div class="totals-row grand">
          <span>${t.grandTotal}</span>
          <span>₪${metadata.total_amount}</span>
        </div>
      </div>
    </div>

    ${paymentsBlock}
    ${driversBlock}

    <div class="pay-terms">
      <div>
        <h4>${t.paymentMethod}</h4>
        <p>${escapeHtml(metadata.payment_method)}</p>
      </div>
      <div class="signature">
        <div class="role">${t.issuer}</div>
        <div class="name">${escapeHtml(metadata.admin_name) || branding.companyName}</div>
      </div>
    </div>

    <div style="margin-top:24px;padding:14px 18px;border-radius:10px;background:#f8fafc;border:1px solid #e2e8f0;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#64748b;margin-bottom:4px;">${t.termsTitle}</div>
      <p style="margin:0;font-size:12px;color:#334155;line-height:1.7;">${t.terms}</p>
    </div>

    <div class="footer-contact">
      <div class="thanks">${t.thankYou}</div>
      <div>${escapeHtml(metadata.admin_email)}</div>
    </div>
  </div>
</body>
</html>
  `.trim();
}
