import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Banknote,
  CreditCard,
  Wallet,
  ReceiptText,
  Printer,
  Pencil,
  Trash2,
  Loader2,
  ExternalLink,
  ArrowRightLeft,
  AlertCircle,
  CheckCircle,
  Clock,
  ImageIcon,
  FileText,
} from "lucide-react";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";
import { PaymentEditDialog } from "./PaymentEditDialog";
import { InvoiceSendPrintDialog } from "@/components/policies/InvoiceSendPrintDialog";

interface PaymentImage {
  id: string;
  image_url: string;
  image_type: string | null;
}

interface PaymentRow {
  id: string;
  policy_id: string;
  amount: number;
  payment_date: string;
  payment_type: string;
  cheque_number: string | null;
  cheque_image_url: string | null;
  cheque_status: string | null;
  refused: boolean | null;
  notes: string | null;
  locked: boolean | null;
  card_last_four: string | null;
  tranzila_approval_code: string | null;
  tranzila_receipt_url: string | null;
  transferred_to_type: string | null;
  transferred_to_id: string | null;
  transferred_payment_id: string | null;
  policy: {
    id: string;
    policy_type_parent: string;
    policy_type_child: string | null;
    insurance_price: number;
  } | null;
  images?: PaymentImage[];
}

interface PackagePolicy {
  id: string;
  policy_type_parent: string;
  policy_type_child: string | null;
  insurance_price: number;
  company_name: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policyIds: string[];
  onChange?: () => void;
}

const paymentTypeIcon: Record<string, typeof Banknote> = {
  cash: Banknote,
  cheque: CreditCard,
  visa: CreditCard,
  transfer: Wallet,
};

const paymentTypeLabel: Record<string, string> = {
  cash: "نقدي",
  cheque: "شيك",
  visa: "بطاقة ائتمان",
  transfer: "تحويل بنكي",
};

const paymentTypeBg: Record<string, string> = {
  cash: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  cheque: "bg-blue-500/10 text-blue-700 border-blue-500/30",
  visa: "bg-purple-500/10 text-purple-700 border-purple-500/30",
  transfer: "bg-amber-500/10 text-amber-700 border-amber-500/30",
};

const chequeStatusDisplay: Record<
  string,
  { label: string; icon: typeof CheckCircle; className: string }
> = {
  pending: {
    label: "قيد الانتظار",
    icon: Clock,
    className: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  },
  cashed: {
    label: "تم صرفه",
    icon: CheckCircle,
    className: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  },
  returned: {
    label: "مرتجع",
    icon: AlertCircle,
    className: "bg-destructive/10 text-destructive border-destructive/30",
  },
};

const formatDate = (dateStr: string | null) => {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("en-GB");
};

const formatCurrency = (amount: number) =>
  `₪${amount.toLocaleString("en-US")}`;

