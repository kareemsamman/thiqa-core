import { useState, useEffect, useMemo } from 'react';
import { useAgentContext } from '@/hooks/useAgentContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Card } from '@/components/ui/card';
import { Loader2, CreditCard, Banknote, Wallet, AlertCircle, CheckCircle, FileText, Plus, Trash2, Split, Upload, X, ImageIcon, Scan } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { TranzilaPaymentModal } from '@/components/payments/TranzilaPaymentModal';
import { ChequeScannerDialog } from '@/components/payments/ChequeScannerDialog';
import { sanitizeChequeNumber, CHEQUE_NUMBER_MAX_LENGTH } from '@/lib/chequeUtils';
import { BankPicker } from '@/components/shared/BankPicker';
import { useToast } from '@/hooks/use-toast';
import type { Enums } from "@/integrations/supabase/types";
import { ArabicDatePicker } from '@/components/ui/arabic-date-picker';

interface PaymentLine {
  id: string;
  amount: number;
  paymentType: 'cash' | 'cheque' | 'transfer' | 'visa';
  paymentDate: string;
  chequeNumber?: string;
  bankCode?: string | null;
  branchCode?: string | null;
  notes?: string;
  tranzilaPaid?: boolean;
  pendingImages?: File[];
}

interface PreviewUrls {
  [paymentId: string]: string[];
}

interface SinglePolicyPaymentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policyId: string;
  policyType: string;
  policyTypeChild?: string | null;
  insurancePrice: number;
  officeCommission?: number;
  branchId?: string | null;
  onSuccess: () => void | Promise<void>;
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

const paymentTypesBase = [
  { value: 'cash', label: 'نقدي', icon: Banknote },
  { value: 'cheque', label: 'شيك', icon: CreditCard },
  { value: 'transfer', label: 'تحويل', icon: Wallet },
];
const paymentTypeVisa = { value: 'visa', label: 'فيزا', icon: CreditCard };

