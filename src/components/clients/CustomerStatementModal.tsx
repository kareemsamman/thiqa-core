import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Printer,
  MessageSquare,
  Loader2,
  FileText,
  X,
  RefreshCw,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { parseFunctionError } from '@/lib/functionError';
import { toast } from 'sonner';
import { useSiteSettings } from '@/hooks/useSiteSettings';
import { useSmsLock } from '@/hooks/useSmsLock';
import { ArabicYearPicker } from './ArabicYearPicker';

// Inline WhatsApp glyph — same one ClientReportModal used so the
// statement modal's action bar keeps the visual language the user
// already knows.
const WhatsAppIcon = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    aria-hidden="true"
  >
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0 0 20.885 3.488" />
  </svg>
);

interface PolicyForYears {
  start_date: string;
}

interface CustomerStatementModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  clientName: string;
  clientPhone: string | null;
  /** Used to derive the "available years" list for the year picker. */
  policies: PolicyForYears[];
}

export function CustomerStatementModal({
  open,
  onOpenChange,
  clientId,
  clientName,
  clientPhone,
  policies,
}: CustomerStatementModalProps) {
  const { data: siteSettings } = useSiteSettings();
  const {
    locked: smsLocked,
    loading: smsLoading,
    openUpgradeDialog: openSmsUpgrade,
    guardSend: guardSmsSend,
  } = useSmsLock();

  // Years derived from policy start_dates — sorted desc so the
  // freshest year is the natural default. Invalid/missing dates are
  // skipped so a corrupt row can't push 1970 into the list.
  const availableYears = useMemo(() => {
    const set = new Set<number>();
    for (const p of policies) {
      if (!p.start_date) continue;
      const y = new Date(p.start_date).getFullYear();
      if (!Number.isNaN(y) && y > 1990) set.add(y);
    }
    return Array.from(set).sort((a, b) => b - a);
  }, [policies]);

  const [year, setYear] = useState<number | null>(null);
  const [statementUrl, setStatementUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sendingSms, setSendingSms] = useState(false);
  const [sendingWhatsapp, setSendingWhatsapp] = useState(false);

  // Default the picker to the latest available year on first open,
  // and clear any stale URL when the modal reopens for a different
  // client (otherwise the iframe would briefly show the previous
  // customer's statement before the new fetch lands).
  useEffect(() => {
    if (!open) return;
    setStatementUrl(null);
    if (year === null && availableYears.length > 0) {
      setYear(availableYears[0]);
    }
  }, [open, availableYears]);

  // Re-fetch whenever the year changes.
  useEffect(() => {
    if (!open || year === null) return;
    fetchStatement(year);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, year, clientId]);

  const fetchStatement = async (selectedYear: number) => {
    setLoading(true);
    setStatementUrl(null);
    try {
      const response = await supabase.functions.invoke('generate-customer-statement', {
        body: { client_id: clientId, year: selectedYear },
      });
      if (response.error) throw response.error;
      const url = (response.data as any)?.statement_url;
      if (!url) throw new Error('Failed to generate statement URL');
      setStatementUrl(url);
    } catch (error) {
      const parsed = await parseFunctionError(error);
      console.error('[CustomerStatementModal] generate failed', parsed);
      toast.error(parsed.message || 'فشل في توليد كشف الحساب');
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    if (!statementUrl) return;
    const w = window.open(statementUrl, '_blank');
    if (w) {
      w.addEventListener('load', () => {
        setTimeout(() => w.print(), 500);
      });
    }
  };

  const handleSendSms = async () => {
    if (!clientPhone) {
      toast.error('لا يوجد رقم هاتف للعميل');
      return;
    }
    if (!statementUrl) return;
    if (!guardSmsSend('click')) return;

    setSendingSms(true);
    try {
      const companyName = siteSettings?.site_title || 'وكالة التأمين';
      const message =
        `${clientName} عزيزنا/ي\n` +
        `يمكنك مشاهدة كشف حسابك لسنة ${year} عبر الرابط:\n${statementUrl}\n\n` +
        `${companyName} 🚗`;

      const smsResponse = await supabase.functions.invoke('send-sms', {
        body: { phone: clientPhone, message },
      });
      if (smsResponse.error) throw smsResponse.error;

      await (supabase.from('sms_logs') as any).insert([
        {
          phone_number: clientPhone,
          message,
          client_id: clientId,
          sms_type: 'manual' as const,
          status: 'sent',
          sent_at: new Date().toISOString(),
        },
      ]);
      toast.success('تم إرسال رابط كشف الحساب عبر SMS بنجاح');
    } catch (error) {
      const parsed = await parseFunctionError(error);
      console.error('[CustomerStatementModal] sms failed', parsed);
      toast.error(parsed.message || 'فشل في إرسال الرسالة');
    } finally {
      setSendingSms(false);
    }
  };

  const handleSendWhatsApp = () => {
    if (!clientPhone) {
      toast.error('لا يوجد رقم هاتف للعميل');
      return;
    }
    if (!statementUrl) return;
    setSendingWhatsapp(true);
    try {
      const companyName = siteSettings?.site_title || 'وكالة التأمين';
      const message =
        `${clientName} عزيزنا/ي\n` +
        `يمكنك مشاهدة كشف حسابك لسنة ${year} عبر الرابط:\n${statementUrl}\n\n` +
        `${companyName} 🚗`;
      const digits = clientPhone.replace(/[^\d]/g, '');
      const phone = digits.startsWith('0') ? '972' + digits.slice(1) : digits;
      window.open(
        `https://wa.me/${phone}?text=${encodeURIComponent(message)}`,
        '_blank',
        'noopener,noreferrer',
      );
    } finally {
      setSendingWhatsapp(false);
    }
  };

  const noYears = availableYears.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-5xl w-[95vw] h-[92vh] p-0 overflow-hidden flex flex-col"
        hideCloseButton
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b bg-primary text-primary-foreground">
          <div className="flex items-center gap-3 min-w-0">
            <FileText className="h-5 w-5 shrink-0" />
            <div className="min-w-0">
              <h2 className="text-base font-bold truncate">كشف حساب · {clientName}</h2>
              <p className="text-[11px] opacity-80 truncate">
                اختر السنة لعرض المعاملات والسندات الخاصة بها
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-primary-foreground hover:bg-white/20 shrink-0"
            onClick={() => onOpenChange(false)}
            aria-label="إغلاق"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Toolbar: year picker + refresh */}
        <div className="flex items-center gap-3 px-5 py-3 border-b bg-muted/30">
          <div className="text-sm font-semibold shrink-0">السنة</div>
          <div className="w-[200px]">
            <ArabicYearPicker
              value={year}
              onChange={setYear}
              availableYears={availableYears}
              placeholder={noYears ? 'لا توجد سنوات' : 'اختر السنة'}
            />
          </div>
          {year !== null && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => fetchStatement(year)}
              disabled={loading}
            >
              <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
              <span>تحديث</span>
            </Button>
          )}
          <div className="flex-1" />
          {statementUrl && (
            <a
              href={statementUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline"
            >
              فتح في تبويب جديد ↗
            </a>
          )}
        </div>

        {/* Preview area */}
        <div className="flex-1 min-h-0 bg-slate-100 relative">
          {noYears ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
              <FileText className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-sm font-semibold">لا توجد معاملات لهذا العميل</p>
              <p className="text-xs text-muted-foreground mt-1">
                يجب أن يكون للعميل بوليصة واحدة على الأقل لتوليد كشف حساب
              </p>
            </div>
          ) : loading ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
              <p className="text-sm font-medium text-muted-foreground">
                جاري تحضير كشف الحساب لسنة {year}…
              </p>
            </div>
          ) : statementUrl ? (
            <iframe
              src={statementUrl}
              title={`كشف حساب ${year} - ${clientName}`}
              className="absolute inset-0 w-full h-full bg-white"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
              تعذّر تحميل الكشف. اضغط "تحديث" لإعادة المحاولة.
            </div>
          )}
        </div>

        {/* Action bar */}
        <div className="flex items-center gap-2 px-5 py-3 border-t bg-background">
          <Button
            variant="outline"
            size="sm"
            className="gap-2 flex-1 sm:flex-none"
            onClick={handlePrint}
            disabled={!statementUrl || loading}
          >
            <Printer className="h-4 w-4" />
            <span>طباعة</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 flex-1 sm:flex-none"
            onClick={smsLocked ? () => openSmsUpgrade('click') : handleSendSms}
            disabled={!statementUrl || loading || sendingSms || smsLoading || !clientPhone}
            title={!clientPhone ? 'لا يوجد رقم هاتف للعميل' : undefined}
          >
            {sendingSms ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <MessageSquare className="h-4 w-4" />
            )}
            <span>إرسال SMS</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 flex-1 sm:flex-none text-green-700 hover:text-green-800 hover:bg-green-50"
            onClick={handleSendWhatsApp}
            disabled={!statementUrl || loading || sendingWhatsapp || !clientPhone}
            title={!clientPhone ? 'لا يوجد رقم هاتف للعميل' : undefined}
          >
            {sendingWhatsapp ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <WhatsAppIcon className="h-4 w-4" />
            )}
            <span>WhatsApp</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
