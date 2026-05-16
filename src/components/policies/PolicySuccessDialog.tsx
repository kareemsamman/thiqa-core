import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSmsLock } from "@/hooks/useSmsLock";
import { supabase } from "@/integrations/supabase/client";
import { toastFunctionError, extractFunctionErrorMessage } from "@/lib/functionError";
import { toast } from "sonner";
import {
  Printer,
  MessageSquare,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  FileText,
  Receipt,
  Info,
  FileSignature,
} from "lucide-react";
import { WhatsappLogo } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

type RowKey = "transaction" | "receipt" | "signing";
type ChannelKey = "print" | "sms" | "whatsapp";
type ChannelState = "idle" | "loading" | "sent";

interface PolicySuccessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policyId: string;
  clientId: string;
  clientPhone: string | null;
  isPackage: boolean;
  /** payment_ids the user added beyond the auto-mandatory row. When the
   *  array is empty the سند القبض button is hidden — there's nothing
   *  receiptable to print/send. */
  receiptPaymentIds: string[];
  onClose: () => void;
  /** When true, the سند القبض row + its "متاح فقط..." hint never
   *  render at all. Used by the accounting page's معاملة-click flow,
   *  where the user wants the dialog scoped to the policy alone
   *  ("اذا معاملة بس فمعاملة"). The default — false — keeps the
   *  end-of-wizard behavior unchanged. */
  hideReceiptSection?: boolean;
  /** Render a third "طلب توقيع العميل" row with SMS + WhatsApp actions.
   *  Set by PolicyWizard only when the agent has
   *  signing_check_timing='on_completion' AND the client doesn't already
   *  have a signature on file. */
  showSigningRow?: boolean;
}

const ROW_LABELS: Record<RowKey, { title: string; desc: string; tooltip: string }> = {
  transaction: {
    title: "طباعة أو إرسال المعاملة",
    desc: "تفاصيل البوليصة الكاملة",
    tooltip:
      "المعاملة تحتوي تفاصيل البوليصة كاملة — السيارة، نوع التأمين، السعر، والدفعات المتفق عليها.",
  },
  receipt: {
    title: "طباعة أو إرسال سند القبض",
    desc: "إثبات استلام المبلغ من العميل",
    tooltip:
      "سند القبض إثبات استلام المبلغ من العميل بنفس شكل السندات في صفحة الإيصالات.",
  },
  signing: {
    title: "طلب توقيع العميل",
    desc: "يرسل رابط نموذج التفويض للعميل عبر SMS أو واتساب",
    tooltip:
      "العميل لم يوقّع على نموذج التفويض بعد. اختر SMS أو واتساب لإرسال رابط التوقيع، وستظهر علامة خضراء هنا تلقائياً فور توقيع العميل.",
  },
};

