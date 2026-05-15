// ──────────────────────────────────────────────────────────────
// ReceiptActionsDialog — print / SMS / WhatsApp picker
// ──────────────────────────────────────────────────────────────
//
// Mirrors the PolicySuccessDialog visual design — gradient hero
// header + a single expandable Row that reveals three channel
// buttons (طباعة / SMS / واتساب). Scoped to ONE voucher.
//
// Print → `generate-voucher` for every type (it dispatches by
//          receipt_type internally so the URL matches /receipts).
// SMS + WhatsApp → `send-voucher`, the unified wrapper that
//          handles every type (payment, disbursement, credit_note,
//          debit_note, cancellation) and resolves the counterparty
//          phone via receipts.client_id, receipts.broker_id, or the
//          linked policy.
//
// Body shape is identical to the print path: payment rows pass
// payment_ids so the bulk session number is preserved; everything
// else passes voucher_receipt_id.
//
// SMS-lock awareness comes from useSmsLock — when quota's gone the
// SMS button gets an amber dot and clicking it opens the upgrade
// dialog, matching PolicySuccessDialog.

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  MessageSquare,
  Printer,
  Receipt as ReceiptIcon,
  X,
} from 'lucide-react';
import { WhatsappLogo } from '@phosphor-icons/react';
import { useSmsLock } from '@/hooks/useSmsLock';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// Compact row shape the dialog consumes. Different surfaces feed
// different source rows (customer receipts, company-settlement
// mirror receipts, broker settlements) so we accept a structural
// subset rather than the full ClientReceiptRow type. The required
// fields drive routing + display; everything else is presentational.
export interface VoucherActionRow {
  id: string;
  receipt_type: string;
  voucher_number: string | null;
  payment_id?: string | null;
  client_name?: string | null;
  client_phone?: string | null;
}

type ActionChannelState = 'idle' | 'loading' | 'sent';

const SEND_VOUCHER_FUNCTION = 'send-voucher';

const RECEIPT_TITLE_BY_TYPE: Record<string, string> = {
  payment: 'سند قبض',
  disbursement: 'سند صرف',
  credit_note: 'إشعار دائن',
  debit_note: 'إشعار مدين',
  cancellation: 'سند إلغاء',
};

const RECEIPT_DESC_BY_TYPE: Record<string, string> = {
  payment: 'إثبات استلام المبلغ من الجهة',
  disbursement: 'إثبات صرف المبلغ للجهة',
  credit_note: 'تسجيل رصيد للجهة لدى المكتب',
  debit_note: 'تسجيل مبلغ مستحق على الجهة',
  cancellation: 'إلغاء سند قبض سابق',
};

