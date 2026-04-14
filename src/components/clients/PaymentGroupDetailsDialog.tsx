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
      <DialogContent className="max-w-2xl w-[95vw] max-h-[90vh] overflow-y-auto p-0" dir="rtl">
        {/* Header */}
        <div
          className="sticky top-0 z-10 text-white px-3 py-2.5 rounded-t-lg"
          style={{ background: "linear-gradient(135deg, #122143 0%, #1a3260 100%)" }}
        >
          <DialogHeader>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                  <ReceiptText className="h-4 w-4" />
                </div>
                <div>
                  <DialogTitle className="text-base font-bold text-white text-right leading-tight">
                    تفاصيل الدفعة
                  </DialogTitle>
                  <p className="text-[11px] text-white/70 leading-tight mt-0.5">
                    {combinedTypeLabel} · ₪{group.totalAmount.toLocaleString("en-US")} ·{" "}
                    {formatDate(group.payment_date)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  size="sm"
                  onClick={handlePrint}
                  disabled={printing}
                  className="h-7 gap-1 bg-white/20 hover:bg-white/30 text-white border-0 text-xs px-2"
                >
                  {printing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Printer className="h-3.5 w-3.5" />
                  )}
                  <span className="hidden sm:inline">
                    {group.payments.length > 1 ? 'طباعة السندات' : 'طباعة السند'}
                  </span>
                </Button>
                <Button
                  size="icon"
                  onClick={() => onOpenChange(false)}
                  className="h-7 w-7 bg-white/10 hover:bg-white/20 text-white border-0"
                  aria-label="إغلاق"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </DialogHeader>
        </div>

        {/* Body — one card per underlying payment row */}
        <div className="p-2.5 space-y-2">
          {group.payments.map((p) => {
            const Icon = paymentTypeIcon[p.payment_type] || Banknote;
            const typeBg = paymentTypeBg[p.payment_type] || "bg-muted text-muted-foreground border-border";
            const hasBody = p.cheque_number || p.card_last_four || p.notes || (imagesByPayment[p.id]?.length ?? 0) > 0;
            return (
              <div
                key={p.id}
                className={cn(
                  "rounded-lg border bg-card overflow-hidden",
                  p.refused
                    ? "border-destructive/40 bg-destructive/5"
                    : "border-border/60",
                )}
              >
                <div className={cn(
                  "flex items-center justify-between gap-2 px-2.5 py-1.5 bg-muted/30",
                  hasBody && "border-b border-border/60",
                )}>
                  <div className="flex items-center gap-2 min-w-0">
                    <div
                      className={cn(
                        "w-7 h-7 rounded-md border flex items-center justify-center shrink-0",
                        typeBg,
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 leading-tight">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-bold text-sm ltr-nums text-foreground">
                          ₪{Number(p.amount || 0).toLocaleString("en-US")}
                        </span>
                        <Badge variant="outline" className={cn("text-[10px] h-4 px-1.5", typeBg)}>
                          {getPaymentTypeLabel(p)}
                        </Badge>
                        {p.refused && (
                          <Badge variant="destructive" className="text-[10px] h-4 px-1.5 gap-0.5">
                            <AlertCircle className="h-2.5 w-2.5" />
                            مرفوضة
                          </Badge>
                        )}
                        <span className="text-[10px] text-muted-foreground ltr-nums">
                          · {formatDate(p.payment_date)}
                        </span>
                      </div>
                    </div>
                  </div>
                  {(onEdit || onDelete) && (
                    <div className="flex items-center gap-0.5 shrink-0">
                      {onEdit && !p.locked && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          onClick={() => handleEditClick(p)}
                          title="تعديل"
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                      )}
                      {onDelete && !p.locked && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 text-destructive hover:bg-destructive/10"
                          onClick={() => handleDeleteClick(p)}
                          title="حذف"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  )}
                </div>
                {hasBody && (
                  <div className="px-2.5 py-1.5 space-y-1 text-[11px]">
                    {(p.cheque_number || p.card_last_four) && (
                      <div className="flex items-center gap-3 flex-wrap">
                        {p.cheque_number && (
                          <div className="flex items-center gap-1.5">
                            <span className="text-muted-foreground">رقم الشيك:</span>
                            <span className="font-mono font-semibold">{p.cheque_number}</span>
                          </div>
                        )}
                        {p.card_last_four && (
                          <div className="flex items-center gap-1.5">
                            <span className="text-muted-foreground">البطاقة:</span>
                            <span className="font-mono font-semibold">•••• {p.card_last_four}</span>
                          </div>
                        )}
                      </div>
                    )}
                    {p.notes && (
                      <p className="text-muted-foreground">{p.notes}</p>
                    )}
                    {(imagesByPayment[p.id]?.length ?? 0) > 0 && (
                      <div className="pt-0.5">
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-1">
                          <ImageIcon className="h-3 w-3" />
                          <span>الملفات المرفقة</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {imagesByPayment[p.id].map((img) => {
                            const isPdf = img.image_url.toLowerCase().endsWith('.pdf');
                            return (
                              <button
                                key={img.id}
                                type="button"
                                onClick={() => setGalleryFile(buildGalleryFile(img))}
                                className="relative w-12 h-12 rounded-md overflow-hidden border border-border hover:border-primary transition-colors bg-muted flex items-center justify-center shrink-0"
                                title={img.image_type || 'مرفق'}
                              >
                                {isPdf ? (
                                  <div className="flex flex-col items-center justify-center gap-0.5">
                                    <FileText className="h-4 w-4 text-red-500" />
                                    <span className="text-[8px] font-bold text-red-500">PDF</span>
                                  </div>
                                ) : (
                                  <img src={img.image_url} alt={img.image_type || ''} className="w-full h-full object-cover" />
                                )}
                              </button>
                            );
                          })}
                        </div>
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
