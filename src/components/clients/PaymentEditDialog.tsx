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
import { Loader2, Trash2, Upload, X, FileText, ImageIcon } from "lucide-react";
import { sanitizeChequeNumber, CHEQUE_NUMBER_MAX_LENGTH } from "@/lib/chequeUtils";
import { getInsuranceTypeLabel } from "@/lib/insuranceTypes";
import { useAgentContext } from "@/hooks/useAgentContext";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";

interface PaymentRecord {
  id: string;
  amount: number;
  payment_date: string;
  payment_type: string;
  cheque_number: string | null;
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
    refused: false,
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
        refused: payment.refused || false,
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
      };

      // Only include cheque_number if payment type is cheque
      if (formData.payment_type === 'cheque') {
        updateData.cheque_number = formData.cheque_number.trim();
      } else {
        updateData.cheque_number = null;
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>تعديل الدفعة</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Package Context — show every policy in the package so the user
              sees the full picture instead of just the one row the payment
              is technically attached to. */}
          {hasPackage ? (
            <div className="rounded-lg border border-border/60 bg-muted/30 p-3 space-y-1.5">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                وثائق الباقة
              </p>
              <div className="space-y-1">
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
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Badge variant="outline">
                  {getInsuranceTypeLabel(payment.policy.policy_type_parent as any, (payment.policy.policy_type_child || null) as any)}
                </Badge>
                <span className="text-xs">
                  (سعر الوثيقة: ₪{payment.policy.insurance_price.toLocaleString()})
                </span>
              </div>
            )
          )}

          {/* Locked info — only refused can be toggled on elzami rows */}
          {isLocked && (
            <div className="bg-warning/10 border border-warning/30 text-warning-foreground px-3 py-2 rounded-lg text-xs">
              🔒 هذه دفعة لوثيقة إلزامية — المبلغ والطريقة والتاريخ ثابتين، يمكنك فقط وضعها كراجعة.
            </div>
          )}

          {/* Amount */}
          <div className="space-y-2">
            <Label htmlFor="amount">المبلغ (₪)</Label>
            <Input
              id="amount"
              type="number"
              min={0}
              step={0.01}
              value={formData.amount}
              onChange={(e) => setFormData({ ...formData, amount: parseFloat(e.target.value) || 0 })}
              disabled={isLocked}
              className="text-lg font-semibold"
            />
          </div>

          {/* Payment Type */}
          <div className="space-y-2">
            <Label>طريقة الدفع</Label>
            <Select
              value={formData.payment_type}
              onValueChange={(value) => setFormData({ ...formData, payment_type: value })}
              disabled={isLocked}
            >
              <SelectTrigger>
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

          {/* Cheque Number - only show if payment type is cheque */}
          {formData.payment_type === 'cheque' && (
            <div className="space-y-2">
              <Label htmlFor="cheque_number">رقم الشيك</Label>
              <Input
                id="cheque_number"
                value={formData.cheque_number}
                onChange={(e) => setFormData({
                  ...formData,
                  cheque_number: sanitizeChequeNumber(e.target.value)
                })}
                maxLength={CHEQUE_NUMBER_MAX_LENGTH}
                className="font-mono"
                placeholder="أدخل رقم الشيك"
                disabled={isLocked}
              />
            </div>
          )}

          {/* Payment Date */}
          <div className="space-y-2">
            <Label>تاريخ الدفع</Label>
            <ArabicDatePicker
              value={formData.payment_date}
              onChange={(date) => setFormData({
                ...formData,
                payment_date: date || ''
              })}
              disabled={isLocked}
            />
          </div>

          {/* Attached files — delete / add inline */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1 text-xs">
              <ImageIcon className="h-3 w-3" />
              الملفات المرفقة
            </Label>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Legacy cheque image stored on the payment row itself */}
              {payment.cheque_image_url && (
                <a
                  href={payment.cheque_image_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="relative h-16 w-16 rounded border overflow-hidden bg-muted flex items-center justify-center"
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
                <div className="h-16 w-16 rounded border flex items-center justify-center">
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
                      className="block h-16 w-16 rounded border overflow-hidden bg-muted flex items-center justify-center"
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
                  className="h-16 w-16 border-2 border-dashed rounded flex items-center justify-center cursor-pointer hover:bg-muted/50 transition-colors"
                  title="إضافة ملف"
                >
                  {uploadingImage ? (
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  ) : (
                    <Upload className="h-5 w-5 text-muted-foreground" />
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

          {/* Refused Checkbox */}
          <div className="flex items-center gap-3 pt-2">
            <Checkbox
              id="refused"
              checked={formData.refused}
              onCheckedChange={(checked) => setFormData({ ...formData, refused: checked === true })}
            />
            <Label htmlFor="refused" className="cursor-pointer">
              راجع (مرفوض)
            </Label>
            {formData.refused && (
              <Badge variant="destructive" className="mr-2">راجع</Badge>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between flex-row">
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
