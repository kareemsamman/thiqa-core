import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { sanitizeHtml } from '@/lib/sanitize';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import { useSiteSettings } from '@/hooks/useSiteSettings';
import { useAgentContext } from '@/hooks/useAgentContext';

interface CompanyPhones {
  phoneLinks: Array<{ phone: string; label?: string; link_type?: string }>;
  companyLocation: string;
}

interface LetterPreviewProps {
  title: string;
  recipientName: string;
  bodyHtml: string;
  createdAt?: string;
  className?: string;
}

export function LetterPreview({ title, recipientName, bodyHtml, createdAt, className }: LetterPreviewProps) {
  const { data: siteSettings, isLoading: settingsLoading } = useSiteSettings();
  const { agent } = useAgentContext();
  const [phoneInfo, setPhoneInfo] = useState<CompanyPhones>({ phoneLinks: [], companyLocation: '' });
  const [phoneInfoLoading, setPhoneInfoLoading] = useState(true);

  useEffect(() => {
    async function fetchPhones() {
      try {
        const { data } = await supabase.rpc('get_company_contact_info');
        const info = (data ?? {}) as { company_phone_links?: unknown; company_location?: unknown };

        let phoneLinks = info.company_phone_links;
        if (phoneLinks && typeof phoneLinks === 'string') {
          try { phoneLinks = JSON.parse(phoneLinks); } catch { phoneLinks = []; }
        }

        setPhoneInfo({
          phoneLinks: Array.isArray(phoneLinks) ? phoneLinks as CompanyPhones['phoneLinks'] : [],
          companyLocation: (typeof info.company_location === 'string' ? info.company_location : '') || '',
        });
      } catch {
        setPhoneInfo({ phoneLinks: [], companyLocation: '' });
      } finally {
        setPhoneInfoLoading(false);
      }
    }
    fetchPhones();
  }, []);

  const loading = settingsLoading || phoneInfoLoading;

  if (loading) {
    return (
      <div className={className}>
        <Skeleton className="h-32 w-full mb-4" />
        <Skeleton className="h-40 w-full mb-4" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  // Prefer the agent's branded site title, then the agent profile name,
  // then a safe generic fallback. Same for the logo and accent color.
  const companyName = siteSettings?.site_title?.trim()
    || agent?.name_ar?.trim()
    || agent?.name?.trim()
    || 'وكالة التأمين';
  const subtitle = siteSettings?.site_description || 'وكالة تأمين معتمدة';
  const logoUrl = siteSettings?.logo_url || null;
  const accent = siteSettings?.signature_primary_color || '#0d9488';
  const ownerName = siteSettings?.owner_name || companyName;

  // Combine the agent's configured phones/address with the legacy
  // company_phone_links SMS field so the footer still shows something
  // useful even if the new branding fields haven't been filled in.
  const footerPhones: string[] = [];
  if (siteSettings?.invoice_phones?.length) {
    footerPhones.push(...siteSettings.invoice_phones.filter(Boolean));
  }
  for (const p of phoneInfo.phoneLinks) {
    if (p.phone && !footerPhones.some(existing => existing.includes(p.phone))) {
      footerPhones.push(p.label ? `${p.label}: ${p.phone}` : p.phone);
    }
  }
  const footerAddress = siteSettings?.invoice_address || phoneInfo.companyLocation || '';

  const formattedDate = createdAt
    ? format(new Date(createdAt), 'dd/MM/yyyy')
    : format(new Date(), 'dd/MM/yyyy');

  return (
    <div
      className={className}
      style={{
        direction: 'rtl',
        fontFamily: 'Arial, Tahoma, sans-serif',
        maxWidth: '820px',
        margin: '0 auto',
        backgroundColor: 'white',
        border: '1px solid #e5e7eb',
        borderRadius: '6px',
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      }}
    >
      {/* Letterhead with agent logo + name. The logo is wrapped in a
          fixed-size flex box so a square/tall/wide source image all
          render at the same visual footprint — the previous
          max-height/max-width pair alone made the logo look cropped
          when the source image was large. */}
      <div style={{
        padding: '40px 56px 32px',
        borderBottom: `3px double ${accent}`,
        textAlign: 'center',
      }}>
        {logoUrl && (
          <div style={{
            width: '100%',
            height: '96px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '18px',
          }}>
            <img
              src={logoUrl}
              alt={companyName}
              style={{
                maxHeight: '96px',
                maxWidth: '260px',
                width: 'auto',
                height: 'auto',
                objectFit: 'contain',
              }}
            />
          </div>
        )}
        <h1 style={{
          fontSize: '30px',
          fontWeight: 700,
          margin: 0,
          color: accent,
          letterSpacing: '0.5px',
        }}>
          {companyName}
        </h1>
        <p style={{ fontSize: '14px', margin: '6px 0 0', color: '#64748b' }}>
          {subtitle}
        </p>
      </div>

      {/* Meta */}
      <div style={{ padding: '28px 48px 16px' }}>
        <div style={{ textAlign: 'left', marginBottom: '24px', color: '#374151', fontSize: '15px' }}>
          التاريخ: {formattedDate}
        </div>
        <div style={{ marginBottom: '10px', fontSize: '15px' }}>
          <span style={{ color: '#64748b' }}>إلى: </span>
          <span style={{ color: '#0f172a', fontWeight: 600 }}>{recipientName || '---'}</span>
        </div>
        <div style={{ marginBottom: '20px', fontSize: '15px' }}>
          <span style={{ color: '#64748b' }}>الموضوع: </span>
          <span style={{ color: '#0f172a', fontWeight: 600 }}>{title || 'رسالة رسمية'}</span>
        </div>
        <div style={{ borderBottom: '1px solid #e5e7eb', marginBottom: '24px' }} />
      </div>

      {/* Body */}
      <div style={{ padding: '0 48px 40px', minHeight: '240px' }}>
        <div style={{ fontSize: '16px', lineHeight: 2, color: '#1e293b' }}>
          <p style={{ marginBottom: '20px' }}>
            {recipientName ? `حضرة السيد/ة ${recipientName} المحترم/ة،` : 'تحية طيبة وبعد،'}
          </p>
          <div
            style={{ whiteSpace: 'pre-wrap' }}
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(bodyHtml) }}
          />
          <div style={{ marginTop: '40px' }}>
            <p>وتفضلوا بقبول فائق الاحترام والتقدير،</p>
          </div>
        </div>
      </div>

      {/* Signature */}
      <div style={{ padding: '20px 48px 40px', textAlign: 'left' }}>
        <div style={{ display: 'inline-block', textAlign: 'center' }}>
          <div style={{ fontSize: '17px', color: accent, fontWeight: 600, marginBottom: '10px' }}>
            {ownerName}
          </div>
          <div style={{ width: '140px', borderTop: '1px solid #94a3b8', paddingTop: '8px', color: '#64748b', fontSize: '13px' }}>
            التوقيع والختم
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{
        borderTop: `3px double ${accent}`,
        padding: '18px 48px',
        textAlign: 'center',
        color: '#64748b',
        fontSize: '13px',
        backgroundColor: '#f8fafc',
        lineHeight: 1.8,
      }}>
        {footerPhones.length > 0 && (
          <div>{footerPhones.join(' | ')}</div>
        )}
        {footerAddress && <div>{footerAddress}</div>}
      </div>
    </div>
  );
}
