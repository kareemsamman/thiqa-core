import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArabicDatePicker } from "@/components/ui/arabic-date-picker";
import { Plus, Trash2, CreditCard, AlertCircle, Loader2, Split, Upload, X, ImageIcon, Lock, Scan, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { PaymentSummaryBar } from "./PaymentSummaryBar";
import { TranzilaPaymentModal } from "@/components/payments/TranzilaPaymentModal";
import { ChequeScannerDialog } from "@/components/payments/ChequeScannerDialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { sanitizeChequeNumber, CHEQUE_NUMBER_MAX_LENGTH } from "@/lib/chequeUtils";
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
}

interface PreviewUrls {
  [paymentId: string]: string[];
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

    // Create preview URLs
    const newPreviewUrls = validFiles.map(file => URL.createObjectURL(file));
    setPreviewUrls(prev => ({
      ...prev,
      [paymentId]: [...(prev[paymentId] || []), ...newPreviewUrls],
    }));
    
    // Store files in payment object for later upload
    const payment = payments.find(p => p.id === paymentId);
    if (payment) {
      const existingFiles = payment.pendingImages || [];
      updatePayment(paymentId, 'pendingImages', [...existingFiles, ...validFiles]);
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
    
    // Keep locked payments, remove unlocked ones, add new split payments
    const lockedPayments = payments.filter(p => p.locked === true);
    setPayments([...lockedPayments, ...newPayments]);
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
            {payments.map((payment, index) => {
              const isVisa = payment.payment_type === 'visa';
              const visaPaid = payment.tranzila_paid;
              const visaAmount = payment.amount || 0;
              const isProcessing = creatingPolicy && selectedVisaPaymentIndex === index;
              const isLocked = payment.locked === true;
              const isDisabled = visaPaid || isLocked;
              
              return (
                <Card key={payment.id} className={cn(
                  "p-3",
                  visaPaid && "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800",
                  isLocked && "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800"
                )}>
                  {/* Locked Payment Badge */}
                  {isLocked && payment.locked_label && (
                    <div className="flex items-center gap-2 mb-2 pb-2 border-b border-amber-200 dark:border-amber-700">
                      <Lock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                      <span className="text-sm font-medium text-amber-700 dark:text-amber-300">
                        {payment.locked_label}
                      </span>
                      <span className="text-[10px] text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/50 px-2 py-0.5 rounded-full">
                        محسوبة تلقائيًا
                      </span>
                    </div>
                  )}

                  {/* Main row: Type / Amount / Date / Actions.
                      On mobile we give the actions column its own row to keep the three fields readable. */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 items-end">
                    {/* Payment Type */}
                    <div>
                      <Label className="text-[10px] mb-1 block text-muted-foreground">نوع الدفع</Label>
                      <Select
                        value={payment.payment_type}
                        onValueChange={(v) => updatePayment(payment.id, 'payment_type', v)}
                        disabled={isDisabled}
                      >
                        <SelectTrigger className={cn("h-9", isLocked && "opacity-70 cursor-not-allowed")}>
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

                    {/* Amount */}
                    <div>
                      <Label className="text-[10px] mb-1 block text-muted-foreground">المبلغ (₪)</Label>
                      <Input
                        type="number"
                        value={payment.amount || ''}
                        onChange={(e) => updatePayment(payment.id, 'amount', parseFloat(e.target.value) || 0)}
                        placeholder="0"
                        disabled={isDisabled}
                        className={cn(
                          "h-9",
                          paymentsExceedPrice && "border-destructive",
                          isLocked && "opacity-70 cursor-not-allowed"
                        )}
                      />
                    </div>

                    {/* Date */}
                    <div className="col-span-2 lg:col-span-1">
                      <Label className="text-[10px] mb-1 block text-muted-foreground">التاريخ</Label>
                      <ArabicDatePicker
                        value={payment.payment_date}
                        onChange={(date) => updatePayment(payment.id, 'payment_date', date)}
                        className={cn("h-9", isLocked && "opacity-70 cursor-not-allowed")}
                        disabled={isDisabled}
                      />
                    </div>

                    {/* Actions (cheque# inline + visa pay / delete) */}
                    <div className="col-span-2 lg:col-span-1 flex items-center gap-2">
                      {payment.payment_type === 'cheque' && !isLocked && (
                        <Input
                          value={payment.cheque_number || ''}
                          onChange={(e) => updatePayment(payment.id, 'cheque_number', sanitizeChequeNumber(e.target.value))}
                          placeholder="رقم الشيك"
                          maxLength={CHEQUE_NUMBER_MAX_LENGTH}
                          className="h-9 flex-1 font-mono ltr-input"
                          disabled={isDisabled}
                        />
                      )}

                      {isVisa && !visaPaid && !isLocked && (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => handleVisaPayClick(index)}
                          disabled={visaAmount <= 0 || isProcessing}
                          className="gap-1.5 bg-primary hover:bg-primary/90 flex-1 lg:flex-initial"
                        >
                          {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                          {isProcessing ? 'جاري التحضير...' : 'ادفع'}
                        </Button>
                      )}

                      {isVisa && visaPaid && (
                        <span className="text-xs text-green-600 font-medium flex items-center gap-1 flex-1">
                          <CreditCard className="h-3.5 w-3.5" />
                          تم الدفع
                        </span>
                      )}

                      {isLocked && (
                        <span className="text-xs text-amber-600 font-medium flex items-center gap-1 flex-1">
                          <Lock className="h-3.5 w-3.5" />
                          مقفلة
                        </span>
                      )}

                      {!visaPaid && !isLocked && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removePayment(payment.id)}
                          className="h-9 w-9 mr-auto text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Inline receipt strip — thin, no divider, same card. */}
                  {(payment.payment_type === 'cash' || payment.payment_type === 'cheque' || payment.payment_type === 'transfer') && !visaPaid && (
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
                      {getPreviewUrls(payment.id).map((url, imgIndex) => (
                        <div key={imgIndex} className="relative group">
                          <img
                            src={url}
                            alt=""
                            className="h-10 w-14 object-cover rounded border"
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

        {/* Error Message */}
        {paymentsExceedPrice && (
          <div className="flex items-center gap-2 text-destructive text-sm p-3 bg-destructive/10 rounded-lg">
            <AlertCircle className="h-4 w-4" />
            <span>مجموع الدفعات يتجاوز سعر التأمين</span>
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
          const newPreviewUrls: { [key: string]: string[] } = {};
          
          for (const cheque of detectedCheques) {
            const paymentId = crypto.randomUUID();
            const payment: PaymentLine = {
              id: paymentId,
              payment_type: 'cheque',
              amount: cheque.amount || 0,
              payment_date: cheque.payment_date || new Date().toISOString().split('T')[0],
              cheque_number: cheque.cheque_number || '',
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
                
                // Create preview URL for display
                newPreviewUrls[paymentId] = [URL.createObjectURL(blob)];
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