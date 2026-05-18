import React, { useState, useEffect, useMemo } from 'react';
import { useAgentContext } from '@/hooks/useAgentContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
import { Loader2, CreditCard, Banknote, Wallet, AlertCircle, CheckCircle, DollarSign, Plus, Trash2, Copy, Split, Upload, X, ImageIcon, HelpCircle, Car, Package, FileText, Info, Scan, Handshake } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { TranzilaPaymentModal } from '@/components/payments/TranzilaPaymentModal';
import { ChequeScannerDialog } from '@/components/payments/ChequeScannerDialog';
import { sanitizeChequeNumber, CHEQUE_NUMBER_MAX_LENGTH } from '@/lib/chequeUtils';
import { BankPicker } from '@/components/shared/BankPicker';
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
  // Aggregate transfer fee across the package. Already included in
  // fullPrice via office_commission — surfaced separately so the
  // breakdown can call it out.
  transferFee: number;
}

interface PaymentLine {
  id: string;
  amount: number;
  paymentType: 'cash' | 'cheque' | 'transfer' | 'visa' | 'visa_external';
  /** For cash/transfer/visa: the day money flowed.
   *  For cheque: تاريخ الاستحقاق (when the cheque can be cashed). */
  paymentDate: string;
  /** Cheque-only: تاريخ الإصدار (when the customer wrote the cheque).
   *  Defaults to today; can be earlier than paymentDate for postdated. */
  chequeIssueDate?: string;
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

// Broker-related debt the client is NOT on the hook for — the broker
// owes us for any of their own deals. Surfaced as an info block so
// staff know the amount exists and where it's tracked.
interface BrokerDebtInfo {
  brokerId: string;
  brokerName: string;
  amount: number;
}

// When the modal is opened in "edit" mode this carries everything the
// modal needs to act as a session-level editor: which payment rows
// belong to the session being edited, plus the existing line data so
// the form can pre-populate them. The accounting rule (set by the user)
// is "delete the old سند قبض and write a new one" — there is no
// per-row UPDATE path; submit DELETEs every row in `paymentIds` and
// recreates them from the form. The session id is reused so the new
// rows keep the same grouping key.
export interface DebtPaymentEditingSession {
  id: string;
  paymentIds: string[];
  // The original payment rows, used only for pre-loading the form. We
  // collapse multi-policy splits (same batch_id) into a single line at
  // the face value the user originally entered.
  payments: Array<{
    id: string;
    amount: number;
    payment_type: string;
    payment_date: string;
    cheque_number?: string | null;
    cheque_date?: string | null;
    cheque_issue_date?: string | null;
    bank_code?: string | null;
    branch_code?: string | null;
    cheque_image_url?: string | null;
    notes?: string | null;
    batch_id?: string | null;
    locked?: boolean | null;
  }>;
  totalAmount: number;
  receiptNumber: string | null;
}

interface DebtPaymentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  clientName: string;
  clientPhone: string | null;
  totalOwed: number;
  // Receives the payment_ids created by this submit so the caller can
  // open a "print / send سند قبض" dialog. The list is empty when the
  // submit didn't create any rows (e.g. edit mode that only restamped
  // existing payments) — callers should treat an empty array as "no
  // receipt to send".
  onSuccess: (paymentIds: string[]) => void;
  // Optional: when set, the modal switches into "edit a single سند قبض"
  // mode — title changes, the wallet ceiling treats the session's
  // existing total as available room, and submit replaces the session's
  // rows instead of adding new ones.
  editingSession?: DebtPaymentEditingSession | null;
  // Label for the secondary footer button. Defaults to "إلغاء" — the
  // /receipts wizard overrides this to "رجوع" because closing the
  // modal there returns to the AddVoucher picker (the picker stays
  // mounted behind), so "back" matches what actually happens.
  cancelLabel?: string;
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
  { value: 'visa_external', label: 'فيزا خارجي', icon: CreditCard },
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
  editingSession,
  cancelLabel = 'إلغاء',
}: DebtPaymentModalProps) {
  const isEditMode = !!editingSession;
  const { toast: uiToast } = useToast();
  const { hasFeature } = useAgentContext();
  const paymentTypes = useMemo(() => hasFeature('visa_payment') ? [...paymentTypesBase, paymentTypeVisa] : paymentTypesBase, [hasFeature]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [debtItems, setDebtItems] = useState<DebtItem[]>([]);
  const [brokerDebts, setBrokerDebts] = useState<BrokerDebtInfo[]>([]);
  const [creditBalance, setCreditBalance] = useState(0);
  // Gross cash collected from the customer (across every non-deleted
  // policy, minus إلزامي visa_external pass-through). The kashf and
  // the ClientDetails debt tile show the same number — keeping the
  // modal in sync so all three surfaces agree.
  const [grossPaidAmount, setGrossPaidAmount] = useState(0);
  // Kashf-aligned outstanding: every non-destination policy's office
  // claim + transfer customer_pays − gross_paid − credit_consumed.
  // This is the SAME number the kashf totals box and the
  // ClientDetails debt tile show. The per-package items[] above can
  // sum to a different value (it uses per-package clamping which
  // loses payments to transferred-destination policies); we override
  // the summary tile and the payment ceiling with this kashf value so
  // the agent never sees "أدفع 3,500" while the kashf and the client
  // page say 1,750.
  const [kashfOutstanding, setKashfOutstanding] = useState(0);
  const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([]);
  // One-shot slide-up animation on freshly-duplicated rows.
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
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
  // totalRemaining drives the summary tile + payment ceiling +
  // installment split. We use kashfOutstanding (set in fetchDebtItems)
  // so all three surfaces — kashf, ClientDetails debt tile, this
  // modal — converge on the same المتبقي. items[].remainingTotal
  // stays in the per-package breakdown for the agent's reference
  // (which transactions still have unpaid lines), but the user-
  // visible "أدفع X" amount is the kashf number.
  // When a car filter is active, fall back to the filtered items sum
  // so the user can pay against a subset; otherwise the global kashf
  // outstanding wins.
  const totalFullPrice = filteredItems.reduce((sum, item) => sum + item.fullPrice, 0);
  const totalPaidAmount = filteredItems.reduce((sum, item) => sum + item.paidTotal, 0);
  const filteredItemsRemaining = filteredItems.reduce((sum, item) => sum + item.remainingTotal, 0);
  const totalRemaining = selectedCars.length === 0 ? kashfOutstanding : filteredItemsRemaining;
  
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
      if (isEditMode && editingSession) {
        // Edit mode: pre-load the session's existing payments as form
        // lines. Multi-policy splits (same batch_id, one physical
        // cheque allocated across N policies) collapse into ONE line
        // at the cheque's face value — re-submitting will re-split
        // via calculateSplitPayments just like the original entry did.
        // Passthrough / locked rows are excluded; the session can only
        // contain user-collected rows (the auto إلزامي passthrough has
        // its own non-shared session_id from PolicyWizard).
        const eligible = editingSession.payments.filter((p) => p.locked !== true);
        const byBatch = new Map<string, typeof eligible>();
        const standalone: typeof eligible = [];
        for (const p of eligible) {
          if (p.batch_id) {
            const arr = byBatch.get(p.batch_id) ?? [];
            arr.push(p);
            byBatch.set(p.batch_id, arr);
          } else {
            standalone.push(p);
          }
        }
        const lines: PaymentLine[] = [];
        const toLine = (rep: (typeof eligible)[number], amount: number): PaymentLine => ({
          id: crypto.randomUUID(),
          amount,
          paymentType: (['cash', 'cheque', 'transfer', 'visa', 'visa_external'].includes(rep.payment_type)
            ? rep.payment_type
            : 'cash') as PaymentLine['paymentType'],
          paymentDate: rep.payment_type === 'cheque'
            ? (rep.cheque_date || rep.payment_date)
            : rep.payment_date,
          chequeIssueDate: rep.payment_type === 'cheque'
            ? (rep.cheque_issue_date || undefined)
            : undefined,
          chequeNumber: rep.cheque_number || undefined,
          bankCode: rep.bank_code ?? null,
          branchCode: rep.branch_code ?? null,
          notes: rep.notes || undefined,
          cheque_image_url: rep.cheque_image_url || undefined,
        });
        for (const [, batch] of byBatch) {
          const sum = batch.reduce((s, p) => s + Number(p.amount || 0), 0);
          lines.push(toLine(batch[0], sum));
        }
        for (const p of standalone) {
          lines.push(toLine(p, Number(p.amount || 0)));
        }
        setPaymentLines(lines.length > 0
          ? lines
          : [{
              id: crypto.randomUUID(),
              amount: 0,
              paymentType: 'cash',
              paymentDate: new Date().toISOString().split('T')[0],
            }],
        );
      } else {
        // Reset form with one empty payment line
        setPaymentLines([{
          id: crypto.randomUUID(),
          amount: 0,
          paymentType: 'cash',
          paymentDate: new Date().toISOString().split('T')[0],
        }]);
      }
      setPreviewUrls({});
      setSelectedCars([]);
    }
  }, [open, clientId, isEditMode, editingSession]);

  // Net amount we currently owe the client (refunds minus adjustments due).
  // This offsets the debt shown in the modal so "المتبقي للدفع" reflects
  // reality — same logic as ClientDetails.fetchWalletBalance.
  const fetchCreditBalance = async () => {
    try {
      const { data, error } = await supabase
        .from('customer_wallet_transactions')
        .select('amount, transaction_type, settled_at')
        .eq('client_id', clientId)
        .is('settled_at', null);

      if (error) throw error;

      // refund / transfer_refund_owed / manual_refund = office owes
      // the customer (live credit available)
      // transfer_adjustment_due                       = customer owes
      // credit_consumed                                = credit already
      //   applied to a new transaction (settled side, but until the
      //   wallet trigger marks settled_at we still need to net it out
      //   here so the available balance never shows a credit that's
      //   already been used). Mirrors fetchPaymentSummary on the
      //   client page so the two surfaces never disagree.
      // manual_debit                                  = إشعار مدين,
      //   customer owes the office a manually-recorded amount. Same
      //   sign as transfer_adjustment_due / credit_consumed.
      const weOwe = (data || [])
        .filter(t =>
          t.transaction_type === 'refund' ||
          t.transaction_type === 'transfer_refund_owed' ||
          t.transaction_type === 'manual_refund'
        )
        .reduce((sum, t) => sum + (t.amount || 0), 0);

      const customerOwes = (data || [])
        .filter(t =>
          t.transaction_type === 'transfer_adjustment_due' ||
          t.transaction_type === 'credit_consumed' ||
          t.transaction_type === 'manual_debit'
        )
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
   * Broker deals are NOT the client's responsibility — the broker owes
   * us for those. We pool their payments into the containing group
   * (أسامة حسام case: a package paid against the broker row also
   * covers the non-broker sibling) but broker policies themselves are
   * never shown as client debt. Any broker-owed amount is surfaced in
   * a separate "related to broker" info block.
   */
  const fetchDebtItems = async () => {
    setLoading(true);
    try {
      // Per "إلغاء المعاملة ≠ إلغاء الدين": a cancelled package the
      // customer never paid for is still collectable — the customer
      // used the insurance up to the cancellation date. Only the
      // refund flow (إشعار دائن / سند صرف) reduces the obligation,
      // and that surfaces as paid via paymentsMap below. So include
      // every non-destination policy regardless of cancel/transfer
      // status; payablePolicies (remaining > 0) still filters out
      // anything already fully covered.
      const { data: policiesData, error: policiesError } = await supabase
        .from('policies')
        .select('id, policy_type_parent, policy_type_child, insurance_price, office_commission, branch_id, group_id, broker_id, transferred_from_policy_id, broker:brokers(id, name), car:cars(car_number)')
        .eq('client_id', clientId)
        .is('transferred_from_policy_id', null)
        .is('deleted_at', null);

      if (policiesError) throw policiesError;

      const allPolicyIds = (policiesData || []).map(p => p.id);

      // Pull every non-deleted policy of the client (including
      // cancelled / transferred) so the "المدفوع" tile can show
      // GROSS cash the customer actually paid, matching the kashf
      // and the ClientDetails debt card. The active-only set
      // (allPolicyIds + paymentsMap) still drives the
      // outstanding-debt math below.
      const { data: everyPolicyRow } = await supabase
        .from('policies')
        .select('id, policy_type_parent, office_commission')
        .eq('client_id', clientId)
        .is('deleted_at', null);
      const everyPolicyById = new Map<string, any>(
        (everyPolicyRow || []).map(p => [p.id, p]),
      );
      const isElzamiPassthrough = (payment: { payment_type?: string | null; policy_id: string }) => {
        if (payment.payment_type !== 'visa_external') return false;
        const pol = everyPolicyById.get(payment.policy_id);
        if (!pol) return false;
        return pol.policy_type_parent === 'ELZAMI';
      };

      let paymentsMap: Record<string, number> = {};
      let grossPaid = 0;
      const everyPolicyId = (everyPolicyRow || []).map(p => p.id);
      if (everyPolicyId.length > 0) {
        const { data: paymentsData, error: paymentsError } = await supabase
          .from('policy_payments')
          .select('id, policy_id, amount, refused, payment_type')
          .in('policy_id', everyPolicyId);

        if (paymentsError) throw paymentsError;

        // In edit mode the session being edited is about to be DELETEd
        // and recreated on submit, so its rows should not count toward
        // المدفوع / المتبقي here — otherwise the wallet ceiling would
        // be off by the session's existing total and the user couldn't
        // re-allocate the same money they already paid.
        const excluded = new Set<string>(
          isEditMode && editingSession ? editingSession.paymentIds : [],
        );
        const activeIds = new Set(allPolicyIds);

        (paymentsData || []).forEach(p => {
          if (p.refused) return;
          if (excluded.has((p as any).id)) return;
          if (isElzamiPassthrough(p as any)) return;
          grossPaid += Number(p.amount || 0);
          if (activeIds.has(p.policy_id)) {
            paymentsMap[p.policy_id] = (paymentsMap[p.policy_id] || 0) + p.amount;
          }
        });
      }
      // Expose grossPaid to the JSX layer via a ref-like state setter
      // below — fetchDebtItems is the only place we know it from.
      setGrossPaidAmount(grossPaid);

      // Transfer adjustments — customer_pays fee amounts live on
      // policy_transfers but are already folded into the target
      // policy's office_commission. Pulling them out lets us surface
      // the fee in the debt breakdown without double-counting.
      const transferredNewPolicyIds = (policiesData || [])
        .filter((p: any) => p.transferred_from_policy_id)
        .map((p: any) => p.id);
      const transferAmountByPolicy: Record<string, number> = {};
      if (transferredNewPolicyIds.length > 0) {
        const { data: transferRows } = await supabase
          .from('policy_transfers')
          .select('new_policy_id, adjustment_amount, adjustment_type')
          .in('new_policy_id', transferredNewPolicyIds);
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

      // Group policies by group_id or individual. Broker policies ride
      // inside their group so their payments feed the pooled total.
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
        const nonBrokerPolicies = groupPolicies.filter(p => !(p as any).broker_id);

        // All-broker group: nothing for the client to pay.
        if (nonBrokerPolicies.length === 0) return;

        const isPackage = nonBrokerPolicies.length > 1 || (nonBrokerPolicies[0]?.group_id !== null);

        // Client components = non-broker only. Broker siblings only
        // contribute payments into the pool below.
        //
        // إلزامي base price is paid to the insurance company directly
        // via external Visa and never enters the office's books — so
        // it shouldn't appear as something the cashier collects from
        // the customer. Only the (rare) office commission on an إلزامي
        // line stays as a payable debt. Mirrors the kashf rule.
        const policyComponents: PolicyComponent[] = nonBrokerPolicies.map(p => {
          const commission = (p as any).office_commission || 0;
          const effectivePrice = p.policy_type_parent === 'ELZAMI'
            ? commission
            : p.insurance_price + commission;
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
        const groupPoolPaid = groupPolicies.reduce(
          (sum, p) => sum + (paymentsMap[p.id] || 0),
          0,
        );
        const paidTotal = Math.min(groupPoolPaid, fullPrice);
        const fullPackageRemaining = Math.max(0, fullPrice - paidTotal);

        // ELZAMI now flows through the same debt math as everything
        // else: insurance_price + (commission if ELZAMI) is owed by
        // the customer. The locked auto-row's amount drives whether
        // it's already covered (default = full price → no debt) or
        // surfaces as outstanding (agent set to 0 → full debt).
        const remainingTotal = Math.max(0, fullPackageRemaining);

        // Distribute the paid pool across components in price-ascending
        // order — keeps small premiums (commissions, road service)
        // from being marked partial when the bigger policies are also
        // unpaid. No more ELZAMI-first waterfall (that was a workaround
        // for the "always paid externally" assumption).
        let remainingPool = paidTotal;
        const sortedComponents = [...policyComponents].sort((a, b) => a.price - b.price);
        const componentsWithInternalRemaining = sortedComponents.map(comp => {
          const coverAmount = Math.min(remainingPool, comp.price);
          remainingPool = Math.max(0, remainingPool - coverAmount);
          return {
            ...comp,
            remaining: comp.price - coverAmount,
          };
        });

        // Anything still unpaid is collectable from the customer.
        const payablePolicies = componentsWithInternalRemaining.filter(
          p => p.remaining > 0,
        );

        // Only include items that have payable policies (with actual debt to collect)
        // Using payablePolicies.length > 0 instead of remainingTotal > 0 ensures
        // packages where only ELZAMI is unpaid don't appear as client debt
        if (payablePolicies.length > 0) {
          const transferFee = nonBrokerPolicies.reduce(
            (s: number, p: any) => s + (transferAmountByPolicy[p.id] || 0),
            0,
          );
          items.push({
            itemKey,
            isPackage,
            policies: componentsWithInternalRemaining,
            fullPrice,
            paidTotal,
            remainingTotal,
            carNumber: (nonBrokerPolicies[0]?.car as any)?.car_number || null,
            includesElzami: nonBrokerPolicies.some(p => p.policy_type_parent === 'ELZAMI'),
            payablePolicies,
            transferFee,
          });
        }
      });

      // Sort by remaining (highest first)
      items.sort((a, b) => b.remainingTotal - a.remainingTotal);

      // ─── Kashf-aligned outstanding ──────────────────────────────
      // Same formula as ClientDetails.fetchPaymentSummary and the
      // kashf totals box:
      //   outstanding = sum_office_claim(non-destination, non-broker)
      //               + transfer_customer_pays
      //               − gross_paid
      //               − credit_consumed
      //               − transfer_office_pays (refunds the office owes)
      // The local items[] sum drifts because per-package clamping
      // loses payments mirrored to transfer destinations and the
      // cancellation refunds aren't netted. This kashfTotal is what
      // the summary tile + payment ceiling use below; the items[]
      // breakdown stays for "which transactions still have lines".
      const officeClaimSum = (policiesData || [])
        .filter((p: any) => !p.broker_id)
        .reduce((sum: number, p: any) => {
          const commission = Number(p.office_commission || 0);
          if (p.policy_type_parent === 'ELZAMI') return sum + commission;
          return sum + Number(p.insurance_price || 0) + commission;
        }, 0);
      // Transfer adjustments — fetch ALL transfer rows where ANY of
      // the customer's policies (source or destination, active or
      // canceled) is on either side. transferAmountByPolicy built
      // earlier only contained destinations indexed by new_policy_id;
      // for the kashf-aligned outstanding we want the gross
      // customer_pays / office_pays totals across every transfer
      // the customer was party to.
      const allCustomerPolicyIds = (everyPolicyRow || []).map((p: any) => p.id);
      let transferCustomerPaysSum = 0;
      let transferOfficePaysSum = 0;
      if (allCustomerPolicyIds.length > 0) {
        const customerIdsList = allCustomerPolicyIds.join(',');
        const { data: allTransfers } = await supabase
          .from('policy_transfers')
          .select('adjustment_amount, adjustment_type, policy_id, new_policy_id')
          .or(
            `policy_id.in.(${customerIdsList}),new_policy_id.in.(${customerIdsList})`,
          );
        for (const t of (allTransfers || []) as any[]) {
          const amt = Number(t.adjustment_amount || 0);
          if (amt <= 0.01) continue;
          if (t.adjustment_type === 'customer_pays') {
            transferCustomerPaysSum += amt;
          } else if (t.adjustment_type === 'office_pays') {
            transferOfficePaysSum += amt;
          }
        }
      }
      // Pull the receipts that affect the customer's outstanding —
      // credit_note SUBTRACTS, debit_note ADDS, disbursements stay
      // independent (per the user's "each voucher is independent" rule
      // mirrored in the kashf). Matches generate-customer-statement
      // exactly so the payment ceiling here = the kashf's المتبقي.
      const { data: clientReceiptRows } = await supabase
        .from('receipts')
        .select('amount, receipt_type, cancelled_at')
        .eq('client_id', clientId)
        .in('receipt_type', ['credit_note', 'debit_note'])
        .is('cancelled_at', null);
      let creditNotesIssuedTotal = 0;
      let debitNotesBilledTotal = 0;
      for (const r of (clientReceiptRows ?? []) as any[]) {
        const amt = Math.abs(Number(r.amount || 0));
        if (r.receipt_type === 'credit_note') creditNotesIssuedTotal += amt;
        else if (r.receipt_type === 'debit_note') debitNotesBilledTotal += amt;
      }
      // kashf-aligned formula:
      //   billed   = office_claim + transfer_customer_pays + debit_notes
      //   credits  = paid + credit_notes + transfer_office_pays
      //   ceiling  = max(0, billed - credits)
      const kashfTotal = Math.max(
        0,
        officeClaimSum
          + transferCustomerPaysSum
          + debitNotesBilledTotal
          - grossPaid
          - creditNotesIssuedTotal
          - transferOfficePaysSum,
      );
      setKashfOutstanding(kashfTotal);

      setDebtItems(items);

      // Compute "related to broker" info per broker. A broker policy's
      // outstanding amount = its effective price minus the payments that
      // landed on non-broker siblings in the same group (those payments
      // were already applied against the client debt; the broker still
      // owes us whatever is left). Collapse by broker so one row per
      // broker appears in the info block.
      const brokerTotals = new Map<string, BrokerDebtInfo>();
      groupMap.forEach((groupPolicies) => {
        const nonBrokerInGroup = groupPolicies.filter(p => !(p as any).broker_id);
        const brokerInGroup = groupPolicies.filter(p => (p as any).broker_id);
        if (brokerInGroup.length === 0) return;

        const nonBrokerClaim = nonBrokerInGroup.reduce((sum, p) => {
          const price = p.insurance_price + ((p as any).office_commission || 0);
          return sum + price;
        }, 0);
        const groupPool = groupPolicies.reduce(
          (sum, p) => sum + (paymentsMap[p.id] || 0),
          0,
        );
        const paidTowardClient = Math.min(groupPool, nonBrokerClaim);
        const paidTowardBroker = Math.max(0, groupPool - paidTowardClient);

        const brokerOwed = brokerInGroup.reduce((sum, p) => {
          const price = p.insurance_price + ((p as any).office_commission || 0);
          return sum + price;
        }, 0);
        const brokerRemaining = Math.max(0, brokerOwed - paidTowardBroker);
        if (brokerRemaining <= 0) return;

        // A group can only belong to one broker in practice; fall back
        // to the first broker row if there are somehow multiple.
        const broker = (brokerInGroup[0] as any).broker;
        if (!broker?.id) return;
        const existing = brokerTotals.get(broker.id);
        if (existing) {
          existing.amount += brokerRemaining;
        } else {
          brokerTotals.set(broker.id, {
            brokerId: broker.id,
            brokerName: broker.name || 'وسيط',
            amount: brokerRemaining,
          });
        }
      });
      setBrokerDebts(Array.from(brokerTotals.values()));
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

  // Clone — copy editable fields, strip state markers (tranzilaPaid)
  // and per-instrument binary attachments (pendingImages /
  // cheque_image_url) so the agent doesn't end up with two cheque
  // rows pointing at the same scan.
  const duplicatePaymentLine = (id: string) => {
    const source = paymentLines.find(p => p.id === id);
    if (!source) return;
    const newId = crypto.randomUUID();
    setPaymentLines([
      ...paymentLines,
      {
        ...source,
        id: newId,
        tranzilaPaid: undefined,
        pendingImages: undefined,
        cheque_image_url: undefined,
      },
    ]);
    setFreshIds(prev => new Set(prev).add(newId));
    setTimeout(() => {
      setFreshIds(prev => {
        const next = new Set(prev);
        next.delete(newId);
        return next;
      });
    }, 600);
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
  const calculateSplitPayments = (
    amount: number,
    _paymentType: string = 'cash',
    remainingByPolicy?: Map<string, number>,
  ) => {
    const splits: { policyId: string; amount: number; branchId: string | null }[] = [];

    if (amount <= 0) return splits;

    // When a remaining map is passed in (from handleSubmit's per-batch
    // tracker) read from it instead of the policy's original remaining.
    // Without this, a multi-cheque submit re-targets the same policies
    // for every cheque, and the second cheque trips the per-group cap
    // in validate_policy_payment_total — leaving the user with one
    // saved cheque and the rest silently dropped.
    const getRemaining = (p: { policyId: string; remaining: number }) =>
      remainingByPolicy ? (remainingByPolicy.get(p.policyId) ?? 0) : p.remaining;

    // Smallest-remaining first: fill the tightest policies before
    // spilling over into ones with more room. That way a 1550 cheque
    // with (1300, 250) slots becomes [1300, 250] instead of [250, 1300].
    const policiesWithBalance = [...allPayablePolicies]
      .filter(p => getRemaining(p) > 0)
      .sort((a, b) => getRemaining(a) - getRemaining(b));

    if (policiesWithBalance.length === 0) return splits;

    let remainingAmount = amount;

    for (const policy of policiesWithBalance) {
      if (remainingAmount <= 0) break;

      const paymentForPolicy = Math.min(remainingAmount, getRemaining(policy));
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

    // Per-batch remaining tracker. Each cheque in this submit must
    // see the room left AFTER earlier cheques in the same submit took
    // their slice — otherwise calculateSplitPayments re-targets the
    // same smallest-remaining policies for every cheque and the
    // per-group validate_policy_payment_total trigger rejects the
    // duplicates (only the first cheque saves; the rest disappear).
    const remainingByPolicy = new Map<string, number>(
      allPayablePolicies.map(p => [p.policyId, p.remaining]),
    );

    // One session id for the entire submit. Every policy_payment row
    // we insert below (cheques + cash + visa, split or not) gets the
    // same payment_session_id, so the receipts page and the client
    // profile's سجل الدفعات tab can collapse them into ONE سند قبض
    // row matching the paper voucher the cashier would hand the
    // customer for this collection event. Distinct from batch_id —
    // that's per-physical-cheque; this is per-visit/per-submit.
    //
    // In edit mode we keep the SAME session id so audit history /
    // back-references that pointed at the old session keep resolving
    // to the new rows (e.g. activity log entries linking to the
    // session). The old rows themselves are about to be DELETEd just
    // below, before the new INSERTs run.
    const sessionId = isEditMode && editingSession ? editingSession.id : crypto.randomUUID();

    try {
      // Edit-mode prelude: replace, don't update. The user's accounting
      // rule is that an unprinted سند قبض is a draft — editing it is
      // not "modify in place" but "tear up the draft and write a new
      // one". So we DELETE the existing session rows first (cascading
      // delete cleans up payment_images via FK; receipts.payment_id is
      // ON DELETE SET NULL so we explicitly remove the receipts rows
      // too, otherwise the old سند قبض number would hang around in
      // the receipts page with a null payment link).
      if (isEditMode && editingSession && editingSession.paymentIds.length > 0) {
        const { error: receiptsErr } = await supabase
          .from('receipts')
          .delete()
          .in('payment_id', editingSession.paymentIds);
        if (receiptsErr) throw receiptsErr;

        const { error: paymentsErr } = await supabase
          .from('policy_payments')
          .delete()
          .in('id', editingSession.paymentIds);
        if (paymentsErr) throw paymentsErr;
      }

      // Pre-allocate ONE receipt_number for this entire submit. Every
      // row we insert below — across all paymentLines, all cheque
      // splits, all batches — gets stamped with the same R-number so
      // the user-stated rule "one collection event = one سند قبض =
      // one number" holds. Without this, the BEFORE-INSERT trigger
      // would fire per row and allocate sequential-but-different
      // numbers (R10, R11, R12...) for cash + cheque + transfer of
      // one submit.
      let sessionReceiptNumber: string | null = null;
      const firstPayablePolicyId = allPayablePolicies[0]?.policyId;
      if (firstPayablePolicyId) {
        const { data: rNum, error: rNumErr } = await supabase.rpc(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          'allocate_receipt_number_for_policy' as any,
          { p_policy_id: firstPayablePolicyId },
        );
        if (rNumErr) {
          // Fall through: trigger will still allocate per-row. Worse
          // numbering than the unified path, but the submit succeeds
          // instead of erroring out for the cashier.
          console.warn('[DebtPaymentModal] receipt_number pre-allocate failed; trigger will fall back', rNumErr);
        } else if (typeof rNum === 'string') {
          sessionReceiptNumber = rNum;
        }
      }

      for (const paymentLine of paymentLines) {
        // Skip visa payments that are already paid via Tranzila
        if (paymentLine.paymentType === 'visa' && paymentLine.tranzilaPaid) {
          continue;
        }

        if (paymentLine.paymentType !== 'visa') {
          const splits = calculateSplitPayments(
            paymentLine.amount,
            paymentLine.paymentType,
            remainingByPolicy,
          );

          // Reserve this cheque's slice so the next cheque's split sees
          // the smaller remaining figure.
          for (const split of splits) {
            const prev = remainingByPolicy.get(split.policyId) ?? 0;
            remainingByPolicy.set(split.policyId, Math.max(0, prev - split.amount));
          }
          
          if (splits.length > 0) {
            // Generate batch_id for grouping split payments in the UI
            // This links all payments from a single debt payment action
            const batchId = splits.length > 1 ? crypto.randomUUID() : null;
            
            const todayIso = new Date().toISOString().split('T')[0];
            const paymentsToInsert = splits.map(split => ({
              policy_id: split.policyId,
              amount: split.amount,
              payment_type: paymentLine.paymentType,
              payment_date: paymentLine.paymentDate,
              cheque_due_date:
                paymentLine.paymentType === 'cheque' ? paymentLine.paymentDate : null,
              cheque_issue_date:
                paymentLine.paymentType === 'cheque'
                  ? paymentLine.chequeIssueDate ?? todayIso
                  : null,
              cheque_number: paymentLine.paymentType === 'cheque' ? paymentLine.chequeNumber : null,
              cheque_image_url: paymentLine.paymentType === 'cheque' ? paymentLine.cheque_image_url : null,
              bank_code: paymentLine.paymentType === 'cheque' ? (paymentLine.bankCode || null) : null,
              branch_code: paymentLine.paymentType === 'cheque' ? (paymentLine.branchCode || null) : null,
              notes: paymentLine.notes || `تسديد دين`,
              branch_id: split.branchId,
              batch_id: batchId,
              payment_session_id: sessionId,
              // Stamp the pre-allocated session receipt_number so every
              // row in this submit shares one سند قبض. Null lets the
              // trigger fall back to per-row allocation (used only when
              // the pre-allocate RPC errored).
              ...(sessionReceiptNumber ? { receipt_number: sessionReceiptNumber } : {}),
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
            if ((paymentLine.paymentType === 'cash' || paymentLine.paymentType === 'cheque' || paymentLine.paymentType === 'transfer' || paymentLine.paymentType === 'visa_external') &&
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

                  // upload-media returns { file: { cdn_url } } — the
                  // previous code only checked .url, so every upload
                  // silently dropped and the payment row landed in the
                  // history with no attached files.
                  const cdnUrl = uploadResult?.file?.cdn_url || uploadResult?.url;
                  if (!uploadError && cdnUrl) {
                    await supabase.from('payment_images').insert({
                      payment_id: firstPaymentId,
                      image_url: cdnUrl,
                      image_type: imgIndex === 0 ? 'front' : imgIndex === 1 ? 'back' : 'receipt',
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

      toast.success(isEditMode ? 'تم تحديث سند القبض' : 'تم تسديد الدفعات بنجاح');

      onOpenChange(false);
      onSuccess(allCreatedPaymentIds);
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
      <DialogContent className="max-w-5xl w-[95vw] max-h-[92vh] sm:max-h-[90vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            <DollarSign className="h-5 w-5 text-primary shrink-0" />
            <span className="truncate">
              {isEditMode
                ? `تعديل سند قبض ${editingSession?.receiptNumber ? `#${editingSession.receiptNumber}` : ''}`
                : `تسديد ديون ${clientName}`}
            </span>
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
          <div className="space-y-3 sm:space-y-4">
            {/* Summary Cards — sticky at the top of the scrolling
                content so the cashier sees إجمالي / مدفوع / متبقي no
                matter how far down they scroll the payment lines.
                Background + slight padding + shadow give a clean
                separation from the scrolling rows underneath. */}
            <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 pt-1 pb-2 bg-background border-b">
              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                <div className="bg-muted/50 rounded-lg p-2 sm:p-3 text-center">
                  <p className="text-[10px] sm:text-xs text-muted-foreground leading-tight">إجمالي السعر</p>
                  <p className="text-sm sm:text-lg font-bold tabular-nums leading-tight mt-0.5">₪{totalFullPrice.toLocaleString('en-US')}</p>
                </div>
                <div className="bg-green-500/10 rounded-lg p-2 sm:p-3 text-center">
                  <p className="text-[10px] sm:text-xs text-muted-foreground leading-tight">المدفوع</p>
                  <p className="text-sm sm:text-lg font-bold text-green-600 tabular-nums leading-tight mt-0.5">
                    ₪{(grossPaidAmount + paidVisaTotal).toLocaleString('en-US')}
                  </p>
                </div>
                <div className="bg-destructive/10 rounded-lg p-2 sm:p-3 text-center">
                  <p className="text-[10px] sm:text-xs text-muted-foreground leading-tight">المتبقي للدفع</p>
                  <p className="text-sm sm:text-lg font-bold text-destructive tabular-nums leading-tight mt-0.5">
                    ₪{effectiveRemaining.toLocaleString('en-US')}
                  </p>
                </div>
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

            {brokerDebts.length > 0 && (
              <div className="flex items-start gap-2 p-3 rounded-lg border border-sky-500/30 bg-sky-500/5 text-sky-900 dark:text-sky-200">
                <Handshake className="h-4 w-4 mt-0.5 shrink-0 text-sky-600" />
                <div className="text-xs leading-relaxed space-y-0.5">
                  <p>
                    هذه المبالغ مستحقة على الوسيط وليس على العميل — تُتابع في حساب الوسيط:
                  </p>
                  {brokerDebts.map(b => (
                    <p key={b.brokerId}>
                      <span className="font-bold ltr-nums">₪{b.amount.toLocaleString('en-US')}</span>
                      {' '}على الوسيط{' '}
                      <span className="font-semibold">{b.brokerName}</span>
                    </p>
                  ))}
                </div>
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

            {/* "المعاملات" section was removed per the user — the
                summary cards at the top already convey إجمالي / مدفوع /
                متبقي for the whole customer; the per-policy breakdown
                was duplicated information and crowded the modal. The
                payment distribution logic (calculateSplitPayments) still
                uses debtItems / allPayablePolicies under the hood, just
                not surfaced as a list. */}

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

              {paymentLines.map((payment, index) => ({ payment, index })).reverse().map(({ payment, index }) => (
                <Card key={payment.id} className={cn(
                  "p-3",
                  payment.tranzilaPaid && "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800",
                  freshIds.has(payment.id) && "animate-in slide-in-from-bottom-8 fade-in-0 duration-500"
                )}>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-muted-foreground">دفعة {index + 1}</span>
                      {!payment.tranzilaPaid && (
                        <div className="flex items-center gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/10"
                            onClick={() => duplicatePaymentLine(payment.id)}
                            aria-label="تكرار الدفعة"
                            title="تكرار الدفعة"
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                          {paymentLines.length > 1 && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive"
                              onClick={() => removePaymentLine(payment.id)}
                              aria-label="حذف الدفعة"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Reorder rationale (Google/Material common pattern
                        for payment forms): primary inputs the cashier
                        types FIRST line up on one row — المبلغ +
                        طريقة الدفع + التاريخ. Cheques add a single
                        secondary row for bank + branch + رقم الشيك +
                        تاريخ الإصدار. Notes are tertiary and compact.
                        Removes the empty whitespace the user pointed
                        at without sacrificing field visibility. */}
                    <div className="grid grid-cols-3 gap-3">
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
                      <div>
                        {/* Date on the primary row: cheque rows put
                            تاريخ الإصدار here (the act of writing the
                            cheque is what the cashier types together
                            with amount+method), and تاريخ الاستحقاق
                            moves to the cheque sub-row below — same
                            information density, better field grouping
                            per the user's revised rule. */}
                        <Label className="text-xs">
                          {payment.paymentType === 'cheque' ? 'تاريخ الإصدار' : 'تاريخ الدفع'}
                        </Label>
                        <ArabicDatePicker
                          value={payment.paymentType === 'cheque'
                            ? (payment.chequeIssueDate || new Date().toISOString().split('T')[0])
                            : payment.paymentDate}
                          onChange={(date) => updatePaymentLine(
                            payment.id,
                            payment.paymentType === 'cheque' ? 'chequeIssueDate' : 'paymentDate',
                            date,
                          )}
                          disabled={payment.tranzilaPaid || payment.paymentType === 'cash'}
                        />
                      </div>
                    </div>

                    {payment.paymentType === 'cheque' && (
                      // Cheque sub-row: 4 equal-width columns (Bank,
                      // Branch, Cheque#, Issue date) so the inputs read
                      // as a clean Material-style row instead of the
                      // uneven 1.6fr/0.7fr/1fr split BankBranchPicker
                      // defaults to. We bypass the picker wrapper and
                      // place its inner pieces (BankPicker + branch
                      // Input) as siblings in this grid.
                      <div className="grid grid-cols-4 gap-3">
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
                            className="h-10 text-sm ltr-nums font-mono"
                            placeholder="مثال: 305"
                            value={payment.branchCode || ''}
                            onChange={(e) => {
                              const v = e.target.value.replace(/\D/g, '');
                              updatePaymentLine(payment.id, 'branchCode', v || null);
                            }}
                            disabled={payment.tranzilaPaid}
                          />
                        </div>
                        <div className="space-y-1.5 min-w-0">
                          <Label className="text-xs font-semibold">رقم الشيك</Label>
                          <Input
                            value={payment.chequeNumber || ''}
                            onChange={e => updatePaymentLine(payment.id, 'chequeNumber', sanitizeChequeNumber(e.target.value))}
                            placeholder="رقم الشيك"
                            maxLength={CHEQUE_NUMBER_MAX_LENGTH}
                            className="h-10 font-mono"
                            disabled={payment.tranzilaPaid}
                          />
                        </div>
                        <div className="space-y-1.5 min-w-0">
                          <Label className="text-xs">تاريخ الاستحقاق</Label>
                          <ArabicDatePicker
                            value={payment.paymentDate}
                            onChange={(date) => updatePaymentLine(payment.id, 'paymentDate', date)}
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
                        rows={1}
                        disabled={payment.tranzilaPaid}
                        className="resize-none text-sm min-h-9"
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

                    {/* Compact image-upload strip — sits inline next to
                        the notes cell instead of taking its own full-
                        width block + dashed drop zone. Existing previews
                        render as 9×9 thumbnails with a hover-revealed X;
                        a plus-tile triggers the file input. Status of
                        pending uploads collapses into a single short
                        line under the tiles so it doesn't double the
                        modal height. */}
                    {(payment.paymentType === 'cash' || payment.paymentType === 'cheque' || payment.paymentType === 'transfer' || payment.paymentType === 'visa_external') && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <Label className="text-xs text-muted-foreground whitespace-nowrap">
                          {payment.paymentType === 'cheque' ? 'صور الشيك:' : payment.paymentType === 'transfer' ? 'صور التحويل:' : 'صور الإيصال:'}
                        </Label>
                        {getPreviewUrls(payment.id).map((url, imgIndex) => (
                          <div key={imgIndex} className="relative group">
                            <img
                              src={url}
                              alt=""
                              className="h-9 w-12 object-cover rounded border"
                            />
                            <button
                              type="button"
                              onClick={() => removeImage(payment.id, imgIndex)}
                              className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
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
                            onChange={(e) => handleImageSelect(payment.id, e)}
                            className="hidden"
                          />
                          <Upload className="h-3.5 w-3.5" />
                          إضافة
                        </label>
                        {payment.pendingImages && payment.pendingImages.length > 0 && (
                          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <ImageIcon className="h-3 w-3" />
                            {payment.pendingImages.length} ملف سيُرفع
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </Card>
              ))}
            </div>

          </div>
        )}

        {/* Combined sticky-bottom bar: totals (when applicable) +
            validation banners + action buttons (إلغاء / تسديد المبلغ).
            Was previously two pieces — a sticky totals block inside
            the conditional and a separate DialogFooter outside it —
            which meant the totals could scroll out of view while the
            footer stayed put. Merging them keeps everything the
            cashier needs to act on the form pinned to the bottom of
            the modal at once. */}
        <div className="sticky bottom-0 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 pt-3 pb-2 bg-background border-t space-y-2">
          {!loading && debtItems.length > 0 && (
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
              {cancelLabel}
            </Button>
            <Button onClick={handleSubmit} disabled={!isValid || saving || debtItems.length === 0}>
              {saving && <Loader2 className="h-4 w-4 animate-spin ml-2" />}
              تسديد المبلغ
            </Button>
          </div>
        </div>
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