export function SinglePolicyPaymentModal({
  open,
  onOpenChange,
  policyId,
  policyType,
  policyTypeChild,
  insurancePrice,
  officeCommission,
  branchId,
  onSuccess,
}: SinglePolicyPaymentModalProps) {
  const { toast: uiToast } = useToast();
  const { hasFeature } = useAgentContext();
  const paymentTypes = useMemo(() => hasFeature('visa_payment') ? [...paymentTypesBase, paymentTypeVisa] : paymentTypesBase, [hasFeature]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [totalPaid, setTotalPaid] = useState(0);
  const [creditBalance, setCreditBalance] = useState(0);
  const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([]);
  const [tranzilaModalOpen, setTranzilaModalOpen] = useState(false);
  const [activeVisaPaymentIndex, setActiveVisaPaymentIndex] = useState<number | null>(null);
  const [splitPopoverOpen, setSplitPopoverOpen] = useState(false);
  const [splitCount, setSplitCount] = useState(2);
  const [previewUrls, setPreviewUrls] = useState<PreviewUrls>({});
  const [chequeScannerOpen, setChequeScannerOpen] = useState(false);

  const effectiveTotalPrice = insurancePrice + (officeCommission || 0);
  const remaining = effectiveTotalPrice - totalPaid;
  
  // Calculate total payments - count paid visa payments as already completed
  const paidVisaTotal = paymentLines
    .filter(p => p.paymentType === 'visa' && p.tranzilaPaid)
    .reduce((sum, p) => sum + (p.amount || 0), 0);
  
  const pendingPaymentsTotal = paymentLines
    .filter(p => !(p.paymentType === 'visa' && p.tranzilaPaid))
    .reduce((sum, p) => sum + (p.amount || 0), 0);
  
  const totalPaymentAmount = paymentLines.reduce((sum, p) => sum + (p.amount || 0), 0);

  // Credit the customer has with us (refunds) offsets their debt.
  const appliedCredit = Math.min(creditBalance, Math.max(0, remaining - paidVisaTotal));

  // Remaining to pay should account for already completed visa payments
  // and any refund credit we already owe the customer.
  const effectiveRemaining = Math.max(0, remaining - paidVisaTotal - appliedCredit);
  const isOverpaying = pendingPaymentsTotal > effectiveRemaining;
  
  // Check for unpaid visa payments
  const hasUnpaidVisa = paymentLines.some(p => p.paymentType === 'visa' && !p.tranzilaPaid);

  // Validation
  const isValid = paymentLines.length > 0 && 
    totalPaymentAmount > 0 && 
    !isOverpaying &&
    !hasUnpaidVisa && // Block if unpaid visa exists
    paymentLines.every(p => {
      if (p.paymentType === 'cheque' && !p.chequeNumber?.trim()) return false;
      if (p.paymentType === 'visa' && !p.tranzilaPaid && p.amount <= 0) return false;
      return p.amount > 0;
    });

  useEffect(() => {
    if (open && policyId) {
      fetchExistingPayments();
    }
  }, [open, policyId]);

  // Pre-fill the first payment line with the effective remaining once the
  // refund credit has loaded — only while the line is still untouched.
  useEffect(() => {
    if (loading) return;
    const netRemaining = Math.max(0, remaining - Math.min(creditBalance, remaining));
    setPaymentLines(prev => {
      if (prev.length !== 1) return prev;
      const only = prev[0];
      if (only.amount > 0 || only.paymentType !== 'cash' || only.chequeNumber || only.notes) return prev;
      if (netRemaining <= 0) return prev;
      return [{ ...only, amount: netRemaining }];
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, creditBalance, remaining]);

  // Image handling functions
  const handleImageSelect = (paymentId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    
    const validFiles = files.filter(file => {
      const isImage = file.type.startsWith('image/');
      const isPdf = file.type === 'application/pdf';
      if (!isImage && !isPdf) {
        uiToast({ title: "خطأ", description: "يرجى اختيار صور أو ملفات PDF فقط", variant: "destructive" });
        return false;
      }
      if (file.size > 10 * 1024 * 1024) {
        uiToast({ title: "خطأ", description: "حجم الملف يجب أن يكون أقل من 10MB", variant: "destructive" });
        return false;
      }
      return true;
    });

    if (validFiles.length === 0) return;

    const newPreviewUrls = validFiles.map(file => URL.createObjectURL(file));
    setPreviewUrls(prev => ({
      ...prev,
      [paymentId]: [...(prev[paymentId] || []), ...newPreviewUrls],
    }));
    
    const payment = paymentLines.find(p => p.id === paymentId);
    if (payment) {
      const existingFiles = payment.pendingImages || [];
      updatePaymentLine(paymentId, 'pendingImages', [...existingFiles, ...validFiles]);
    }
  };

  const removeImage = (paymentId: string, index: number) => {
    const urls = previewUrls[paymentId] || [];
    if (urls[index]) {
      URL.revokeObjectURL(urls[index]);
    }
    
    setPreviewUrls(prev => {
      const newUrls = (prev[paymentId] || []).filter((_, i) => i !== index);
      if (newUrls.length === 0) {
        const { [paymentId]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [paymentId]: newUrls };
    });
    
    const payment = paymentLines.find(p => p.id === paymentId);
    if (payment && payment.pendingImages) {
      const newFiles = payment.pendingImages.filter((_, i) => i !== index);
      updatePaymentLine(paymentId, 'pendingImages', newFiles.length > 0 ? newFiles : undefined);
    }
  };

  const getPreviewUrls = (paymentId: string) => previewUrls[paymentId] || [];

  const fetchExistingPayments = async () => {
    setLoading(true);
    try {
      const { data: paymentsData, error } = await supabase
        .from('policy_payments')
        .select('amount, refused')
        .eq('policy_id', policyId);

      if (error) throw error;

      const paid = (paymentsData || [])
        .filter(p => !p.refused)
        .reduce((sum, p) => sum + p.amount, 0);

      setTotalPaid(paid);

      // Fetch the policy's client_id so we can look up their refund credit.
      const { data: policyRow } = await supabase
        .from('policies')
        .select('client_id')
        .eq('id', policyId)
        .maybeSingle();

      if (policyRow?.client_id) {
        await fetchCreditBalance(policyRow.client_id);
      } else {
        setCreditBalance(0);
      }

      // Initialize with one empty payment line. A follow-up effect pre-fills
      // it once the credit balance is loaded.
      setPaymentLines([{
        id: crypto.randomUUID(),
        amount: 0,
        paymentType: 'cash',
        paymentDate: new Date().toISOString().split('T')[0],
      }]);
      setPreviewUrls({});
    } catch (error) {
      console.error('Error fetching payments:', error);
      toast.error('خطأ في جلب بيانات الدفع');
    } finally {
      setLoading(false);
    }
  };

  // Net amount currently owed to the client from refunds — offsets debt in
  // the payment popup so the staff sees the true amount to collect.
  const fetchCreditBalance = async (cid: string) => {
    try {
      const { data, error } = await supabase
        .from('customer_wallet_transactions')
        .select('amount, transaction_type')
        .eq('client_id', cid);

      if (error) throw error;

      const weOwe = (data || [])
        .filter(t =>
          t.transaction_type === 'refund' ||
          t.transaction_type === 'transfer_refund_owed' ||
          t.transaction_type === 'manual_refund'
        )
        .reduce((sum, t) => sum + (t.amount || 0), 0);

      const customerOwes = (data || [])
        .filter(t => t.transaction_type === 'transfer_adjustment_due')
        .reduce((sum, t) => sum + (t.amount || 0), 0);

      setCreditBalance(Math.max(0, weOwe - customerOwes));
    } catch (error) {
      console.error('Error fetching credit balance:', error);
      setCreditBalance(0);
    }
  };

  const addPaymentLine = () => {
    setPaymentLines([
      ...paymentLines,
      {
        id: crypto.randomUUID(),
        amount: 0,
        paymentType: 'cash',
        paymentDate: new Date().toISOString().split('T')[0],
      },
    ]);
  };

  const removePaymentLine = (id: string) => {
    if (paymentLines.length > 1) {
      // Clean up preview URLs
      const urls = previewUrls[id] || [];
      urls.forEach(url => URL.revokeObjectURL(url));
      setPreviewUrls(prev => {
        const { [id]: _, ...rest } = prev;
        return rest;
      });
      setPaymentLines(paymentLines.filter(p => p.id !== id));
    }
  };

  const updatePaymentLine = (id: string, field: keyof PaymentLine, value: any) => {
    setPaymentLines(paymentLines.map(p => p.id === id ? { ...p, [field]: value } : p));
  };

  const handleSplitPayments = () => {
    if (splitCount < 2 || splitCount > 12 || remaining <= 0) return;
    
    const amountPerInstallment = Math.floor(remaining / splitCount);
    const remainder = remaining - (amountPerInstallment * splitCount);
    
    const today = new Date();
    const newPayments: PaymentLine[] = [];
    
    for (let i = 0; i < splitCount; i++) {
      const paymentDate = new Date(today);
      paymentDate.setMonth(today.getMonth() + i);
      
      const amount = i === 0 ? amountPerInstallment + remainder : amountPerInstallment;
      
      newPayments.push({
        id: crypto.randomUUID(),
        amount,
        paymentType: 'cash',
        paymentDate: paymentDate.toISOString().split('T')[0],
      });
    }
    
    // Clean up old preview URLs
    Object.values(previewUrls).flat().forEach(url => URL.revokeObjectURL(url));
    setPreviewUrls({});
    setPaymentLines(newPayments);
    setSplitPopoverOpen(false);
  };

  // Helper to convert base64 to Blob
  const base64ToBlob = (base64: string, type = 'image/jpeg'): Blob => {
    try {
      const cleanBase64 = base64.includes(',') ? base64.split(',')[1] : base64;
      const byteString = atob(cleanBase64);
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
      }
      return new Blob([ab], { type });
    } catch (e) {
      console.error('Failed to convert base64 to blob:', e);
      return new Blob([], { type });
    }
  };

  const handleScannedCheques = (cheques: any[]) => {
    const newPayments: PaymentLine[] = [];
    const newPreviewUrls: PreviewUrls = {};
    
    for (const cheque of cheques) {
      const paymentId = crypto.randomUUID();
      const payment: PaymentLine = {
        id: paymentId,
        amount: cheque.amount || 0,
        paymentType: 'cheque' as const,
        paymentDate: cheque.payment_date || new Date().toISOString().split('T')[0],
        chequeNumber: cheque.cheque_number || '',
        bankCode: cheque.bank_code || null,
        branchCode: cheque.branch_code || cheque.branch_number || null,
      };
      
      // Convert cropped image to File and add to pendingImages
      if (cheque.cropped_base64) {
        try {
          const blob = base64ToBlob(cheque.cropped_base64);
          const file = new File([blob], `cheque_${cheque.cheque_number || paymentId}.jpg`, { type: 'image/jpeg' });
          payment.pendingImages = [file];
          newPreviewUrls[paymentId] = [URL.createObjectURL(blob)];
        } catch (e) {
          console.error('Failed to convert cheque image:', e);
        }
      }
      
      newPayments.push(payment);
    }
    
    setPreviewUrls(prev => ({ ...prev, ...newPreviewUrls }));
    setPaymentLines(prev => [...prev, ...newPayments]);
    toast.success(`تم إضافة ${newPayments.length} دفعة شيك مع الصور`);
  };

  const handleVisaPayClick = (index: number) => {
    const payment = paymentLines[index];
    if (!payment || payment.amount <= 0) return;

    setActiveVisaPaymentIndex(index);
    setTranzilaModalOpen(true);
  };

  const handleTranzilaSuccess = () => {
    setTranzilaModalOpen(false);
    
    if (activeVisaPaymentIndex !== null) {
      updatePaymentLine(paymentLines[activeVisaPaymentIndex].id, 'tranzilaPaid', true);
    }
    
    setActiveVisaPaymentIndex(null);
  };

  // Upload images helper
  const uploadPaymentImages = async (paymentId: string, files: File[]): Promise<void> => {
    if (files.length === 0) return;
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const formData = new FormData();
      formData.append('file', file);
      formData.append('entity_type', 'payment');
      formData.append('entity_id', paymentId);

      try {
        const { data, error } = await supabase.functions.invoke('upload-media', {
          body: formData,
        });

        if (!error && (data?.file?.cdn_url || data?.url)) {
          const cdnUrl = data.file?.cdn_url || data.url;
          const imageType = i === 0 ? 'front' : i === 1 ? 'back' : 'receipt';
          await supabase.from('payment_images').insert({
            payment_id: paymentId,
            image_url: cdnUrl,
            image_type: imageType,
            sort_order: i,
          });
        }
      } catch (err) {
        console.error('Error uploading payment image:', err);
      }
    }
  };

  const handleSubmit = async () => {
    if (!isValid) return;

    // Check for unpaid visa payments
    const unpaidVisaPayments = paymentLines.filter(p => p.paymentType === 'visa' && !p.tranzilaPaid);
    if (unpaidVisaPayments.length > 0) {
      uiToast({ title: "تنبيه", description: "يرجى إتمام الدفع بالبطاقة أولاً", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      for (const paymentLine of paymentLines) {
        // Skip already paid visa payments (already recorded via Tranzila)
        if (paymentLine.paymentType === 'visa' && paymentLine.tranzilaPaid) {
          continue;
        }

        const { data, error } = await supabase
          .from('policy_payments')
          .insert({
            policy_id: policyId,
            amount: paymentLine.amount,
            payment_type: paymentLine.paymentType as Enums<'payment_type'>,
            payment_date: paymentLine.paymentDate,
            cheque_number: paymentLine.paymentType === 'cheque' ? paymentLine.chequeNumber : null,
            cheque_status: paymentLine.paymentType === 'cheque' ? 'pending' : null,
            bank_code: paymentLine.paymentType === 'cheque' ? (paymentLine.bankCode || null) : null,
            branch_code: paymentLine.paymentType === 'cheque' ? (paymentLine.branchCode || null) : null,
            refused: false,
            notes: paymentLine.notes || null,
            branch_id: branchId || null,
          })
          .select('id')
          .single();

        if (error) throw error;

        // Upload images if any
        if (paymentLine.pendingImages && paymentLine.pendingImages.length > 0 && data) {
          await uploadPaymentImages(data.id, paymentLine.pendingImages);
        }
      }

      toast.success(`تمت إضافة ${paymentLines.length} دفعة بنجاح`);
      await onSuccess();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error adding payments:', error);
      if (error.message?.includes('Payment total exceeds')) {
        toast.error('مجموع الدفعات يتجاوز سعر التأمين');
      } else {
        toast.error('فشل في إضافة الدفعات');
      }
    } finally {
      setSaving(false);
    }
  };

  const getPolicyLabel = () => {
    const parent = policyTypeLabels[policyType] || policyType;
    if (policyTypeChild) {
      return `${parent} - ${policyTypeChild}`;
    }
    return parent;
  };

  const activeVisaPayment = activeVisaPaymentIndex !== null ? paymentLines[activeVisaPaymentIndex] : null;

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[95vw] max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            دفع للمعاملة
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : remaining <= 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <CheckCircle className="h-12 w-12 text-success" />
            <p className="text-lg font-medium">هذه المعاملة مدفوعة بالكامل</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Summary Cards */}
            <div className="grid grid-cols-3 gap-2">
              <Card className="p-3 text-center bg-muted/50">
                <p className="text-xs text-muted-foreground mb-1">إجمالي السعر</p>
                <p className="text-lg font-bold">₪{effectiveTotalPrice.toLocaleString()}</p>
              </Card>
              <Card className="p-3 text-center bg-green-50 dark:bg-green-950/20">
                <p className="text-xs text-muted-foreground mb-1">المدفوع</p>
                <p className="text-lg font-bold text-success">₪{(totalPaid + paidVisaTotal).toLocaleString()}</p>
              </Card>
              <Card className="p-3 text-center bg-red-50 dark:bg-red-950/20">
                <p className="text-xs text-muted-foreground mb-1">المتبقي</p>
                <p className="text-lg font-bold text-destructive">₪{effectiveRemaining.toLocaleString()}</p>
                {appliedCredit > 0 && (
                  <div className="text-[10px] text-muted-foreground mt-1 space-y-0.5">
                    <p>المطلوب: ₪{(remaining - paidVisaTotal).toLocaleString()}</p>
                    <p className="text-amber-600">المرتجع: -₪{appliedCredit.toLocaleString()}</p>
                  </div>
                )}
              </Card>
            </div>

            {appliedCredit > 0 && (
              <div className="flex items-start gap-2 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 text-amber-900 dark:text-amber-200">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
                <p className="text-xs leading-relaxed">
                  لدى العميل رصيد مرتجع بقيمة <span className="font-bold ltr-nums">₪{creditBalance.toLocaleString()}</span> تم خصمه من المطلوب.
                  المبلغ المستحق فعلياً للدفع هو <span className="font-bold ltr-nums">₪{effectiveRemaining.toLocaleString()}</span>.
                </p>
              </div>
            )}

            {/* Policy Info */}
            <div className="flex items-center justify-between p-2 rounded-lg border bg-muted/30">
              <Badge variant="secondary">{getPolicyLabel()}</Badge>
              <div className="flex items-center gap-3">
                <span className="text-muted-foreground">₪{insurancePrice.toLocaleString()}</span>
                <span className="font-medium text-destructive">
                  -₪{remaining.toLocaleString()}
                </span>
              </div>
            </div>

            {/* Payment Lines */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-base font-semibold">الدفعات</Label>
                <div className="flex items-center gap-2">
                  <Popover open={splitPopoverOpen} onOpenChange={setSplitPopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" disabled={remaining <= 0}>
                        <Split className="h-4 w-4 ml-2" />
                        تقسيط
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-60" align="end">
                      <div className="space-y-3">
                        <Label>عدد الأقساط</Label>
                        <Input
                          type="number"
                          min={2}
                          max={12}
                          value={splitCount}
                          onChange={e => setSplitCount(parseInt(e.target.value) || 2)}
                        />
                        <Button onClick={handleSplitPayments} className="w-full">
                          تقسيم إلى {splitCount} دفعات
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                  <Button variant="outline" size="sm" onClick={() => setChequeScannerOpen(true)}>
                    <Scan className="h-4 w-4 ml-2" />
                    مسح شيكات
                  </Button>
                  <Button variant="outline" size="sm" onClick={addPaymentLine}>
                    <Plus className="h-4 w-4 ml-2" />
                    إضافة دفعة
                  </Button>
                </div>
              </div>

              {paymentLines.map((payment, index) => (
                <Card key={payment.id} className={cn(
                  "p-3",
                  payment.tranzilaPaid && "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800"
                )}>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-muted-foreground">دفعة {index + 1}</span>
                      {paymentLines.length > 1 && !payment.tranzilaPaid && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive"
                          onClick={() => removePaymentLine(payment.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">المبلغ</Label>
                        <Input
                          type="number"
                          value={payment.amount || ''}
                          onChange={e => updatePaymentLine(payment.id, 'amount', parseFloat(e.target.value) || 0)}
                          placeholder={`أقصى: ₪${effectiveRemaining.toLocaleString()}`}
                          disabled={payment.tranzilaPaid}
                        />
                      </div>
                      <div>
                        <Label className="text-xs">طريقة الدفع</Label>
                        <Select 
                          value={payment.paymentType} 
                          onValueChange={v => updatePaymentLine(payment.id, 'paymentType', v)}
                          disabled={payment.tranzilaPaid}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {paymentTypes.map(pt => (
                              <SelectItem key={pt.value} value={pt.value}>
                                <span className="flex items-center gap-2">
                                  <pt.icon className="h-4 w-4" />
                                  {pt.label}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">تاريخ الدفع</Label>
                        <ArabicDatePicker
                          value={payment.paymentDate}
                          onChange={(date) => updatePaymentLine(payment.id, 'paymentDate', date)}
                          disabled={payment.tranzilaPaid}
                          compact
                        />
                      </div>
                    </div>

                    {/* Cheque-only row: bank → branch → رقم الشيك, same
                        order and field widths as every other cheque
                        entry flow. */}
                    {payment.paymentType === 'cheque' && (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div>
                          <Label className="text-xs">البنك</Label>
                          <BankPicker
                            value={payment.bankCode}
                            onChange={(code) => updatePaymentLine(payment.id, 'bankCode', code)}
                            disabled={payment.tranzilaPaid}
                          />
                        </div>
                        <div>
                          <Label className="text-xs">الفرع</Label>
                          <Input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            maxLength={4}
                            value={payment.branchCode || ''}
                            onChange={(e) => {
                              const v = e.target.value.replace(/\D/g, '');
                              updatePaymentLine(payment.id, 'branchCode', v || null);
                            }}
                            placeholder="مثال: 305"
                            className="h-10 font-mono ltr-nums"
                            disabled={payment.tranzilaPaid}
                          />
                        </div>
                        <div>
                          <Label className="text-xs">رقم الشيك</Label>
                          <Input
                            value={payment.chequeNumber || ''}
                            onChange={e => updatePaymentLine(payment.id, 'chequeNumber', sanitizeChequeNumber(e.target.value))}
                            placeholder="رقم الشيك"
                            maxLength={CHEQUE_NUMBER_MAX_LENGTH}
                            className="h-10 font-mono ltr-input"
                            disabled={payment.tranzilaPaid}
                          />
                        </div>
                      </div>
                    )}

                    <div>
                      <Label className="text-xs">ملاحظات (اختياري)</Label>
                      <Textarea
                        value={payment.notes || ''}
                        onChange={e => updatePaymentLine(payment.id, 'notes', e.target.value)}
                        placeholder="أضف ملاحظة لهذه الدفعة..."
                        rows={2}
                        disabled={payment.tranzilaPaid}
                        className="resize-none text-sm"
                      />
                    </div>

                    {/* Visa Pay Button */}
                    {payment.paymentType === 'visa' && (
                      <div className="flex items-center gap-2">
                        {payment.tranzilaPaid ? (
                          <Badge className="bg-green-500">
                            <CheckCircle className="h-3 w-3 ml-1" />
                            تم الدفع
                          </Badge>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleVisaPayClick(index)}
                            disabled={payment.amount <= 0}
                          >
                            <CreditCard className="h-4 w-4 ml-2" />
                            ادفع الآن
                          </Button>
                        )}
                      </div>
                    )}

                    {/* Image Upload Section for Cash/Cheque/Transfer */}
                    {(payment.paymentType === 'cash' || payment.paymentType === 'cheque' || payment.paymentType === 'transfer') && (
                      <div className="pt-3 border-t border-border/50">
                        <div className="flex-1">
                          <Label className="text-xs text-muted-foreground mb-2 block">
                            {payment.paymentType === 'cheque' ? 'صور الشيك (أمامي/خلفي)' : payment.paymentType === 'transfer' ? 'صور إيصال التحويل' : 'صور إيصال الدفع'}
                          </Label>
                          <div className="flex flex-wrap gap-2">
                            {/* Preview existing images */}
                            {getPreviewUrls(payment.id).map((url, imgIndex) => (
                              <div key={imgIndex} className="relative group">
                                <img 
                                  src={url} 
                                  alt="" 
                                  className="h-14 w-18 object-cover rounded border"
                                />
                                <button
                                  type="button"
                                  onClick={() => removeImage(payment.id, imgIndex)}
                                  className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            ))}
                            {/* Upload button */}
                            <label className="h-14 w-18 border-2 border-dashed rounded flex flex-col items-center justify-center cursor-pointer hover:bg-muted/50 transition-colors">
                              <input 
                                type="file" 
                                accept="image/*,application/pdf" 
                                multiple 
                                onChange={(e) => handleImageSelect(payment.id, e)} 
                                className="hidden" 
                              />
                              <Upload className="h-4 w-4 text-muted-foreground" />
                              <span className="text-[10px] text-muted-foreground mt-0.5">إضافة</span>
                            </label>
                          </div>
                          {payment.pendingImages && payment.pendingImages.length > 0 && (
                            <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                              <ImageIcon className="h-3 w-3" />
                              {payment.pendingImages.length} ملفات سيتم رفعها عند الحفظ
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </Card>
              ))}
            </div>

            {/* Total and Validation */}
            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
              <span className="font-medium">مجموع الدفعات:</span>
              <span className={cn("text-lg font-bold", isOverpaying && "text-destructive")}>
                ₪{totalPaymentAmount.toLocaleString()}
              </span>
            </div>

            {isOverpaying && (
              <p className="text-sm text-destructive flex items-center gap-1">
                <AlertCircle className="h-4 w-4" />
                مجموع الدفعات أكبر من المبلغ المتبقي (₪{effectiveRemaining.toLocaleString()})
              </p>
            )}

            {hasUnpaidVisa && (
              <div className="flex items-center gap-2 text-amber-600 text-sm p-2 bg-amber-50 dark:bg-amber-950/20 rounded-lg">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>يرجى إتمام الدفع بالبطاقة أولاً قبل الحفظ</span>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button onClick={handleSubmit} disabled={!isValid || saving || remaining <= 0}>
            {saving && <Loader2 className="h-4 w-4 animate-spin ml-2" />}
            تسديد المبلغ
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Tranzila Payment Modal */}
      {activeVisaPayment && (
        <TranzilaPaymentModal
          open={tranzilaModalOpen}
          onOpenChange={setTranzilaModalOpen}
          policyId={policyId}
          amount={activeVisaPayment.amount}
          paymentDate={activeVisaPayment.paymentDate}
          notes={activeVisaPayment.notes || `دفعة للمعاملة`}
          onSuccess={handleTranzilaSuccess}
          onFailure={() => {
            setTranzilaModalOpen(false);
            setActiveVisaPaymentIndex(null);
          }}
        />
      )}
    </Dialog>

      <ChequeScannerDialog
        open={chequeScannerOpen}
        onOpenChange={setChequeScannerOpen}
        onConfirm={handleScannedCheques}
      />
    </>
  );
}
