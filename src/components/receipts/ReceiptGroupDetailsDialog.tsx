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
  FileText,
  ReceiptText,
  Printer,
  Pencil,
  Trash2,
  X,
} from "lucide-react";

export interface ReceiptRow {
  id: string;
  receipt_number: string | null;
  client_name: string;
  car_number: string | null;
  amount: number;
  receipt_date: string;
  payment_method: string;
  cheque_number: string | null;
  notes: string | null;
  receipt_type: string;
  created_at: string;
}

export interface ReceiptGroupView {
  key: string;
  client_name: string;
  car_number: string | null;
  receipts: ReceiptRow[];
  total: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: ReceiptGroupView | null;
  onPrint: (group: ReceiptGroupView) => void;
  onEdit: (receipt: ReceiptRow) => void;
  onDelete: (receipt: ReceiptRow) => void;
}

const paymentIcon: Record<string, typeof Banknote> = {
  cash: Banknote,
  cheque: FileText,
  visa: CreditCard,
  transfer: Wallet,
};

const paymentLabel: Record<string, string> = {
  cash: "نقدي",
  cheque: "شيك",
  visa: "فيزا",
  transfer: "تحويل",
};

const paymentTint: Record<string, string> = {
  cash: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  cheque: "bg-blue-500/10 text-blue-700 border-blue-500/30",
  visa: "bg-purple-500/10 text-purple-700 border-purple-500/30",
  transfer: "bg-amber-500/10 text-amber-700 border-amber-500/30",
};

const formatDate = (value: string | null) => {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleDateString("en-GB");
  } catch {
    return value;
  }
};

export function ReceiptGroupDetailsDialog({
  open,
  onOpenChange,
  group,
  onPrint,
  onEdit,
  onDelete,
}: Props) {
  if (!group) return null;

  const combinedMethodLabel = Array.from(
    new Set(group.receipts.map((r) => paymentLabel[r.payment_method] || r.payment_method)),
  ).join(" + ");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl w-[95vw] max-h-[90vh] overflow-y-auto p-0"
        dir="rtl"
      >
        {/* Header — mirrors PaymentGroupDetailsDialog styling so the two
            popups feel like one family. */}
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
                    تفاصيل السندات
                  </DialogTitle>
                  <p className="text-xs text-white/70">
                    {combinedMethodLabel} · ₪{group.total.toLocaleString("en-US")} ·{" "}
                    {group.receipts.length}{" "}
                    {group.receipts.length === 1 ? "سند" : "سندات"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Button
                  size="sm"
                  onClick={() => onPrint(group)}
                  className="gap-1.5 bg-white/20 hover:bg-white/30 text-white border-0"
                >
                  <Printer className="h-4 w-4" />
                  <span className="hidden sm:inline">
                    {group.receipts.length > 1 ? "طباعة السندات" : "طباعة السند"}
                  </span>
                </Button>
                <Button
                  size="icon"
                  onClick={() => onOpenChange(false)}
                  className="h-8 w-8 bg-white/10 hover:bg-white/20 text-white border-0"
                  aria-label="إغلاق"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </DialogHeader>
        </div>

        {/* Body — one card per underlying receipt row */}
        <div className="p-4 space-y-3">
          {group.receipts.map((r) => {
            const Icon = paymentIcon[r.payment_method] || Banknote;
            const tint =
              paymentTint[r.payment_method] ||
              "bg-muted text-muted-foreground border-border";
            return (
              <div
                key={r.id}
                className="rounded-xl border-2 border-border/60 bg-card overflow-hidden"
              >
                <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border/60 bg-muted/30">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={cn(
                        "w-9 h-9 rounded-lg border flex items-center justify-center shrink-0",
                        tint,
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-lg ltr-nums text-foreground">
                          ₪{Number(r.amount || 0).toLocaleString("en-US")}
                        </span>
                        <Badge variant="outline" className={cn("text-[10px]", tint)}>
                          {paymentLabel[r.payment_method] || r.payment_method}
                        </Badge>
                        {r.receipt_number && (
                          <Badge variant="secondary" className="text-[10px] font-mono">
                            {r.receipt_number}
                          </Badge>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground ltr-nums mt-0.5">
                        {formatDate(r.receipt_date)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={() => onEdit(r)}
                      title="تعديل"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-destructive hover:bg-destructive/10"
                      onClick={() => onDelete(r)}
                      title="حذف"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                {(r.cheque_number || r.notes || r.car_number) && (
                  <div className="px-4 py-3 space-y-1.5 text-xs">
                    {r.car_number && (
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">رقم السيارة:</span>
                        <span className="font-semibold">{r.car_number}</span>
                      </div>
                    )}
                    {r.cheque_number && (
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">رقم الشيك:</span>
                        <span className="font-mono font-semibold">{r.cheque_number}</span>
                      </div>
                    )}
                    {r.notes && <p className="text-muted-foreground">{r.notes}</p>}
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
