import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArabicDatePicker } from "@/components/ui/arabic-date-picker";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Trash2, Upload, X, FileText, ImageIcon, Pencil, Lock } from "lucide-react";
import { sanitizeChequeNumber, CHEQUE_NUMBER_MAX_LENGTH } from "@/lib/chequeUtils";
import { BankBranchPicker } from "@/components/shared/BankBranchPicker";
import { getInsuranceTypeLabel } from "@/lib/insuranceTypes";
import { useAgentContext } from "@/hooks/useAgentContext";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";
import { cn } from "@/lib/utils";

interface PaymentRecord {
  id: string;
  amount: number;
  payment_date: string;
  payment_type: string;
  cheque_number: string | null;
  cheque_date?: string | null;
  bank_code?: string | null;
  branch_code?: string | null;
  cheque_image_url: string | null;
  card_last_four: string | null;
  refused: boolean | null;
  notes: string | null;
  locked: boolean | null;
  policy_id: string;
  policy: {
    id: string;
    policy_type_parent: string;
    policy_type_child?: string | null;
    insurance_price: number;
  } | null;
}

interface PackagePolicyInfo {
  id: string;
  policy_type_parent: string;
  policy_type_child?: string | null;
  insurance_price: number;
  company_name?: string | null;
}

interface PaymentEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: PaymentRecord | null;
  onSuccess: () => void;
  // Optional: when the payment belongs to a package, pass every policy in
  // the package so the dialog can show the full context instead of just
  // the single policy the payment row is attached to.
  packagePolicies?: PackagePolicyInfo[];
}

const policyTypeLabels: Record<string, string> = {
  ELZAMI: 'إلزامي',
  THIRD_FULL: 'ثالث/شامل',
  ROAD_SERVICE: 'خدمات الطريق',
  ACCIDENT_FEE_EXEMPTION: 'إعفاء رسوم حادث',
  HEALTH: 'تأمين صحي',
  LIFE: 'تأمين حياة',
  PROPERTY: 'تأمين ممتلكات',
  TRAVEL: 'تأمين سفر',
  BUSINESS: 'تأمين أعمال',
  OTHER: 'أخرى',
};

const paymentTypeLabels: Record<string, string> = {
  cash: 'نقدي',
  cheque: 'شيك',
  visa: 'بطاقة',
  transfer: 'تحويل',
};

