import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArabicDatePicker } from "@/components/ui/arabic-date-picker";
import { Plus, Trash2, Copy, CreditCard, AlertCircle, Loader2, Split, Upload, X, ImageIcon, Sparkles, Scan, Info, FileText, Wallet } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { PaymentSummaryBar } from "./PaymentSummaryBar";
import { TranzilaPaymentModal } from "@/components/payments/TranzilaPaymentModal";
import { ChequeScannerDialog } from "@/components/payments/ChequeScannerDialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { sanitizeChequeNumber, CHEQUE_NUMBER_MAX_LENGTH } from "@/lib/chequeUtils";
import { BankPicker } from "@/components/shared/BankPicker";
import type { PaymentLine, PricingBreakdown, ValidationErrors } from "./types";
import { getPaymentTypes } from "./types";
import { useAgentContext } from "@/hooks/useAgentContext";

interface Step4Props {
  payments: PaymentLine[];
  setPayments: (payments: PaymentLine[]) => void;
  pricing: PricingBreakdown;
  totalPaidPayments: number;
  remainingToPay: number;
  paymentsExceedPrice: boolean;
  errors: ValidationErrors;
  // For Tranzila "pay first" flow
  onCreateTempPolicy: () => Promise<string | null>;
  onDeleteTempPolicy: (policyId: string) => Promise<void>;
  tempPolicyId: string | null;
  /** If true, this is an ELZAMI policy - hide split button */
  isElzami?: boolean;
  /** Customer's outstanding wallet credit (إشعار دائن balance not yet
   *  consumed). When > 0 the wizard automatically subtracts it from
   *  the cash المتبقي, and on save records a credit_consumed wallet
   *  entry equal to min(credit, payablePrice). 0 when the customer
   *  has no open credits. */
  outstandingCredit?: number;
  /** How much of the outstanding credit is actually being applied to
   *  THIS transaction. Equals min(outstandingCredit, payablePrice) —
   *  for a pure ELZAMI policy this is 0 because the office never
   *  receives the premium (visa_external direct to insurer). */
  creditApplied?: number;
}

interface PreviewItem {
  url: string;
  kind: 'image' | 'pdf';
  name?: string;
}

interface PreviewUrls {
  [paymentId: string]: PreviewItem[];
}

