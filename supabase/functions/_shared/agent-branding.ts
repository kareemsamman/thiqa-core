/**
 * Shared helper to fetch agent branding (company name, logo, etc.)
 * from the site_settings table. Used by all HTML-generating edge functions.
 */

export interface AgentBranding {
  companyName: string;
  companyNameEn: string;
  logoUrl: string | null;
  siteDescription: string;
  signatureHeaderHtml: string;
  signatureBodyHtml: string;
  signatureFooterHtml: string;
  signaturePrimaryColor: string;
  ownerName: string;
  taxNumber: string;
  invoicePrivacyText: string;
}

const DEFAULT_BRANDING: AgentBranding = {
  companyName: 'وكالة التأمين',
  companyNameEn: 'Insurance Agency',
  logoUrl: null,
  siteDescription: '',
  signatureHeaderHtml: '<h2>نموذج الموافقة على الخصوصية</h2>',
  signatureBodyHtml: '<p>مرحباً.</p><p>أقرّ بأنني قرأت وفهمت سياسة الخصوصية، وأوافق على قيام الشركة بجمع واستخدام ومعالجة بياناتي الشخصية للأغراض المتعلقة بخدمات التأمين والتواصل وإتمام الإجراءات اللازمة.</p><p>بالتوقيع أدناه، أؤكد صحة البيانات وأمنح موافقتي على ما ورد أعلاه.</p>',
  signatureFooterHtml: '<p>جميع الحقوق محفوظة</p>',
  signaturePrimaryColor: '#1e3a5f',
  ownerName: '',
  taxNumber: '',
  invoicePrivacyText: '',
};

/**
 * Fetch branding for a given agent from site_settings.
 * Falls back to defaults if no settings found.
 */
export async function getAgentBranding(
  supabase: any,
  agentId: string | null
): Promise<AgentBranding> {
  if (!agentId) return DEFAULT_BRANDING;

  try {
    const { data, error } = await supabase
      .from('site_settings')
      .select('site_title, site_description, logo_url, signature_header_html, signature_body_html, signature_footer_html, signature_primary_color, owner_name, tax_number, invoice_privacy_text')
      .eq('agent_id', agentId)
      .maybeSingle();

    if (error || !data) return DEFAULT_BRANDING;

    return {
      companyName: data.site_title || DEFAULT_BRANDING.companyName,
      companyNameEn: '',
      logoUrl: data.logo_url || null,
      siteDescription: data.site_description || '',
      signatureHeaderHtml: data.signature_header_html || DEFAULT_BRANDING.signatureHeaderHtml,
      signatureBodyHtml: data.signature_body_html || DEFAULT_BRANDING.signatureBodyHtml,
      signatureFooterHtml: data.signature_footer_html || DEFAULT_BRANDING.signatureFooterHtml,
      signaturePrimaryColor: data.signature_primary_color || DEFAULT_BRANDING.signaturePrimaryColor,
      ownerName: data.owner_name || '',
      taxNumber: data.tax_number || '',
      invoicePrivacyText: data.invoice_privacy_text || '',
    };
  } catch {
    return DEFAULT_BRANDING;
  }
}

/**
 * Resolve agent_id from an authenticated user via agent_users table.
 */
export async function resolveAgentId(
  supabase: any,
  userId: string
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('agent_users')
      .select('agent_id')
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !data) return null;
    return data.agent_id;
  } catch {
    return null;
  }
}

/**
 * Build the logo HTML for invoice/receipt headers.
 * If logo_url exists, renders an <img>. Otherwise renders company name as text.
 */
export function buildLogoHtml(branding: AgentBranding): string {
  if (branding.logoUrl) {
    return `<img src="${branding.logoUrl}" alt="${branding.companyName}" style="max-height:60px;object-fit:contain;margin:0 auto 8px auto;display:block;" />`;
  }
  return '';
}

/**
 * Build footer brand HTML using dynamic branding.
 */
export function buildFooterBrandHtml(branding: AgentBranding): string {
  const parts = [`<div class="footer-brand-ar">${branding.companyName}</div>`];
  if (branding.companyNameEn) {
    parts.push(`<div class="footer-brand-en">${branding.companyNameEn}</div>`);
  }
  return `<div class="footer-brand">${parts.join('\n')}</div>`;
}