export function ReceiptActionsDialog({
  row,
  onClose,
}: {
  row: VoucherActionRow | null;
  onClose: () => void;
}) {
  // ⚠ ALL hooks must run on every render — keep them above any early
  // return. A previous implementation had `useState(expanded)` and
  // `useEffect` after `if (!row) return null`, which violated the
  // Rules of Hooks and crashed the accounting tab to a blank page
  // the moment a user clicked a voucher number.
  const [printState, setPrintState] = useState<ActionChannelState>('idle');
  const [smsState, setSmsState] = useState<ActionChannelState>('idle');
  const [whatsappState, setWhatsappState] = useState<ActionChannelState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const {
    locked: smsLocked,
    loading: smsLoading,
    openUpgradeDialog: openSmsUpgrade,
  } = useSmsLock();

  // Reset state every time the dialog opens against a new row so
  // returning to a previously-sent voucher doesn't show the green
  // "sent" badge from the last session.
  useEffect(() => {
    if (!row) return;
    setPrintState('idle');
    setSmsState('idle');
    setWhatsappState('idle');
    setErrorMessage(null);
    setExpanded(false);
  }, [row?.id]);

  if (!row) return null;

  const title = RECEIPT_TITLE_BY_TYPE[row.receipt_type] ?? 'سند';

  // Body shape every send-* and generate-voucher accepts. Payment
  // rows ride on payment_ids so the bulk session number renders
  // consistently with /receipts; everything else uses voucher_receipt_id.
  const buildBody = (extra: Record<string, unknown> = {}) => {
    const base =
      row.receipt_type === 'payment' && row.payment_id
        ? { payment_ids: [row.payment_id] }
        : { voucher_receipt_id: row.id };
    return { ...base, ...extra };
  };

  const handlePrint = async () => {
    setPrintState('loading');
    setErrorMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke('generate-voucher', {
        body: buildBody(),
      });
      if (error) {
        setErrorMessage(error.message || 'فشل توليد السند');
        toast.error('فشل توليد السند');
        return;
      }
      const url = (data as { receipt_url?: string } | null)?.receipt_url ?? null;
      if (!url) {
        setErrorMessage('لم يتم إرجاع رابط السند');
        return;
      }
      window.open(url, '_blank', 'noopener');
      toast.success('تم فتح السند');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'فشل توليد السند';
      setErrorMessage(msg);
      toast.error(msg);
    } finally {
      setPrintState('idle');
    }
  };

  const handleSms = async () => {
    if (!row.client_phone) {
      toast.error('لا يوجد رقم هاتف للجهة');
      return;
    }
    if (smsLoading) return;
    if (smsLocked) {
      openSmsUpgrade();
      return;
    }
    setSmsState('loading');
    setErrorMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke(SEND_VOUCHER_FUNCTION, {
        body: buildBody(),
      });
      if (error) {
        setErrorMessage(error.message || 'فشل إرسال SMS');
        toast.error('فشل إرسال SMS');
        setSmsState('idle');
        return;
      }
      if ((data as { error?: string } | null)?.error) {
        toast.error((data as { error: string }).error);
        setSmsState('idle');
        return;
      }
      setSmsState('sent');
      toast.success('تم إرسال السند عبر SMS');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'فشل إرسال SMS';
      setErrorMessage(msg);
      toast.error(msg);
      setSmsState('idle');
    }
  };

  const handleWhatsapp = async () => {
    if (!row.client_phone) {
      toast.error('لا يوجد رقم هاتف للجهة');
      return;
    }
    setWhatsappState('loading');
    setErrorMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke(SEND_VOUCHER_FUNCTION, {
        body: buildBody({ whatsapp_mode: true }),
      });
      if (error) {
        setErrorMessage(error.message || 'فشل تجهيز رسالة واتساب');
        toast.error('فشل تجهيز رسالة واتساب');
        return;
      }
      const phone = (data as { whatsapp_phone?: string } | null)?.whatsapp_phone;
      const text = (data as { message_text?: string } | null)?.message_text;
      if (!phone || !text) {
        toast.error('لم يتم تجهيز رسالة واتساب');
        return;
      }
      window.open(
        `https://wa.me/${phone}?text=${encodeURIComponent(text)}`,
        '_blank',
      );
      toast.success('تم فتح واتساب');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'فشل تجهيز رسالة واتساب';
      setErrorMessage(msg);
      toast.error(msg);
    } finally {
      setWhatsappState('idle');
    }
  };

  const smsDisabled = !row.client_phone || smsLoading;
  const whatsappDisabled = !row.client_phone;
  const anyLoading =
    printState === 'loading' || smsState === 'loading' || whatsappState === 'loading';

  return (
    <Dialog open={!!row} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md w-[95vw] p-0 overflow-hidden" dir="rtl">
        {/* Hero header — same gradient as PolicySuccessDialog so the
            two dialogs read as a family. Different icon (Receipt) so
            the user can tell at a glance which flow they're in. */}
        <div className="text-white p-5 hero-gradient">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                <ReceiptIcon className="h-6 w-6" />
              </div>
              <div className="flex-1 min-w-0">
                <DialogTitle className="text-lg font-bold text-white text-right">
                  طباعة أو إرسال {title}
                </DialogTitle>
                <p className="text-xs text-white/70 mt-0.5">
                  {row.client_name || '—'}
                  {row.voucher_number ? ` · ${row.voucher_number}` : ''}
                </p>
              </div>
            </div>
          </DialogHeader>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3">
          {errorMessage && (
            <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
              <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Action panel — same expand-on-click pattern as
              PolicySuccessDialog's RowBlock so the two dialogs feel
              identical to operate. */}
          <div className="space-y-2">
            <div
              className={cn(
                'overflow-hidden transition-all duration-200 ease-out',
                expanded ? 'max-h-24 opacity-100' : 'max-h-0 opacity-0',
              )}
            >
              <div className="flex items-center justify-center gap-2 p-2 bg-muted/40 border border-border/60 rounded-xl">
                <ChannelButton
                  state={printState}
                  onClick={handlePrint}
                  icon={<Printer className="h-5 w-5" />}
                  colorIdle="text-emerald-600"
                  title="طباعة"
                />
                <ChannelButton
                  state={smsState}
                  onClick={handleSms}
                  disabled={smsDisabled}
                  locked={smsLocked}
                  icon={<MessageSquare className="h-5 w-5" />}
                  colorIdle="text-blue-600"
                  title={
                    !row.client_phone
                      ? 'لا يوجد رقم هاتف'
                      : smsLocked
                        ? 'تجاوزت الباقة — اضغط للترقية'
                        : 'إرسال SMS'
                  }
                />
                <ChannelButton
                  state={whatsappState}
                  onClick={handleWhatsapp}
                  disabled={whatsappDisabled}
                  icon={<WhatsappLogo className="h-5 w-5" weight="fill" />}
                  colorIdle="text-green-600"
                  title={
                    !row.client_phone
                      ? 'لا يوجد رقم هاتف'
                      : 'إرسال واتساب'
                  }
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className={cn(
                'w-full p-4 rounded-xl border-2 transition-all duration-200 text-right flex items-center gap-4',
                expanded
                  ? 'border-primary/60 bg-primary/5'
                  : 'border-border hover:border-primary/50 hover:bg-primary/5',
              )}
            >
              <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
                <ReceiptIcon className="h-6 w-6 text-blue-600" />
              </div>
              <div className="flex-1 min-w-0 text-right">
                <div className="font-semibold text-base">
                  طباعة أو إرسال {title}
                </div>
                <div className="text-sm text-muted-foreground">
                  {RECEIPT_DESC_BY_TYPE[row.receipt_type] ?? 'تفاصيل السند'}
                </div>
              </div>
            </button>
          </div>

          <Button
            variant="outline"
            className="w-full gap-2 mt-1"
            onClick={onClose}
            disabled={anyLoading}
          >
            <X className="h-4 w-4" />
            إغلاق
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Mini channel button — mirrors PolicySuccessDialog's ChannelButton
// style so both dialogs share the same expand-into-channels feel.
function ChannelButton({
  state,
  onClick,
  icon,
  colorIdle,
  disabled,
  locked,
  title,
}: {
  state: ActionChannelState;
  onClick: () => void;
  icon: React.ReactNode;
  colorIdle: string;
  disabled?: boolean;
  locked?: boolean;
  title: string;
}) {
  const isLoading = state === 'loading';
  const isSent = state === 'sent';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || isLoading || isSent}
      title={title}
      className={cn(
        'relative flex-1 h-12 rounded-lg border border-border/60 bg-background',
        'transition-all duration-150 hover:scale-105 hover:shadow-sm',
        'flex items-center justify-center',
        'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:shadow-none',
        !disabled && !isLoading && !isSent && colorIdle,
        isSent && 'text-emerald-600 bg-emerald-50 border-emerald-200',
      )}
    >
      {isLoading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : isSent ? (
        <CheckCircle2 className="h-5 w-5" />
      ) : (
        icon
      )}
      {locked && !isLoading && !isSent && (
        <span className="absolute top-0.5 left-0.5 h-1.5 w-1.5 rounded-full bg-amber-500" />
      )}
    </button>
  );
}
