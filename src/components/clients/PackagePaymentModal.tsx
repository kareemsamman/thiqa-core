import { useState, useEffect, useMemo } from 'react';
import { useAgentContext } from '@/hooks/useAgentContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
import { BankPicker } from '@/components/shared/BankPicker';
import { useToast } from '@/hooks/use-toast';
import type { Enums } from "@/integrations/supabase/types";
import { ArabicDatePicker } from '@/components/ui/arabic-date-picker';

interface PaymentLine {
  id: string;
  amount: number;
  paymentType: 'cash' | 'cheque' | 'transfer' | 'visa';
  /** For cheque rows = تاريخ الاستحقاق (when the cheque can be cashed). */
  paymentDate: string;
  /** Cheque-only: تاريخ الإصدار. Defaults to today. */
  chequeIssueDate?: string;
  chequeNumber?: string;
  bankCode?: string | null;
  branchCode?: string | null;
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
  /** Synthetic line for the aggregated "عمولة التحويل" row. The real
   *  policies.office_commission has this amount subtracted out, and it
   *  shows up as a separate entry in the breakdown. */
  isTransferFee?: boolean;
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
  const [creditBalance, setCreditBalance] = useState(0);
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

  // Credit the customer already has with us (from refunds) offsets their debt.
  const appliedCredit = Math.min(creditBalance, Math.max(0, totalRemaining - paidVisaTotal));

  // Remaining to pay should account for already completed visa payments
  // and any refund credit we already owe the customer.
  const effectiveRemaining = Math.max(0, totalRemaining - paidVisaTotal - appliedCredit);
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

