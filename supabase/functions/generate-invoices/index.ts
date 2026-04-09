import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    // Get payment method from first payment if exists
    const { data: payments } = await supabase
      .from('policy_payments')
      .select('payment_type')
      .eq('policy_id', policy_id)
      .eq('refused', false)
      .limit(1);

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

        // Prepare metadata snapshot
        const metadata = {
          client_name: policy.client?.full_name || '',
          client_id_number: policy.client?.id_number || '',
          client_phone: policy.client?.phone_number || '',
          car_number: policy.car?.car_number || '',
          company_name: lang === 'ar' ? (policy.company?.name_ar || policy.company?.name) : policy.company?.name,
          insurance_type: getInsuranceTypeLabel(policy.policy_type_parent, policy.policy_type_child, lang),
          start_date: formatDate(policy.start_date, lang),
          end_date: formatDate(policy.end_date, lang),
          total_amount: policy.insurance_price?.toLocaleString() || '0',
          payment_method: PAYMENT_TYPE_LABELS[lang]?.[paymentType as keyof typeof PAYMENT_TYPE_LABELS['ar']] || paymentType,
          admin_name: policy.created_by?.full_name || '',
          admin_email: policy.created_by?.email || '',
          policy_number: `${policy.policy_type_parent} ${new Date(policy.start_date).getFullYear()} ${policy.car?.car_number || ''}`,
          // Additional drivers / dependents linked to this policy
          additional_drivers: additionalDrivers,
          has_additional_drivers: additionalDrivers.length > 0,
        };

        // Replace placeholders in template
        let htmlContent = buildInvoiceHtml(template, metadata, invoiceNumber || '', lang);

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

interface InvoiceMetadata {
  client_name: string;
  client_id_number: string;
  client_phone: string;
  car_number: string;
  company_name: string;
  insurance_type: string;
  start_date: string;
  end_date: string;
  total_amount: string;
  payment_method: string;
  admin_name: string;
  admin_email: string;
  policy_number: string;
  additional_drivers: AdditionalDriver[];
  has_additional_drivers: boolean;
}

function buildInvoiceHtml(
  template: any,
  metadata: InvoiceMetadata,
  invoiceNumber: string,
  lang: 'ar' | 'he'
): string {
  const replacePlaceholders = (html: string) => {
    let result = html || '';
    result = result.replace(/\{\{invoice_number\}\}/g, invoiceNumber);
    result = result.replace(/\{\{issue_date\}\}/g, formatDate(new Date().toISOString(), lang));
    result = result.replace(/\{\{client_name\}\}/g, metadata.client_name);
    result = result.replace(/\{\{client_id_number\}\}/g, metadata.client_id_number);
    result = result.replace(/\{\{client_phone\}\}/g, metadata.client_phone);
    result = result.replace(/\{\{car_number\}\}/g, metadata.car_number);
    result = result.replace(/\{\{company_name\}\}/g, metadata.company_name);
    result = result.replace(/\{\{insurance_type\}\}/g, metadata.insurance_type);
    result = result.replace(/\{\{start_date\}\}/g, metadata.start_date);
    result = result.replace(/\{\{end_date\}\}/g, metadata.end_date);
    result = result.replace(/\{\{total_amount\}\}/g, metadata.total_amount);
    result = result.replace(/\{\{payment_method\}\}/g, metadata.payment_method);
    result = result.replace(/\{\{admin_name\}\}/g, metadata.admin_name);
    result = result.replace(/\{\{admin_email\}\}/g, metadata.admin_email);
    result = result.replace(/\{\{policy_number\}\}/g, metadata.policy_number);
    
    // Build additional drivers section HTML if there are any
    if (metadata.additional_drivers && metadata.additional_drivers.length > 0) {
      const driversListHtml = metadata.additional_drivers.map((driver: any) => 
        `<li style="margin-bottom: 4px;">${driver.name} — ${driver.id_number}${driver.relation ? ` (${driver.relation})` : ''}${driver.birth_date ? ` — ${driver.birth_date}` : ''}</li>`
      ).join('');
      
      const additionalDriversHtml = `
        <div style="margin-top: 16px; padding-top: 12px; border-top: 1px solid #e5e5e5;">
          <h4 style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600;">السائقين الإضافيين / التابعين</h4>
          <ul style="margin: 0; padding-right: 20px; list-style-type: disc;">${driversListHtml}</ul>
        </div>
      `;
      result = result.replace(/\{\{additional_drivers\}\}/g, additionalDriversHtml);
    } else {
      // Remove placeholder if no additional drivers
      result = result.replace(/\{\{additional_drivers\}\}/g, '');
    }
    
    return result;
  };

  const direction = template.direction || 'rtl';
  const logoHtml = template.logo_url 
    ? `<div style="text-align: center; margin-bottom: 20px;"><img src="${template.logo_url}" alt="Logo" style="max-height: 80px;" /></div>`
    : '';

  return `
<!DOCTYPE html>
<html dir="${direction}" lang="${lang}">
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: 'Arial', 'Tahoma', sans-serif;
      margin: 0;
      padding: 40px;
      direction: ${direction};
      text-align: ${direction === 'rtl' ? 'right' : 'left'};
    }
    @media print {
      body { padding: 20px; }
    }
  </style>
</head>
<body>
  ${logoHtml}
  ${replacePlaceholders(template.header_html || '')}
  ${replacePlaceholders(template.body_html || '')}
  ${replacePlaceholders(template.footer_html || '')}
</body>
</html>
  `.trim();
}
