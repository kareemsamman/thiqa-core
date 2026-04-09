import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

import { FileUploader } from "@/components/media/FileUploader";
import { CustomerChequeSelector, SelectableCheque } from "@/components/shared/CustomerChequeSelector";
import { 
  ArrowLeft, 
  Plus, 
  Wallet, 
  Calendar,
  CreditCard,
  Banknote,
  Building2,
  Receipt,
  XCircle,
  Loader2,
  Trash2,
  Split,
  TrendingDown,
  CheckCircle2,
  FileText,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ArabicDatePicker } from "@/components/ui/arabic-date-picker";
import { cn } from "@/lib/utils";

interface Company {
  id: string;
  name: string;
  name_ar: string | null;
}

interface Settlement {
  id: string;
  total_amount: number;
  settlement_date: string;
  status: string;
  notes: string | null;
  created_at: string;
  payment_type: string;
  cheque_number: string | null;
  cheque_image_url: string | null;
  bank_reference: string | null;
  refused: boolean;
  receipt_images: string[] | null;
  customer_cheque_ids: string[] | null;
}

interface CustomerChequeDetail {
  id: string;
  amount: number;
  payment_date: string;
  cheque_number: string | null;
  cheque_image_url: string | null;
  client_name: string | null;
  car_number: string | null;
}

type PaymentType = 'cash' | 'cheque' | 'bank_transfer' | 'visa' | 'customer_cheque';

interface PaymentLine {
  id: string;
  payment_type: PaymentType;
  amount: number;
  payment_date: string;
  cheque_number?: string;
  cheque_image_url?: string;
  bank_reference?: string;
  notes?: string;
  selected_cheques?: SelectableCheque[];
}

// Settlement detail dialog state
interface SettlementDetail {
  id: string;
  settlement: Settlement;
  customerCheques?: CustomerChequeDetail[];
}

const paymentTypeLabels: Record<PaymentType, string> = {
  cash: 'نقداً',
  cheque: 'شيك',
  bank_transfer: 'تحويل بنكي',
  visa: 'بطاقة ائتمان',
  customer_cheque: 'شيك عميل',
};

const PaymentTypeIcon = ({ type }: { type: string }) => {
  switch (type) {
    case 'cash': return <Banknote className="h-4 w-4" />;
    case 'cheque': return <Receipt className="h-4 w-4" />;
    case 'customer_cheque': return <FileText className="h-4 w-4" />;
    case 'bank_transfer': return <Building2 className="h-4 w-4" />;
    case 'visa': return <CreditCard className="h-4 w-4" />;
    default: return <Wallet className="h-4 w-4" />;
  }
};

