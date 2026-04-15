import { useEffect, useState } from "react";
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
  ImageIcon,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getCombinedPaymentTypeLabel, getPaymentTypeLabel } from "@/lib/paymentLabels";
import { FilePreviewGallery } from "@/components/policies/FilePreviewGallery";
import { getBankName } from "@/lib/banks";

export interface PaymentRecord {
  id: string;
  amount: number;
  payment_date: string;
  payment_type: string;
  cheque_number: string | null;
  cheque_date?: string | null;
  bank_code?: string | null;
  branch_code?: string | null;
  card_last_four: string | null;
  refused: boolean | null;
  locked: boolean | null;
  notes: string | null;
  policy: {
    id: string;
    policy_type_parent: string;
    insurance_price: number;
    office_commission?: number | null;
  } | null;
}

export interface GroupedPayment {
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
  // Optional CRUD hooks — when provided, each payment card gets
  // pencil/trash icon buttons. The dialog closes before calling the
  // handler so the parent can open its own edit/confirm dialog on top
  // without z-index fights.
  onEdit?: (payment: PaymentRecord) => void;
  onDelete?: (payment: PaymentRecord) => void;
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

interface GalleryFile {
  id: string;
  original_name: string;
  cdn_url: string;
  mime_type: string;
  size: number;
  created_at: string;
  entity_type: string | null;
}

const buildGalleryFile = (
  img: { id: string; image_url: string; image_type: string | null },
): GalleryFile => {
  const isPdf = img.image_url.toLowerCase().endsWith('.pdf');
  const tail = img.image_url.split('/').pop() || (isPdf ? 'ملف.pdf' : 'صورة');
  return {
    id: img.id,
    original_name: tail,
    cdn_url: img.image_url,
    mime_type: isPdf ? 'application/pdf' : 'image/jpeg',
    size: 0,
    created_at: new Date().toISOString(),
    entity_type: null,
  };
};

export function PaymentGroupDetailsDialog({
  open,
  onOpenChange,
  group,
  onEdit,
  onDelete,
}: Props) {
  const [printing, setPrinting] = useState(false);
  const [imagesByPayment, setImagesByPayment] = useState<Record<string, { id: string; image_url: string; image_type: string | null }[]>>({});
  const [galleryFile, setGalleryFile] = useState<GalleryFile | null>(null);

  const handleEditClick = (p: PaymentRecord) => {
    onOpenChange(false);
    onEdit?.(p);
  };

  const handleDeleteClick = (p: PaymentRecord) => {
    onOpenChange(false);
    onDelete?.(p);
  };

  // Fetch payment_images for every payment in the group whenever the
  // dialog opens so the user can see receipts / cheque scans / whatever
  // they uploaded at payment time.
  useEffect(() => {
    if (!open || !group) {
      setImagesByPayment({});
      return;
    }
    const paymentIds = group.payments.map((p) => p.id);
    if (paymentIds.length === 0) return;
    (async () => {
      try {
        const { data } = await supabase
          .from("payment_images")
          .select("id, payment_id, image_url, image_type")
          .in("payment_id", paymentIds);
        const map: Record<string, { id: string; image_url: string; image_type: string | null }[]> = {};
        (data || []).forEach((img: any) => {
          const arr = map[img.payment_id] || [];
          arr.push({ id: img.id, image_url: img.image_url, image_type: img.image_type });
          map[img.payment_id] = arr;
        });
        setImagesByPayment(map);
      } catch (e) {
        console.error("[PaymentGroupDetailsDialog] images fetch error:", e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, group?.id, group?.payments.map((p) => p.id).join(",")]);

  if (!group) return null;

  const combinedTypeLabel = getCombinedPaymentTypeLabel(
    group.payments.length > 0
      ? group.payments
      : [{ payment_type: group.payment_type, locked: null }],
  );

  // Flatten all attachments across payments so the gallery can navigate
  // between every file in the whole group, not just within one payment.
  const allGalleryFiles: GalleryFile[] = group.payments.flatMap((p) =>
    (imagesByPayment[p.id] || []).map(buildGalleryFile),
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
    } catch (e: any) {
      console.error('Print receipts error:', e);
      // supabase-js wraps non-2xx edge function responses as
      // FunctionsHttpError with the raw Response on .context. Peel it
      // open so the toast shows the function's actual error instead of
      // the generic "non-2xx status code" message.
      let detail = '';
      try {
        if (e?.context && typeof e.context.clone === 'function') {
          const body = await e.context.clone().json();
          detail = body?.error || body?.message || '';
        }
      } catch {}
      if (!detail) detail = e?.message || '';
      console.error('Print receipts detail:', detail);
      toast.error(detail ? `فشل في توليد السندات: ${detail}` : 'فشل في توليد السندات');
    } finally {
      setPrinting(false);
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[95vw] max-h-[90vh] overflow-y-auto p-0" dir="rtl">
        {/* Header */}
        <div
          className="sticky top-0 z-10 text-white px-5 py-4 rounded-t-lg"
          style={{ background: "linear-gradient(135deg, #122143 0%, #1a3260 100%)" }}
        >
          <DialogHeader>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-white/15 backdrop-blur-sm flex items-center justify-center shrink-0">
                  <ReceiptText className="h-5 w-5" />
                </div>
                <div>
                  <DialogTitle className="text-lg font-bold text-white text-right leading-tight">
                    تفاصيل الدفعة
                  </DialogTitle>
                  <div className="flex items-center gap-2 mt-1 text-xs text-white/75">
                    <span className="font-semibold">{combinedTypeLabel}</span>
                    <span className="text-white/40">•</span>
                    <span className="font-bold ltr-nums">₪{group.totalAmount.toLocaleString("en-US")}</span>
                    <span className="text-white/40">•</span>
                    <span className="ltr-nums">{formatDate(group.payment_date)}</span>
                    <span className="text-white/40">•</span>
                    <span className="bg-white/15 rounded-full px-2 py-0.5 text-[10px] font-semibold">
                      {group.payments.length} {group.payments.length === 1 ? 'سند' : 'سندات'}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  onClick={handlePrint}
                  disabled={printing}
                  className="h-9 gap-2 bg-white/15 hover:bg-white/25 text-white border-0 px-3"
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
                <Button
                  size="icon"
                  onClick={() => onOpenChange(false)}
                  className="h-9 w-9 bg-white/10 hover:bg-white/20 text-white border-0"
                  aria-label="إغلاق"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </DialogHeader>
        </div>

        {/* Body — one row per payment in a real HTML table. Every row has
            the same height so the dialog reads like a ledger, not a stack
            of variable-size cards. Notes and attachments hang off the row
            as a thin sub-row (only when present) to avoid height churn. */}
        <div className="p-4 bg-muted/20">
          <div className="overflow-x-auto rounded-lg border border-border/60 bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b border-border/60">
                <tr>
                  <th className="text-center w-10 px-2 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">#</th>
                  <th className="text-right px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">طريقة الدفع</th>
                  <th className="text-right px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">التفاصيل</th>
                  <th className="text-right px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">التواريخ</th>
                  <th className="text-left px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide min-w-[110px]">المبلغ</th>
                  <th className="text-right px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide min-w-[140px]">ملاحظات</th>
                  <th className="text-center px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide w-20">المرفقات</th>
                  {(onEdit || onDelete) && (
                    <th className="text-center px-2 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide w-20">إجراءات</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {group.payments.map((p, idx) => {
                  const Icon = paymentTypeIcon[p.payment_type] || Banknote;
                  const typeBg = paymentTypeBg[p.payment_type] || "bg-muted text-muted-foreground border-border";
                  const attachments = imagesByPayment[p.id] || [];
                  return (
                    <tr
                      key={p.id}
                      className={cn(
                        "border-b border-border/40 last:border-b-0 transition-colors",
                        p.refused
                          ? "bg-destructive/5 hover:bg-destructive/10"
                          : "hover:bg-muted/30",
                      )}
                    >
                        {/* # */}
                        <td className="px-2 py-3 text-center text-[11px] font-bold text-muted-foreground ltr-nums align-middle">
                          {idx + 1}
                        </td>

                        {/* Payment method + refused tag */}
                        <td className="px-3 py-3 align-middle">
                          <div className="flex items-center gap-2">
                            <div className={cn("w-8 h-8 rounded-lg border flex items-center justify-center shrink-0", typeBg)}>
                              <Icon className="h-4 w-4" />
                            </div>
                            <div className="flex flex-col gap-0.5 min-w-0">
                              <span className="text-xs font-semibold truncate">
                                {getPaymentTypeLabel(p)}
                              </span>
                              {p.refused && (
                                <Badge variant="destructive" className="text-[9px] h-4 px-1.5 gap-0.5 w-fit">
                                  <AlertCircle className="h-2.5 w-2.5" />
                                  مرفوضة
                                </Badge>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Details (cheque# + bank/branch, or card last 4, else dash) */}
                        <td className="px-3 py-3 align-middle">
                          {p.cheque_number ? (
                            <div className="flex flex-col gap-1">
                              <div className="flex flex-col gap-0.5">
                                <span className="text-[9px] text-muted-foreground uppercase tracking-wide">رقم الشيك</span>
                                <span className="font-mono text-xs font-semibold ltr-nums">{p.cheque_number}</span>
                              </div>
                              {(p.bank_code || p.branch_code) && (
                                <div className="flex flex-col gap-0.5">
                                  <span className="text-[9px] text-muted-foreground uppercase tracking-wide">البنك والفرع</span>
                                  <span className="text-xs font-semibold text-foreground">
                                    {getBankName(p.bank_code) || '—'}
                                    {p.branch_code && (
                                      <span className="text-muted-foreground font-mono ltr-nums"> · {p.branch_code}</span>
                                    )}
                                  </span>
                                </div>
                              )}
                            </div>
                          ) : p.card_last_four ? (
                            <div className="flex flex-col gap-0.5">
                              <span className="text-[9px] text-muted-foreground uppercase tracking-wide">البطاقة</span>
                              <span className="font-mono text-xs font-semibold ltr-nums">•••• {p.card_last_four}</span>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>

                        {/* Dates — for cheque rows the `payment_date` column
                            is repurposed as the due date (that's how the
                            backend already stores it), so label it
                            accordingly. For non-cheque rows the same
                            column is the actual receipt date. */}
                        <td className="px-3 py-3 align-middle">
                          <div className="flex flex-col gap-0.5">
                            {p.payment_type === 'cheque' && p.cheque_date && (
                              <div className="flex items-center gap-1.5">
                                <span className="text-[9px] text-muted-foreground uppercase tracking-wide">الإصدار</span>
                                <span className="text-xs font-semibold ltr-nums">{formatDate(p.cheque_date)}</span>
                              </div>
                            )}
                            <div className="flex items-center gap-1.5">
                              <span className="text-[9px] text-muted-foreground uppercase tracking-wide">
                                {p.payment_type === 'cheque' ? 'الاستحقاق' : 'التاريخ'}
                              </span>
                              <span className="text-xs font-semibold ltr-nums">{formatDate(p.payment_date)}</span>
                            </div>
                          </div>
                        </td>

                        {/* Amount */}
                        <td className="px-3 py-3 align-middle text-left">
                          <span className="font-bold text-sm ltr-nums text-foreground">
                            ₪{Number(p.amount || 0).toLocaleString("en-US")}
                          </span>
                        </td>

                        {/* Notes — own column so the table stays fixed-
                            height; long notes wrap, empty notes render
                            an em dash. */}
                        <td className="px-3 py-3 align-middle">
                          {p.notes ? (
                            <p className="text-xs text-foreground leading-relaxed whitespace-pre-wrap break-words max-w-[220px]">
                              {p.notes}
                            </p>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>

                        {/* Attachments — clickable count chip that opens the first file */}
                        <td className="px-3 py-3 align-middle text-center">
                          {attachments.length > 0 ? (
                            <button
                              type="button"
                              onClick={() => setGalleryFile(buildGalleryFile(attachments[0]))}
                              className="inline-flex items-center gap-1 text-[11px] text-primary hover:text-primary/80 bg-primary/10 hover:bg-primary/20 rounded-full px-2 py-0.5 transition-colors"
                              title={`${attachments.length} مرفق`}
                            >
                              <ImageIcon className="h-3 w-3" />
                              <span className="ltr-nums">{attachments.length}</span>
                            </button>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>

                        {/* Actions */}
                        {(onEdit || onDelete) && (
                          <td className="px-2 py-3 align-middle">
                            <div className="flex items-center justify-center gap-0.5">
                              {onEdit && !p.locked && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7"
                                  onClick={() => handleEditClick(p)}
                                  title="تعديل"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                              )}
                              {onDelete && !p.locked && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7 text-destructive hover:bg-destructive/10"
                                  onClick={() => handleDeleteClick(p)}
                                  title="حذف"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                  );
                })}
              </tbody>
              {/* Footer: running totals. Commission is computed once per
                  unique policy in the group (each policy's office_commission
                  is added once even if multiple payments reference it) and
                  only rendered when at least one policy carries a non-zero
                  commission. Total is the sum of non-refused payment amounts
                  so the user sees what actually landed in the till. */}
              {(() => {
                const totalPaid = group.payments
                  .filter((p) => !p.refused)
                  .reduce((s, p) => s + (p.amount || 0), 0);
                const uniquePolicies = new Map<string, number>();
                for (const p of group.payments) {
                  if (!p.policy?.id) continue;
                  const commission = Number(p.policy.office_commission) || 0;
                  if (commission > 0 && !uniquePolicies.has(p.policy.id)) {
                    uniquePolicies.set(p.policy.id, commission);
                  }
                }
                const totalCommission = Array.from(uniquePolicies.values()).reduce(
                  (s, c) => s + c,
                  0,
                );
                const colSpan = onEdit || onDelete ? 7 : 6;
                return (
                  <tfoot className="border-t-2 border-border/60 bg-muted/30">
                    {totalCommission > 0 && (
                      <tr>
                        <td
                          colSpan={colSpan - 3}
                          className="px-3 py-2.5 text-right text-xs font-semibold text-muted-foreground"
                        >
                          عمولة المكتب
                        </td>
                        <td className="px-3 py-2.5 text-left">
                          <span className="text-sm font-bold ltr-nums text-amber-700 dark:text-amber-400">
                            ₪{totalCommission.toLocaleString("en-US")}
                          </span>
                        </td>
                        <td colSpan={onEdit || onDelete ? 3 : 2} />
                      </tr>
                    )}
                    <tr>
                      <td
                        colSpan={colSpan - 3}
                        className="px-3 py-3 text-right text-sm font-bold"
                      >
                        المجموع
                      </td>
                      <td className="px-3 py-3 text-left">
                        <span className="text-base font-bold ltr-nums text-foreground">
                          ₪{totalPaid.toLocaleString("en-US")}
                        </span>
                      </td>
                      <td colSpan={onEdit || onDelete ? 3 : 2} />
                    </tr>
                  </tfoot>
                );
              })()}
            </table>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    <FilePreviewGallery
      file={galleryFile}
      allFiles={allGalleryFiles}
      onClose={() => setGalleryFile(null)}
      onNavigate={setGalleryFile}
    />
    </>
  );
}
