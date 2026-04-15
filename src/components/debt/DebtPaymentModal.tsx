import React, { useState, useEffect, useMemo } from 'react';
import { useAgentContext } from '@/hooks/useAgentContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Loader2, CreditCard, Banknote, Wallet, AlertCircle, CheckCircle, DollarSign, Plus, Trash2, Split, Upload, X, ImageIcon, HelpCircle, Car, Package, FileText, Info, Scan } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { extractFunctionErrorMessage } from '@/lib/functionError';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { TranzilaPaymentModal } from '@/components/payments/TranzilaPaymentModal';
import { ChequeScannerDialog } from '@/components/payments/ChequeScannerDialog';
import { sanitizeChequeNumber, CHEQUE_NUMBER_MAX_LENGTH } from '@/lib/chequeUtils';
import { BankBranchPicker } from '@/components/shared/BankBranchPicker';
import { useToast } from '@/hooks/use-toast';
import { ArabicDatePicker } from '@/components/ui/arabic-date-picker';

// Represents each policy inside a debt item
interface PolicyComponent {
  policyId: string;
  policyType: string;
  policyTypeChild: string | null;
  price: number;
  paid: number;
  remaining: number;
  branchId: string | null;
  officeCommission: number;
}

// Represents a debt item (package or single policy)
interface DebtItem {
  itemKey: string;        // group_id or `single_${policy_id}`
  isPackage: boolean;
  policies: PolicyComponent[];
  fullPrice: number;      // Sum of all policies including ELZAMI
  paidTotal: number;      // Sum of all payments for this item
  remainingTotal: number; // fullPrice - paidTotal (clamped to 0)
  carNumber: string | null;
  includesElzami: boolean;
  // For payment distribution - policies that can receive payments (non-ELZAMI with remaining > 0)
  payablePolicies: PolicyComponent[];
}

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
  cheque_image_url?: string;
}

interface PreviewUrls {
  [paymentId: string]: string[];
}

interface DebtPaymentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  clientName: string;
  clientPhone: string | null;
  totalOwed: number;
  onSuccess: () => void;
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

const policyChildLabels: Record<string, string> = {
  THIRD: 'ثالث',
  FULL: 'شامل',
};

const paymentTypesBase = [
  { value: 'cash', label: 'نقدي', icon: Banknote },
  { value: 'cheque', label: 'شيك', icon: CreditCard },
  { value: 'transfer', label: 'تحويل', icon: Wallet },
];
const paymentTypeVisa = { value: 'visa', label: 'فيزا', icon: CreditCard };

