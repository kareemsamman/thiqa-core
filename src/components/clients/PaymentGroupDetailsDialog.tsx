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
  FileText,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getCombinedPaymentTypeLabel, getPaymentTypeLabel } from "@/lib/paymentLabels";
import { FilePreviewGallery } from "@/components/policies/FilePreviewGallery";

export interface PaymentRecord {
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

        {/* Body — every payment row renders as a wide single-line card
            with columns for icon / amount / badges / meta / files / actions.
            Details like cheque# and notes live in a secondary row under
            the main line so the layout stays readable instead of cramming
            everything into one horizontal strip. */}
        <div className="p-4 space-y-2.5 bg-muted/20">
          {group.payments.map((p) => {
            const Icon = paymentTypeIcon[p.payment_type] || Banknote;
            const typeBg = paymentTypeBg[p.payment_type] || "bg-muted text-muted-foreground border-border";
            const attachments = imagesByPayment[p.id] || [];
            const hasDetails = p.cheque_number || p.card_last_four || p.notes || attachments.length > 0;
            return (
              <div
                key={p.id}
                className={cn(
                  "rounded-xl border bg-card shadow-sm transition-colors",
                  p.refused
                    ? "border-destructive/40 bg-destructive/5"
                    : "border-border/60 hover:border-border",
                )}
              >
                {/* Primary row */}
                <div className="flex items-center gap-4 px-4 py-3">
                  {/* Icon */}
                  <div
                    className={cn(
                      "w-11 h-11 rounded-xl border-2 flex items-center justify-center shrink-0",
                      typeBg,
                    )}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  {/* Amount + type badge */}
                  <div className="flex flex-col gap-1 shrink-0 min-w-[140px]">
                    <span className="font-bold text-xl ltr-nums text-foreground leading-none">
                      ₪{Number(p.amount || 0).toLocaleString("en-US")}
                    </span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge variant="outline" className={cn("text-[10px] h-5 px-2 font-semibold", typeBg)}>
                        {getPaymentTypeLabel(p)}
                      </Badge>
                      {p.refused && (
                        <Badge variant="destructive" className="text-[10px] h-5 px-2 gap-0.5">
                          <AlertCircle className="h-3 w-3" />
                          مرفوضة
                        </Badge>
                      )}
                    </div>
                  </div>
                  {/* Divider */}
                  <div className="h-10 w-px bg-border/70 shrink-0" />
                  {/* Meta (date + cheque# or card inline) */}
                  <div className="flex-1 min-w-0 flex items-center gap-4 flex-wrap text-xs">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <span className="text-[10px] uppercase tracking-wide">التاريخ</span>
                      <span className="font-semibold text-foreground ltr-nums">
                        {formatDate(p.payment_date)}
                      </span>
                    </div>
                    {p.cheque_number && (
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <span className="text-[10px] uppercase tracking-wide">رقم الشيك</span>
                        <span className="font-mono font-semibold text-foreground ltr-nums">
                          {p.cheque_number}
                        </span>
                      </div>
                    )}
                    {p.card_last_four && (
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <span className="text-[10px] uppercase tracking-wide">البطاقة</span>
                        <span className="font-mono font-semibold text-foreground ltr-nums">
                          •••• {p.card_last_four}
                        </span>
                      </div>
                    )}
                  </div>
                  {/* Attachments count chip */}
                  {attachments.length > 0 && (
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground bg-muted/60 rounded-full px-2.5 py-1 shrink-0">
                      <ImageIcon className="h-3 w-3" />
                      <span>{attachments.length} ملف</span>
                    </div>
                  )}
                  {/* Actions */}
                  {(onEdit || onDelete) && (
                    <div className="flex items-center gap-1 shrink-0 border-r border-border/60 pr-3">
                      {onEdit && !p.locked && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => handleEditClick(p)}
                          title="تعديل"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                      {onDelete && !p.locked && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive hover:bg-destructive/10"
                          onClick={() => handleDeleteClick(p)}
                          title="حذف"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  )}
                </div>
                {/* Secondary row — notes + thumbnails when present */}
                {hasDetails && (p.notes || attachments.length > 0) && (
                  <div className="px-4 pb-3 pt-0 border-t border-border/40 mt-0 flex items-start gap-4 flex-wrap bg-muted/10">
                    {p.notes && (
                      <p className="text-xs text-muted-foreground leading-relaxed pt-2.5 flex-1 min-w-[160px]">
                        {p.notes}
                      </p>
                    )}
                    {attachments.length > 0 && (
                      <div className="pt-2.5 flex flex-wrap gap-1.5">
                        {attachments.map((img) => {
                          const isPdf = img.image_url.toLowerCase().endsWith('.pdf');
                          return (
                            <button
                              key={img.id}
                              type="button"
                              onClick={() => setGalleryFile(buildGalleryFile(img))}
                              className="relative w-14 h-14 rounded-lg overflow-hidden border border-border hover:border-primary transition-colors bg-background flex items-center justify-center shrink-0"
                              title={img.image_type || 'مرفق'}
                            >
                              {isPdf ? (
                                <div className="flex flex-col items-center justify-center gap-0.5">
                                  <FileText className="h-5 w-5 text-red-500" />
                                  <span className="text-[9px] font-bold text-red-500">PDF</span>
                                </div>
                              ) : (
                                <img src={img.image_url} alt={img.image_type || ''} className="w-full h-full object-cover" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
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
