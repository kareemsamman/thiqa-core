import { useState, useEffect } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArabicDatePicker } from '@/components/ui/arabic-date-picker';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface SettlementSupplement {
  id: string;
  company_id: string;
  description: string;
  insurance_price: number;
  company_payment: number;
  profit: number;
  settlement_date: string;
  created_at: string;
  customer_name?: string | null;
  car_number?: string | null;
  car_value?: number | null;
  policy_type?: string | null;
  is_cancelled?: boolean | null;
  start_date?: string | null;
  end_date?: string | null;
}

interface SupplementFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingSupplement: SettlementSupplement | null;
  companyId: string;
  onSaved: () => void;
}

const EMPTY_FORM = {
  description: 'ملحق',
  insurance_price: '0',
  company_payment: '',
  profit: '0',
  settlement_date: new Date().toISOString().split('T')[0],
  customer_name: '',
  car_number: '',
  car_value: '',
  policy_type: '',
  is_cancelled: false,
  start_date: '',
  end_date: '',
};

export function SupplementFormDialog({ open, onOpenChange, editingSupplement, companyId, onSaved }: SupplementFormDialogProps) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // When editingSupplement changes or dialog opens, populate the form
  useEffect(() => {
    if (!open) return;
    if (editingSupplement) {
      setForm({
        description: editingSupplement.description,
        insurance_price: editingSupplement.insurance_price.toString(),
        company_payment: editingSupplement.company_payment.toString(),
        profit: editingSupplement.profit.toString(),
        settlement_date: editingSupplement.settlement_date,
        customer_name: editingSupplement.customer_name || '',
        car_number: editingSupplement.car_number || '',
        car_value: editingSupplement.car_value ? editingSupplement.car_value.toString() : '',
        policy_type: editingSupplement.policy_type || '',
        is_cancelled: editingSupplement.is_cancelled || false,
        start_date: editingSupplement.start_date || '',
        end_date: editingSupplement.end_date || '',
      });
    } else {
      setForm(EMPTY_FORM);
    }
  }, [open, editingSupplement]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: any = {
        company_id: companyId,
        description: form.description || 'ملحق',
        insurance_price: parseFloat(form.insurance_price) || 0,
        company_payment: parseFloat(form.company_payment) || 0,
        profit: parseFloat(form.profit) || 0,
        settlement_date: form.settlement_date,
        customer_name: form.customer_name || null,
        car_number: form.car_number || null,
        car_value: form.car_value ? parseFloat(form.car_value) : null,
        policy_type: form.policy_type || null,
        is_cancelled: form.is_cancelled,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
      };

      // Only update if editingSupplement has an id (i.e. real edit, not duplicate)
      if (editingSupplement && (editingSupplement as any)._isEdit) {
        await supabase.from('settlement_supplements').update(payload).eq('id', editingSupplement.id);
      } else {
        await supabase.from('settlement_supplements').insert(payload);
      }

      onOpenChange(false);
      onSaved();
      toast.success(editingSupplement && (editingSupplement as any)._isEdit ? 'تم تحديث الملحق' : 'تم إضافة الملحق');
    } catch (e) {
      toast.error('فشل في حفظ الملحق');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {editingSupplement && (editingSupplement as any)._isEdit ? 'تعديل ملحق' : 'إضافة ملحق'}
          </AlertDialogTitle>
        </AlertDialogHeader>
        <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>اسم العميل</Label>
              <Input value={form.customer_name} onChange={(e) => setForm(f => ({ ...f, customer_name: e.target.value }))} placeholder="اسم العميل" />
            </div>
            <div className="space-y-2">
              <Label>رقم السيارة</Label>
              <Input value={form.car_number} onChange={(e) => setForm(f => ({ ...f, car_number: e.target.value }))} placeholder="رقم السيارة" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>قيمة السيارة</Label>
              <Input type="number" value={form.car_value} onChange={(e) => setForm(f => ({ ...f, car_value: e.target.value }))} placeholder="0" />
            </div>
            <div className="space-y-2">
              <Label>نوع التأمين</Label>
              <Select value={form.policy_type} onValueChange={(v) => setForm(f => ({ ...f, policy_type: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر النوع" />
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="إلزامي">إلزامي</SelectItem>
                  <SelectItem value="ثالث">ثالث</SelectItem>
                  <SelectItem value="شامل">شامل</SelectItem>
                  <SelectItem value="خدمة طريق">خدمة طريق</SelectItem>
                  <SelectItem value="إعفاء رسوم">إعفاء رسوم</SelectItem>
                  <SelectItem value="أخرى">أخرى</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>تاريخ البداية</Label>
              <ArabicDatePicker value={form.start_date} onChange={(d) => setForm(f => ({ ...f, start_date: d }))} />
            </div>
            <div className="space-y-2">
              <Label>تاريخ النهاية</Label>
              <ArabicDatePicker value={form.end_date} onChange={(d) => setForm(f => ({ ...f, end_date: d }))} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Label>ملغاة</Label>
            <input type="checkbox" checked={form.is_cancelled} onChange={(e) => setForm(f => ({ ...f, is_cancelled: e.target.checked }))} className="h-4 w-4" />
          </div>
          <hr className="border-border" />
          <div className="space-y-2">
            <Label>الوصف</Label>
            <Input value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} placeholder="ملحق" />
          </div>
          <div className="space-y-2">
            <Label>تاريخ التسوية</Label>
            <ArabicDatePicker value={form.settlement_date} onChange={(d) => setForm(f => ({ ...f, settlement_date: d }))} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>سعر التأمين</Label>
              <Input type="number" value={form.insurance_price} onChange={(e) => setForm(f => ({ ...f, insurance_price: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>المستحق للشركة *</Label>
              <Input type="number" value={form.company_payment} onChange={(e) => setForm(f => ({ ...f, company_payment: e.target.value }))} placeholder="+ أو -" />
            </div>
            <div className="space-y-2">
              <Label>الربح</Label>
              <Input type="number" value={form.profit} onChange={(e) => setForm(f => ({ ...f, profit: e.target.value }))} />
            </div>
          </div>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>إلغاء</AlertDialogCancel>
          <AlertDialogAction onClick={handleSave} disabled={saving || !form.company_payment}>
            {saving ? 'جاري الحفظ...' : 'حفظ'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