export default function CompanyWallet() {
  const { companyId } = useParams<{ companyId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();

  const [company, setCompany] = useState<Company | null>(null);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewPayment, setShowNewPayment] = useState(false);
  const [saving, setSaving] = useState(false);
  
  // Wallet summary
  const [totalPayable, setTotalPayable] = useState(0);
  const [totalPaid, setTotalPaid] = useState(0);
  const [outstanding, setOutstanding] = useState(0);
  const [elzamiCosts, setElzamiCosts] = useState(0);

  // Payment lines
  const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([]);
  
  // Main receipt images for the whole settlement
  const [mainReceiptImages, setMainReceiptImages] = useState<string[]>([]);
  const [mainNotes, setMainNotes] = useState('');

  // Settlement detail dialog
  const [settlementDetail, setSettlementDetail] = useState<SettlementDetail | null>(null);

  // Split popover
  const [splitPopoverOpen, setSplitPopoverOpen] = useState(false);
  const [splitCount, setSplitCount] = useState(2);
  const [splitAmount, setSplitAmount] = useState('');

  const fetchCompanyData = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      // Fetch company info
      const { data: companyData, error: companyError } = await supabase
        .from('insurance_companies')
        .select('id, name, name_ar')
        .eq('id', companyId)
        .single();

      if (companyError) throw companyError;
      setCompany(companyData);

      // Fetch settlements
      const { data: settlementsData } = await supabase
        .from('company_settlements')
        .select('*')
        .eq('company_id', companyId)
        .order('settlement_date', { ascending: false });

      if (settlementsData) {
        setSettlements(settlementsData as Settlement[]);
      }

      // Calculate wallet balance from ledger
      const { data: balanceData } = await supabase
        .rpc('get_company_wallet_balance', { p_company_id: companyId });

      if (balanceData && balanceData.length > 0) {
        setTotalPayable(Number(balanceData[0].total_payable) || 0);
        setTotalPaid(Math.max(Number(balanceData[0].total_paid) || 0, 0)); // safeguard
        setOutstanding(Number(balanceData[0].outstanding) || 0);
        setElzamiCosts(Number(balanceData[0].elzami_costs) || 0);
      }
    } catch (error) {
      console.error('Error fetching company data:', error);
      toast({
        title: "خطأ",
        description: "فشل في تحميل بيانات الشركة",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [companyId, toast]);

  useEffect(() => {
    fetchCompanyData();
  }, [fetchCompanyData]);

  const validateChequeNumber = (num: string) => /^\d{8}$/.test(num);

  const addPaymentLine = () => {
    setPaymentLines([
      ...paymentLines,
      {
        id: crypto.randomUUID(),
        payment_type: 'cash',
        amount: 0,
        payment_date: new Date().toISOString().split('T')[0],
      },
    ]);
  };

  const removePaymentLine = (id: string) => {
    setPaymentLines(paymentLines.filter(p => p.id !== id));
  };

  const updatePaymentLine = (id: string, field: string, value: any) => {
    setPaymentLines((prev) =>
      prev.map((p) => (p.id === id ? { ...p, [field]: value } : p))
    );
  };

  const handleSplitPayments = () => {
    if (splitCount < 2 || splitCount > 12 || !splitAmount) return;
    
    const totalAmount = parseFloat(splitAmount) || 0;
    if (totalAmount <= 0) return;

    const amountPerInstallment = Math.floor(totalAmount / splitCount);
    const remainder = totalAmount - (amountPerInstallment * splitCount);
    
    const today = new Date();
    const newPayments: PaymentLine[] = [];
    
    for (let i = 0; i < splitCount; i++) {
      const paymentDate = new Date(today);
      paymentDate.setMonth(today.getMonth() + i);
      
      const amount = i === 0 ? amountPerInstallment + remainder : amountPerInstallment;
      
      newPayments.push({
        id: crypto.randomUUID(),
        payment_type: 'cash',
        amount,
        payment_date: paymentDate.toISOString().split('T')[0],
      });
    }
    
    setPaymentLines(newPayments);
    setSplitPopoverOpen(false);
  };

  const handleSaveAllPayments = async () => {
    // Validate
    const hasInvalidCheque = paymentLines.some(
      p => p.payment_type === 'cheque' && !validateChequeNumber(p.cheque_number || '')
    );
    if (hasInvalidCheque) {
      toast({ title: "خطأ", description: "رقم الشيك يجب أن يكون 8 أرقام", variant: "destructive" });
      return;
    }

    // For customer_cheque, validate that cheques are selected
    const hasEmptyCustomerCheque = paymentLines.some(
      p => p.payment_type === 'customer_cheque' && (!p.selected_cheques || p.selected_cheques.length === 0)
    );
    if (hasEmptyCustomerCheque) {
      toast({ title: "خطأ", description: "يجب اختيار شيك واحد على الأقل", variant: "destructive" });
      return;
    }

    const paymentsToSave = paymentLines.filter(p => p.amount > 0 || (p.payment_type === 'customer_cheque' && p.selected_cheques?.length));

    if (paymentsToSave.length === 0) {
      toast({ title: "تنبيه", description: "لا توجد دفعات لحفظها", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      for (const payment of paymentsToSave) {
        // Calculate amount from selected cheques if customer_cheque
        const amount = payment.payment_type === 'customer_cheque' && payment.selected_cheques
          ? payment.selected_cheques.reduce((sum, c) => sum + c.amount, 0)
          : payment.amount;

        // Collect customer cheque IDs if applicable
        const customerChequeIds = payment.payment_type === 'customer_cheque' && payment.selected_cheques
          ? payment.selected_cheques.map(c => c.id)
          : [];

        // Create settlement record
        const { data: settlement, error } = await supabase
          .from('company_settlements')
          .insert({
            company_id: companyId,
            total_amount: amount,
            settlement_date: payment.payment_date,
            notes: mainNotes || null,
            status: 'completed',
            created_by_admin_id: user?.id,
            payment_type: payment.payment_type, // Keep actual payment type
            cheque_number: payment.payment_type === 'cheque' ? payment.cheque_number : null,
            cheque_image_url: payment.payment_type === 'cheque' ? payment.cheque_image_url : null,
            bank_reference: payment.payment_type === 'bank_transfer' ? payment.bank_reference : null,
            receipt_images: mainReceiptImages,
            customer_cheque_ids: customerChequeIds,
            refused: false,
            branch_id: null,
          })
          .select('id')
          .single();

        if (error) throw error;

        // If customer cheques were used, update them as transferred
        if (payment.payment_type === 'customer_cheque' && customerChequeIds.length > 0 && settlement) {
          const { error: updateError } = await supabase
            .from('policy_payments')
            .update({
              cheque_status: 'transferred_out',
              transferred_to_type: 'company',
              transferred_to_id: companyId!,
              transferred_payment_id: settlement.id,
              transferred_at: new Date().toISOString(),
              refused: false,
            })
            .in('id', customerChequeIds);

          if (updateError) {
            console.error('Error updating cheque status:', updateError);
            // Best-effort cleanup so we don't leave a settlement that didn't actually consume cheques
            try {
              await supabase.from('company_settlements').delete().eq('id', settlement.id);
            } catch {
              // ignore
            }
            throw updateError;
          }
        }
      }

      toast({ title: "تم الحفظ", description: "تم تسجيل جميع الدفعات بنجاح" });
      setShowNewPayment(false);
      setPaymentLines([]);
      setMainReceiptImages([]);
      setMainNotes('');
      fetchCompanyData();
    } catch (error) {
      console.error('Error saving payments:', error);
      toast({ title: "خطأ", description: "فشل في حفظ الدفعات", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleRefused = async (settlement: Settlement) => {
    try {
      const { error } = await supabase
        .from('company_settlements')
        .update({ refused: !settlement.refused })
        .eq('id', settlement.id);

      if (error) throw error;
      
      toast({ 
        title: settlement.refused ? "تم استعادة الدفعة" : "تم رفض الدفعة",
      });
      
      fetchCompanyData();
    } catch (error) {
      toast({ title: "خطأ", description: "فشل في تحديث الدفعة", variant: "destructive" });
    }
  };

  // Fetch customer cheque details for settlement detail dialog
  const handleOpenSettlementDetail = async (settlement: Settlement) => {
    let customerCheques: CustomerChequeDetail[] = [];
    
    if (settlement.payment_type === 'customer_cheque' && settlement.customer_cheque_ids && settlement.customer_cheque_ids.length > 0) {
      try {
        // Fetch the cheques with their policy/client/car details
        const { data: payments } = await supabase
          .from('policy_payments')
          .select('id, amount, payment_date, cheque_number, cheque_image_url, policy_id')
          .in('id', settlement.customer_cheque_ids);
        
        if (payments && payments.length > 0) {
          // Get policy IDs
          const policyIds = [...new Set(payments.map(p => p.policy_id).filter(Boolean))];
          
          // Fetch policies with clients and cars
          const { data: policies } = await supabase
            .from('policies')
            .select('id, client:clients(full_name), car:cars(car_number)')
            .in('id', policyIds);
          
          const policyMap = new Map(policies?.map(p => [p.id, p]) || []);
          
          customerCheques = payments.map(p => {
            const policy = policyMap.get(p.policy_id);
            return {
              id: p.id,
              amount: p.amount,
              payment_date: p.payment_date,
              cheque_number: p.cheque_number,
              cheque_image_url: p.cheque_image_url,
              client_name: (policy?.client as any)?.full_name || null,
              car_number: (policy?.car as any)?.car_number || null,
            };
          });
        }
      } catch (error) {
        console.error('Error fetching customer cheque details:', error);
      }
    }
    
    setSettlementDetail({ id: settlement.id, settlement, customerCheques });
  };

  const totalPaymentLines = paymentLines.reduce((sum, p) => sum + (p.amount || 0), 0);

  if (loading) {
    return (
      <MainLayout>
        <div className="p-6 space-y-6" dir="rtl">
          <Skeleton className="h-8 w-48" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="p-6 space-y-6" dir="rtl">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate(`/reports/company-settlement/${companyId}`)}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Wallet className="h-6 w-6" />
                محفظة الشركة
              </h1>
              <p className="text-muted-foreground">{company?.name_ar || company?.name}</p>
            </div>
          </div>
          <Button onClick={() => setShowNewPayment(true)} className="gap-2" size="lg">
            <Plus className="h-5 w-5" />
            دفعة جديدة للشركة
          </Button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* إجمالي المستحق للشركة */}
          <Card className="p-4 border-orange-200 dark:border-orange-800">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-orange-100 dark:bg-orange-900/30">
                <TrendingDown className="h-5 w-5 text-orange-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">إجمالي المستحق للشركة</p>
                <p className="text-lg font-bold text-orange-600">₪{totalPayable.toLocaleString()}</p>
              </div>
            </div>
          </Card>

          {/* إجمالي المدفوع */}
          <Card className="p-4 border-green-200 dark:border-green-800">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-green-100 dark:bg-green-900/30">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">إجمالي المدفوع</p>
                <p className="text-lg font-bold text-green-600">₪{totalPaid.toLocaleString()}</p>
              </div>
            </div>
          </Card>

          {/* المتبقي */}
          <Card className={cn(
            "p-4",
            outstanding > 0 ? "border-red-200 dark:border-red-800" : "border-green-200 dark:border-green-800"
          )}>
            <div className="flex items-center gap-3">
              <div className={cn(
                "p-2 rounded-xl",
                outstanding > 0 ? "bg-red-100 dark:bg-red-900/30" : "bg-green-100 dark:bg-green-900/30"
              )}>
                <Wallet className={cn(
                  "h-5 w-5",
                  outstanding > 0 ? "text-red-600" : "text-green-600"
                )} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">المتبقي للشركة</p>
                <p className={cn(
                  "text-lg font-bold",
                  outstanding > 0 ? "text-red-600" : "text-green-600"
                )}>
                  ₪{outstanding.toLocaleString()}
                </p>
              </div>
            </div>
          </Card>

          {/* تكلفة الإلزامي */}
          {elzamiCosts > 0 && (
            <Card className="p-4 border-purple-200 dark:border-purple-800">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-purple-100 dark:bg-purple-900/30">
                  <Receipt className="h-5 w-5 text-purple-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">تكلفة الإلزامي (علينا)</p>
                  <p className="text-lg font-bold text-purple-600">₪{elzamiCosts.toLocaleString()}</p>
                </div>
              </div>
            </Card>
          )}
        </div>

        {/* Settlements Table */}
        <Card className="p-4">
          <h2 className="text-lg font-semibold mb-4">سجل الدفعات</h2>
          {settlements.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">لا توجد دفعات مسجلة</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>المبلغ</TableHead>
                  <TableHead>طريقة الدفع</TableHead>
                  <TableHead>التفاصيل</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {settlements.map((s) => (
                  <TableRow
                    key={s.id}
                    className={cn(
                      "cursor-pointer transition-colors hover:bg-muted/40",
                      s.refused && "opacity-50"
                    )}
                    onClick={() => handleOpenSettlementDetail(s)}
                  >
                    <TableCell>{new Date(s.settlement_date).toLocaleDateString('en-GB')}</TableCell>
                    <TableCell className="font-bold">₪{s.total_amount.toLocaleString()}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <PaymentTypeIcon type={s.payment_type} />
                        {paymentTypeLabels[s.payment_type as PaymentType] || s.payment_type}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 flex-wrap">
                        {s.payment_type === 'customer_cheque' && s.customer_cheque_ids && s.customer_cheque_ids.length > 0 && (
                          <Badge variant="secondary" className="text-xs">
                            <FileText className="h-3 w-3 ml-1" />
                            {s.customer_cheque_ids.length} شيك عميل
                          </Badge>
                        )}
                        {s.cheque_number && (
                          <Badge variant="secondary" className="font-mono text-xs">
                            #{s.cheque_number}
                          </Badge>
                        )}
                        {s.bank_reference && (
                          <Badge variant="secondary" className="text-xs">
                            {s.bank_reference}
                          </Badge>
                        )}
                        {s.cheque_image_url && (
                          <a href={s.cheque_image_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                            <Badge variant="outline" className="text-xs cursor-pointer hover:bg-muted">
                              <Receipt className="h-3 w-3 ml-1" />
                              صورة الشيك
                            </Badge>
                          </a>
                        )}
                        {s.receipt_images && s.receipt_images.length > 0 && (
                          <Badge variant="outline" className="text-xs">
                            <FileText className="h-3 w-3 ml-1" />
                            سند قبض ({s.receipt_images.length})
                          </Badge>
                        )}
                        {s.notes && (
                          <span className="text-xs text-muted-foreground truncate max-w-[150px]" title={s.notes}>
                            {s.notes}
                          </span>
                        )}
                        {!s.cheque_number && !s.bank_reference && !s.receipt_images?.length && !s.notes && !(s.payment_type === 'customer_cheque' && s.customer_cheque_ids?.length) && '-'}
                      </div>
                    </TableCell>
                    <TableCell>
                      {s.refused ? (
                        <Badge variant="destructive">مرفوض</Badge>
                      ) : (
                        <Badge variant="default">تم الدفع</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                       <Button
                         variant="ghost"
                         size="sm"
                         onClick={(e) => {
                           e.stopPropagation();
                           handleToggleRefused(s);
                         }}
                       >
                         {s.refused ? (
                           <CheckCircle2 className="h-4 w-4 text-green-600" />
                         ) : (
                           <XCircle className="h-4 w-4 text-red-600" />
                         )}
                       </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>

        {/* Settlement Detail Dialog */}
        <Dialog open={!!settlementDetail} onOpenChange={(open) => !open && setSettlementDetail(null)}>
          <DialogContent className="max-w-lg" dir="rtl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                تفاصيل الدفعة
              </DialogTitle>
            </DialogHeader>
            {settlementDetail && (
              <div className="space-y-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground">التاريخ</p>
                    <p className="font-medium">{new Date(settlementDetail.settlement.settlement_date).toLocaleDateString('en-GB')}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">المبلغ</p>
                    <p className="font-bold text-lg">₪{settlementDetail.settlement.total_amount.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">طريقة الدفع</p>
                    <div className="flex items-center gap-2">
                      <PaymentTypeIcon type={settlementDetail.settlement.payment_type} />
                      {paymentTypeLabels[settlementDetail.settlement.payment_type as PaymentType] || settlementDetail.settlement.payment_type}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">الحالة</p>
                    {settlementDetail.settlement.refused ? (
                      <Badge variant="destructive">مرفوض</Badge>
                    ) : (
                      <Badge variant="default">تم الدفع</Badge>
                    )}
                  </div>
                </div>
                
                {settlementDetail.settlement.cheque_number && (
                  <div>
                    <p className="text-xs text-muted-foreground">رقم الشيك</p>
                    <p className="font-mono">{settlementDetail.settlement.cheque_number}</p>
                  </div>
                )}
                
                {settlementDetail.settlement.bank_reference && (
                  <div>
                    <p className="text-xs text-muted-foreground">رقم المرجع البنكي</p>
                    <p>{settlementDetail.settlement.bank_reference}</p>
                  </div>
                )}
                
                {settlementDetail.settlement.notes && (
                  <div>
                    <p className="text-xs text-muted-foreground">ملاحظات</p>
                    <p>{settlementDetail.settlement.notes}</p>
                  </div>
                )}
                
                {/* Customer Cheques Section */}
                {settlementDetail.customerCheques && settlementDetail.customerCheques.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">شيكات العملاء المستخدمة ({settlementDetail.customerCheques.length})</p>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {settlementDetail.customerCheques.map((cheque) => (
                        <div key={cheque.id} className="p-2 rounded-lg bg-muted/50 flex items-center justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              {cheque.cheque_number && (
                                <Badge variant="secondary" className="font-mono text-xs">
                                  #{cheque.cheque_number}
                                </Badge>
                              )}
                              <span className="font-bold text-sm">₪{cheque.amount.toLocaleString()}</span>
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">
                              {cheque.client_name && <span>{cheque.client_name}</span>}
                              {cheque.car_number && <span className="mr-2">• {cheque.car_number}</span>}
                              {cheque.payment_date && <span className="mr-2">• {new Date(cheque.payment_date).toLocaleDateString('en-GB')}</span>}
                            </div>
                          </div>
                          {cheque.cheque_image_url && (
                            <a href={cheque.cheque_image_url} target="_blank" rel="noopener noreferrer">
                              <img 
                                src={cheque.cheque_image_url} 
                                alt="صورة الشيك" 
                                className="h-12 w-auto rounded border hover:opacity-80 transition-opacity"
                              />
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                {settlementDetail.settlement.cheque_image_url && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">صورة الشيك</p>
                    <a href={settlementDetail.settlement.cheque_image_url} target="_blank" rel="noopener noreferrer">
                      <img 
                        src={settlementDetail.settlement.cheque_image_url} 
                        alt="صورة الشيك" 
                        className="max-h-40 rounded border hover:opacity-80 transition-opacity"
                      />
                    </a>
                  </div>
                )}
                
                {settlementDetail.settlement.receipt_images && settlementDetail.settlement.receipt_images.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">سند قبض / إيصال</p>
                    <div className="flex gap-2 flex-wrap">
                      {settlementDetail.settlement.receipt_images.map((url, idx) => (
                        <a key={idx} href={url} target="_blank" rel="noopener noreferrer">
                          <img 
                            src={url} 
                            alt={`سند قبض ${idx + 1}`} 
                            className="h-24 w-auto rounded border hover:opacity-80 transition-opacity"
                          />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* New Payment Dialog */}
        <Dialog open={showNewPayment} onOpenChange={setShowNewPayment}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" dir="rtl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Plus className="h-5 w-5" />
                دفعة جديدة للشركة
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {/* Split Payments */}
              <div className="flex items-center gap-4">
                <Popover open={splitPopoverOpen} onOpenChange={setSplitPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="gap-2">
                      <Split className="h-4 w-4" />
                      تقسيم لدفعات
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72" align="start">
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label>المبلغ الإجمالي</Label>
                        <Input
                          type="number"
                          value={splitAmount}
                          onChange={(e) => setSplitAmount(e.target.value)}
                          placeholder="0"
                          dir="ltr"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>عدد الدفعات</Label>
                        <Input
                          type="number"
                          min={2}
                          max={12}
                          value={splitCount}
                          onChange={(e) => setSplitCount(parseInt(e.target.value) || 2)}
                          dir="ltr"
                        />
                      </div>
                      <Button onClick={handleSplitPayments} className="w-full">
                        تقسيم
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>

                <Button variant="outline" onClick={addPaymentLine} className="gap-2">
                  <Plus className="h-4 w-4" />
                  إضافة دفعة
                </Button>
              </div>

              {/* Payment Lines */}
              {paymentLines.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">
                  أضف دفعة واحدة على الأقل
                </p>
              ) : (
                <div className="space-y-4">
                  {paymentLines.map((payment, index) => (
                    <Card key={payment.id} className="p-4 space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">دفعة {index + 1}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removePaymentLine(payment.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {/* Amount - hide for customer_cheque */}
                        {payment.payment_type !== 'customer_cheque' && (
                          <div className="space-y-2">
                            <Label>المبلغ</Label>
                            <Input
                              type="number"
                              value={payment.amount || ''}
                              onChange={(e) => updatePaymentLine(payment.id, 'amount', parseFloat(e.target.value) || 0)}
                              placeholder="0"
                              dir="ltr"
                            />
                          </div>
                        )}

                        <div className="space-y-2">
                          <Label>التاريخ</Label>
                          <ArabicDatePicker
                            value={payment.payment_date}
                            onChange={(date) => updatePaymentLine(payment.id, 'payment_date', date)}
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>طريقة الدفع</Label>
                          <Select
                            value={payment.payment_type}
                            onValueChange={(v) => {
                              updatePaymentLine(payment.id, 'payment_type', v);
                              // Reset amount when switching to customer_cheque
                              if (v === 'customer_cheque') {
                                updatePaymentLine(payment.id, 'amount', 0);
                              }
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="cash">نقداً</SelectItem>
                              <SelectItem value="cheque">شيك جديد</SelectItem>
                              <SelectItem value="customer_cheque">شيك عميل</SelectItem>
                              <SelectItem value="bank_transfer">تحويل بنكي</SelectItem>
                              <SelectItem value="visa">بطاقة ائتمان</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {/* Conditional fields */}
                      {payment.payment_type === 'cheque' && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>رقم الشيك (8 أرقام)</Label>
                            <Input
                              value={payment.cheque_number || ''}
                              onChange={(e) => updatePaymentLine(payment.id, 'cheque_number', e.target.value)}
                              placeholder="12345678"
                              maxLength={8}
                              dir="ltr"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>صورة الشيك</Label>
                            <FileUploader
                              entityType="company_settlement_cheque"
                              entityId={payment.id}
                              onUploadComplete={(urls) => updatePaymentLine(payment.id, 'cheque_image_url', urls[0])}
                              accept="image/*"
                            />
                          </div>
                        </div>
                      )}

                      {/* Customer Cheque Selector */}
                      {payment.payment_type === 'customer_cheque' && (
                        <div className="space-y-2 border-t pt-4">
                          <Label className="text-base font-semibold">اختر شيكات العميل</Label>
                          <p className="text-xs text-muted-foreground mb-2">
                            فقط الشيكات بحالة "قيد الانتظار" متاحة للاختيار
                          </p>
                          <CustomerChequeSelector
                            selectedCheques={payment.selected_cheques || []}
                            onSelectionChange={(cheques) => {
                              updatePaymentLine(payment.id, 'selected_cheques', cheques);
                              // Auto-calculate amount from selected cheques
                              const total = cheques.reduce((sum, c) => sum + c.amount, 0);
                              updatePaymentLine(payment.id, 'amount', total);
                            }}
                          />
                        </div>
                      )}

                      {payment.payment_type === 'bank_transfer' && (
                        <div className="space-y-2">
                          <Label>رقم المرجع البنكي</Label>
                          <Input
                            value={payment.bank_reference || ''}
                            onChange={(e) => updatePaymentLine(payment.id, 'bank_reference', e.target.value)}
                            placeholder="رقم الحوالة"
                            dir="ltr"
                          />
                        </div>
                      )}

                    </Card>
                  ))}

                  {/* Main Receipt Image Upload - سند قبض / إيصال - for all payments */}
                  <Card className="p-4 border-dashed border-2">
                    <Label className="font-semibold">سند قبض / إيصال</Label>
                    <p className="text-xs text-muted-foreground mb-2">صورة الإيصال لجميع الدفعات</p>
                    <FileUploader
                      entityType="company_receipt"
                      entityId={companyId || 'new'}
                      accept="image/*"
                      maxFiles={5}
                      onUploadComplete={(files) => {
                        if (files.length > 0) {
                          setMainReceiptImages(files.map((f) => f.cdn_url));
                        }
                      }}
                    />
                    {mainReceiptImages.length > 0 && (
                      <div className="mt-2 flex gap-2 flex-wrap">
                        {mainReceiptImages.map((url, idx) => (
                          <img
                            key={idx}
                            src={url}
                            alt={`سند قبض ${idx + 1}`}
                            className="h-16 w-auto rounded border"
                          />
                        ))}
                      </div>
                    )}
                  </Card>

                  {/* Main Notes */}
                  <div className="space-y-2">
                    <Label>ملاحظات</Label>
                    <Textarea
                      value={mainNotes}
                      onChange={(e) => setMainNotes(e.target.value)}
                      placeholder="ملاحظات إضافية..."
                      rows={2}
                    />
                  </div>

                  {/* Total */}
                  <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                    <span className="font-semibold">إجمالي الدفعات:</span>
                    <span className="text-xl font-bold">₪{totalPaymentLines.toLocaleString()}</span>
                  </div>

                  {/* Save Button */}
                  <Button
                    onClick={handleSaveAllPayments}
                    disabled={saving || paymentLines.length === 0}
                    className="w-full"
                    size="lg"
                  >
                    {saving ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin ml-2" />
                        جاري الحفظ...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-4 w-4 ml-2" />
                        حفظ جميع الدفعات
                      </>
                    )}
                  </Button>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