export function PolicySuccessDialog({
  open,
  onOpenChange,
  policyId,
  clientId,
  clientPhone,
  isPackage,
  receiptPaymentIds,
  onClose,
  hideReceiptSection = false,
  showSigningRow = false,
}: PolicySuccessDialogProps) {
  // Only one action panel is ever open at a time — clicking the other
  // row collapses this one and opens that one with the same animation.
  const [activeRow, setActiveRow] = useState<RowKey | null>(null);

  // Per-cell state, keyed `${row}:${channel}`. Cells run independently
  // so the user can fire one icon, watch it spin, and still hit another
  // icon in the same panel without losing context.
  const [cellState, setCellState] = useState<Record<string, ChannelState>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Flips true once realtime picks up an UPDATE on the client row with
  // signature_url set. Used by the signing row to swap its icon to a
  // green check and show "تم التوقيع" under the buttons.
  const [clientSigned, setClientSigned] = useState(false);
  // True between firing SMS/WhatsApp and the realtime signal. Drives
  // the "في انتظار توقيع العميل..." hint under the row.
  const [signingWaiting, setSigningWaiting] = useState(false);

  const {
    locked: smsLocked,
    loading: smsLoading,
    openUpgradeDialog: openSmsUpgrade,
  } = useSmsLock();

  const cellKey = (row: RowKey, channel: ChannelKey) => `${row}:${channel}`;
  const setCell = (row: RowKey, channel: ChannelKey, state: ChannelState) =>
    setCellState((prev) => ({ ...prev, [cellKey(row, channel)]: state }));
  const getCell = (row: RowKey, channel: ChannelKey): ChannelState =>
    cellState[cellKey(row, channel)] || "idle";

  const hasReceipt = receiptPaymentIds.length > 0;

  // Resolve every policy id in the package — single policies get a
  // 1-item array. Used for transaction print/SMS/WhatsApp.
  const resolvePolicyIds = async (): Promise<string[]> => {
    if (!isPackage) return [policyId];
    const { data: mainPolicy } = await supabase
      .from("policies")
      .select("group_id")
      .eq("id", policyId)
      .single();
    const groupId = mainPolicy?.group_id;
    if (!groupId) return [policyId];
    const { data: groupPolicies } = await supabase
      .from("policies")
      .select("id")
      .eq("group_id", groupId);
    return groupPolicies?.map((p) => p.id) || [policyId];
  };

  // ─── Transaction actions ───────────────────────────────────────
  const handleTransactionPrint = async () => {
    setCell("transaction", "print", "loading");
    setErrorMessage(null);
    try {
      const ids = await resolvePolicyIds();
      const { data, error } = await supabase.functions.invoke(
        "send-package-invoice-sms",
        { body: { policy_ids: ids, skip_sms: true } },
      );
      if (error) {
        await toastFunctionError(error, "فشل في تحميل المعاملة");
        return;
      }
      if (data?.error) {
        toast.error(data.error);
        return;
      }
      const url =
        data?.package_invoice_url || data?.ab_invoice_url || data?.invoice_url;
      if (!url) {
        toast.error("لم يتم العثور على رابط المعاملة");
        return;
      }
      window.open(url, "_blank");
      toast.success("تم فتح المعاملة");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "فشل في تحميل المعاملة";
      setErrorMessage(msg);
      toast.error(msg);
    } finally {
      setCell("transaction", "print", "idle");
    }
  };

  const handleTransactionSms = async () => {
    if (!clientPhone) {
      toast.error("لا يوجد رقم هاتف للعميل");
      return;
    }
    if (smsLoading) return;
    if (smsLocked) {
      openSmsUpgrade();
      return;
    }

    setCell("transaction", "sms", "loading");
    setErrorMessage(null);
    try {
      const ids = await resolvePolicyIds();
      const { data, error } = await supabase.functions.invoke(
        "send-package-invoice-sms",
        { body: { policy_ids: ids } },
      );
      if (error) {
        await toastFunctionError(error, "فشل في إرسال SMS");
        setCell("transaction", "sms", "idle");
        return;
      }
      if (data?.error) {
        toast.error(data.error);
        setCell("transaction", "sms", "idle");
        return;
      }
      setCell("transaction", "sms", "sent");
      toast.success("تم إرسال المعاملة عبر SMS");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "فشل في إرسال SMS";
      setErrorMessage(msg);
      toast.error(msg);
      setCell("transaction", "sms", "idle");
    }
  };

  const handleTransactionWhatsapp = async () => {
    if (!clientPhone) {
      toast.error("لا يوجد رقم هاتف للعميل");
      return;
    }
    setCell("transaction", "whatsapp", "loading");
    setErrorMessage(null);
    try {
      const ids = await resolvePolicyIds();
      const { data, error } = await supabase.functions.invoke(
        "send-package-invoice-sms",
        { body: { policy_ids: ids, whatsapp_mode: true } },
      );
      if (error) {
        await toastFunctionError(error, "فشل في تجهيز رسالة واتساب");
        return;
      }
      if (data?.error) {
        toast.error(data.error);
        return;
      }
      const phone = data?.whatsapp_phone;
      const text = data?.message_text;
      if (!phone || !text) {
        toast.error("لم يتم تجهيز رسالة واتساب");
        return;
      }
      window.open(
        `https://wa.me/${phone}?text=${encodeURIComponent(text)}`,
        "_blank",
      );
      toast.success("تم فتح واتساب");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "فشل في تجهيز رسالة واتساب";
      setErrorMessage(msg);
      toast.error(msg);
    } finally {
      setCell("transaction", "whatsapp", "idle");
    }
  };

  // ─── Receipt actions ───────────────────────────────────────────
  const handleReceiptPrint = async () => {
    setCell("receipt", "print", "loading");
    setErrorMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke(
        "send-payment-receipt-sms",
        { body: { payment_ids: receiptPaymentIds, skip_sms: true } },
      );
      if (error) {
        await toastFunctionError(error, "فشل في تحميل سند القبض");
        return;
      }
      if (data?.error) {
        toast.error(data.error);
        return;
      }
      const url = data?.receipt_url;
      if (!url) {
        toast.error("لم يتم العثور على رابط السند");
        return;
      }
      // Stamp printed_at so سجل الدفعات locks "تعديل" on these rows —
      // mirrors the Receipts page print path. Best-effort, don't block
      // the open() on this update.
      await supabase
        .from("policy_payments")
        .update({ printed_at: new Date().toISOString() })
        .in("id", receiptPaymentIds)
        .is("printed_at", null);
      window.open(url, "_blank");
      toast.success("تم فتح سند القبض");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "فشل في تحميل سند القبض";
      setErrorMessage(msg);
      toast.error(msg);
    } finally {
      setCell("receipt", "print", "idle");
    }
  };

  const handleReceiptSms = async () => {
    if (!clientPhone) {
      toast.error("لا يوجد رقم هاتف للعميل");
      return;
    }
    if (smsLoading) return;
    if (smsLocked) {
      openSmsUpgrade();
      return;
    }

    setCell("receipt", "sms", "loading");
    setErrorMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke(
        "send-payment-receipt-sms",
        { body: { payment_ids: receiptPaymentIds } },
      );
      if (error) {
        await toastFunctionError(error, "فشل في إرسال SMS");
        setCell("receipt", "sms", "idle");
        return;
      }
      if (data?.error) {
        toast.error(data.error);
        setCell("receipt", "sms", "idle");
        return;
      }
      setCell("receipt", "sms", "sent");
      toast.success("تم إرسال سند القبض عبر SMS");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "فشل في إرسال SMS";
      setErrorMessage(msg);
      toast.error(msg);
      setCell("receipt", "sms", "idle");
    }
  };

  const handleReceiptWhatsapp = async () => {
    if (!clientPhone) {
      toast.error("لا يوجد رقم هاتف للعميل");
      return;
    }
    setCell("receipt", "whatsapp", "loading");
    setErrorMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke(
        "send-payment-receipt-sms",
        { body: { payment_ids: receiptPaymentIds, whatsapp_mode: true } },
      );
      if (error) {
        await toastFunctionError(error, "فشل في تجهيز رسالة واتساب");
        return;
      }
      if (data?.error) {
        toast.error(data.error);
        return;
      }
      const phone = data?.whatsapp_phone;
      const text = data?.message_text;
      if (!phone || !text) {
        toast.error("لم يتم تجهيز رسالة واتساب");
        return;
      }
      window.open(
        `https://wa.me/${phone}?text=${encodeURIComponent(text)}`,
        "_blank",
      );
      toast.success("تم فتح واتساب");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "فشل في تجهيز رسالة واتساب";
      setErrorMessage(msg);
      toast.error(msg);
    } finally {
      setCell("receipt", "whatsapp", "idle");
    }
  };

  // ─── Signing actions ───────────────────────────────────────────
  // Mirrors SigningCheckDialog's send flow but lives here because
  // /subscription → الحساب lets agents defer the prompt from the
  // wizard to this post-save dialog. Two channels: SMS (same edge
  // function as before) and WhatsApp (whatsapp_mode → wa.me deep-link).
  const handleSigningSms = async () => {
    if (!clientPhone) {
      toast.error("لا يوجد رقم هاتف للعميل");
      return;
    }
    if (smsLoading) return;
    if (smsLocked) {
      openSmsUpgrade();
      return;
    }

    setCell("signing", "sms", "loading");
    setErrorMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke(
        "send-signature-sms",
        { body: { client_id: clientId } },
      );
      if (error) {
        const msg = await extractFunctionErrorMessage(error);
        throw new Error(msg || "فشل في إرسال طلب التوقيع");
      }
      if (data?.success === false) {
        // Edge function returns success:false when the client already
        // has a signature on file — surface as info, not error.
        toast.info(data.message || "العميل لديه توقيع مسبق");
        setClientSigned(true);
        setCell("signing", "sms", "idle");
        return;
      }
      setCell("signing", "sms", "sent");
      setSigningWaiting(true);
      toast.success(
        clientPhone
          ? `تم إرسال رابط التوقيع إلى ${clientPhone}`
          : "تم إرسال رابط التوقيع",
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "فشل في إرسال طلب التوقيع";
      setErrorMessage(msg);
      toast.error(msg);
      setCell("signing", "sms", "idle");
    }
  };

  const handleSigningWhatsapp = async () => {
    if (!clientPhone) {
      toast.error("لا يوجد رقم هاتف للعميل");
      return;
    }
    setCell("signing", "whatsapp", "loading");
    setErrorMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke(
        "send-signature-sms",
        { body: { client_id: clientId, whatsapp_mode: true } },
      );
      if (error) {
        const msg = await extractFunctionErrorMessage(error);
        throw new Error(msg || "فشل في تجهيز رسالة واتساب");
      }
      if (data?.success === false) {
        toast.info(data.message || "العميل لديه توقيع مسبق");
        setClientSigned(true);
        setCell("signing", "whatsapp", "idle");
        return;
      }
      const phone = data?.whatsapp_phone;
      const text = data?.message_text;
      if (!phone || !text) {
        toast.error("لم يتم تجهيز رسالة واتساب");
        setCell("signing", "whatsapp", "idle");
        return;
      }
      window.open(
        `https://wa.me/${phone}?text=${encodeURIComponent(text)}`,
        "_blank",
      );
      setCell("signing", "whatsapp", "sent");
      setSigningWaiting(true);
      toast.success("تم فتح واتساب");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "فشل في تجهيز رسالة واتساب";
      setErrorMessage(msg);
      toast.error(msg);
      setCell("signing", "whatsapp", "idle");
    }
  };

  // Realtime: detect the moment the client signs from the link we just
  // sent. Same pattern as SigningCheckDialog. Only subscribe when the
  // signing row is on screen — otherwise this dialog opens a channel
  // for every saved policy, signed or not.
  useEffect(() => {
    if (!open || !showSigningRow || !clientId || clientSigned) return;

    const channel = supabase
      .channel(`policy-success-signing-${clientId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "clients",
          filter: `id=eq.${clientId}`,
        },
        (payload) => {
          const updated = payload.new as { signature_url?: string | null };
          if (updated.signature_url) {
            setClientSigned(true);
            setSigningWaiting(false);
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [open, showSigningRow, clientId, clientSigned]);

  // ─── Close ─────────────────────────────────────────────────────
  const handleClose = () => {
    setErrorMessage(null);
    setCellState({});
    setActiveRow(null);
    setClientSigned(false);
    setSigningWaiting(false);
    onOpenChange(false);
    onClose();
  };

  const anyLoading = Object.values(cellState).some((s) => s === "loading");

  const toggleRow = (row: RowKey) =>
    setActiveRow((prev) => (prev === row ? null : row));

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="max-w-md w-[95vw] p-0 overflow-hidden" dir="rtl">
        {/* Hero header */}
        <div className="text-white p-5 hero-gradient">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <div className="flex-1 min-w-0">
                <DialogTitle className="text-lg font-bold text-white text-right">
                  {hideReceiptSection ? 'طباعة أو إرسال المعاملة' : 'تم إنشاء المعاملة بنجاح'}
                </DialogTitle>
                <p className="text-xs text-white/70 mt-0.5">
                  {hideReceiptSection
                    ? 'تفاصيل البوليصة الكاملة للعميل'
                    : 'يمكنك طباعة أو إرسال المعاملة وسند القبض للعميل'}
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

          <TooltipProvider delayDuration={200}>
            {/* Transaction row */}
            <RowBlock
              row="transaction"
              icon={<FileText className="h-6 w-6 text-emerald-600" />}
              iconBg="bg-emerald-500/10"
              active={activeRow === "transaction"}
              onToggle={() => toggleRow("transaction")}
              channelStates={{
                print: getCell("transaction", "print"),
                sms: getCell("transaction", "sms"),
                whatsapp: getCell("transaction", "whatsapp"),
              }}
              onPrint={handleTransactionPrint}
              onSms={handleTransactionSms}
              onWhatsapp={handleTransactionWhatsapp}
              hasPhone={!!clientPhone}
              smsLocked={smsLocked}
            />

            {/* Receipt row — always shown so the user knows the option
                exists. When there's no non-mandatory payment (hasReceipt
                is false) the row stays disabled and surfaces a hint
                explaining the gate, instead of disappearing.
                Skipped entirely when `hideReceiptSection` is set —
                the accounting page's "open by معاملة" flow opens
                only the policy section. */}
            {!hideReceiptSection && (
              <RowBlock
                row="receipt"
                icon={<Receipt className="h-6 w-6 text-blue-600" />}
                iconBg="bg-blue-500/10"
                active={activeRow === "receipt"}
                onToggle={() => toggleRow("receipt")}
                channelStates={{
                  print: getCell("receipt", "print"),
                  sms: getCell("receipt", "sms"),
                  whatsapp: getCell("receipt", "whatsapp"),
                }}
                onPrint={handleReceiptPrint}
                onSms={handleReceiptSms}
                onWhatsapp={handleReceiptWhatsapp}
                hasPhone={!!clientPhone}
                smsLocked={smsLocked}
                disabled={!hasReceipt}
                disabledHint="متاح فقط عند وجود دفعة غير الإلزامي"
              />
            )}

            {/* Signing row — only when the agent set
                signing_check_timing='on_completion' AND the client
                doesn't already have a signature on file. The wizard
                computes that and passes showSigningRow. Once the
                realtime channel observes signature_url set, the row
                badge flips to green and the buttons disable. */}
            {showSigningRow && (
              <RowBlock
                row="signing"
                icon={
                  clientSigned ? (
                    <CheckCircle2 className="h-6 w-6 text-emerald-600" />
                  ) : (
                    <FileSignature className="h-6 w-6 text-amber-600" />
                  )
                }
                iconBg={clientSigned ? "bg-emerald-500/10" : "bg-amber-500/10"}
                active={activeRow === "signing"}
                onToggle={() => toggleRow("signing")}
                channelStates={{
                  // Print is hidden for this row, but the type forces
                  // a value — "idle" is harmless since the button
                  // never renders.
                  print: "idle",
                  sms: getCell("signing", "sms"),
                  whatsapp: getCell("signing", "whatsapp"),
                }}
                onPrint={() => {}}
                onSms={handleSigningSms}
                onWhatsapp={handleSigningWhatsapp}
                hasPhone={!!clientPhone}
                smsLocked={smsLocked}
                hidePrint
                disabled={clientSigned}
                disabledHint={clientSigned ? "تم التوقيع بنجاح" : undefined}
                belowPanel={
                  signingWaiting && !clientSigned ? (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-center">
                      في انتظار توقيع العميل... ستظهر علامة خضراء فور إتمام التوقيع.
                    </p>
                  ) : null
                }
              />
            )}
          </TooltipProvider>

          {/* Close */}
          <Button
            variant="outline"
            className="w-full gap-2 mt-1"
            onClick={handleClose}
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

// ───────────────────────────────────────────────────────────────────

interface RowBlockProps {
  row: RowKey;
  icon: React.ReactNode;
  iconBg: string;
  active: boolean;
  onToggle: () => void;
  channelStates: Record<ChannelKey, ChannelState>;
  onPrint: () => void;
  onSms: () => void;
  onWhatsapp: () => void;
  hasPhone: boolean;
  smsLocked: boolean;
  /** Locks the row entirely — main button can't expand its panel and a
   *  small hint takes the place of the panel below. Used for سند القبض
   *  when the user added no payment beyond the auto-mandatory row, and
   *  for the signing row after the client signs. */
  disabled?: boolean;
  /** Text shown under the disabled main button explaining the gate. */
  disabledHint?: string;
  /** Skip rendering the Print channel button. Used by the signing row,
   *  which only ships SMS + WhatsApp (no print equivalent for a
   *  signature request). */
  hidePrint?: boolean;
  /** Extra slot rendered below the action panel (between panel and
   *  main row button). Used by the signing row to show "في انتظار
   *  توقيع العميل..." after SMS/WhatsApp fires. */
  belowPanel?: React.ReactNode;
}

function RowBlock({
  row,
  icon,
  iconBg,
  active,
  onToggle,
  channelStates,
  onPrint,
  onSms,
  onWhatsapp,
  hasPhone,
  smsLocked,
  disabled,
  disabledHint,
  hidePrint,
  belowPanel,
}: RowBlockProps) {
  const labels = ROW_LABELS[row];
  const expanded = active && !disabled;

  return (
    <div className="space-y-2">
      {/* Action panel — collapses both height and opacity so the
          row above slides up cleanly when the panel closes. Hidden
          entirely when the row is disabled. */}
      <div
        className={cn(
          "overflow-hidden transition-all duration-200 ease-out",
          expanded ? "max-h-24 opacity-100" : "max-h-0 opacity-0",
        )}
      >
        <div className="flex items-center justify-center gap-2 p-2 bg-muted/40 border border-border/60 rounded-xl">
          {!hidePrint && (
            <ChannelButton
              label="طباعة"
              state={channelStates.print}
              onClick={onPrint}
              icon={<Printer className="h-5 w-5" />}
              colorIdle="text-emerald-600"
            />
          )}
          <ChannelButton
            label={hasPhone ? "إرسال SMS" : "لا يوجد رقم هاتف"}
            state={channelStates.sms}
            disabled={!hasPhone}
            locked={smsLocked}
            onClick={onSms}
            icon={<MessageSquare className="h-5 w-5" />}
            colorIdle="text-blue-600"
          />
          <ChannelButton
            label={hasPhone ? "إرسال واتساب" : "لا يوجد رقم هاتف"}
            state={channelStates.whatsapp}
            disabled={!hasPhone}
            onClick={onWhatsapp}
            icon={<WhatsappLogo className="h-5 w-5" weight="fill" />}
            colorIdle="text-green-600"
          />
        </div>
      </div>

      {/* Main row button */}
      <button
        type="button"
        onClick={disabled ? undefined : onToggle}
        disabled={disabled}
        className={cn(
          "w-full p-4 rounded-xl border-2 transition-all duration-200 text-right flex items-center gap-4",
          disabled
            ? "border-border/50 bg-muted/30 cursor-not-allowed opacity-60"
            : active
            ? "border-primary/60 bg-primary/5"
            : "border-border hover:border-primary/50 hover:bg-primary/5",
        )}
      >
        <div
          className={cn(
            "w-12 h-12 rounded-xl flex items-center justify-center shrink-0",
            iconBg,
          )}
        >
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-base">{labels.title}</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="inline-flex items-center justify-center w-4 h-4 text-muted-foreground/70 hover:text-foreground cursor-help"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Info className="h-3.5 w-3.5" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[260px] text-right">
                {labels.tooltip}
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="text-sm text-muted-foreground">{labels.desc}</div>
        </div>
      </button>

      {/* Below-panel slot — rendered unconditionally below the main
          button so e.g. the signing row's "waiting" hint stays visible
          after the user collapses the action panel. */}
      {belowPanel}

      {/* Hint shown only when the row is gated. Sits directly under the
          button so the user can read why the action is unavailable. */}
      {disabled && disabledHint && (
        <p className="text-xs text-muted-foreground text-right px-1">
          {disabledHint}
        </p>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────

interface ChannelButtonProps {
  label: string;
  state: ChannelState;
  onClick: () => void;
  icon: React.ReactNode;
  colorIdle: string;
  disabled?: boolean;
  locked?: boolean;
}

function ChannelButton({
  label,
  state,
  onClick,
  icon,
  colorIdle,
  disabled,
  locked,
}: ChannelButtonProps) {
  const isLoading = state === "loading";
  const isSent = state === "sent";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled || isLoading || isSent}
          className={cn(
            "relative flex-1 h-12 rounded-lg border border-border/60 bg-background",
            "transition-all duration-150 hover:scale-105 hover:shadow-sm",
            "flex items-center justify-center",
            "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:shadow-none",
            !disabled && !isLoading && !isSent && colorIdle,
            isSent && "text-emerald-600 bg-emerald-50 border-emerald-200",
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
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