export function Step4Payments({
  payments,
  setPayments,
  pricing,
  totalPaidPayments,
  remainingToPay,
  paymentsExceedPrice,
  errors,
  onCreateTempPolicy,
  onDeleteTempPolicy,
  tempPolicyId,
  isElzami = false,
  outstandingCredit = 0,
  creditApplied = 0,
}: Step4Props) {
  const { toast } = useToast();
  const [showTranzilaModal, setShowTranzilaModal] = useState(false);
  const [showChequeScannerModal, setShowChequeScannerModal] = useState(false);
  const { hasFeature } = useAgentContext();
  const paymentTypes = getPaymentTypes(hasFeature('visa_payment'));
  const [selectedVisaPaymentIndex, setSelectedVisaPaymentIndex] = useState<number | null>(null);
  const [creatingPolicy, setCreatingPolicy] = useState(false);
  const [activePolicyIdForPayment, setActivePolicyIdForPayment] = useState<string | null>(null);
  const [splitPopoverOpen, setSplitPopoverOpen] = useState(false);
  const [splitCount, setSplitCount] = useState(2);
  
  // Preview URLs for payment images (separate from files stored in payment objects)
  const [previewUrls, setPreviewUrls] = useState<PreviewUrls>({});

  const handleImageSelect = (paymentId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    
    const validFiles = files.filter(file => {
      const isImage = file.type.startsWith('image/');
      const isPdf = file.type === 'application/pdf';
      if (!isImage && !isPdf) {
        toast({ title: "خطأ", description: "يرجى اختيار صور أو ملفات PDF فقط", variant: "destructive" });
        return false;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast({ title: "خطأ", description: "حجم الملف يجب أن يكون أقل من 10MB", variant: "destructive" });
        return false;
      }
      return true;
    });

    if (validFiles.length === 0) return;

    // Create preview items so PDFs render as a placeholder tile instead
    // of a broken <img>.
    const newPreviewItems: PreviewItem[] = validFiles.map(file => ({
      url: URL.createObjectURL(file),
      kind: file.type === 'application/pdf' ? 'pdf' : 'image',
      name: file.name,
    }));
    setPreviewUrls(prev => ({
      ...prev,
      [paymentId]: [...(prev[paymentId] || []), ...newPreviewItems],
    }));
    
    // Store files in payment object for later upload
    const payment = payments.find(p => p.id === paymentId);
    if (payment) {
      const existingFiles = payment.pendingImages || [];
      updatePayment(paymentId, 'pendingImages', [...existingFiles, ...validFiles]);
    }
  };

  const removeImage = (paymentId: string, index: number) => {
    // Revoke preview URL only when it's a blob we created
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
    
    // Update payment files
    const payment = payments.find(p => p.id === paymentId);
    if (payment && payment.pendingImages) {
      const newFiles = payment.pendingImages.filter((_, i) => i !== index);
      updatePayment(paymentId, 'pendingImages', newFiles.length > 0 ? newFiles : undefined);
    }
  };

  const getPreviewUrls = (paymentId: string) => previewUrls[paymentId] || [];

  const addPayment = () => {
    setPayments([
      ...payments,
      {
        id: crypto.randomUUID(),
        payment_type: "cash",
        amount: 0,
        payment_date: new Date().toISOString().split('T')[0],
        refused: false,
      },
    ]);
  };

  const removePayment = (id: string) => {
    setPayments(payments.filter(p => p.id !== id));
  };

  // Clone an existing payment line. Form fields copy verbatim — the
  // agent triggers this when entering a series of similar entries
  // (same amount, same bank, consecutive cheque numbers etc.) and
  // wants to avoid re-typing. We strip:
  //   • locked / locked_label   → system-managed ELZAMI auto-row
  //   • tranzila_paid           → a paid row can't auto-clone its paid state
  //   • pendingImages / cheque_image_url → binary attachments belong
  //     to a specific physical instrument; copying them would create
  //     misleading duplicate evidence on a second cheque.
  const duplicatePayment = (id: string) => {
    const source = payments.find(p => p.id === id);
    if (!source) return;
    const clone: PaymentLine = {
      ...source,
      id: crypto.randomUUID(),
      locked: undefined,
      locked_label: undefined,
      tranzila_paid: undefined,
      pendingImages: undefined,
      cheque_image_url: undefined,
    };
    setPayments([...payments, clone]);
  };

  // Split remaining amount into equal installments (keeps locked payments)
  const handleSplitPayments = () => {
    if (splitCount < 2 || splitCount > 12 || remainingToPay <= 0) return;
    
    const amountToSplit = remainingToPay;
    const amountPerInstallment = Math.floor(amountToSplit / splitCount);
    const remainder = amountToSplit - (amountPerInstallment * splitCount);
    
    const today = new Date();
    const newPayments: PaymentLine[] = [];
    
    for (let i = 0; i < splitCount; i++) {
      const paymentDate = new Date(today);
      paymentDate.setMonth(today.getMonth() + i);
      
      // Add remainder to the first payment
      const amount = i === 0 ? amountPerInstallment + remainder : amountPerInstallment;
      
      newPayments.push({
        id: crypto.randomUUID(),
        payment_type: "cash",
        amount,
        payment_date: paymentDate.toISOString().split('T')[0],
        refused: false,
      });
    }
    
    // Keep locked payments, remove unlocked ones, add new split payments.
    // The list is rendered with .reverse() so the topmost row is the
    // most recently appended item. To show the earliest installment
    // (closest date) at the top, push them in reverse-chronological
    // order — the display flip then lands them earliest-first.
    const lockedPayments = payments.filter(p => p.locked === true);
    setPayments([...lockedPayments, ...newPayments.slice().reverse()]);
    setSplitPopoverOpen(false);
  };

  const updatePayment = (id: string, field: string, value: any) => {
    setPayments(payments.map(p => p.id === id ? { ...p, [field]: value } : p));
  };

  // Handle Visa Pay click - creates temp policy first then opens Tranzila
  const handleVisaPayClick = async (index: number) => {
    const payment = payments[index];
    if (!payment || (payment.amount || 0) <= 0) return;

    setCreatingPolicy(true);
    setSelectedVisaPaymentIndex(index);

    try {
      // Create temp policy to get UUID
      const policyId = tempPolicyId || await onCreateTempPolicy();
      
      if (!policyId) {
        throw new Error('Failed to create policy');
      }

      setActivePolicyIdForPayment(policyId);
      setShowTranzilaModal(true);
    } catch (error) {
      console.error('Error creating temp policy:', error);
      setSelectedVisaPaymentIndex(null);
    } finally {
      setCreatingPolicy(false);
    }
  };

  const handleVisaSuccess = () => {
    if (selectedVisaPaymentIndex !== null) {
      const payment = payments[selectedVisaPaymentIndex];
      if (payment) {
        updatePayment(payment.id, 'tranzila_paid', true);
      }
    }
    setShowTranzilaModal(false);
    setSelectedVisaPaymentIndex(null);
    setActivePolicyIdForPayment(null);
  };

  const handleVisaFailure = async () => {
    // On failure, delete the temp policy if it was created for this payment
    if (activePolicyIdForPayment && !tempPolicyId) {
      await onDeleteTempPolicy(activePolicyIdForPayment);
    }
    setShowTranzilaModal(false);
    setSelectedVisaPaymentIndex(null);
    setActivePolicyIdForPayment(null);
  };

  const selectedVisaPayment = selectedVisaPaymentIndex !== null ? payments[selectedVisaPaymentIndex] : null;

  return (
    <div className="space-y-6">
      {/* Outstanding wallet credit banner — only when the customer
          has a live إشعار دائن balance. Tells the agent why المتبقي
          is lower than إجمالي المعاملة, and that on save we'll
          consume up to displayTotal of that credit automatically. */}
      {outstandingCredit > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-400/60 bg-amber-50 dark:bg-amber-950/20 p-3">
          <div className="h-9 w-9 rounded-lg bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center shrink-0">
            <Wallet className="h-4.5 w-4.5 text-amber-700 dark:text-amber-400" />
          </div>
          <div className="flex-1 text-sm leading-relaxed">
            <div className="font-semibold text-amber-800 dark:text-amber-300">
              العميل عنده رصيد دائن بقيمة{' '}
              <span className="font-bold tabular-nums">
                ₪{Math.round(outstandingCredit).toLocaleString('en-US')}
              </span>
            </div>
            {creditApplied > 0.01 ? (
              <p className="text-xs text-amber-700/80 dark:text-amber-300/80 mt-0.5">
                تم خصم{' '}
                <span className="font-mono ltr-nums">
                  ₪{Math.round(creditApplied).toLocaleString('en-US')}
                </span>
                {' '}من قيمة المعاملة — حدّ الدفعات أصبح{' '}
                <span className="font-mono ltr-nums">
                  ₪{Math.round(Math.max(0, (pricing.totalPrice + pricing.officeCommission) - creditApplied)).toLocaleString('en-US')}
                </span>
                . الرصيد بيتقفل تلقائياً عند حفظ المعاملة.
              </p>
            ) : (
              <p className="text-xs text-amber-700/80 dark:text-amber-300/80 mt-0.5">
                هاي المعاملة إلزامي فقط — الرصيد ما بيخصم لأن مبلغ
                الإلزامي بيتدفع للشركة مباشرة وما بيمر على المكتب.
                الرصيد بيضل محفوظ للمعاملة الجاية.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Payment Summary Bar */}
      <PaymentSummaryBar
        totalPrice={pricing.totalPrice + pricing.officeCommission}
        totalPaid={totalPaidPayments}
        remaining={remainingToPay}
        hasError={paymentsExceedPrice}
        officeCommission={pricing.officeCommission}
      />

      {/* Payments List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Label className="text-base font-semibold">الدفعات</Label>
          <div className="flex gap-2">
            {/* Split Payments Button - always show, splits remaining amount */}
            <Popover open={splitPopoverOpen} onOpenChange={setSplitPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5 px-2 sm:px-3"
                  disabled={remainingToPay <= 0}
                  title="تقسيط"
                >
                  <Split className="h-4 w-4" />
                  <span className="hidden sm:inline">تقسيط</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64" align="end" dir="rtl">
                <div className="space-y-4">
                  <h4 className="font-semibold text-sm">تقسيط المبلغ المتبقي</h4>
                  <div className="space-y-2">
                    <Label className="text-xs">عدد الأقساط (2-12)</Label>
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        min={2}
                        max={12}
                        value={splitCount}
                        onChange={(e) => setSplitCount(Math.min(12, Math.max(2, parseInt(e.target.value) || 2)))}
                        className="h-9"
                      />
                      <Button 
                        type="button" 
                        size="sm" 
                        onClick={handleSplitPayments}
                        className="h-9 px-4"
                      >
                        تقسيم
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      سيتم تقسيم {remainingToPay} ₪ إلى {splitCount} دفعات متساوية
                    </p>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
            
            {/* Scan Cheques Button */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowChequeScannerModal(true)}
              className="gap-1.5 px-2 sm:px-3"
              title="مسح شيكات"
            >
              <Scan className="h-4 w-4" />
              <span className="hidden sm:inline">مسح شيكات</span>
            </Button>

            {/* Add Payment Button - always show */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addPayment}
              className="gap-1.5 px-2 sm:px-3"
              title="إضافة دفعة"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">إضافة دفعة</span>
            </Button>
          </div>
        </div>

        {payments.length === 0 ? (
          <Card className="p-8 text-center bg-muted/30">
            <CreditCard className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">لا توجد دفعات</p>
            <p className="text-xs text-muted-foreground mt-1">يمكنك إضافة دفعات لاحقاً</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {payments.map((payment, index) => ({ payment, index })).reverse().map(({ payment, index }) => {
              const isVisa = payment.payment_type === 'visa';
              const visaPaid = payment.tranzila_paid;
              const visaAmount = payment.amount || 0;
              const isProcessing = creatingPolicy && selectedVisaPaymentIndex === index;
              const isLocked = payment.locked === true;
              const isDisabled = visaPaid || isLocked;
              // Locked rows are now fully editable except for delete:
              // the agent can set amount to 0 (or any partial value)
              // when the customer hasn't paid the company portal yet
              // and wants the agency to collect later. Default stays
              // at the full insurance_price so the existing flow is
              // unchanged.
              const isAmountDisabled = visaPaid;
              const isMetaDisabled = visaPaid; // type, date, cheque trio, images

              // Actions column only needs to exist when there's something to put in it —
              // cheque number input, visa pay button, or a paid/locked badge. Cash payments
              // have nothing here, so we drop the whole column and save a row on mobile.
              const hasActionsColumn =
                payment.payment_type === 'cheque' ||
                (isVisa && !isLocked);

              return (
                <Card
                  key={payment.id}
                  className={cn(
                    "relative p-3",
                    visaPaid && "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800"
                  )}
                >
                  {/* Row actions — absolute top-left so they never claim
                      their own row on mobile. Duplicate sits left of
                      delete so the muscle memory for "trash = corner"
                      stays intact. */}
                  {!visaPaid && !isLocked && (
                    <div className="absolute top-1.5 left-1.5 flex gap-0.5 z-10">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => duplicatePayment(payment.id)}
                        className="h-7 w-7 text-muted-foreground hover:text-primary hover:bg-primary/10"
                        aria-label="تكرار الدفعة"
                        title="تكرار الدفعة"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removePayment(payment.id)}
                        className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                        aria-label="حذف الدفعة"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}

                  {/* Elzami feature tag — subtle pill, not a disabled-looking header */}
                  {isLocked && payment.locked_label && (
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-full">
                        <Sparkles className="h-3 w-3" />
                        {payment.locked_label}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        محسوبة تلقائيًا
                      </span>
                      <span className="basis-full text-[10px] text-muted-foreground leading-snug">
                        اتركها كاملة إذا الزبون دفع للشركة مباشرة، أو حطها 0 إذا بدنا نحصلها لاحقاً.
                      </span>
                    </div>
                  )}

                  {/* Main row: Amount | Type | Date. Matches the
                      DebtPaymentModal / PackagePaymentModal pattern —
                      cash/transfer/card show تاريخ الدفع here;
                      cheques show تاريخ الإصدار (cashier writes it
                      together with amount+method) and move تاريخ
                      الاستحقاق to the cheque sub-row below. */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end pl-16">
                    {/* Amount — editable even on locked rows so the
                        agent can set 0 when the customer hasn't paid
                        the company portal yet (the agency collects
                        later through normal cash/visa/transfer rows). */}
                    <div>
                      <Label className="text-[10px] mb-1 block text-muted-foreground">المبلغ (₪)</Label>
                      <Input
                        type="number"
                        value={payment.amount || ''}
                        onChange={(e) => updatePayment(payment.id, 'amount', parseFloat(e.target.value) || 0)}
                        placeholder="0"
                        disabled={isAmountDisabled}
                        className={cn(
                          "h-10",
                          paymentsExceedPrice && "border-destructive",
                        )}
                      />
                    </div>

                    {/* Payment Type — editable even on locked rows so
                        the agent can switch the auto ELZAMI payment to
                        cash / فيزا / تحويل instead of فيزا خارجي.
                        Switching to cash pins the date to today (cash
                        means "paid now") so the agent can't backdate a
                        cash collection. */}
                    <div>
                      <Label className="text-[10px] mb-1 block text-muted-foreground">نوع الدفع</Label>
                      <Select
                        value={payment.payment_type}
                        onValueChange={(v) => {
                          const today = new Date().toISOString().split('T')[0];
                          if (v === 'cash') {
                            setPayments(
                              payments.map((p) =>
                                p.id === payment.id
                                  ? { ...p, payment_type: v, payment_date: today }
                                  : p,
                              ),
                            );
                          } else if (v === 'cheque') {
                            // The cheque sub-row falls back to today in the
                            // UI, but state stayed empty — so validation
                            // ("كل شيك يجب أن يكون له تاريخ إصدار") fired
                            // even though the agent saw a date. Commit it.
                            setPayments(
                              payments.map((p) =>
                                p.id === payment.id
                                  ? { ...p, payment_type: v, cheque_issue_date: p.cheque_issue_date || today }
                                  : p,
                              ),
                            );
                          } else {
                            updatePayment(payment.id, 'payment_type', v);
                          }
                        }}
                        disabled={isMetaDisabled}
                      >
                        <SelectTrigger className="h-10">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {paymentTypes.map((type) => (
                            <SelectItem key={type.value} value={type.value}>
                              {type.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Top-row date — cash/transfer/card → تاريخ الدفع
                        (locked to today for cash since the cashier is
                        collecting it right now); cheque → تاريخ الإصدار
                        (تاريخ الاستحقاق lives on the cheque sub-row). */}
                    <div>
                      <Label className="text-[10px] mb-1 block text-muted-foreground">
                        {payment.payment_type === 'cheque' ? 'تاريخ الإصدار' : 'تاريخ الدفع'}
                      </Label>
                      <ArabicDatePicker
                        value={payment.payment_type === 'cheque'
                          ? (payment.cheque_issue_date || new Date().toISOString().split('T')[0])
                          : payment.payment_date}
                        onChange={(date) => updatePayment(
                          payment.id,
                          payment.payment_type === 'cheque' ? 'cheque_issue_date' : 'payment_date',
                          date,
                        )}
                        className="h-10"
                        disabled={isMetaDisabled || payment.payment_type === 'cash'}
                      />
                    </div>
                  </div>

                  {/* Cheque sub-row: 4 equal columns —
                      البنك | الفرع | رقم الشيك | تاريخ الاستحقاق.
                      Same layout as DebtPaymentModal / PackagePaymentModal
                      so the wizard reads identical to the other pay flows. */}
                  {payment.payment_type === 'cheque' && (
                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end pl-16">
                      <div className="space-y-1.5 min-w-0">
                        <Label className="text-[10px] block text-muted-foreground">البنك</Label>
                        <BankPicker
                          value={payment.bank_code}
                          onChange={(code) => updatePayment(payment.id, 'bank_code', code)}
                          disabled={isMetaDisabled}
                        />
                      </div>
                      <div className="space-y-1.5 min-w-0">
                        <Label className="text-[10px] block text-muted-foreground">الفرع</Label>
                        <Input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          maxLength={4}
                          value={payment.branch_code || ''}
                          onChange={(e) => {
                            const v = e.target.value.replace(/\D/g, '');
                            updatePayment(payment.id, 'branch_code', v || null);
                          }}
                          placeholder="مثال: 305"
                          className="h-10 font-mono ltr-nums"
                          disabled={isMetaDisabled}
                        />
                      </div>
                      <div className="space-y-1.5 min-w-0">
                        <Label className="text-[10px] block text-muted-foreground">رقم الشيك</Label>
                        <Input
                          value={payment.cheque_number || ''}
                          onChange={(e) => updatePayment(payment.id, 'cheque_number', sanitizeChequeNumber(e.target.value))}
                          placeholder="رقم الشيك"
                          maxLength={CHEQUE_NUMBER_MAX_LENGTH}
                          className="h-10 font-mono ltr-input"
                          disabled={isMetaDisabled}
                        />
                      </div>
                      <div className="space-y-1.5 min-w-0">
                        <Label className="text-[10px] block text-muted-foreground">تاريخ الاستحقاق</Label>
                        <ArabicDatePicker
                          value={payment.payment_date}
                          onChange={(date) => updatePayment(payment.id, 'payment_date', date)}
                          className="h-10"
                          disabled={isMetaDisabled}
                        />
                      </div>
                    </div>
                  )}

                  {/* Visa action — Pay button / paid badge. Its own row
                      under the inputs so the cheque sub-row stays clean
                      and the button can stretch full-width on narrow
                      screens. */}
                  {hasActionsColumn && (
                    <div className="mt-2 flex items-center gap-2 pl-16">
                      {isVisa && !visaPaid && !isLocked && (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => handleVisaPayClick(index)}
                          disabled={visaAmount <= 0 || isProcessing}
                          className="gap-1.5 bg-primary hover:bg-primary/90"
                        >
                          {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                          {isProcessing ? 'جاري التحضير...' : 'ادفع'}
                        </Button>
                      )}

                      {isVisa && visaPaid && (
                        <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                          <CreditCard className="h-3.5 w-3.5" />
                          تم الدفع
                        </span>
                      )}
                    </div>
                  )}

                  {/* Inline receipt strip — thin, no divider, same card.
                      Locked auto rows also get the strip so the agent
                      can attach a screenshot of the external visa
                      receipt even when the type stays as فيزا. */}
                  {(payment.payment_type === 'cash' || payment.payment_type === 'cheque' || payment.payment_type === 'transfer' || isLocked) && !visaPaid && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
                        <span>
                          {payment.payment_type === 'cheque'
                            ? 'صور الشيك'
                            : payment.payment_type === 'transfer'
                              ? 'صور إيصال التحويل'
                              : 'صور إيصال الدفع'}
                        </span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button type="button" className="hover:text-foreground">
                              <Info className="h-3 w-3" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            <p className="text-xs max-w-[220px]">
                              أرفق صورة الإيصال أو ملف PDF كإثبات للدفعة. يمكنك إضافة أكثر من ملف.
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </div>

                      {payment.cheque_image_url && (
                        <img
                          src={payment.cheque_image_url}
                          alt="صورة الشيك"
                          className="h-10 w-14 object-cover rounded border"
                        />
                      )}
                      {getPreviewUrls(payment.id).map((item, imgIndex) => (
                        <div key={imgIndex} className="relative group">
                          {item.kind === 'pdf' ? (
                            <div
                              className="h-10 w-14 rounded border bg-red-50 border-red-200 flex flex-col items-center justify-center gap-0.5"
                              title={item.name || 'PDF'}
                            >
                              <FileText className="h-4 w-4 text-red-500" />
                              <span className="text-[8px] font-bold text-red-500 leading-none">PDF</span>
                            </div>
                          ) : (
                            <img
                              src={item.url}
                              alt={item.name || ''}
                              className="h-10 w-14 object-cover rounded border"
                            />
                          )}
                          <button
                            type="button"
                            onClick={() => removeImage(payment.id, imgIndex)}
                            className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                      <label
                        className="h-10 px-2.5 border border-dashed rounded flex items-center gap-1.5 cursor-pointer hover:bg-muted/50 hover:border-primary/40 hover:text-foreground transition-colors text-muted-foreground"
                        title="إضافة صورة إيصال"
                      >
                        <input
                          type="file"
                          accept="image/*,application/pdf"
                          multiple
                          onChange={(e) => handleImageSelect(payment.id, e)}
                          className="hidden"
                        />
                        <Upload className="h-3.5 w-3.5" />
                        <span className="text-[10px] whitespace-nowrap">إضافة إيصال</span>
                      </label>
                      {payment.pendingImages && payment.pendingImages.length > 0 && (
                        <span className="text-[10px] text-muted-foreground flex items-center gap-1 mr-auto">
                          <ImageIcon className="h-3 w-3" />
                          {payment.pendingImages.length} ملفات سيتم رفعها
                        </span>
                      )}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}

        {/* Error Message — paymentsExceedPrice is computed in the hook
            and may not have triggered validateStep yet, so we render it
            independently. errors.payments covers cheque validation
            (missing amount / تاريخ استحقاق / تاريخ إصدار) raised the
            last time the user tried to advance / save. */}
        {paymentsExceedPrice && (
          <div className="flex items-center gap-2 text-destructive text-sm p-3 bg-destructive/10 rounded-lg">
            <AlertCircle className="h-4 w-4" />
            <span>مجموع الدفعات يتجاوز سعر التأمين</span>
          </div>
        )}
        {!paymentsExceedPrice && errors.payments && (
          <div className="flex items-center gap-2 text-destructive text-sm p-3 bg-destructive/10 rounded-lg">
            <AlertCircle className="h-4 w-4" />
            <span>{errors.payments}</span>
          </div>
        )}
      </div>

      {/* Tranzila Payment Modal */}
      {selectedVisaPayment && activePolicyIdForPayment && (
        <TranzilaPaymentModal
          open={showTranzilaModal}
          onOpenChange={(open) => {
            if (!open) handleVisaFailure();
            setShowTranzilaModal(open);
          }}
          policyId={activePolicyIdForPayment}
          amount={selectedVisaPayment.amount || 0}
          paymentDate={selectedVisaPayment.payment_date}
          notes={selectedVisaPayment.notes}
          onSuccess={handleVisaSuccess}
          onFailure={handleVisaFailure}
        />
      )}

      {/* Cheque Scanner Modal */}
      <ChequeScannerDialog
        open={showChequeScannerModal}
        onOpenChange={setShowChequeScannerModal}
        onConfirm={(detectedCheques) => {
          // Helper function to convert base64 to Blob
          const base64ToBlob = (base64: string, type = 'image/jpeg'): Blob => {
            try {
              const byteString = atob(base64);
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

          // Convert detected cheques to payment lines with images
          const newPayments: PaymentLine[] = [];
          const newPreviewUrls: { [key: string]: PreviewItem[] } = {};

          for (const cheque of detectedCheques) {
            const paymentId = crypto.randomUUID();
            const today = new Date().toISOString().split('T')[0];
            const payment: PaymentLine = {
              id: paymentId,
              payment_type: 'cheque',
              amount: cheque.amount || 0,
              payment_date: cheque.payment_date || today,
              cheque_issue_date: today,
              cheque_number: cheque.cheque_number || '',
              bank_code: (cheque as any).bank_code || null,
              branch_code: (cheque as any).branch_code || (cheque as any).branch_number || null,
              refused: false,
              cheque_image_url: cheque.image_url,
            };

            // Convert cropped image to File for pendingImages
            if (cheque.cropped_base64) {
              try {
                const blob = base64ToBlob(cheque.cropped_base64);
                const file = new File(
                  [blob],
                  `cheque_${cheque.cheque_number || paymentId}.jpg`,
                  { type: 'image/jpeg' }
                );
                payment.pendingImages = [file];

                // Cheque scans are always JPEGs from the detector, never PDFs.
                newPreviewUrls[paymentId] = [{
                  url: URL.createObjectURL(blob),
                  kind: 'image',
                  name: file.name,
                }];
              } catch (e) {
                console.error('Failed to convert cheque image:', e);
              }
            }

            newPayments.push(payment);
          }

          // Update preview URLs state
          setPreviewUrls(prev => ({ ...prev, ...newPreviewUrls }));
          
          setPayments([...payments, ...newPayments]);
          toast({
            title: 'تمت إضافة الشيكات',
            description: `تم إضافة ${newPayments.length} دفعة شيك مع الصور`,
          });
        }}
      />
    </div>
  );
}