export function DebtPaymentModal({
  open,
  onOpenChange,
  clientId,
  clientName,
  clientPhone,
  totalOwed,
  onSuccess,
}: DebtPaymentModalProps) {
  const { toast: uiToast } = useToast();
  const { hasFeature } = useAgentContext();
  const paymentTypes = useMemo(() => hasFeature('visa_payment') ? [...paymentTypesBase, paymentTypeVisa] : paymentTypesBase, [hasFeature]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [debtItems, setDebtItems] = useState<DebtItem[]>([]);
  const [creditBalance, setCreditBalance] = useState(0);
  const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([]);
  const [tranzilaModalOpen, setTranzilaModalOpen] = useState(false);
  const [activeVisaPaymentIndex, setActiveVisaPaymentIndex] = useState<number | null>(null);
  const [activeTranzilaPolicyId, setActiveTranzilaPolicyId] = useState<string | null>(null);
  const [splitPopoverOpen, setSplitPopoverOpen] = useState(false);
  const [splitCount, setSplitCount] = useState(2);
  const [previewUrls, setPreviewUrls] = useState<PreviewUrls>({});
  const [selectedCars, setSelectedCars] = useState<string[]>([]);
  const [chequeScannerOpen, setChequeScannerOpen] = useState(false);

  // Extract unique car numbers for filter
  const uniqueCars = React.useMemo(() => {
    const cars = debtItems
      .filter(item => item.carNumber)
      .map(item => item.carNumber!)
      .filter((v, i, a) => a.indexOf(v) === i);
    return cars;
  }, [debtItems]);

  // Toggle car selection
  const toggleCar = (car: string) => {
    setSelectedCars(prev => 
      prev.includes(car) 
        ? prev.filter(c => c !== car) 
        : [...prev, car]
    );
  };

  // Filter items by selected cars (empty array = all cars)
  const filteredItems = React.useMemo(() => {
    if (selectedCars.length === 0) return debtItems;
    return debtItems.filter(item => item.carNumber && selectedCars.includes(item.carNumber));
  }, [debtItems, selectedCars]);

  // All payable policies from filtered items
  const allPayablePolicies = React.useMemo(() => {
    return filteredItems.flatMap(item => item.payablePolicies);
  }, [filteredItems]);

  // Summary calculations
  const totalFullPrice = filteredItems.reduce((sum, item) => sum + item.fullPrice, 0);
  const totalPaidAmount = filteredItems.reduce((sum, item) => sum + item.paidTotal, 0);
  const totalRemaining = filteredItems.reduce((sum, item) => sum + item.remainingTotal, 0);
  
  // Calculate total payments - count paid visa payments as already completed
  const paidVisaTotal = paymentLines
    .filter(p => p.paymentType === 'visa' && p.tranzilaPaid)
    .reduce((sum, p) => sum + (p.amount || 0), 0);
  
  const pendingPaymentsTotal = paymentLines
    .filter(p => !(p.paymentType === 'visa' && p.tranzilaPaid))
    .reduce((sum, p) => sum + (p.amount || 0), 0);
  
  const totalPaymentAmount = paymentLines.reduce((sum, p) => sum + (p.amount || 0), 0);

  // Credit the customer already has with us (from refunds / cancellations).
  // We only apply as much of it as there is debt to cover.
  const appliedCredit = Math.min(creditBalance, Math.max(0, totalRemaining - paidVisaTotal));

  // Remaining to pay should account for already completed visa payments AND any
  // credit we already owe the customer — that credit offsets their debt.
  const effectiveRemaining = Math.max(0, totalRemaining - paidVisaTotal - appliedCredit);
  const isOverpaying = pendingPaymentsTotal > effectiveRemaining;
  
  // Check for unpaid visa payments
  const hasUnpaidVisa = paymentLines.some(p => p.paymentType === 'visa' && !p.tranzilaPaid);

  // Check if all non-visa payments have valid data, and visa payments are either paid or have valid amount
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
    if (open && clientId) {
      fetchDebtItems();
      fetchCreditBalance();
      // Reset form with one empty payment line
      setPaymentLines([{
        id: crypto.randomUUID(),
        amount: 0,
        paymentType: 'cash',
        paymentDate: new Date().toISOString().split('T')[0],
      }]);
      setPreviewUrls({});
      setSelectedCars([]);
    }
  }, [open, clientId]);

  // Net amount we currently owe the client (refunds minus adjustments due).
  // This offsets the debt shown in the modal so "المتبقي للدفع" reflects
  // reality — same logic as ClientDetails.fetchWalletBalance.
  const fetchCreditBalance = async () => {
    try {
      const { data, error } = await supabase
        .from('customer_wallet_transactions')
        .select('amount, transaction_type')
        .eq('client_id', clientId);

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

    // Create preview URLs
    const newPreviewUrls = validFiles.map(file => URL.createObjectURL(file));
    setPreviewUrls(prev => ({
      ...prev,
      [paymentId]: [...(prev[paymentId] || []), ...newPreviewUrls],
    }));
    
    // Store files in payment object for later upload
    const payment = paymentLines.find(p => p.id === paymentId);
    if (payment) {
      const existingFiles = payment.pendingImages || [];
      updatePaymentLine(paymentId, 'pendingImages', [...existingFiles, ...validFiles]);
    }
  };

  const removeImage = (paymentId: string, index: number) => {
    // Revoke preview URL
    const urls = previewUrls[paymentId] || [];
    if (urls[index]) {
      URL.revokeObjectURL(urls[index]);
    }
    
    // Update preview URLs
    setPreviewUrls(prev => {
      const newUrls = (prev[paymentId] || []).filter((_, i) => i !== index);
      if (newUrls.length === 0) {
        const { [paymentId]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [paymentId]: newUrls };
    });
    
    // Update payment files
    const payment = paymentLines.find(p => p.id === paymentId);
    if (payment && payment.pendingImages) {
      const newFiles = payment.pendingImages.filter((_, i) => i !== index);
      updatePaymentLine(paymentId, 'pendingImages', newFiles.length > 0 ? newFiles : undefined);
    }
  };

  const getPreviewUrls = (paymentId: string) => previewUrls[paymentId] || [];

  /**
   * Fetch all policies and payments for the client, then build DebtItems
   * grouped by group_id (packages) or individual policies (singles).
   *
   * Broker deals are treated as client debt — the client owes the full
   * package regardless of who arranged it. Because package payments
   * are commonly recorded against one row (often the broker sibling),
   * we group by group_id and pool every payment in the group so a
   * package that was paid in full via the broker row shows as 0
   * remaining even when the non-broker sibling has no direct payments.
   * See migration 20260413240000 for the original أسامة حسام case.
   */
  const fetchDebtItems = async () => {
    setLoading(true);
    try {
      const { data: policiesData, error: policiesError } = await supabase
        .from('policies')
        .select('id, policy_type_parent, policy_type_child, insurance_price, office_commission, branch_id, group_id, broker_id, car:cars(car_number)')
        .eq('client_id', clientId)
        .eq('cancelled', false)
        .eq('transferred', false)
        .is('deleted_at', null);

      if (policiesError) throw policiesError;

      const allPolicyIds = (policiesData || []).map(p => p.id);

      let paymentsMap: Record<string, number> = {};
      if (allPolicyIds.length > 0) {
        const { data: paymentsData, error: paymentsError } = await supabase
          .from('policy_payments')
          .select('policy_id, amount, refused')
          .in('policy_id', allPolicyIds);

        if (paymentsError) throw paymentsError;

        (paymentsData || []).forEach(p => {
          if (!p.refused) {
            paymentsMap[p.policy_id] = (paymentsMap[p.policy_id] || 0) + p.amount;
          }
        });
      }

      // Group policies by group_id or individual.
      const groupMap = new Map<string, typeof policiesData>();

      (policiesData || []).forEach(policy => {
        const key = policy.group_id || `single_${policy.id}`;
        if (!groupMap.has(key)) {
          groupMap.set(key, []);
        }
        groupMap.get(key)!.push(policy);
      });

      const items: DebtItem[] = [];

      groupMap.forEach((groupPolicies, itemKey) => {
        const isPackage = groupPolicies.length > 1 || (groupPolicies[0]?.group_id !== null);

        // Build policy components from every policy in the group
        // (including broker siblings) — the client's debt view is the
        // gross package total.
        const policyComponents: PolicyComponent[] = groupPolicies.map(p => {
          const commission = (p as any).office_commission || 0;
          const effectivePrice = p.insurance_price + commission;
          return {
            policyId: p.id,
            policyType: p.policy_type_parent,
            policyTypeChild: p.policy_type_child,
            price: effectivePrice,
            paid: paymentsMap[p.id] || 0,
            remaining: effectivePrice - (paymentsMap[p.id] || 0),
            branchId: p.branch_id,
            officeCommission: commission,
          };
        });

        const fullPrice = policyComponents.reduce((sum, p) => sum + p.price, 0);
        const paidTotal = policyComponents.reduce((sum, p) => sum + p.paid, 0);
        const fullPackageRemaining = Math.max(0, fullPrice - paidTotal);

        // For debt display: only show non-ELZAMI portion that's actually payable
        // This follows the business rule: ELZAMI is excluded from wallet/debt
        const nonElzamiPrice = policyComponents
          .filter(p => p.policyType !== 'ELZAMI')
          .reduce((sum, p) => sum + p.price, 0)
          + policyComponents
            .filter(p => p.policyType === 'ELZAMI')
            .reduce((sum, p) => sum + p.officeCommission, 0);

        // Remaining debt = min(non-ELZAMI prices, total package remaining)
        // This ensures we don't show ELZAMI debt as client debt
        const remainingTotal = Math.max(0, Math.min(nonElzamiPrice, fullPackageRemaining));

        // Determine which policies can receive payments (non-ELZAMI with remaining > 0)
        // For packages: distribute payment pool internally
        const poolPaid = paidTotal;
        let remainingPool = poolPaid;
        
        // Sort by priority: ELZAMI first (fills up first), then others by price ascending
        const sortedComponents = [...policyComponents].sort((a, b) => {
          if (a.policyType === 'ELZAMI' && b.policyType !== 'ELZAMI') return -1;
          if (a.policyType !== 'ELZAMI' && b.policyType === 'ELZAMI') return 1;
          return a.price - b.price;
        });

        // Distribute paid amount internally to determine what's left to pay per component
        const componentsWithInternalRemaining = sortedComponents.map(comp => {
          const coverAmount = Math.min(remainingPool, comp.price);
          remainingPool = Math.max(0, remainingPool - coverAmount);
          const internalRemaining = comp.price - coverAmount;
          return {
            ...comp,
            remaining: internalRemaining,
          };
        });

        // Payable policies: non-ELZAMI with remaining > 0, OR ELZAMI with unpaid office commission
        const payablePolicies = componentsWithInternalRemaining.filter(
          p => (p.policyType !== 'ELZAMI' && p.remaining > 0) ||
               (p.policyType === 'ELZAMI' && p.officeCommission > 0 && p.remaining > 0)
        );

        // Only include items that have payable policies (with actual debt to collect)
        // Using payablePolicies.length > 0 instead of remainingTotal > 0 ensures
        // packages where only ELZAMI is unpaid don't appear as client debt
        if (payablePolicies.length > 0) {
          items.push({
            itemKey,
            isPackage,
            policies: componentsWithInternalRemaining,
            fullPrice,
            paidTotal,
            remainingTotal,
            carNumber: (groupPolicies[0]?.car as any)?.car_number || null,
            includesElzami: groupPolicies.some(p => p.policy_type_parent === 'ELZAMI'),
            payablePolicies,
          });
        }
      });

      // Sort by remaining (highest first)
      items.sort((a, b) => b.remainingTotal - a.remainingTotal);
      
      setDebtItems(items);
    } catch (error) {
      console.error('Error fetching debt items:', error);
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
        cheque_image_url: cheque.image_url,
      };
      
      // Add CDN URL to preview if available
      if (cheque.image_url) {
        newPreviewUrls[paymentId] = [cheque.image_url];
      }
      // Fallback: Convert cropped image to File (legacy support)
      else if (cheque.cropped_base64) {
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

  /**
   * Sequential "fill one by one" distribution:
   *   * Walk payable policies smallest-remaining first.
   *   * For each, allocate min(amount_left, policy_remaining) until
   *     either the amount is exhausted or there are no more policies.
   *
   * The same logic is used for cash, transfer, AND cheques. For
   * cheques the caller stamps the returned splits with a shared
   * batch_id + cheque_number, which is how PaymentGroupDetailsDialog
   * collapses them back into one visible ledger row — so
   * physically-one-cheque can still hit N policies on the DB side
   * without confusing the user-facing view.
   *
   * Why we do this for cheques too: the per-policy (and per-package-
   * group) validate_policy_payment_total trigger caps every policy's
   * sum(payments) at its own (insurance_price + office_commission).
   * If a single cheque is larger than any one policy's remaining
   * room, dumping the full face value onto one row blows the cap
   * and the insert fails. Splitting across policies keeps every row
   * under its cap while still representing one physical cheque.
   */
  const calculateSplitPayments = (amount: number, _paymentType: string = 'cash') => {
    const splits: { policyId: string; amount: number; branchId: string | null }[] = [];

    if (amount <= 0) return splits;

    // Smallest-remaining first: fill the tightest policies before
    // spilling over into ones with more room. That way a 1550 cheque
    // with (1300, 250) slots becomes [1300, 250] instead of [250, 1300].
    const policiesWithBalance = [...allPayablePolicies]
      .filter(p => p.remaining > 0)
      .sort((a, b) => a.remaining - b.remaining);

    if (policiesWithBalance.length === 0) return splits;

    let remainingAmount = amount;

    for (const policy of policiesWithBalance) {
      if (remainingAmount <= 0) break;

      const paymentForPolicy = Math.min(remainingAmount, policy.remaining);
      if (paymentForPolicy > 0.001) {
        const roundedAmount = Math.round(paymentForPolicy * 100) / 100;
        if (roundedAmount > 0) {
          splits.push({
            policyId: policy.policyId,
            amount: roundedAmount,
            branchId: policy.branchId,
          });
          remainingAmount -= paymentForPolicy;
        }
      }
    }

    // Overflow guard: if the user's amount exceeds the total debt
    // (e.g. 1600 against a 1550 total), park the leftover on the
    // policy with the most room so the insert doesn't silently drop
    // the excess. The overpayment warning in the UI should catch
    // this upstream, but this keeps the behavior consistent with
    // the old code path.
    if (remainingAmount > 0.001 && policiesWithBalance.length > 0) {
      const largestPolicy = policiesWithBalance[policiesWithBalance.length - 1];
      splits.push({
        policyId: largestPolicy.policyId,
        amount: Math.round(remainingAmount * 100) / 100,
        branchId: largestPolicy.branchId,
      });
    }

    return splits.filter(s => s.amount > 0);
  };

  const handleVisaPayClick = (index: number) => {
    const payment = paymentLines[index];
    if (!payment || payment.amount <= 0) return;

    // Use first payable policy for Tranzila
    const firstPolicy = allPayablePolicies.find(p => p.remaining > 0);
    if (firstPolicy) {
      setActiveVisaPaymentIndex(index);
      setActiveTranzilaPolicyId(firstPolicy.policyId);
      setTranzilaModalOpen(true);
    }
  };

  const handleTranzilaSuccess = async () => {
    setTranzilaModalOpen(false);
    
    if (activeVisaPaymentIndex !== null) {
      updatePaymentLine(paymentLines[activeVisaPaymentIndex].id, 'tranzilaPaid', true);
    }
    
    setActiveVisaPaymentIndex(null);
    setActiveTranzilaPolicyId(null);
  };

  const sendPaymentConfirmationSms = async (paidAmount: number, paymentIds: string[]) => {
    if (!clientPhone || paymentIds.length === 0) return;
    
    try {
      // Use bulk receipt function to aggregate all payments into one receipt
      const { data: receiptData, error: receiptError } = await supabase.functions.invoke('generate-bulk-payment-receipt', {
        body: { payment_ids: paymentIds, total_amount: paidAmount }
      });
      
      if (receiptError) {
        console.error('Error generating bulk payment receipt:', receiptError);
        return;
      }
      
      const receiptUrl = receiptData?.receipt_url;
      
      const message = `مرحباً ${clientName}، تم استلام دفعة بمبلغ ₪${paidAmount.toLocaleString()}. شكراً لك!\n\nلعرض وصل الدفع:\n${receiptUrl || 'غير متوفر'}`;
      
      const { error: smsError } = await supabase.functions.invoke('send-sms', {
        body: {
          phone: clientPhone,
          message,
          sms_type: 'payment_confirmation'
        }
      });

      if (smsError) throw smsError;

      toast.success('تم إرسال رسالة التأكيد للعميل');
    } catch (error) {
      console.error('Error sending payment confirmation SMS:', error);
      const msg = await extractFunctionErrorMessage(error);
      if (msg) toast.error(msg);
    }
  };

  const handleSubmit = async () => {
    if (!isValid) return;

    const unpaidVisaPayments = paymentLines.filter(p => p.paymentType === 'visa' && !p.tranzilaPaid);
    if (unpaidVisaPayments.length > 0) {
      toast.error('يرجى إتمام الدفع بالبطاقة أولاً');
      return;
    }

    setSaving(true);
    
    // Collect all created payment IDs for bulk receipt
    const allCreatedPaymentIds: string[] = [];
    
    try {
      for (const paymentLine of paymentLines) {
        // Skip visa payments that are already paid via Tranzila
        if (paymentLine.paymentType === 'visa' && paymentLine.tranzilaPaid) {
          continue;
        }
        
        if (paymentLine.paymentType !== 'visa') {
          const splits = calculateSplitPayments(paymentLine.amount, paymentLine.paymentType);
          
          if (splits.length > 0) {
            // Generate batch_id for grouping split payments in the UI
            // This links all payments from a single debt payment action
            const batchId = splits.length > 1 ? crypto.randomUUID() : null;
            
            const paymentsToInsert = splits.map(split => ({
              policy_id: split.policyId,
              amount: split.amount,
              payment_type: paymentLine.paymentType,
              payment_date: paymentLine.paymentDate,
              cheque_number: paymentLine.paymentType === 'cheque' ? paymentLine.chequeNumber : null,
              cheque_image_url: paymentLine.paymentType === 'cheque' ? paymentLine.cheque_image_url : null,
              bank_code: paymentLine.paymentType === 'cheque' ? (paymentLine.bankCode || null) : null,
              branch_code: paymentLine.paymentType === 'cheque' ? (paymentLine.branchCode || null) : null,
              notes: paymentLine.notes || `تسديد دين`,
              branch_id: split.branchId,
              batch_id: batchId,
            }));

            const { data: insertedPayments, error } = await supabase
              .from('policy_payments')
              .insert(paymentsToInsert)
              .select('id');
            
            if (error) throw error;

            // Collect all inserted payment IDs
            if (insertedPayments) {
              for (const p of insertedPayments) {
                allCreatedPaymentIds.push(p.id);
              }
            }

            // Upload images
            if ((paymentLine.paymentType === 'cash' || paymentLine.paymentType === 'cheque' || paymentLine.paymentType === 'transfer') && 
                paymentLine.pendingImages && paymentLine.pendingImages.length > 0 && 
                insertedPayments && insertedPayments.length > 0) {
              
              const firstPaymentId = insertedPayments[0].id;
              
              for (let imgIndex = 0; imgIndex < paymentLine.pendingImages.length; imgIndex++) {
                const file = paymentLine.pendingImages[imgIndex];
                const formData = new FormData();
                formData.append('file', file);
                formData.append('entity_type', 'payment');
                formData.append('entity_id', firstPaymentId);

                try {
                  const { data: uploadResult, error: uploadError } = await supabase.functions.invoke('upload-media', {
                    body: formData,
                  });

                  if (!uploadError && uploadResult?.url) {
                    await supabase.from('payment_images').insert({
                      payment_id: firstPaymentId,
                      image_url: uploadResult.url,
                      image_type: imgIndex === 0 ? 'front' : 'back',
                      sort_order: imgIndex,
                    });
                  }
                } catch (uploadErr) {
                  console.error('Error uploading payment image:', uploadErr);
                }
              }
            }
          }
        }
      }

      toast.success('تم تسديد الدفعات بنجاح');
      
      // Send bulk receipt SMS with all payment IDs
      if (allCreatedPaymentIds.length > 0) {
        await sendPaymentConfirmationSms(totalPaymentAmount, allCreatedPaymentIds);
      }
      
      onOpenChange(false);
      onSuccess();
    } catch (error: any) {
      console.error('Error saving payments:', error);
      toast.error(error.message || 'خطأ في حفظ الدفعات');
    } finally {
      setSaving(false);
    }
  };

  const getPolicyTypeLabel = (policyType: string, policyTypeChild: string | null) => {
    // For THIRD_FULL, show the child type (ثالث or شامل)
    if (policyType === 'THIRD_FULL' && policyTypeChild) {
      return policyChildLabels[policyTypeChild] || policyTypeLabels[policyType];
    }
    return policyTypeLabels[policyType] || policyType;
  };

  const activeVisaPayment = activeVisaPaymentIndex !== null ? paymentLines[activeVisaPaymentIndex] : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[95vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-primary" />
            تسديد ديون {clientName}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : debtItems.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <CheckCircle className="h-12 w-12 mx-auto mb-4 text-green-500" />
            <p>لا توجد ديون مستحقة</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Summary Cards */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-muted/50 rounded-lg p-3 text-center">
                <p className="text-xs text-muted-foreground">إجمالي السعر</p>
                <p className="text-lg font-bold ltr-nums">₪{totalFullPrice.toLocaleString('en-US')}</p>
              </div>
              <div className="bg-green-500/10 rounded-lg p-3 text-center">
                <p className="text-xs text-muted-foreground">المدفوع</p>
                <p className="text-lg font-bold text-green-600 ltr-nums">
                  ₪{(totalPaidAmount + paidVisaTotal).toLocaleString('en-US')}
                </p>
              </div>
              <div className="bg-destructive/10 rounded-lg p-3 text-center">
                <p className="text-xs text-muted-foreground">المتبقي للدفع</p>
                <p className="text-lg font-bold text-destructive ltr-nums">
                  ₪{effectiveRemaining.toLocaleString('en-US')}
                </p>
                {appliedCredit > 0 && (
                  <div className="text-[10px] text-muted-foreground mt-1 space-y-0.5">
                    <p>المطلوب: ₪{(totalRemaining - paidVisaTotal).toLocaleString('en-US')}</p>
                    <p className="text-amber-600">المرتجع: -₪{appliedCredit.toLocaleString('en-US')}</p>
                  </div>
                )}
              </div>
            </div>

            {appliedCredit > 0 && (
              <div className="flex items-start gap-2 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 text-amber-900 dark:text-amber-200">
                <Info className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
                <p className="text-xs leading-relaxed">
                  لدى العميل رصيد مرتجع بقيمة <span className="font-bold ltr-nums">₪{creditBalance.toLocaleString('en-US')}</span> تم خصمه من المطلوب.
                  المبلغ المستحق فعلياً للدفع هو <span className="font-bold ltr-nums">₪{effectiveRemaining.toLocaleString('en-US')}</span>.
                </p>
              </div>
            )}

            {/* Car Selection */}
            {uniqueCars.length > 1 && (
              <Card className="border-2 border-dashed border-primary/30">
                <CardHeader className="p-3 pb-0">
                  <Label className="text-base font-semibold flex items-center gap-2">
                    <Car className="h-4 w-4" />
                    اختر السيارة للدفع
                  </Label>
                </CardHeader>
                <CardContent className="p-3 pt-2">
                  <div className="space-y-2">
                    {/* All Cars Option */}
                    <div 
                      onClick={() => setSelectedCars([])}
                      className={cn(
                        "flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all",
                        selectedCars.length === 0 
                          ? "border-primary bg-primary/5" 
                          : "border-muted hover:border-primary/50"
                      )}
                    >
                      <Checkbox checked={selectedCars.length === 0} />
                      <div className="flex-1">
                        <p className="font-medium">كل السيارات</p>
                        <p className="text-sm text-muted-foreground">
                          {uniqueCars.length} سيارات - إجمالي ₪{totalRemaining.toLocaleString('en-US')}
                        </p>
                      </div>
                    </div>
                    
                    {/* Individual Cars */}
                    {uniqueCars.map(car => {
                      const carItems = debtItems.filter(item => item.carNumber === car);
                      const carTotal = carItems.reduce((sum, item) => sum + item.remainingTotal, 0);
                      const isSelected = selectedCars.includes(car);
                      
                      return (
                        <div 
                          key={car}
                          onClick={() => toggleCar(car)}
                          className={cn(
                            "flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all",
                            isSelected 
                              ? "border-primary bg-primary/5" 
                              : "border-muted hover:border-primary/50"
                          )}
                        >
                          <Checkbox checked={isSelected} />
                          <div className="flex-1">
                            <p className="font-bold text-lg font-mono ltr-nums">{car}</p>
                            <p className="text-sm text-muted-foreground">
                              {carItems.length} عناصر - ₪{carTotal.toLocaleString('en-US')}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Debt Items List */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-base font-semibold">الوثائق</Label>
                <Badge variant="secondary" className="text-xs">
                  {filteredItems.length} عناصر
                </Badge>
              </div>
              <div className="border rounded-lg divide-y max-h-72 overflow-auto scrollbar-thin">
                {filteredItems.map(item => (
                  <div key={item.itemKey} className="p-3 hover:bg-muted/30">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        {item.isPackage ? (
                          <Package className="h-5 w-5 text-primary mt-0.5" />
                        ) : (
                          <FileText className="h-5 w-5 text-muted-foreground mt-0.5" />
                        )}
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant={item.isPackage ? "default" : "outline"} className="text-xs">
                              {item.isPackage ? `📦 باقة تأمين` : getPolicyTypeLabel(item.policies[0]?.policyType, item.policies[0]?.policyTypeChild)}
                            </Badge>
                            {item.includesElzami && (
                              <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
                                يشمل الإلزامي
                              </Badge>
                            )}
                          </div>
                          {item.carNumber && (
                            <span className="text-xs text-muted-foreground font-mono">🚗 {item.carNumber}</span>
                          )}
                          {/* Show package components */}
                          {item.isPackage && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {item.policies.map((comp, idx) => (
                                <span key={idx} className="text-xs text-muted-foreground">
                                  {getPolicyTypeLabel(comp.policyType, comp.policyTypeChild)}
                                  {idx < item.policies.length - 1 ? ' + ' : ''}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 text-sm shrink-0">
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">السعر:</span>
                          <span className="font-medium ltr-nums">₪{item.fullPrice.toLocaleString('en-US')}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">المدفوع:</span>
                          <span className="font-medium text-green-600 ltr-nums">₪{item.paidTotal.toLocaleString('en-US')}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">المتبقي:</span>
                          <span className="font-bold text-destructive ltr-nums">₪{item.remainingTotal.toLocaleString('en-US')}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Payment Lines */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-base font-semibold">الدفعات</Label>
                <div className="flex items-center gap-2">
                  <Popover open={splitPopoverOpen} onOpenChange={setSplitPopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm">
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

                    {/* For non-cheque types the date sits on its own row.
                        For cheque rows the BankBranchPicker absorbs the
                        cheque number into its third slot so bank → branch →
                        رقم الشيك all line up on one row, with the due date
                        on the next row. */}
                    {payment.paymentType !== 'cheque' && (
                      <div>
                        <Label className="text-xs">تاريخ الدفع</Label>
                        <ArabicDatePicker
                          value={payment.paymentDate}
                          onChange={(date) => updatePaymentLine(payment.id, 'paymentDate', date)}
                          disabled={payment.tranzilaPaid}
                          compact
                        />
                      </div>
                    )}

                    {payment.paymentType === 'cheque' && (
                      <>
                        <BankBranchPicker
                          bankCode={payment.bankCode}
                          branchCode={payment.branchCode}
                          onBankChange={(code) => updatePaymentLine(payment.id, 'bankCode', code)}
                          onBranchChange={(code) => updatePaymentLine(payment.id, 'branchCode', code)}
                          disabled={payment.tranzilaPaid}
                          chequeNumberSlot={
                            <>
                              <Label className="text-xs font-semibold">رقم الشيك</Label>
                              <Input
                                value={payment.chequeNumber || ''}
                                onChange={e => updatePaymentLine(payment.id, 'chequeNumber', sanitizeChequeNumber(e.target.value))}
                                placeholder="رقم الشيك"
                                maxLength={CHEQUE_NUMBER_MAX_LENGTH}
                                className="h-10 font-mono"
                                disabled={payment.tranzilaPaid}
                              />
                            </>
                          }
                        />
                        <div>
                          <Label className="text-xs">تاريخ الاستحقاق</Label>
                          <ArabicDatePicker
                            value={payment.paymentDate}
                            onChange={(date) => updatePaymentLine(payment.id, 'paymentDate', date)}
                            disabled={payment.tranzilaPaid}
                            compact
                          />
                        </div>
                      </>
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

                    {/* Image Upload Section */}
                    {(payment.paymentType === 'cash' || payment.paymentType === 'cheque' || payment.paymentType === 'transfer') && (
                      <div className="pt-3 border-t border-border/50">
                        <div className="flex-1">
                          <Label className="text-xs text-muted-foreground mb-2 block">
                            {payment.paymentType === 'cheque' ? 'صور الشيك (أمامي/خلفي)' : payment.paymentType === 'transfer' ? 'صور إيصال التحويل' : 'صور إيصال الدفع'}
                          </Label>
                          <div className="flex flex-wrap gap-2">
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
          <Button onClick={handleSubmit} disabled={!isValid || saving || debtItems.length === 0}>
            {saving && <Loader2 className="h-4 w-4 animate-spin ml-2" />}
            تسديد المبلغ
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Tranzila Payment Modal */}
      {activeTranzilaPolicyId && activeVisaPayment && (
        <TranzilaPaymentModal
          open={tranzilaModalOpen}
          onOpenChange={setTranzilaModalOpen}
          policyId={activeTranzilaPolicyId}
          amount={activeVisaPayment.amount}
          paymentDate={activeVisaPayment.paymentDate}
          notes={activeVisaPayment.notes || `تسديد دين`}
          onSuccess={handleTranzilaSuccess}
          onFailure={() => {
            setTranzilaModalOpen(false);
            setActiveVisaPaymentIndex(null);
            setActiveTranzilaPolicyId(null);
          }}
        />
      )}

      <ChequeScannerDialog
        open={chequeScannerOpen}
        onOpenChange={setChequeScannerOpen}
        onConfirm={handleScannedCheques}
      />
    </Dialog>
  );
}
