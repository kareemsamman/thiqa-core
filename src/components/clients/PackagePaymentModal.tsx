import { useState, useEffect, useMemo } from 'react';
import { useAgentContext } from '@/hooks/useAgentContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Card } from '@/components/ui/card';
import { Loader2, CreditCard, Banknote, Wallet, AlertCircle, CheckCircle, Package, Plus, Trash2, Split, Upload, X, ImageIcon, Scan, FileText } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { TranzilaPaymentModal } from '@/components/payments/TranzilaPaymentModal';
import { ChequeScannerDialog } from '@/components/payments/ChequeScannerDialog';
import { sanitizeChequeNumber, CHEQUE_NUMBER_MAX_LENGTH } from '@/lib/chequeUtils';
import { useToast } from '@/hooks/use-toast';
import type { Enums } from "@/integrations/supabase/types";
import { ArabicDatePicker } from '@/components/ui/arabic-date-picker';
import { getInsuranceTypeLabel } from '@/lib/insuranceTypes';

interface PaymentLine {
  id: string;
  amount: number;
  paymentType: 'cash' | 'cheque' | 'transfer' | 'visa';
  paymentDate: string;
  chequeNumber?: string;
  chequeImageUrl?: string;
  notes?: string;
  tranzilaPaid?: boolean;
  pendingImages?: File[];
}

interface PreviewItem {
  url: string;
  kind: 'image' | 'pdf';
  name?: string;
}

interface PreviewUrls {
  [paymentId: string]: PreviewItem[];
}

interface PolicyPaymentInfo {
  policyId: string;
  policyType: string;
  policyTypeChild: string | null;
  price: number;
  paid: number;
  remaining: number;
}

interface PackagePaymentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policyIds: string[];
  branchId: string | null;
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

