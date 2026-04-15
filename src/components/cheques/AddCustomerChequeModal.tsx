import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Loader2, Plus, Trash2, Scan, User, Check, ChevronsUpDown, AlertCircle, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { ChequeScannerDialog } from '@/components/payments/ChequeScannerDialog';
import { sanitizeChequeNumber, CHEQUE_NUMBER_MAX_LENGTH } from '@/lib/chequeUtils';
import { ArabicDatePicker } from '@/components/ui/arabic-date-picker';
import { BankBranchPicker } from '@/components/shared/BankBranchPicker';

interface Client {
  id: string;
  full_name: string;
  phone_number: string | null;
}

interface ChequeLine {
  id: string;
  amount: number;
  cheque_number: string;
  payment_date: string;
  bank_code: string | null;
  branch_code: string | null;
  cheque_image_url?: string;
  notes?: string;
}

// Track all scan images from the batch for payment_images insertion
let batchScanImages: string[] = [];

interface AddCustomerChequeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function AddCustomerChequeModal({
  open,
  onOpenChange,
  onSuccess,
}: AddCustomerChequeModalProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [clientSearchOpen, setClientSearchOpen] = useState(false);
  const [clientSearch, setClientSearch] = useState('');
  const [chequeLines, setChequeLines] = useState<ChequeLine[]>([]);
  const [chequeScannerOpen, setChequeScannerOpen] = useState(false);
  const [excessWarning, setExcessWarning] = useState<number>(0);

  // Fetch clients
  useEffect(() => {
    if (!open) return;
    const fetchClients = async () => {
      setLoading(true);
      try {
        const { data } = await supabase
          .from('clients')
          .select('id, full_name, phone_number')
          .is('deleted_at', null)
          .order('full_name');
        setClients(data || []);
      } catch (err) {
        console.error('Error fetching clients:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchClients();
  }, [open]);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setSelectedClient(null);
      setChequeLines([]);
      setClientSearch('');
      setExcessWarning(0);
      batchScanImages = [];
    }
  }, [open]);

  const filteredClients = useMemo(() => {
    if (!clientSearch.trim()) return clients.slice(0, 50);
    const query = clientSearch.toLowerCase();
    return clients.filter(c =>
      c.full_name.toLowerCase().includes(query) ||
      c.phone_number?.includes(query)
    ).slice(0, 50);
  }, [clients, clientSearch]);

  const addChequeLine = () => {
    setChequeLines(prev => [...prev, {
      id: crypto.randomUUID(),
      amount: 0,
      cheque_number: '',
      payment_date: new Date().toISOString().split('T')[0],
      bank_code: null,
      branch_code: null,
    }]);
  };

  const removeChequeLine = (id: string) => {
    setChequeLines(prev => prev.filter(c => c.id !== id));
  };

  const updateChequeLine = (id: string, updates: Partial<ChequeLine>) => {
    setChequeLines(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));
  };

  const handleScannerConfirm = (scannedCheques: any[]) => {
    // The scanner's OCR emits free-text `bank_name` / `branch_number`
    // — keep whatever it gave us as `branch_code` (it's typically a
    // numeric branch id), and leave `bank_code` null unless the scanner
    // later starts returning a 2-digit MICR code.
    const newLines: ChequeLine[] = scannedCheques.map(cheque => ({
      id: crypto.randomUUID(),
      amount: cheque.amount || 0,
      cheque_number: cheque.cheque_number || '',
      payment_date: cheque.payment_date || new Date().toISOString().split('T')[0],
      bank_code: cheque.bank_code || null,
      branch_code: cheque.branch_code || cheque.branch_number || null,
      cheque_image_url: cheque.image_url,
    }));
    // Collect all unique scan images from this batch
    if (scannedCheques.length > 0 && scannedCheques[0].all_scan_images) {
      const newScanImages = scannedCheques[0].all_scan_images as string[];
      batchScanImages = Array.from(new Set([...batchScanImages, ...newScanImages]));
    }
    setChequeLines(prev => [...prev, ...newLines]);
    setChequeScannerOpen(false);
    toast.success(`تم إضافة ${newLines.length} شيك`);
  };

  const totalAmount = useMemo(() => {
    return chequeLines.reduce((sum, c) => sum + (c.amount || 0), 0);
  }, [chequeLines]);

  const isValid = useMemo(() => {
    if (!selectedClient) return false;
    if (chequeLines.length === 0) return false;
    return chequeLines.every(c =>
      c.amount > 0 &&
      c.cheque_number.trim().length > 0 &&
      c.payment_date
    );
  }, [selectedClient, chequeLines]);

  /**
   * Save cheques as policy_payments distributed across unpaid policies.
   * Same logic as DebtPaymentModal.
   */
  const handleSave = async () => {
    if (!selectedClient || !isValid) return;

    setSaving(true);
    setExcessWarning(0);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = await supabase
        .from('profiles')
        .select('branch_id')
        .eq('id', user?.id)
        .single();
      const branchId = profile?.branch_id || null;

      // 1. Fetch active non-broker policies for this client
      const { data: policiesData, error: policiesError } = await supabase
        .from('policies')
        .select('id, policy_type_parent, insurance_price, branch_id, group_id')
        .eq('client_id', selectedClient.id)
        .eq('cancelled', false)
        .eq('transferred', false)
        .is('deleted_at', null)
        .is('broker_id', null);

      if (policiesError) throw policiesError;
      if (!policiesData || policiesData.length === 0) {
        toast.error('لا يوجد وثائق نشطة لهذا العميل');
        setSaving(false);
        return;
      }

      const allPolicyIds = policiesData.map(p => p.id);

      // 2. Fetch existing payments to calculate remaining per policy
      const { data: paymentsData } = await supabase
        .from('policy_payments')
        .select('policy_id, amount, refused')
        .in('policy_id', allPolicyIds);

      const paymentsMap: Record<string, number> = {};
      (paymentsData || []).forEach(p => {
        if (!p.refused) {
          paymentsMap[p.policy_id] = (paymentsMap[p.policy_id] || 0) + p.amount;
        }
      });

      // 3. Group by package (group_id) to apply ELZAMI exclusion logic
      const groupMap = new Map<string, typeof policiesData>();
      policiesData.forEach(policy => {
        const key = policy.group_id || `single_${policy.id}`;
        if (!groupMap.has(key)) groupMap.set(key, []);
        groupMap.get(key)!.push(policy);
      });

      // 4. Build payable policies list (non-ELZAMI with remaining > 0)
      interface PayablePolicy {
        policyId: string;
        remaining: number;
        branchId: string | null;
      }
      const payablePolicies: PayablePolicy[] = [];

      groupMap.forEach((policies) => {
        const fullPrice = policies.reduce((s, p) => s + p.insurance_price, 0);
        const paidTotal = policies.reduce((s, p) => s + (paymentsMap[p.id] || 0), 0);

        // Distribute paid amount: ELZAMI first, then others
        const sorted = [...policies].sort((a, b) => {
          if (a.policy_type_parent === 'ELZAMI' && b.policy_type_parent !== 'ELZAMI') return -1;
          if (a.policy_type_parent !== 'ELZAMI' && b.policy_type_parent === 'ELZAMI') return 1;
          return a.insurance_price - b.insurance_price;
        });

        let remainingPool = paidTotal;
        sorted.forEach(comp => {
          const coverAmount = Math.min(remainingPool, comp.insurance_price);
          remainingPool = Math.max(0, remainingPool - coverAmount);
          const internalRemaining = comp.insurance_price - coverAmount;

          if (comp.policy_type_parent !== 'ELZAMI' && internalRemaining > 0) {
            payablePolicies.push({
              policyId: comp.id,
              remaining: internalRemaining,
              branchId: comp.branch_id,
            });
          }
        });
      });

      // Sort by remaining ascending (fill smallest first)
      payablePolicies.sort((a, b) => a.remaining - b.remaining);

      // Fallback: if all policies are fully paid, use first non-ELZAMI policy anyway
      if (payablePolicies.length === 0) {
        const fallback = policiesData.find(p => p.policy_type_parent !== 'ELZAMI');
        if (!fallback) {
          toast.error('لا يوجد وثائق غير إلزامي لهذا العميل');
          setSaving(false);
          return;
        }
        payablePolicies.push({
          policyId: fallback.id,
          remaining: 999999,
          branchId: fallback.branch_id,
        });
      }

      // 5. Distribute cheques across policies (split across multiple if needed)
      const batchId = crypto.randomUUID();
      const allInserts: any[] = [];
      let totalExcess = 0;

      for (const cheque of chequeLines) {
        let remainingAmount = cheque.amount;

        for (const policy of payablePolicies) {
          if (remainingAmount <= 0.001) break;

          const assignable = Math.min(remainingAmount, policy.remaining);
          if (assignable <= 0) continue;

          allInserts.push({
            policy_id: policy.policyId,
            amount: assignable,
            payment_type: 'cheque',
            payment_date: cheque.payment_date,
            cheque_number: cheque.cheque_number,
            cheque_image_url: cheque.cheque_image_url || null,
            cheque_status: 'pending',
            bank_code: cheque.bank_code || null,
            branch_code: cheque.branch_code || null,
            notes: cheque.notes || 'شيك من صفحة الشيكات',
            branch_id: policy.branchId || branchId,
            batch_id: batchId,
          });

          policy.remaining = Math.max(0, policy.remaining - assignable);
          remainingAmount -= assignable;
        }

        // If still remaining after all policies, assign to last policy (trigger will skip via batch_id)
        if (remainingAmount > 0.001) {
          const lastPolicy = payablePolicies[payablePolicies.length - 1];
          allInserts.push({
            policy_id: lastPolicy.policyId,
            amount: remainingAmount,
            payment_type: 'cheque',
            payment_date: cheque.payment_date,
            cheque_number: cheque.cheque_number,
            cheque_image_url: cheque.cheque_image_url || null,
            cheque_status: 'pending',
            bank_code: cheque.bank_code || null,
            branch_code: cheque.branch_code || null,
            notes: cheque.notes || 'شيك من صفحة الشيكات',
            branch_id: lastPolicy.branchId || branchId,
            batch_id: batchId,
          });
          totalExcess += remainingAmount;
        }
      }

      if (allInserts.length === 0) {
        toast.error('لا يمكن توزيع الشيكات على الوثائق');
        setSaving(false);
        return;
      }

      // 6. Insert into policy_payments and get back IDs
      const { data: insertedPayments, error } = await supabase
        .from('policy_payments')
        .insert(allInserts)
        .select('id');

      if (error) throw error;

      // 7. Insert all scan images into payment_images for each payment
      if (insertedPayments && batchScanImages.length > 0) {
        const imageInserts = insertedPayments.flatMap(payment =>
          batchScanImages.map((url, idx) => ({
            payment_id: payment.id,
            image_url: url,
            image_type: 'scan',
            sort_order: idx,
          }))
        );
        if (imageInserts.length > 0) {
          await supabase.from('payment_images').insert(imageInserts);
        }
      }

      // Reset batch images
      batchScanImages = [];

      if (totalExcess > 0) {
        setExcessWarning(totalExcess);
      }

      toast.success(`تم إضافة ${chequeLines.length} شيك للعميل ${selectedClient.full_name}`);
      onSuccess();
      onOpenChange(false);
    } catch (err) {
      console.error('Error saving cheques:', err);
      toast.error('فشل في حفظ الشيكات');
    } finally {
      setSaving(false);
    }
  };

  const formatCurrency = (val: number) => `₪${val.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl w-[95vw] max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-primary" />
              إضافة شيكات لعميل
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Client Selection */}
            <div className="space-y-2">
              <Label>العميل *</Label>
              <Popover open={clientSearchOpen} onOpenChange={setClientSearchOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={clientSearchOpen}
                    className="w-full justify-between"
                    disabled={loading}
                  >
                    {loading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : selectedClient ? (
                      <span className="flex items-center gap-2">
                        <User className="h-4 w-4" />
                        {selectedClient.full_name}
                        {selectedClient.phone_number && (
                          <span className="text-muted-foreground text-xs">({selectedClient.phone_number})</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">اختر العميل...</span>
                    )}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder="ابحث بالاسم أو رقم الهاتف..."
                      value={clientSearch}
                      onValueChange={setClientSearch}
                    />
                    <CommandList>
                      <CommandEmpty>لا يوجد عملاء</CommandEmpty>
                      <CommandGroup>
                        {filteredClients.map((client) => (
                          <CommandItem
                            key={client.id}
                            value={client.id}
                            onSelect={() => {
                              setSelectedClient(client);
                              setClientSearchOpen(false);
                              setClientSearch('');
                            }}
                          >
                            <Check
                              className={cn(
                                "ml-2 h-4 w-4",
                                selectedClient?.id === client.id ? "opacity-100" : "opacity-0"
                              )}
                            />
                            <div className="flex flex-col">
                              <span>{client.full_name}</span>
                              {client.phone_number && (
                                <span className="text-xs text-muted-foreground">{client.phone_number}</span>
                              )}
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {/* Cheque Lines Section */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>الشيكات</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setChequeScannerOpen(true)}
                    className="gap-1"
                  >
                    <Scan className="h-4 w-4" />
                    مسح شيكات
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addChequeLine}
                    className="gap-1"
                  >
                    <Plus className="h-4 w-4" />
                    إضافة يدوي
                  </Button>
                </div>
              </div>

              {chequeLines.length === 0 ? (
                <Card className="p-8 text-center border-dashed">
                  <AlertCircle className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-muted-foreground text-sm">
                    لا توجد شيكات. استخدم "مسح شيكات" أو "إضافة يدوي" لإضافة شيكات.
                  </p>
                </Card>
              ) : (
                <div className="space-y-3">
                  {chequeLines.map((cheque) => (
                    <Card key={cheque.id} className="p-4">
                      <div className="flex items-start gap-4">
                        <div className="flex-1 space-y-3">
                          {/* Bank → branch → رقم الشيك on one row */}
                          <BankBranchPicker
                            bankCode={cheque.bank_code}
                            branchCode={cheque.branch_code}
                            onBankChange={(code) => updateChequeLine(cheque.id, { bank_code: code })}
                            onBranchChange={(code) => updateChequeLine(cheque.id, { branch_code: code })}
                            chequeNumberSlot={
                              <>
                                <Label className="text-xs font-semibold">رقم الشيك *</Label>
                                <Input
                                  value={cheque.cheque_number}
                                  onChange={(e) => updateChequeLine(cheque.id, {
                                    cheque_number: sanitizeChequeNumber(e.target.value)
                                  })}
                                  placeholder="رقم الشيك"
                                  maxLength={CHEQUE_NUMBER_MAX_LENGTH}
                                  className="h-9 font-mono"
                                />
                              </>
                            }
                          />
                          {/* Amount + due date on a second row */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <Label className="text-xs">المبلغ *</Label>
                              <Input
                                type="number"
                                value={cheque.amount || ''}
                                onChange={(e) => updateChequeLine(cheque.id, { amount: parseFloat(e.target.value) || 0 })}
                                placeholder="0"
                                className="h-9"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">تاريخ الاستحقاق *</Label>
                              <ArabicDatePicker
                                value={cheque.payment_date}
                                onChange={(date) => updateChequeLine(cheque.id, { payment_date: date })}
                                compact
                              />
                            </div>
                          </div>
                        </div>
                        {cheque.cheque_image_url && (
                          <div className="w-16 h-12 rounded border overflow-hidden shrink-0">
                            <img
                              src={cheque.cheque_image_url}
                              alt="صورة الشيك"
                              className="w-full h-full object-cover"
                            />
                          </div>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeChequeLine(cheque.id)}
                          className="shrink-0 text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>

            {/* Total Summary */}
            {chequeLines.length > 0 && (
              <Card className="p-4 bg-muted/50">
                <div className="flex items-center justify-between">
                  <span className="font-medium">إجمالي الشيكات:</span>
                  <span className="text-xl font-bold ltr-nums">{formatCurrency(totalAmount)}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  سيتم توزيع المبلغ على وثائق العميل غير المدفوعة وخصمه من رصيده
                </p>
              </Card>
            )}

            {/* Excess warning */}
            {excessWarning > 0 && (
              <Card className="p-3 border-amber-500/50 bg-amber-500/10">
                <div className="flex items-center gap-2 text-amber-600">
                  <AlertTriangle className="h-4 w-4" />
                  <span className="text-sm">تبقى {formatCurrency(excessWarning)} بدون توزيع (تجاوز إجمالي الوثائق)</span>
                </div>
              </Card>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              إلغاء
            </Button>
            <Button
              onClick={handleSave}
              disabled={!isValid || saving}
              className="gap-2"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  جاري الحفظ...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  حفظ الشيكات ({chequeLines.length})
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ChequeScannerDialog
        open={chequeScannerOpen}
        onOpenChange={setChequeScannerOpen}
        onConfirm={handleScannerConfirm}
        title="مسح شيكات العميل"
      />
    </>
  );
}