export function PackagePaymentsDetailsDialog({
  open,
  onOpenChange,
  policyIds,
  onChange,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [packagePolicies, setPackagePolicies] = useState<PackagePolicy[]>([]);
  const [transferNames, setTransferNames] = useState<Record<string, string>>({});
  const [editPayment, setEditPayment] = useState<PaymentRow | null>(null);
  const [deletePaymentId, setDeletePaymentId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false);
  const [clientPhone, setClientPhone] = useState<string | null>(null);

  const fetchPayments = async () => {
    if (policyIds.length === 0) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("policy_payments")
        .select(
          `
          id, policy_id, amount, payment_date, payment_type, cheque_number,
          cheque_image_url, cheque_status, refused, notes, locked,
          card_last_four, tranzila_approval_code, tranzila_receipt_url,
          transferred_to_type, transferred_to_id, transferred_payment_id,
          policy:policies!policy_payments_policy_id_fkey(
            id, policy_type_parent, policy_type_child, insurance_price, client_id
          )
          `,
        )
        .in("policy_id", policyIds)
        .order("payment_date", { ascending: false });

      if (error) throw error;

      const rows = (data as unknown as PaymentRow[]) || [];
      setPayments(rows);

      // Load all policies in this package for the edit dialog header
      const { data: pkgData } = await supabase
        .from("policies")
        .select("id, policy_type_parent, policy_type_child, insurance_price, company:insurance_companies(name, name_ar)")
        .in("id", policyIds);
      setPackagePolicies(
        ((pkgData as any[]) || []).map((p) => ({
          id: p.id,
          policy_type_parent: p.policy_type_parent,
          policy_type_child: p.policy_type_child,
          insurance_price: Number(p.insurance_price) || 0,
          company_name: p.company?.name_ar || p.company?.name || null,
        })),
      );

      // Load client phone from the first policy for the invoice dialog
      const clientId = (data as any[])?.[0]?.policy?.client_id;
      if (clientId) {
        const { data: client } = await supabase
          .from("clients")
          .select("phone_number")
          .eq("id", clientId)
          .maybeSingle();
        setClientPhone(client?.phone_number ?? null);
      }

      // Load per-payment images
      const paymentIds = rows.map((r) => r.id);
      if (paymentIds.length > 0) {
        const { data: imgs } = await supabase
          .from("payment_images")
          .select("id, payment_id, image_url, image_type")
          .in("payment_id", paymentIds);
        const byPayment: Record<string, PaymentImage[]> = {};
        (imgs || []).forEach((img: any) => {
          const arr = byPayment[img.payment_id] || [];
          arr.push({
            id: img.id,
            image_url: img.image_url,
            image_type: img.image_type,
          });
          byPayment[img.payment_id] = arr;
        });
        setPayments((prev) =>
          prev.map((p) => ({ ...p, images: byPayment[p.id] || [] })),
        );
      }

      // Resolve transferred_to names (broker or company)
      const brokerIds = [
        ...new Set(
          rows
            .filter((r) => r.transferred_to_type === "broker" && r.transferred_to_id)
            .map((r) => r.transferred_to_id as string),
        ),
      ];
      const companyIds = [
        ...new Set(
          rows
            .filter((r) => r.transferred_to_type === "company" && r.transferred_to_id)
            .map((r) => r.transferred_to_id as string),
        ),
      ];
      const names: Record<string, string> = {};
      if (brokerIds.length > 0) {
        const { data: brokers } = await supabase
          .from("brokers")
          .select("id, name")
          .in("id", brokerIds);
        (brokers || []).forEach((b: any) => {
          names[`broker:${b.id}`] = b.name;
        });
      }
      if (companyIds.length > 0) {
        const { data: companies } = await supabase
          .from("insurance_companies")
          .select("id, name, name_ar")
          .in("id", companyIds);
        (companies || []).forEach((c: any) => {
          names[`company:${c.id}`] = c.name_ar || c.name;
        });
      }
      setTransferNames(names);
    } catch (e: any) {
      console.error("[PackagePaymentsDetailsDialog] fetch error:", e);
      toast.error("فشل تحميل الدفعات");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) fetchPayments();
    else {
      setPayments([]);
      setPackagePolicies([]);
      setTransferNames({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, policyIds.join(",")]);

  const totals = useMemo(() => {
    const paid = payments
      .filter((p) => !p.refused)
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const refused = payments
      .filter((p) => p.refused)
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);
    return { paid, refused, count: payments.length };
  }, [payments]);

  const handleDelete = async () => {
    if (!deletePaymentId) return;
    setDeleting(true);
    try {
      const { error } = await supabase
        .from("policy_payments")
        .delete()
        .eq("id", deletePaymentId);
      if (error) throw error;
      toast.success("تم حذف الدفعة");
      setDeletePaymentId(null);
      await fetchPayments();
      onChange?.();
    } catch (e: any) {
      toast.error(e.message || "فشل حذف الدفعة");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="max-w-3xl w-[95vw] max-h-[90vh] overflow-y-auto p-0"
          dir="rtl"
        >
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
                      تفاصيل الدفعات
                    </DialogTitle>
                    <p className="text-xs text-white/70">
                      {totals.count} دفعة · إجمالي مقبول ₪{totals.paid.toLocaleString("en-US")}
                      {totals.refused > 0 && (
                        <> · مرفوض ₪{totals.refused.toLocaleString("en-US")}</>
                      )}
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={() => setInvoiceDialogOpen(true)}
                  disabled={policyIds.length === 0}
                  className="gap-1.5 bg-white/20 hover:bg-white/30 text-white border-0"
                >
                  <Printer className="h-4 w-4" />
                  <span className="hidden sm:inline">طباعة الفاتورة</span>
                </Button>
              </div>
            </DialogHeader>
          </div>

          {/* Body */}
          <div className="p-4 space-y-3">
            {loading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}

            {!loading && payments.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <ReceiptText className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>لا توجد دفعات مسجلة بعد</p>
              </div>
            )}

            {!loading &&
              payments.map((p) => {
                const Icon = paymentTypeIcon[p.payment_type] || Banknote;
                const typeLabel = paymentTypeLabel[p.payment_type] || p.payment_type;
                const typeBg =
                  paymentTypeBg[p.payment_type] || "bg-muted text-muted-foreground border-border";
                const transferKey = p.transferred_to_id
                  ? `${p.transferred_to_type}:${p.transferred_to_id}`
                  : null;
                const transferName = transferKey ? transferNames[transferKey] : null;
                const chequeStatusKey = p.cheque_status || "pending";
                const chequeStatusInfo =
                  chequeStatusDisplay[chequeStatusKey] || chequeStatusDisplay.pending;
                const ChequeStatusIcon = chequeStatusInfo.icon;

                return (
                  <div
                    key={p.id}
                    className={cn(
                      "rounded-xl border-2 bg-card overflow-hidden transition-all",
                      p.refused
                        ? "border-destructive/40 bg-destructive/5"
                        : "border-border/60 hover:border-primary/40",
                    )}
                  >
                    {/* Top strip: date + amount + type */}
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
                              {formatCurrency(Number(p.amount || 0))}
                            </span>
                            <Badge
                              variant="outline"
                              className={cn("text-[10px]", typeBg)}
                            >
                              {typeLabel}
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
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => setEditPayment(p)}
                          title="تعديل"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive hover:bg-destructive/10"
                          onClick={() => setDeletePaymentId(p.id)}
                          title="حذف"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    {/* Details per type */}
                    <div className="px-4 py-3 space-y-2">
                      {/* CHEQUE details */}
                      {p.payment_type === "cheque" && (
                        <>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                            <div>
                              <p className="text-[10px] text-muted-foreground mb-0.5">رقم الشيك</p>
                              <p className="font-mono font-semibold ltr-nums">
                                {p.cheque_number || "-"}
                              </p>
                            </div>
                            <div className="col-span-1">
                              <p className="text-[10px] text-muted-foreground mb-0.5">الحالة</p>
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold",
                                  chequeStatusInfo.className,
                                )}
                              >
                                <ChequeStatusIcon className="h-3 w-3" />
                                {chequeStatusInfo.label}
                              </span>
                            </div>
                            <div className="col-span-2">
                              <p className="text-[10px] text-muted-foreground mb-0.5">
                                الاستخدام
                              </p>
                              {transferName ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary">
                                  <ArrowRightLeft className="h-3 w-3" />
                                  {p.transferred_to_type === "company" ? "مستخدم لشركة" : "محول لوسيط"}:
                                  <span className="font-bold">{transferName}</span>
                                </span>
                              ) : (
                                <span className="text-[11px] text-muted-foreground italic">
                                  غير مستخدم بعد
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Cheque image preview */}
                          {(p.cheque_image_url || (p.images && p.images.length > 0)) && (
                            <div className="flex gap-2 pt-1">
                              {p.cheque_image_url && (
                                <a
                                  href={p.cheque_image_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="relative w-16 h-16 rounded-md overflow-hidden border border-border hover:border-primary transition-colors bg-muted flex items-center justify-center"
                                  title="عرض صورة الشيك"
                                >
                                  <img
                                    src={p.cheque_image_url}
                                    alt="cheque"
                                    className="w-full h-full object-cover"
                                  />
                                </a>
                              )}
                              {(p.images || [])
                                .filter((img) => img.image_url !== p.cheque_image_url)
                                .slice(0, 3)
                                .map((img) => (
                                  <a
                                    key={img.id}
                                    href={img.image_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="relative w-16 h-16 rounded-md overflow-hidden border border-border hover:border-primary transition-colors bg-muted flex items-center justify-center"
                                  >
                                    <img
                                      src={img.image_url}
                                      alt={img.image_type || ""}
                                      className="w-full h-full object-cover"
                                    />
                                  </a>
                                ))}
                            </div>
                          )}
                        </>
                      )}

                      {/* VISA details */}
                      {p.payment_type === "visa" && (
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          {p.card_last_four && (
                            <div>
                              <p className="text-[10px] text-muted-foreground mb-0.5">البطاقة</p>
                              <p className="font-mono font-semibold ltr-nums">
                                •••• {p.card_last_four}
                              </p>
                            </div>
                          )}
                          {p.tranzila_approval_code && (
                            <div>
                              <p className="text-[10px] text-muted-foreground mb-0.5">
                                رقم التفويض
                              </p>
                              <p className="font-mono font-semibold ltr-nums">
                                {p.tranzila_approval_code}
                              </p>
                            </div>
                          )}
                          {p.tranzila_receipt_url ? (
                            <div className="col-span-2">
                              <a
                                href={p.tranzila_receipt_url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-primary hover:underline"
                              >
                                <FileText className="h-3.5 w-3.5" />
                                عرض الإيصال
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            </div>
                          ) : (
                            <div className="col-span-2">
                              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground italic">
                                <ImageIcon className="h-3 w-3" />
                                لا يوجد إيصال
                              </span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* CASH / TRANSFER — notes only */}
                      {(p.payment_type === "cash" || p.payment_type === "transfer") && p.notes && (
                        <p className="text-[11px] text-muted-foreground">{p.notes}</p>
                      )}

                      {p.payment_type === "cheque" && p.notes && (
                        <p className="text-[11px] text-muted-foreground pt-1 border-t border-dashed border-border/60">
                          {p.notes}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </DialogContent>
      </Dialog>

      {editPayment && (
        <PaymentEditDialog
          open={!!editPayment}
          onOpenChange={(o) => !o && setEditPayment(null)}
          payment={editPayment as any}
          packagePolicies={
            packagePolicies.length > 1
              ? packagePolicies.map((pp) => ({
                  id: pp.id,
                  policy_type_parent: pp.policy_type_parent,
                  policy_type_child: pp.policy_type_child,
                  insurance_price: pp.insurance_price,
                  company_name: pp.company_name,
                }))
              : undefined
          }
          onSuccess={() => {
            setEditPayment(null);
            fetchPayments();
            onChange?.();
          }}
        />
      )}

      <DeleteConfirmDialog
        open={!!deletePaymentId}
        onOpenChange={(o) => !o && setDeletePaymentId(null)}
        onConfirm={handleDelete}
        title="حذف الدفعة"
        description="هل أنت متأكد من حذف هذه الدفعة؟ لا يمكن التراجع عن هذا الإجراء."
        loading={deleting}
      />

      <InvoiceSendPrintDialog
        open={invoiceDialogOpen}
        onOpenChange={setInvoiceDialogOpen}
        policyIds={policyIds}
        isPackage={policyIds.length > 1}
        clientPhone={clientPhone}
      />
    </>
  );
}