export function PackagePaymentModal({
  open,
  onOpenChange,
  policyIds,
  branchId,
  onSuccess,
}: PackagePaymentModalProps) {
  const { toast: uiToast } = useToast();
  const { hasFeature } = useAgentContext();
  const paymentTypes = useMemo(() => hasFeature('visa_payment') ? [...paymentTypesBase, paymentTypeVisa] : paymentTypesBase, [hasFeature]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [policies, setPolicies] = useState<PolicyPaymentInfo[]>([]);
  const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([]);
  const [tranzilaModalOpen, setTranzilaModalOpen] = useState(false);
  const [activeVisaPaymentIndex, setActiveVisaPaymentIndex] = useState<number | null>(null);
  const [splitPopoverOpen, setSplitPopoverOpen] = useState(false);
  const [splitCount, setSplitCount] = useState(2);
  const [previewUrls, setPreviewUrls] = useState<PreviewUrls>({});
  const [chequeScannerOpen, setChequeScannerOpen] = useState(false);

  const totalRemaining = policies.reduce((sum, p) => sum + p.remaining, 0);
  const totalPrice = policies.reduce((sum, p) => sum + p.price, 0);
  const totalPaid = policies.reduce((sum, p) => sum + p.paid, 0);
  
  // Calculate total payments - count paid visa payments as already completed
  const paidVisaTotal = paymentLines
    .filter(p => p.paymentType === 'visa' && p.tranzilaPaid)
    .reduce((sum, p) => sum + (p.amount || 0), 0);
  
  const pendingPaymentsTotal = paymentLines
    .filter(p => !(p.paymentType === 'visa' && p.tranzilaPaid))
    .reduce((sum, p) => sum + (p.amount || 0), 0);
  
  const totalPaymentAmount = paymentLines.reduce((sum, p) => sum + (p.amount || 0), 0);
  
  // Remaining to pay should account for already completed visa payments
  const effectiveRemaining = totalRemaining - paidVisaTotal;
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
    if (open && policyIds.length > 0) {
      fetchPolicyPaymentInfo();
    }
  }, [open, policyIds]);

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

    const newPreviewItems: PreviewItem[] = validFiles.map(file => ({
      url: URL.createObjectURL(file),
      kind: file.type === 'application/pdf' ? 'pdf' : 'image',
      name: file.name,
    }));
    setPreviewUrls(prev => ({
      ...prev,
      [paymentId]: [...(prev[paymentId] || []), ...newPreviewItems],
    }));
    
    const payment = paymentLines.find(p => p.id === paymentId);
    if (payment) {
      const existingFiles = payment.pendingImages || [];
      updatePaymentLine(paymentId, 'pendingImages', [...existingFiles, ...validFiles]);
    }
  };

  const removeImage = (paymentId: string, index: number) => {
    const items = previewUrls[paymentId] || [];
    const target = items[index];
    if (target?.url?.startsWith('blob:')) {
      URL.revokeObjectURL(target.url);
    }

    setPreviewUrls(prev => {
      const newItems = (prev[paymentId] || []).filter((_, i) => i !== index);
      if (newItems.length === 0) {
        const { [paymentId]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [paymentId]: newItems };
    });
    
    const payment = paymentLines.find(p => p.id === paymentId);
    if (payment && payment.pendingImages) {
      const newFiles = payment.pendingImages.filter((_, i) => i !== index);
      updatePaymentLine(paymentId, 'pendingImages', newFiles.length > 0 ? newFiles : undefined);
    }
  };

  const getPreviewUrls = (paymentId: string) => previewUrls[paymentId] || [];

  const fetchPolicyPaymentInfo = async () => {
    setLoading(true);
    try {
      // Fetch policies
      const { data: policiesData, error: policiesError } = await supabase
        .from('policies')
        .select('id, policy_type_parent, policy_type_child, insurance_price, office_commission')
        .in('id', policyIds);

      if (policiesError) throw policiesError;

      // Fetch payments for these policies
      const { data: paymentsData, error: paymentsError } = await supabase
        .from('policy_payments')
        .select('policy_id, amount, refused')
        .in('policy_id', policyIds);

      if (paymentsError) throw paymentsError;

      // Calculate per-policy info
      const policyPayments: Record<string, number> = {};
      (paymentsData || []).forEach(p => {
        if (!p.refused) {
          policyPayments[p.policy_id] = (policyPayments[p.policy_id] || 0) + p.amount;
        }
      });

      const policyInfo = (policiesData || []).map(p => {
        const effectivePrice = p.insurance_price + ((p as any).office_commission || 0);
        return {
          policyId: p.id,
          policyType: p.policy_type_parent,
          policyTypeChild: p.policy_type_child || null,
          price: effectivePrice,
          paid: policyPayments[p.id] || 0,
          remaining: effectivePrice - (policyPayments[p.id] || 0),
        };
      });

      setPolicies(policyInfo);

      // Initialize with single payment line for remaining amount
      const currentRemaining = policyInfo.reduce((sum, p) => sum + p.remaining, 0);
      setPaymentLines([{
        id: crypto.randomUUID(),
        amount: currentRemaining > 0 ? currentRemaining : 0,
        paymentType: 'cash',
        paymentDate: new Date().toISOString().split('T')[0],
      }]);
      setPreviewUrls({});
    } catch (error) {
      console.error('Error fetching policy payment info:', error);
      toast.error('خطأ في جلب بيانات الدفع');
    } finally {
      setLoading(false);
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
      const items = previewUrls[id] || [];
      items.forEach(item => {
        if (item.url?.startsWith('blob:')) URL.revokeObjectURL(item.url);
      });
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
    if (splitCount < 2 || splitCount > 12 || totalRemaining <= 0) return;
    
    const amountPerInstallment = Math.floor(totalRemaining / splitCount);
    const remainder = totalRemaining - (amountPerInstallment * splitCount);
    
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
    Object.values(previewUrls)
      .flat()
      .forEach(item => {
        if (item.url?.startsWith('blob:')) URL.revokeObjectURL(item.url);
      });
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
        chequeImageUrl: cheque.image_url || undefined,
      };
      
      // If we have a CDN image_url from the scanner, use it as preview
      if (cheque.image_url) {
        newPreviewUrls[paymentId] = [{ url: cheque.image_url, kind: 'image' }];
      }
      // Fallback: Convert cropped image to File and add to pendingImages
      else if (cheque.cropped_base64) {
        try {
          const blob = base64ToBlob(cheque.cropped_base64);
          const file = new File([blob], `cheque_${cheque.cheque_number || paymentId}.jpg`, { type: 'image/jpeg' });
          payment.pendingImages = [file];
          newPreviewUrls[paymentId] = [{ url: URL.createObjectURL(blob), kind: 'image', name: file.name }];
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

  // Calculate proportional splits for a given amount
  const calculateSplitPayments = (amount: number) => {
    const splits: { policyId: string; amount: number }[] = [];
    
    if (amount <= 0 || totalRemaining <= 0) return splits;

    policies.forEach(policy => {
      if (policy.remaining > 0) {
        const proportion = policy.remaining / totalRemaining;
        const policyPayment = Math.min(amount * proportion, policy.remaining);
        if (policyPayment > 0) {
          splits.push({
            policyId: policy.policyId,
            amount: Math.round(policyPayment * 100) / 100,
          });
        }
      }
    });

    // Adjust for rounding errors
    const totalSplit = splits.reduce((sum, s) => sum + s.amount, 0);
    const diff = amount - totalSplit;
    if (splits.length > 0 && Math.abs(diff) > 0.001) {
      splits[0].amount = Math.round((splits[0].amount + diff) * 100) / 100;
    }

    return splits;
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
      // Use primary policy (first one) for all payments — trigger validates across the whole group
      const primaryPolicyId = policies[0]?.policyId;
      if (!primaryPolicyId) throw new Error('No policy found');

      // Generate a batch_id to group all payments in this batch
      const batchId = crypto.randomUUID();

      for (const paymentLine of paymentLines) {
        // Skip already paid visa payments (already recorded via Tranzila)
        if (paymentLine.paymentType === 'visa' && paymentLine.tranzilaPaid) {
          continue;
        }

        const { data, error } = await supabase
          .from('policy_payments')
          .insert({
            policy_id: primaryPolicyId,
            amount: paymentLine.amount,
            payment_type: paymentLine.paymentType as Enums<'payment_type'>,
            payment_date: paymentLine.paymentDate,
            cheque_number: paymentLine.paymentType === 'cheque' ? paymentLine.chequeNumber : null,
            cheque_image_url: paymentLine.chequeImageUrl || null,
            cheque_status: paymentLine.paymentType === 'cheque' ? 'pending' : null,
            refused: false,
            notes: paymentLine.notes || `دفعة من باقة (${policies.length} وثائق)`,
            branch_id: branchId,
            batch_id: batchId,
          })
          .select('id')
          .single();

        if (error) throw error;

        // Upload images for this payment
        if (paymentLine.pendingImages && paymentLine.pendingImages.length > 0 && data) {
          await uploadPaymentImages(data.id, paymentLine.pendingImages);
        }
      }

      toast.success(`تمت إضافة الدفعات بنجاح`);
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

  // Get first policy for Tranzila
  const firstPolicyId = policies.find(p => p.remaining > 0)?.policyId;
  const activeVisaPayment = activeVisaPaymentIndex !== null ? paymentLines[activeVisaPaymentIndex] : null;

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            دفع للباقة كاملة
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : totalRemaining <= 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <CheckCircle className="h-12 w-12 text-success" />
            <p className="text-lg font-medium">هذه الباقة مدفوعة بالكامل</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Summary Cards */}
            <div className="grid grid-cols-3 gap-2">
              <Card className="p-3 text-center bg-muted/50">
                <p className="text-xs text-muted-foreground mb-1">إجمالي السعر</p>
                <p className="text-lg font-bold">₪{totalPrice.toLocaleString()}</p>
              </Card>
              <Card className="p-3 text-center bg-green-50 dark:bg-green-950/20">
                <p className="text-xs text-muted-foreground mb-1">المدفوع</p>
                <p className="text-lg font-bold text-success">₪{(totalPaid + paidVisaTotal).toLocaleString()}</p>
              </Card>
              <Card className="p-3 text-center bg-red-50 dark:bg-red-950/20">
                <p className="text-xs text-muted-foreground mb-1">المتبقي</p>
                <p className="text-lg font-bold text-destructive">₪{effectiveRemaining.toLocaleString()}</p>
              </Card>
            </div>

            {/* Policy List */}
            <div className="border rounded-lg divide-y max-h-32 overflow-auto">
              {policies.map(policy => (
                <div key={policy.policyId} className="flex items-center justify-between p-2 text-sm">
                  <Badge variant="outline" className="text-xs">
                    {getInsuranceTypeLabel(policy.policyType as any, policy.policyTypeChild as any)}
                  </Badge>
                  <div className="flex items-center gap-3">
                    <span className="text-muted-foreground">₪{policy.price.toLocaleString()}</span>
                    <span className={cn(
                      "font-medium",
                      policy.remaining > 0 ? "text-destructive" : "text-success"
                    )}>
                      {policy.remaining > 0 ? `-₪${policy.remaining.toLocaleString()}` : '✓'}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Payment Lines */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-base font-semibold">الدفعات</Label>
                <div className="flex items-center gap-2">
                  <Popover open={splitPopoverOpen} onOpenChange={setSplitPopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" disabled={totalRemaining <= 0}>
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
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => removePaymentLine(payment.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                      {payment.tranzilaPaid && (
                        <Badge variant="success" className="gap-1">
                          <CheckCircle className="h-3 w-3" />
                          تم الدفع
                        </Badge>
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
                          onValueChange={(val) => updatePaymentLine(payment.id, 'paymentType', val)}
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
                      {payment.paymentType === 'cheque' && (
                        <div>
                          <Label className="text-xs">رقم الشيك</Label>
                          <Input
                            value={payment.chequeNumber || ''}
                            onChange={e => updatePaymentLine(payment.id, 'chequeNumber', sanitizeChequeNumber(e.target.value))}
                            maxLength={CHEQUE_NUMBER_MAX_LENGTH}
                            placeholder="رقم الشيك"
                            disabled={payment.tranzilaPaid}
                          />
                        </div>
                      )}
                    </div>

                    {/* Visa Pay Button */}
                    {payment.paymentType === 'visa' && !payment.tranzilaPaid && (
                      <Button
                        variant="outline"
                        className="w-full border-primary text-primary hover:bg-primary hover:text-primary-foreground"
                        onClick={() => handleVisaPayClick(index)}
                        disabled={payment.amount <= 0}
                      >
                        <CreditCard className="h-4 w-4 ml-2" />
                        دفع ₪{(payment.amount || 0).toLocaleString()} بالبطاقة
                      </Button>
                    )}

                    {/* Image Upload for cash/cheque/transfer */}
                    {(payment.paymentType === 'cash' || payment.paymentType === 'cheque' || payment.paymentType === 'transfer') && !payment.tranzilaPaid && (
                      <div className="space-y-2">
                        <Label className="text-xs flex items-center gap-1">
                          <ImageIcon className="h-3 w-3" />
                          {payment.paymentType === 'cheque' ? 'صورة الشيك' : payment.paymentType === 'transfer' ? 'صورة الحوالة' : 'صورة الإيصال'}
                        </Label>
                        <div className="flex items-center gap-2 flex-wrap">
                          {getPreviewUrls(payment.id).map((item, imgIndex) => (
                            <div key={imgIndex} className="relative">
                              {item.kind === 'pdf' ? (
                                <div
                                  className="h-16 w-16 rounded border bg-red-50 border-red-200 flex flex-col items-center justify-center gap-0.5"
                                  title={item.name || 'PDF'}
                                >
                                  <FileText className="h-5 w-5 text-red-500" />
                                  <span className="text-[9px] font-bold text-red-500">PDF</span>
                                </div>
                              ) : (
                                <img
                                  src={item.url}
                                  alt={item.name || 'Preview'}
                                  className="h-16 w-16 object-cover rounded border"
                                />
                              )}
                              <button
                                type="button"
                                onClick={() => removeImage(payment.id, imgIndex)}
                                className="absolute -top-1 -right-1 bg-destructive text-white rounded-full p-0.5"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                          <label className="h-16 w-16 border-2 border-dashed rounded flex items-center justify-center cursor-pointer hover:bg-muted/50 transition-colors">
                            <Upload className="h-5 w-5 text-muted-foreground" />
                            <input
                              type="file"
                              accept="image/*,application/pdf"
                              multiple
                              className="hidden"
                              onChange={(e) => handleImageSelect(payment.id, e)}
                            />
                          </label>
                        </div>
                      </div>
                    )}

                    <div>
                      <Label className="text-xs">ملاحظات (اختياري)</Label>
                      <Input
                        value={payment.notes || ''}
                        onChange={e => updatePaymentLine(payment.id, 'notes', e.target.value)}
                        placeholder="ملاحظات إضافية"
                        disabled={payment.tranzilaPaid}
                      />
                    </div>
                  </div>
                </Card>
              ))}

              {/* Overpaying Warning */}
              {isOverpaying && (
                <div className="flex items-center gap-2 text-destructive text-sm p-2 bg-destructive/10 rounded-lg">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>مجموع الدفعات أكبر من المبلغ المتبقي</span>
                </div>
              )}

              {hasUnpaidVisa && (
                <div className="flex items-center gap-2 text-amber-600 text-sm p-2 bg-amber-50 dark:bg-amber-950/20 rounded-lg">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>يرجى إتمام الدفع بالبطاقة أولاً قبل الحفظ</span>
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button onClick={handleSubmit} disabled={!isValid || saving || totalRemaining <= 0}>
            {saving && <Loader2 className="h-4 w-4 animate-spin ml-2" />}
            إضافة الدفعات
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Tranzila Payment Modal */}
      {activeVisaPayment && firstPolicyId && (
        <TranzilaPaymentModal
          open={tranzilaModalOpen}
          onOpenChange={setTranzilaModalOpen}
          policyId={firstPolicyId}
          amount={activeVisaPayment.amount}
          paymentDate={activeVisaPayment.paymentDate}
          notes={activeVisaPayment.notes || `دفعة من باقة (${policies.length} وثائق)`}
          onSuccess={handleTranzilaSuccess}
          onFailure={() => setTranzilaModalOpen(false)}
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
