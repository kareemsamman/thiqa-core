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
import { Loader2, FileImage, ExternalLink } from "lucide-react";
import { sanitizeChequeNumber, CHEQUE_NUMBER_MAX_LENGTH } from "@/lib/chequeUtils";
import { getInsuranceTypeLabel } from "@/lib/insuranceTypes";

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
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    amount: 0,
    payment_type: 'cash',
    payment_date: '',
    cheque_number: '',
    refused: false,
  });

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
    }
  }, [payment]);

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
                <span>الوثيقة:</span>
                <Badge variant="outline">
                  {getInsuranceTypeLabel(payment.policy.policy_type_parent as any, (payment.policy.policy_type_child || null) as any)}
                </Badge>
                <span className="text-xs">
                  (سعر الوثيقة: ₪{payment.policy.insurance_price.toLocaleString()})
                </span>
              </div>
            )
          )}

          {/* Locked info — soft warning, but fields stay editable for admins */}
          {isLocked && (
            <div className="bg-warning/10 border border-warning/30 text-warning-foreground px-3 py-2 rounded-lg text-xs">
              ℹ️ هذه دفعة لوثيقة إلزامية — عدّل بحذر.
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
              className="text-lg font-semibold"
            />
          </div>

          {/* Payment Type */}
          <div className="space-y-2">
            <Label>طريقة الدفع</Label>
            <Select
              value={formData.payment_type}
              onValueChange={(value) => setFormData({ ...formData, payment_type: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="اختر طريقة الدفع" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">نقدي</SelectItem>
                <SelectItem value="cheque">شيك</SelectItem>
                <SelectItem value="visa">بطاقة</SelectItem>
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
            />
          </div>

          {/* Cheque Image Link */}
          {payment.cheque_image_url && (
            <div className="space-y-2">
              <Label>صورة الإيصال</Label>
              <a
                href={payment.cheque_image_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-primary hover:underline text-sm"
              >
                <FileImage className="h-4 w-4" />
                عرض الملف المرفق
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}

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

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            إلغاء
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                جاري الحفظ...
              </>
            ) : (
              'حفظ التعديلات'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