  // Pre-fill the first payment line with the effective remaining once policies
  // and credit are both loaded — but only while the line is still untouched.
  useEffect(() => {
    if (loading || policies.length === 0) return;
    const netRemaining = Math.max(0, totalRemaining - Math.min(creditBalance, totalRemaining));
    setPaymentLines(prev => {
      if (prev.length !== 1) return prev;
      const only = prev[0];
      if (only.amount > 0 || only.paymentType !== 'cash' || only.chequeNumber || only.notes) return prev;
      if (netRemaining <= 0) return prev;
      return [{ ...only, amount: netRemaining }];
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, creditBalance, totalRemaining]);

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

  const fetchPolicyPaymentInfo = async () => {
    setLoading(true);
    try {
      // Fetch policies
      const { data: policiesData, error: policiesError } = await supabase
        .from('policies')
        .select('id, policy_type_parent, policy_type_child, insurance_price, office_commission, client_id, transferred_from_policy_id')
        .in('id', policyIds);

      if (policiesError) throw policiesError;

      const pkgClientId = (policiesData || [])[0]?.client_id || null;
      if (pkgClientId) {
        await fetchCreditBalance(pkgClientId);
      } else {
        setCreditBalance(0);
      }

      // Fetch payments for these policies
      const { data: paymentsData, error: paymentsError } = await supabase
        .from('policy_payments')
        .select('policy_id, amount, refused')
        .in('policy_id', policyIds);

      if (paymentsError) throw paymentsError;

      // Transfer adjustments — the transfer fee is already baked into the
      // target policy's office_commission, so we pull it out here and
      // display it as its own synthetic "عمولة التحويل" line. Only the
      // customer_pays side counts (refunds are tracked separately).
      const transferredIds = (policiesData || [])
        .filter((p: any) => p.transferred_from_policy_id)
        .map((p: any) => p.id);
      const transferAmountByPolicy: Record<string, number> = {};
      if (transferredIds.length > 0) {
        const { data: transferRows } = await supabase
          .from('policy_transfers')
          .select('new_policy_id, adjustment_amount, adjustment_type')
          .in('new_policy_id', transferredIds);
        (transferRows || []).forEach((row: any) => {
          if (
            row?.new_policy_id &&
            row?.adjustment_type === 'customer_pays' &&
            Number(row?.adjustment_amount) > 0
          ) {
            transferAmountByPolicy[row.new_policy_id] = Number(row.adjustment_amount);
          }
        });
      }

      // Calculate per-policy info
      const policyPayments: Record<string, number> = {};
      (paymentsData || []).forEach(p => {
        if (!p.refused) {
          policyPayments[p.policy_id] = (policyPayments[p.policy_id] || 0) + p.amount;
        }
      });

      // Split rule: payments allocated to a transferred policy fill its
      // own base price FIRST (insurance + remaining office commission),
      // and only the overflow is credited against the transfer-fee
      // bucket. That keeps the per-policy row paying down its own debt
      // before the synthetic "عمولة التحويل" line shows any paid.
      let totalTransferPortion = 0;
      let totalTransferPaid = 0;
      const policyInfo: PolicyPaymentInfo[] = (policiesData || []).map((p: any) => {
        const transferPortion = transferAmountByPolicy[p.id] || 0;
        const fullPrice = (p.insurance_price || 0) + (p.office_commission || 0);
        const basePrice = Math.max(0, fullPrice - transferPortion);
        const paidToPolicy = policyPayments[p.id] || 0;
        const basePaid = Math.min(paidToPolicy, basePrice);
        const transferPaid = Math.max(0, paidToPolicy - basePrice);
        totalTransferPortion += transferPortion;
        totalTransferPaid += transferPaid;
        return {
          policyId: p.id,
          policyType: p.policy_type_parent,
          policyTypeChild: p.policy_type_child || null,
          price: basePrice,
          paid: basePaid,
          remaining: Math.max(0, basePrice - basePaid),
        };
      });

      if (totalTransferPortion > 0) {
        policyInfo.push({
          policyId: '__transfer_fee__',
          policyType: 'TRANSFER_FEE',
          policyTypeChild: null,
          price: totalTransferPortion,
          paid: totalTransferPaid,
          remaining: Math.max(0, totalTransferPortion - totalTransferPaid),
          isTransferFee: true,
        });
      }

      setPolicies(policyInfo);

      // Initialize with one empty payment line. A follow-up effect fills the
      // amount after the refund credit loads so pre-fill matches the true
      // effective remaining (avoids a false "overpaying" warning on open).
      setPaymentLines([{
        id: crypto.randomUUID(),
        amount: 0,
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
      const today = new Date().toISOString().split('T')[0];
      const payment: PaymentLine = {
        id: paymentId,
        amount: cheque.amount || 0,
        paymentType: 'cheque' as const,
        paymentDate: cheque.payment_date || today,
        chequeIssueDate: today,
        chequeNumber: cheque.cheque_number || '',
        bankCode: cheque.bank_code || null,
        branchCode: cheque.branch_code || cheque.branch_number || null,
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
      // Skip the synthetic "عمولة التحويل" line — it has no policy_id
      // to allocate payments against; the paid column on that row is
      // derived from overflow into the transferred policy's bucket.
      if (policy.isTransferFee) return;
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
      // Use primary policy (first real one) for all payments — the
      // synthetic "عمولة التحويل" line has no policy_id to attach to.
      const primaryPolicyId = policies.find(p => !p.isTransferFee)?.policyId;
      if (!primaryPolicyId) throw new Error('No policy found');

      // Generate a batch_id to group all payments in this batch
      const batchId = crypto.randomUUID();

      // Pre-allocate ONE receipt_number for the whole submit — same
      // rule as DebtPaymentModal: a single collection event = a single
      // سند قبض number, regardless of how many payment methods. The
      // BEFORE-INSERT trigger would otherwise allocate per-row and
      // every paymentLine would get its own R-number.
      let sessionReceiptNumber: string | null = null;
      const { data: rNum, error: rNumErr } = await supabase.rpc(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'allocate_receipt_number_for_policy' as any,
        { p_policy_id: primaryPolicyId },
      );
      if (rNumErr) {
        console.warn('[PackagePaymentModal] receipt_number pre-allocate failed; trigger will fall back', rNumErr);
      } else if (typeof rNum === 'string') {
        sessionReceiptNumber = rNum;
      }

      for (const paymentLine of paymentLines) {
        // Skip already paid visa payments (already recorded via Tranzila)
        if (paymentLine.paymentType === 'visa' && paymentLine.tranzilaPaid) {
          continue;
        }

        const todayIso = new Date().toISOString().split('T')[0];
        const { data, error } = await supabase
          .from('policy_payments')
          .insert({
            policy_id: primaryPolicyId,
            amount: paymentLine.amount,
            payment_type: paymentLine.paymentType as Enums<'payment_type'>,
            payment_date: paymentLine.paymentDate,
            cheque_due_date:
              paymentLine.paymentType === 'cheque' ? paymentLine.paymentDate : null,
            cheque_issue_date:
              paymentLine.paymentType === 'cheque'
                ? paymentLine.chequeIssueDate ?? todayIso
                : null,
            cheque_number: paymentLine.paymentType === 'cheque' ? paymentLine.chequeNumber : null,
            cheque_image_url: paymentLine.chequeImageUrl || null,
            cheque_status: paymentLine.paymentType === 'cheque' ? 'pending' : null,
            bank_code: paymentLine.paymentType === 'cheque' ? (paymentLine.bankCode || null) : null,
            branch_code: paymentLine.paymentType === 'cheque' ? (paymentLine.branchCode || null) : null,
            refused: false,
            notes: paymentLine.notes || `دفعة من باقة (${policies.filter(p => !p.isTransferFee).length} معاملات)`,
            branch_id: branchId,
            batch_id: batchId,
            // Same R-number across every row of this submit (see
            // pre-allocate comment above). Null → trigger falls back
            // to per-row allocation; used only on RPC error.
            ...(sessionReceiptNumber ? { receipt_number: sessionReceiptNumber } : {}),
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

  // Get first real policy for Tranzila (skip the synthetic transfer-fee line)
  const firstPolicyId = policies.find(p => p.remaining > 0 && !p.isTransferFee)?.policyId
    || policies.find(p => !p.isTransferFee)?.policyId;
  const activeVisaPayment = activeVisaPaymentIndex !== null ? paymentLines[activeVisaPaymentIndex] : null;

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[95vw] max-h-[92vh] sm:max-h-[90vh] overflow-y-auto p-4 sm:p-6" dir="rtl">
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
            {/* Sticky-top summary so إجمالي / مدفوع / متبقي stay visible
                while the user scrolls through multiple payment lines —
                same pattern as DebtPaymentModal. */}
            <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 pt-1 pb-2 bg-background border-b">
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
                  {appliedCredit > 0 && (
                    <div className="text-[10px] text-muted-foreground mt-1 space-y-0.5">
                      <p>المطلوب: ₪{(totalRemaining - paidVisaTotal).toLocaleString()}</p>
                      <p className="text-amber-600">المرتجع: -₪{appliedCredit.toLocaleString()}</p>
                    </div>
                  )}
                </Card>
              </div>
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

            {/* Per-policy breakdown removed — the total cards at the top
                (إجمالي السعر / المدفوع / المتبقي) are all staff need here.
                Per-policy allocation is arbitrary at payment time (payments
                all land on the primary policy and waterfall across the
                package), so splitting rows only invited confusion. The
                full breakdown still lives on the card's مكونات الباقة
                panel and in the printed invoice. */}

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

              {paymentLines.map((payment, index) => ({ payment, index })).reverse().map(({ payment, index }) => (
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

                    {/* One 3-col row for amount / method / date so the
                        payment essentials fit on a single line instead
                        of two separate grids. Mobile collapses to a
                        single column via grid-cols-1. */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <Label className="text-xs">المبلغ</Label>
                        <Input
                          type="number"
                          value={payment.amount || ''}
                          onChange={e => updatePaymentLine(payment.id, 'amount', parseFloat(e.target.value) || 0)}
                          placeholder={`أقصى: ₪${effectiveRemaining.toLocaleString()}`}
                          className="h-10"
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
                          <SelectTrigger className="h-10">
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
                      <div>
                        <Label className="text-xs">
                          {payment.paymentType === 'cheque' ? 'تاريخ الاستحقاق' : 'تاريخ الدفع'}
                        </Label>
                        <ArabicDatePicker
                          value={payment.paymentDate}
                          onChange={(date) => updatePaymentLine(payment.id, 'paymentDate', date)}
                          disabled={payment.tranzilaPaid}
                        />
                      </div>
                    </div>

                    {/* Cheque sub-row: 4 equal columns (Bank | Branch |
                        Cheque# | Issue date) — same layout as
                        DebtPaymentModal so both pay flows read alike. */}
                    {payment.paymentType === 'cheque' && (
                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                        <div className="space-y-1.5 min-w-0">
                          <Label className="text-xs font-semibold">البنك</Label>
                          <BankPicker
                            value={payment.bankCode}
                            onChange={(code) => updatePaymentLine(payment.id, 'bankCode', code)}
                            disabled={payment.tranzilaPaid}
                          />
                        </div>
                        <div className="space-y-1.5 min-w-0">
                          <Label className="text-xs font-semibold">الفرع</Label>
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
                        <div className="space-y-1.5 min-w-0">
                          <Label className="text-xs font-semibold">رقم الشيك</Label>
                          <Input
                            value={payment.chequeNumber || ''}
                            onChange={e => updatePaymentLine(payment.id, 'chequeNumber', sanitizeChequeNumber(e.target.value))}
                            maxLength={CHEQUE_NUMBER_MAX_LENGTH}
                            placeholder="رقم الشيك"
                            className="h-10 font-mono ltr-input"
                            disabled={payment.tranzilaPaid}
                          />
                        </div>
                        <div className="space-y-1.5 min-w-0">
                          <Label className="text-xs">تاريخ الإصدار</Label>
                          <ArabicDatePicker
                            value={payment.chequeIssueDate || new Date().toISOString().split('T')[0]}
                            onChange={(date) => updatePaymentLine(payment.id, 'chequeIssueDate', date)}
                            disabled={payment.tranzilaPaid}
                          />
                        </div>
                      </div>
                    )}

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

                    <div>
                      <Label className="text-xs">ملاحظات (اختياري)</Label>
                      <Input
                        value={payment.notes || ''}
                        onChange={e => updatePaymentLine(payment.id, 'notes', e.target.value)}
                        placeholder="ملاحظات إضافية"
                        disabled={payment.tranzilaPaid}
                      />
                    </div>

                    {/* Inline image upload — same compact strip used in
                        DebtPaymentModal. Label + thumbs + إضافة button
                        all on one row instead of a dashed drop block. */}
                    {(payment.paymentType === 'cash' || payment.paymentType === 'cheque' || payment.paymentType === 'transfer') && !payment.tranzilaPaid && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <Label className="text-xs text-muted-foreground whitespace-nowrap">
                          {payment.paymentType === 'cheque' ? 'صورة الشيك:' : payment.paymentType === 'transfer' ? 'صورة الحوالة:' : 'صورة الإيصال:'}
                        </Label>
                        {getPreviewUrls(payment.id).map((item, imgIndex) => (
                          <div key={imgIndex} className="relative">
                            {item.kind === 'pdf' ? (
                              <div
                                className="h-9 w-12 rounded border bg-red-50 border-red-200 flex flex-col items-center justify-center gap-0.5"
                                title={item.name || 'PDF'}
                              >
                                <FileText className="h-3.5 w-3.5 text-red-500" />
                                <span className="text-[8px] font-bold text-red-500">PDF</span>
                              </div>
                            ) : (
                              <img
                                src={item.url}
                                alt={item.name || 'Preview'}
                                className="h-9 w-12 object-cover rounded border"
                              />
                            )}
                            <button
                              type="button"
                              onClick={() => removeImage(payment.id, imgIndex)}
                              className="absolute -top-1 -right-1 bg-destructive text-white rounded-full p-0.5"
                            >
                              <X className="h-2.5 w-2.5" />
                            </button>
                          </div>
                        ))}
                        <label className="h-9 px-2.5 inline-flex items-center gap-1.5 border border-dashed rounded cursor-pointer hover:bg-muted/50 transition-colors text-xs text-muted-foreground">
                          <input
                            type="file"
                            accept="image/*,application/pdf"
                            multiple
                            className="hidden"
                            onChange={(e) => handleImageSelect(payment.id, e)}
                          />
                          <Upload className="h-3.5 w-3.5" />
                          إضافة
                        </label>
                      </div>
                    )}
                  </div>
                </Card>
              ))}

            </div>
          </div>
        )}

        {/* Combined sticky-bottom bar — same as DebtPaymentModal: مجموع
            الدفعات + validation banners + action buttons all pinned
            together so the cashier sees totals AND the save button at
            once no matter how far down they scrolled. */}
        <div className="sticky bottom-0 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 pt-3 pb-2 bg-background border-t space-y-2">
          {!loading && totalRemaining > 0 && (
            <>
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
            </>
          )}
          <div className="flex justify-end gap-3 pt-1">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              إلغاء
            </Button>
            <Button onClick={handleSubmit} disabled={!isValid || saving || totalRemaining <= 0}>
              {saving && <Loader2 className="h-4 w-4 animate-spin ml-2" />}
              إضافة الدفعات
            </Button>
          </div>
        </div>
      </DialogContent>

      {/* Tranzila Payment Modal */}
      {activeVisaPayment && firstPolicyId && (
        <TranzilaPaymentModal
          open={tranzilaModalOpen}
          onOpenChange={setTranzilaModalOpen}
          policyId={firstPolicyId}
          amount={activeVisaPayment.amount}
          paymentDate={activeVisaPayment.paymentDate}
          notes={activeVisaPayment.notes || `دفعة من باقة (${policies.filter(p => !p.isTransferFee).length} معاملات)`}
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
