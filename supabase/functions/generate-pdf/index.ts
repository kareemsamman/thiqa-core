import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TemplateElement {
  id: string;
  type: 'text' | 'image' | 'field' | 'table' | 'line' | 'logo';
  x: number;
  y: number;
  width: number;
  height: number;
  style: {
    fontSize?: number;
    fontWeight?: string;
    fontFamily?: string;
    textAlign?: string;
    color?: string;
    backgroundColor?: string;
    direction?: 'rtl' | 'ltr';
  };
  content?: string;
  fieldKey?: string;
}

interface GeneratePdfRequest {
  invoice_id: string;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const bunnyApiKey = Deno.env.get('BUNNY_API_KEY');
    const bunnyStorageZone = Deno.env.get('BUNNY_STORAGE_ZONE');
    const bunnyCdnUrl = Deno.env.get('BUNNY_CDN_URL');
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { invoice_id } = await req.json() as GeneratePdfRequest;

    if (!invoice_id) {
      return new Response(
        JSON.stringify({ error: 'invoice_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[generate-pdf] Starting for invoice: ${invoice_id}`);

    // Fetch invoice with template
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select(`
        *,
        template:invoice_templates(*)
      `)
      .eq('id', invoice_id)
      .single();

    if (invoiceError || !invoice) {
      console.error('[generate-pdf] Invoice not found:', invoiceError);
      return new Response(
        JSON.stringify({ error: 'Invoice not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const template = invoice.template;
    const metadata = invoice.metadata_json || {};

    // Build HTML from either JSON layout or legacy HTML
    let htmlContent: string;
    
    if (template?.template_layout_json && Array.isArray(template.template_layout_json) && template.template_layout_json.length > 0) {
      // Build from JSON layout
      htmlContent = buildHtmlFromLayout(
        template.template_layout_json as TemplateElement[],
        metadata,
        template.logo_url,
        template.direction || 'rtl',
        invoice.language
      );
    } else if (metadata.html_content) {
      // Use pre-generated HTML
      htmlContent = metadata.html_content;
    } else {
      // Build from legacy HTML fields
      htmlContent = buildLegacyHtml(template, metadata, invoice.invoice_number, invoice.language);
    }

    // For now, store the HTML content as the "PDF"
    // In production, you would use a PDF generation service like Puppeteer, jsPDF, or a third-party API
    // The HTML is already print-ready with @media print styles

    // Update invoice with generated content
    const { error: updateError } = await supabase
      .from('invoices')
      .update({
        metadata_json: { ...metadata, html_content: htmlContent, generated_at: new Date().toISOString() },
        status: 'generated',
      })
      .eq('id', invoice_id);

    if (updateError) {
      throw updateError;
    }

    console.log(`[generate-pdf] Successfully generated for invoice: ${invoice_id}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        invoice_id,
        message: 'Invoice HTML generated. PDF generation requires external service integration.'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('[generate-pdf] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function buildHtmlFromLayout(
  elements: TemplateElement[],
  metadata: Record<string, string>,
  logoUrl: string | null,
  direction: string,
  language: string
): string {
  const elementHtml = elements.map(el => {
    const style = buildElementStyle(el);
    
    let content = '';
    if (el.type === 'field' && el.fieldKey) {
      content = metadata[el.fieldKey] || `{{${el.fieldKey}}}`;
    } else if (el.type === 'text') {
      content = el.content || '';
    } else if (el.type === 'logo' && logoUrl) {
      content = `<img src="${logoUrl}" style="width:100%;height:100%;object-fit:contain;" />`;
    } else if (el.type === 'image' && el.content) {
      content = `<img src="${el.content}" style="width:100%;height:100%;object-fit:contain;" />`;
    } else if (el.type === 'line') {
      // Line is just a colored div
    }

    return `<div style="${style}">${content}</div>`;
  }).join('\n');

  return `
<!DOCTYPE html>
<html dir="${direction}" lang="${language}">
<head>
  <meta charset="UTF-8">
  <style>
    @page {
      size: A4;
      margin: 0;
    }
    * {
      box-sizing: border-box;
    }
    body {
      font-family: 'Arial', 'Tahoma', 'Noto Sans Arabic', 'Noto Sans Hebrew', sans-serif;
      margin: 0;
      padding: 0;
      width: 210mm;
      min-height: 297mm;
      position: relative;
      direction: ${direction};
    }
    @media print {
      body {
        width: 210mm;
        height: 297mm;
      }
    }
  </style>
</head>
<body>
  ${elementHtml}
</body>
</html>
  `.trim();
}

function buildElementStyle(el: TemplateElement): string {
  const styles: string[] = [
    'position: absolute',
    `left: ${el.x * 0.352778}mm`, // Convert from pixels to mm (1px ≈ 0.352778mm at 72dpi)
    `top: ${el.y * 0.352778}mm`,
    `width: ${el.width * 0.352778}mm`,
    `height: ${el.height * 0.352778}mm`,
  ];

  if (el.style.fontSize) {
    styles.push(`font-size: ${el.style.fontSize}pt`);
  }
  if (el.style.fontWeight) {
    styles.push(`font-weight: ${el.style.fontWeight}`);
  }
  if (el.style.fontFamily) {
    styles.push(`font-family: ${el.style.fontFamily}, Arial, sans-serif`);
  }
  if (el.style.textAlign) {
    styles.push(`text-align: ${el.style.textAlign}`);
  }
  if (el.style.color) {
    styles.push(el.type === 'line' ? `background-color: ${el.style.color}` : `color: ${el.style.color}`);
  }
  if (el.style.backgroundColor && el.type !== 'line') {
    styles.push(`background-color: ${el.style.backgroundColor}`);
  }
  if (el.style.direction) {
    styles.push(`direction: ${el.style.direction}`);
  }

  return styles.join('; ');
}

function buildLegacyHtml(
  template: any,
  metadata: Record<string, string>,
  invoiceNumber: string,
  language: string
): string {
  const replacePlaceholders = (html: string) => {
    let result = html || '';
    result = result.replace(/\{\{invoice_number\}\}/g, invoiceNumber);
    result = result.replace(/\{\{issue_date\}\}/g, new Date().toLocaleDateString(language === 'ar' ? 'ar-SA' : 'he-IL'));
    
    Object.entries(metadata).forEach(([key, value]) => {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value || '');
    });
    
    return result;
  };

  const direction = template?.direction || 'rtl';
  const logoHtml = template?.logo_url 
    ? `<div style="text-align: center; margin-bottom: 20px;"><img src="${template.logo_url}" alt="Logo" style="max-height: 80px;" /></div>`
    : '';

  return `
<!DOCTYPE html>
<html dir="${direction}" lang="${language}">
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
  ${replacePlaceholders(template?.header_html || '')}
  ${replacePlaceholders(template?.body_html || '')}
  ${replacePlaceholders(template?.footer_html || '')}
</body>
</html>
  `.trim();
}