export function PaymentEditDialog({
  open,
  onOpenChange,
  payment,
  onSuccess,
  packagePolicies,
}: PaymentEditDialogProps) {
  const { hasFeature } = useAgentContext();
  const visaEnabled = hasFeature('visa_payment');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [formData, setFormData] = useState({
    amount: 0,
    payment_type: 'cash',
    payment_date: '',
    cheque_number: '',
    bank_code: '' as string | null,
    branch_code: '' as string | null,
    refused: false,
    notes: '',
  });

  // Attached files managed inline: existing payment_images rows the user
  // can delete + brand-new uploads that go straight to the CDN.
  const [attachedImages, setAttachedImages] = useState<
    { id: string; image_url: string; image_type: string | null }[]
  >([]);
  const [loadingImages, setLoadingImages] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [deletingImageId, setDeletingImageId] = useState<string | null>(null);

  const fetchAttachedImages = async (paymentId: string) => {
    setLoadingImages(true);
    try {
      const { data, error } = await supabase
        .from('payment_images')
        .select('id, image_url, image_type')
        .eq('payment_id', paymentId)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      setAttachedImages((data as any[]) || []);
    } catch (e) {
      console.error('[PaymentEditDialog] fetch images error:', e);
      setAttachedImages([]);
    } finally {
      setLoadingImages(false);
    }
  };

  // Reset form when payment changes
  useEffect(() => {
    if (payment) {
      setFormData({
        amount: payment.amount || 0,
        payment_type: payment.payment_type || 'cash',
        payment_date: payment.payment_date || new Date().toISOString().split('T')[0],
        cheque_number: payment.cheque_number || '',
        bank_code: payment.bank_code || null,
        branch_code: payment.branch_code || null,
        refused: payment.refused || false,
        notes: payment.notes || '',
      });
      fetchAttachedImages(payment.id);
    } else {
      setAttachedImages([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payment?.id]);

  const handleUploadImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!payment) return;
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;

    setUploadingImage(true);
    try {
      let nextSortOrder = attachedImages.length;
      for (const file of files) {
        const isImage = file.type.startsWith('image/');
        const isPdf = file.type === 'application/pdf';
        if (!isImage && !isPdf) {
          toast.error('يرجى اختيار صور أو ملفات PDF فقط');
          continue;
        }
        if (file.size > 10 * 1024 * 1024) {
          toast.error('حجم الملف يجب أن يكون أقل من 10MB');
          continue;
        }

        const formDataBody = new FormData();
        formDataBody.append('file', file);
        formDataBody.append('entity_type', 'payment');
        formDataBody.append('entity_id', payment.id);

        const { data, error } = await supabase.functions.invoke('upload-media', {
          body: formDataBody,
        });
        if (error) throw error;
        const cdnUrl = (data as any)?.file?.cdn_url || (data as any)?.url;
        if (!cdnUrl) continue;

        const { data: inserted, error: insertError } = await supabase
          .from('payment_images')
          .insert({
            payment_id: payment.id,
            image_url: cdnUrl,
            image_type: 'receipt',
            sort_order: nextSortOrder++,
          })
          .select('id, image_url, image_type')
          .single();
        if (insertError) throw insertError;
        if (inserted) {
          setAttachedImages((prev) => [...prev, inserted as any]);
        }
      }
      toast.success('تم رفع الملف');
    } catch (err: any) {
      console.error('[PaymentEditDialog] upload error:', err);
      toast.error(err?.message || 'فشل رفع الملف');
    } finally {
      setUploadingImage(false);
    }
  };

  const handleDeleteImage = async (imageId: string) => {
    setDeletingImageId(imageId);
    try {
      const { error } = await supabase
        .from('payment_images')
        .delete()
        .eq('id', imageId);
      if (error) throw error;
      setAttachedImages((prev) => prev.filter((img) => img.id !== imageId));
      toast.success('تم حذف الملف');
    } catch (err: any) {
      console.error('[PaymentEditDialog] delete image error:', err);
      toast.error(err?.message || 'فشل حذف الملف');
    } finally {
      setDeletingImageId(null);
    }
  };

  const handleSave = async () => {
    if (!payment) return;

    // Validate amount
    if (formData.amount <= 0) {
      toast.error('المبلغ يجب أن يكون أكبر من صفر');
      return;
    }

    // Validate cheque number if payment type is cheque
    if (formData.payment_type === 'cheque' && !formData.cheque_number.trim()) {
      toast.error('رقم الشيك مطلوب');
      return;
    }

    setSaving(true);
    try {
      const updateData: any = {
        amount: formData.amount,
        payment_type: formData.payment_type,
        payment_date: formData.payment_date,
        refused: formData.refused,
        notes: formData.notes?.trim() ? formData.notes.trim() : null,
      };

      // Only include cheque_number / bank / branch if payment type is
      // cheque — otherwise clear them so the columns don't carry stale
      // data from a prior cheque that was later re-classified.
      if (formData.payment_type === 'cheque') {
        updateData.cheque_number = formData.cheque_number.trim();
        updateData.bank_code = formData.bank_code || null;
        updateData.branch_code = formData.branch_code || null;
      } else {
        updateData.cheque_number = null;
        updateData.bank_code = null;
        updateData.branch_code = null;
      }

      const { error } = await supabase
        .from('policy_payments')
        .update(updateData)
        .eq('id', payment.id);

      if (error) throw error;

      toast.success('تم تعديل الدفعة بنجاح');
      onSuccess();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error updating payment:', error);
      toast.error(error.message || 'فشل في تعديل الدفعة');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!payment) return;
    setDeleting(true);
    try {
      const { error } = await supabase
        .from('policy_payments')
        .delete()
        .eq('id', payment.id);
      if (error) throw error;
      toast.success('تم حذف الدفعة');
      setDeleteConfirmOpen(false);
      onSuccess();
      onOpenChange(false);
    } catch (e: any) {
      console.error('Delete payment error:', e);
      toast.error(e.message || 'فشل حذف الدفعة');
    } finally {
      setDeleting(false);
    }
  };

  if (!payment) return null;

  const isLocked = payment.locked === true;
  const hasPackage = (packagePolicies?.length ?? 0) > 0;

  const paymentTypeLabel = isLocked && formData.payment_type === 'visa' ? 'فيزا خارجي' : (paymentTypeLabels[formData.payment_type] || formData.payment_type);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[95vw] max-h-[90vh] overflow-y-auto p-0" dir="rtl">
        {/* Header — matches the PaymentGroupDetailsDialog navy gradient
            so every payment-related dialog shares one design language. */}
        <div
          className="sticky top-0 z-10 text-white px-5 py-4 rounded-t-lg"
          style={{ background: "linear-gradient(135deg, #122143 0%, #1a3260 100%)" }}
        >
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-white/15 backdrop-blur-sm flex items-center justify-center shrink-0">
                <Pencil className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-lg font-bold text-white text-right leading-tight">
                  تعديل الدفعة
                </DialogTitle>
                <div className="flex items-center gap-2 mt-1 text-xs text-white/75 flex-wrap">
                  <span className="font-bold ltr-nums">₪{Number(formData.amount || 0).toLocaleString("en-US")}</span>
                  <span className="text-white/40">•</span>
                  <span>{paymentTypeLabel}</span>
                  {formData.payment_date && (
                    <>
                      <span className="text-white/40">•</span>
                      <span className="ltr-nums">
                        {new Date(formData.payment_date).toLocaleDateString("en-GB")}
                      </span>
                    </>
                  )}
                  {isLocked && (
                    <Badge className="bg-amber-400/20 text-amber-100 border-amber-300/30 gap-1 text-[10px] h-5 px-2">
                      <Lock className="h-2.5 w-2.5" />
                      إلزامي
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          </DialogHeader>
        </div>

        <div className="p-5 space-y-5 bg-muted/20">
          {/* Package / policy context */}
          {hasPackage ? (
            <div className="rounded-lg border border-border/60 bg-card p-3 space-y-2">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">
                وثائق الباقة
              </p>
              <div className="space-y-1.5">
                {packagePolicies!.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Badge variant="outline" className="text-[10px] shrink-0">
                        {getInsuranceTypeLabel(p.policy_type_parent as any, (p.policy_type_child || null) as any)}
                      </Badge>
                      {p.company_name && (
                        <span className="text-muted-foreground truncate">
                          {p.company_name}
                        </span>
                      )}
                    </div>
                    <span className="font-semibold ltr-nums text-foreground shrink-0">
                      ₪{p.insurance_price.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            payment.policy && (
              <div className="rounded-lg border border-border/60 bg-card px-3 py-2 flex items-center justify-between gap-2">
                <Badge variant="outline" className="text-[10px]">
                  {getInsuranceTypeLabel(payment.policy.policy_type_parent as any, (payment.policy.policy_type_child || null) as any)}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  سعر الوثيقة:{" "}
                  <span className="font-semibold text-foreground ltr-nums">
                    ₪{payment.policy.insurance_price.toLocaleString()}
                  </span>
                </span>
              </div>
            )
          )}

          {/* Locked info — only refused can be toggled on ELZAMI rows */}
          {isLocked && (
            <div className="bg-amber-50 border border-amber-200 text-amber-900 px-3 py-2.5 rounded-lg text-xs flex items-start gap-2">
              <Lock className="h-4 w-4 mt-0.5 shrink-0" />
              <span>هذه دفعة لوثيقة إلزامية — المبلغ والطريقة والتاريخ ثابتين، يمكنك فقط وضعها كراجعة.</span>
            </div>
          )}

          {/* Amount — big input */}
          <div className="space-y-1.5">
            <Label htmlFor="amount" className="text-xs font-semibold">المبلغ (₪)</Label>
            <Input
              id="amount"
              type="number"
              min={0}
              step={0.01}
              value={formData.amount}
              onChange={(e) => setFormData({ ...formData, amount: parseFloat(e.target.value) || 0 })}
              disabled={isLocked}
              className="text-xl font-bold h-12 ltr-input text-left"
            />
          </div>

          {/* Method + Date side-by-side */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">طريقة الدفع</Label>
              <Select
                value={formData.payment_type}
                onValueChange={(value) => setFormData({ ...formData, payment_type: value })}
                disabled={isLocked}
              >
                <SelectTrigger className="h-10">
                  <SelectValue placeholder="اختر طريقة الدفع" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">نقدي</SelectItem>
                  <SelectItem value="cheque">شيك</SelectItem>
                  {/* فيزا is only selectable when the agent has visa_payment
                      enabled by the Thiqa admin. We still render it when the
                      current row is already visa (e.g. a locked ELZAMI row)
                      so the value stays valid. */}
                  {(visaEnabled || formData.payment_type === 'visa') && (
                    <SelectItem value="visa">{isLocked ? 'فيزا خارجي' : 'فيزا'}</SelectItem>
                  )}
                  <SelectItem value="transfer">تحويل</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">تاريخ الدفع</Label>
              <ArabicDatePicker
                value={formData.payment_date}
                onChange={(date) => setFormData({
                  ...formData,
                  payment_date: date || ''
                })}
                disabled={isLocked}
              />
            </div>
          </div>

          {/* Cheque-specific fields on one row: bank → branch → رقم الشيك.
              The picker takes the cheque-number input as a slot so the
              three identifiers share one row. */}
          {formData.payment_type === 'cheque' && (
            <BankBranchPicker
              bankCode={formData.bank_code}
              branchCode={formData.branch_code}
              onBankChange={(code) => setFormData({ ...formData, bank_code: code })}
              onBranchChange={(code) => setFormData({ ...formData, branch_code: code })}
              disabled={isLocked}
              chequeNumberSlot={
                <>
                  <Label htmlFor="cheque_number" className="text-xs font-semibold">
                    رقم الشيك
                  </Label>
                  <Input
                    id="cheque_number"
                    value={formData.cheque_number}
                    onChange={(e) => setFormData({
                      ...formData,
                      cheque_number: sanitizeChequeNumber(e.target.value)
                    })}
                    maxLength={CHEQUE_NUMBER_MAX_LENGTH}
                    className="font-mono h-10 ltr-input"
                    placeholder="أدخل رقم الشيك"
                    disabled={isLocked}
                  />
                </>
              }
            />
          )}

          {/* Attached files — delete / add inline */}
          <div className="rounded-lg border border-border/60 bg-card p-3 space-y-2">
            <Label className="flex items-center gap-1.5 text-xs font-semibold">
              <ImageIcon className="h-3.5 w-3.5" />
              الملفات المرفقة
            </Label>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Legacy cheque image stored on the payment row itself */}
              {payment.cheque_image_url && (
                <a
                  href={payment.cheque_image_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="relative h-14 w-14 rounded-lg border border-border overflow-hidden bg-muted flex items-center justify-center"
                  title="صورة الشيك الأصلية"
                >
                  <img
                    src={payment.cheque_image_url}
                    alt="cheque"
                    className="w-full h-full object-cover"
                  />
                </a>
              )}
              {loadingImages && (
                <div className="h-14 w-14 rounded-lg border border-border flex items-center justify-center">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              )}
              {attachedImages.map((img) => {
                const isPdf = img.image_url.toLowerCase().endsWith('.pdf');
                const isDeleting = deletingImageId === img.id;
                return (
                  <div key={img.id} className="relative group">
                    <a
                      href={img.image_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block h-14 w-14 rounded-lg border border-border overflow-hidden bg-background flex items-center justify-center"
                      title={img.image_type || 'مرفق'}
                    >
                      {isPdf ? (
                        <div className="flex flex-col items-center justify-center gap-0.5">
                          <FileText className="h-5 w-5 text-red-500" />
                          <span className="text-[9px] font-bold text-red-500">PDF</span>
                        </div>
                      ) : (
                        <img
                          src={img.image_url}
                          alt={img.image_type || ''}
                          className="w-full h-full object-cover"
                        />
                      )}
                    </a>
                    {!isLocked && (
                      <button
                        type="button"
                        onClick={() => handleDeleteImage(img.id)}
                        disabled={isDeleting}
                        className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
                      >
                        {isDeleting ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <X className="h-3 w-3" />
                        )}
                      </button>
                    )}
                  </div>
                );
              })}
              {!isLocked && (
                <label
                  className="h-14 w-14 border-2 border-dashed border-border rounded-lg flex items-center justify-center cursor-pointer hover:bg-muted/50 hover:border-primary transition-colors"
                  title="إضافة ملف"
                >
                  {uploadingImage ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : (
                    <Upload className="h-4 w-4 text-muted-foreground" />
                  )}
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    multiple
                    className="hidden"
                    onChange={handleUploadImage}
                    disabled={uploadingImage}
                  />
                </label>
              )}
            </div>
            {!payment.cheque_image_url && !loadingImages && attachedImages.length === 0 && !isLocked && (
              <p className="text-[11px] text-muted-foreground">
                لا توجد ملفات مرفقة — اضغط على زر الرفع لإضافة صورة أو PDF.
              </p>
            )}
          </div>

          {/* Notes — free-form text so the user can jot down anything
              that doesn't fit into cheque#, card, or refused. Saved into
              policy_payments.notes and surfaced on the payment row and
              in the group-details popup. */}
          <div className="space-y-1.5">
            <Label htmlFor="notes" className="text-xs font-semibold">ملاحظات</Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="اكتب ملاحظة اختيارية…"
              rows={3}
              disabled={isLocked}
              className="resize-none text-sm"
            />
          </div>

          {/* Refused toggle */}
          <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-card px-3 py-2.5">
            <Checkbox
              id="refused"
              checked={formData.refused}
              onCheckedChange={(checked) => setFormData({ ...formData, refused: checked === true })}
            />
            <Label htmlFor="refused" className="cursor-pointer text-sm font-medium">
              راجع (مرفوض)
            </Label>
            {formData.refused && (
              <Badge variant="destructive" className="text-[10px] h-5 px-2 mr-auto">راجع</Badge>
            )}
          </div>
        </div>

        <DialogFooter className="p-4 border-t border-border/60 bg-card sm:justify-between flex-row gap-2">
          {/* Delete button — only for user-entered rows. Locked ELZAMI
              rows can never be deleted individually (they're auto-generated
              by the wizard and must stay attached to the policy). */}
          {!isLocked ? (
            <Button
              variant="ghost"
              onClick={() => setDeleteConfirmOpen(true)}
              disabled={saving || deleting}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive gap-2"
            >
              <Trash2 className="h-4 w-4" />
              حذف
            </Button>
          ) : (
            <div />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving || deleting}>
              إلغاء
            </Button>
            <Button onClick={handleSave} disabled={saving || deleting}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                  جاري الحفظ...
                </>
              ) : (
                'حفظ التعديلات'
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>

      <DeleteConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        onConfirm={handleDelete}
        title="حذف الدفعة"
        description="هل أنت متأكد من حذف هذه الدفعة؟ لا يمكن التراجع عن هذا الإجراء."
        loading={deleting}
      />
    </Dialog>
  );
}
