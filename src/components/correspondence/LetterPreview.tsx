import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { sanitizeHtml } from '@/lib/sanitize';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';

interface CompanyInfo {
  company_name?: string;
  company_phone_links?: Array<{ phone: string; label?: string; link_type?: string }>;
  company_location?: string;
}

interface LetterPreviewProps {
  title: string;
  recipientName: string;
  bodyHtml: string;
  createdAt?: string;
  className?: string;
}

export function LetterPreview({ title, recipientName, bodyHtml, createdAt, className }: LetterPreviewProps) {
  const [companyInfo, setCompanyInfo] = useState<CompanyInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchCompanyInfo() {
      try {
        const { data, error } = await supabase
          .from('sms_settings')
          .select('company_phone_links, company_location')
          .limit(1)
          .single();
        
        if (error) throw error;
        
        let phoneLinks = data?.company_phone_links;
        if (phoneLinks && typeof phoneLinks === 'string') {
          try {
            phoneLinks = JSON.parse(phoneLinks);
          } catch {
            phoneLinks = [];
          }
        }
        
        setCompanyInfo({
          company_name: 'ثقة للتأمين',
          company_phone_links: phoneLinks as CompanyInfo['company_phone_links'],
          company_location: data?.company_location || undefined,
        });
      } catch (error) {
        console.error('Error fetching company info:', error);
        setCompanyInfo({
          company_name: 'ثقة للتأمين',
        });
      } finally {
        setLoading(false);
      }
    }
    fetchCompanyInfo();
  }, []);

  if (loading) {
    return (
      <div className={className}>
        <Skeleton className="h-32 w-full mb-4" />
        <Skeleton className="h-40 w-full mb-4" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  const phoneLinks = Array.isArray(companyInfo?.company_phone_links) 
    ? companyInfo.company_phone_links 
    : [];

  const formattedDate = createdAt 
    ? format(new Date(createdAt), 'dd/MM/yyyy')
    : format(new Date(), 'dd/MM/yyyy');

  return (
    <div 
      className={className}
      style={{ 
        direction: 'rtl',
        fontFamily: 'Arial, Tahoma, sans-serif',
        maxWidth: '800px',
        margin: '0 auto',
        backgroundColor: 'white',
        border: '1px solid #e5e7eb',
        borderRadius: '4px',
        overflow: 'hidden',
      }}
    >
      {/* Elegant Letterhead */}
      <div style={{ 
        padding: '32px 40px 24px',
        borderBottom: '3px double hsl(225, 65%, 50%)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: '8px' }}>
          <h1 style={{ 
            fontSize: '28px', 
            fontWeight: 'bold', 
            margin: 0, 
            color: 'hsl(225, 65%, 50%)',
            letterSpacing: '1px',
          }}>
            ثقة للتأمين
          </h1>
          <p style={{ 
            fontSize: '13px', 
            margin: '4px 0 0', 
            color: '#64748b',
          }}>
            وكالة تأمين معتمدة
          </p>
        </div>
      </div>

      {/* Letter Meta */}
      <div style={{ padding: '24px 40px 16px' }}>
        {/* Date */}
        <div style={{ 
          textAlign: 'left',
          marginBottom: '20px',
          color: '#374151',
          fontSize: '14px',
        }}>
          التاريخ: {formattedDate}
        </div>

        {/* Recipient */}
        <div style={{ marginBottom: '8px', fontSize: '14px' }}>
          <span style={{ color: '#64748b' }}>إلى: </span>
          <span style={{ color: '#1e293b', fontWeight: '600' }}>{recipientName || '---'}</span>
        </div>

        {/* Subject */}
        <div style={{ marginBottom: '16px', fontSize: '14px' }}>
          <span style={{ color: '#64748b' }}>الموضوع: </span>
          <span style={{ color: '#1e293b', fontWeight: '600' }}>{title || 'رسالة رسمية'}</span>
        </div>

        {/* Separator */}
        <div style={{ 
          borderBottom: '1px solid #e5e7eb',
          marginBottom: '20px',
        }} />
      </div>

      {/* Body Content */}
      <div style={{ padding: '0 40px 32px', minHeight: '200px' }}>
        <div style={{ 
          fontSize: '14px',
          lineHeight: '2',
          color: '#1e293b',
        }}>
          {/* Greeting */}
          <p style={{ marginBottom: '16px' }}>
            {recipientName ? `حضرة السيد/ة ${recipientName} المحترم/ة،` : 'تحية طيبة وبعد،'}
          </p>
          
          {/* Main Content */}
          <div 
            style={{ whiteSpace: 'pre-wrap' }}
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(bodyHtml) }}
          />
          
          {/* Closing */}
          <div style={{ marginTop: '32px' }}>
            <p>وتفضلوا بقبول فائق الاحترام والتقدير،</p>
          </div>
        </div>
      </div>

      {/* Signature Area */}
      <div style={{ 
        padding: '16px 40px 32px',
        textAlign: 'left',
      }}>
        <div style={{ display: 'inline-block', textAlign: 'center' }}>
          <div style={{ 
            fontSize: '16px',
            color: '#0d9488',
            fontWeight: '600',
            marginBottom: '8px',
          }}>
            ثقة للتأمين
          </div>
          <div style={{ 
            width: '120px', 
            borderTop: '1px solid #94a3b8', 
            paddingTop: '6px',
            color: '#64748b',
            fontSize: '12px',
          }}>
            التوقيع والختم
          </div>
        </div>
      </div>

      {/* Simple Footer */}
      <div style={{ 
        borderTop: '3px double #0d9488',
        padding: '16px 40px',
        textAlign: 'center',
        color: '#64748b',
        fontSize: '12px',
        backgroundColor: '#f8fafc',
      }}>
        <div>
          {phoneLinks.map((p, i) => (
            <span key={i}>
              {i > 0 && ' | '}
              {p.label ? `${p.label}: ` : ''}{p.phone}
            </span>
          ))}
          {companyInfo?.company_location && (
            <span> | {companyInfo.company_location}</span>
          )}
        </div>
      </div>
    </div>
  );
}
