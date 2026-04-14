import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Banknote,
  CreditCard,
  Wallet,
  AlertCircle,
  ReceiptText,
  Printer,
  Loader2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getCombinedPaymentTypeLabel, getPaymentTypeLabel } from "@/lib/paymentLabels";

interface PaymentRecord {
  id: string;
  amount: number;
  payment_date: string;
  payment_type: string;
  cheque_number: string | null;
  card_last_four: string | null;
  refused: boolean | null;
  locked: boolean | null;
  notes: string | null;
  policy: {
    id: string;
    policy_type_parent: string;
    insurance_price: number;
  } | null;
}

interface GroupedPayment {
  id: string;
  totalAmount: number;
  payment_date: string;
  payment_type: string;
  paymentTypes: string[];
  cheque_number: string | null;
  refused: boolean | null;
  notes: string | null;
  payments: PaymentRecord[];
  policyTypes: string[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: GroupedPayment | null;
}

const paymentTypeIcon: Record<string, typeof Banknote> = {
  cash: Banknote,
  cheque: CreditCard,
  visa: CreditCard,
  transfer: Wallet,
};

const paymentTypeBg: Record<string, string> = {
  cash: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  cheque: "bg-blue-500/10 text-blue-700 border-blue-500/30",
  visa: "bg-purple-500/10 text-purple-700 border-purple-500/30",
  transfer: "bg-amber-500/10 text-amber-700 border-amber-500/30",
};

const formatDate = (dateStr: string | null) => {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("en-GB");
};

export function PaymentGroupDetailsDialog({ open, onOpenChange, group }: Props) {
  const [printing, setPrinting] = useState(false);
  if (!group) return null;

  const combinedTypeLabel = getCombinedPaymentTypeLabel(
    group.payments.length > 0
      ? group.payments
      : [{ payment_type: group.payment_type, locked: null }],
  );

  const handlePrint = async () => {
    if (group.payments.length === 0) return;
    setPrinting(true);
    try {
      const ids = group.payments.map((p) => p.id);
      const fn = ids.length > 1 ? 'generate-bulk-payment-receipt' : 'generate-payment-receipt';
      const body = ids.length > 1 ? { payment_ids: ids } : { payment_id: ids[0] };
      const { data, error } = await supabase.functions.invoke(fn, { body });
      if (error) throw error;
      const url = data?.receipt_url;
      if (url) {
        window.open(url, '_blank');
      } else {
        toast.error('لم يتم العثور على رابط السند');
      }
    } catch (e) {
      console.error('Print receipts error:', e);
      toast.error('فشل في توليد السندات');
    } finally {
      setPrinting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl w-[95vw] max-h-[90vh] overflow-y-auto p-0" dir="rtl">
        {/* Header */}
        <div
          className="sticky top-0 z-10 text-white p-4 rounded-t-lg"
          style={{ background: "linear-gradient(135deg, #122143 0%, #1a3260 100%)" }}
        >
          <DialogHeader>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
                  <ReceiptText className="h-5 w-5" />
                </div>
                <div>
                  <DialogTitle className="text-lg font-bold text-white text-right">
                    تفاصيل الدفعة
                  </DialogTitle>
                  <p className="text-xs text-white/70">
                    {combinedTypeLabel} · ₪{group.totalAmount.toLocaleString("en-US")} ·{" "}
                    {formatDate(group.payment_date)}
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                onClick={handlePrint}
                disabled={printing}
                className="gap-1.5 bg-white/20 hover:bg-white/30 text-white border-0 shrink-0"
              >
                {printing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Printer className="h-4 w-4" />
                )}
                <span className="hidden sm:inline">
                  {group.payments.length > 1 ? 'طباعة السندات' : 'طباعة السند'}
                </span>
              </Button>
            </div>
          </DialogHeader>
        </div>

        {/* Body — one card per underlying payment row */}
        <div className="p-4 space-y-3">
          {group.payments.map((p) => {
            const Icon = paymentTypeIcon[p.payment_type] || Banknote;
            const typeBg = paymentTypeBg[p.payment_type] || "bg-muted text-muted-foreground border-border";
            return (
              <div
                key={p.id}
                className={cn(
                  "rounded-xl border-2 bg-card overflow-hidden",
                  p.refused
                    ? "border-destructive/40 bg-destructive/5"
                    : "border-border/60",
                )}
              >
                <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border/60 bg-muted/30">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={cn(
                        "w-9 h-9 rounded-lg border flex items-center justify-center shrink-0",
                        typeBg,
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-lg ltr-nums text-foreground">
                          ₪{Number(p.amount || 0).toLocaleString("en-US")}
                        </span>
                        <Badge variant="outline" className={cn("text-[10px]", typeBg)}>
                          {getPaymentTypeLabel(p)}
                        </Badge>
                        {p.refused && (
                          <Badge variant="destructive" className="text-[10px] gap-1">
                            <AlertCircle className="h-3 w-3" />
                            مرفوضة
                          </Badge>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground ltr-nums mt-0.5">
                        {formatDate(p.payment_date)}
                      </p>
                    </div>
                  </div>
                </div>
                {(p.cheque_number || p.card_last_four || p.notes) && (
                  <div className="px-4 py-3 space-y-1 text-xs">
                    {p.cheque_number && (
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">رقم الشيك:</span>
                        <span className="font-mono font-semibold">{p.cheque_number}</span>
                      </div>
                    )}
                    {p.card_last_four && (
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">البطاقة:</span>
                        <span className="font-mono font-semibold">•••• {p.card_last_four}</span>
                      </div>
                    )}
                    {p.notes && (
                      <p className="text-muted-foreground">{p.notes}</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
