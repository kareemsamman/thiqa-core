import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { FileUploader } from "@/components/media/FileUploader";
import { BrokerPaymentModal } from "@/components/brokers/BrokerPaymentModal";
import { CustomerChequeSelector, SelectableCheque } from "@/components/shared/CustomerChequeSelector";
import { ChequeScannerDialog } from "@/components/payments/ChequeScannerDialog";
import { 
  ArrowLeft, 
  Plus, 
  Wallet, 
  ArrowUpRight, 
  ArrowDownLeft,
  Calendar,
  CheckCircle2,
  CreditCard,
  Banknote,
  Building2,
  Receipt,
  XCircle,
  Image,
  Loader2,
  Trash2,
  Split,
  TrendingUp,
  TrendingDown,
  FileText,
  Scan,
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

interface Broker {
  id: string;
  name: string;
  phone: string | null;
}

interface Transaction {
  id: string;
  direction: 'we_owe' | 'broker_owes';
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
  card_last_four: string | null;
  installments_count: number | null;
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
  tranzila_paid?: boolean;
  selected_cheques?: SelectableCheque[];
}

interface TransactionWithReceipts extends Transaction {
  receipt_images?: string[] | null;
}

// Settlement detail dialog state
interface SettlementDetail {
  id: string;
  transaction: TransactionWithReceipts;
  customerCheques?: CustomerChequeDetail[];
}

const paymentTypeLabels: Record<PaymentType, string> = {
  cash: 'نقداً',
  cheque: 'شيك',
  bank_transfer: 'تحويل بنكي',
  visa: 'بطاقة ائتمان',
  customer_cheque: 'شيك عميل',
};

const PAYMENT_TYPES = [
  { value: 'cash', label: 'نقداً' },
  { value: 'cheque', label: 'شيك جديد' },
  { value: 'customer_cheque', label: 'شيك عميل' },
  { value: 'bank_transfer', label: 'تحويل بنكي' },
  { value: 'visa', label: 'بطاقة ائتمان' },
];

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

export default function BrokerWallet() {
  const { brokerId } = useParams<{ brokerId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();

  const [broker, setBroker] = useState<Broker | null>(null);
  const [transactions, setTransactions] = useState<TransactionWithReceipts[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewTransaction, setShowNewTransaction] = useState(false);
  const [saving, setSaving] = useState(false);
  
  // Wallet summary - settlements
  const [paidToBroker, setPaidToBroker] = useState(0);
  const [receivedFromBroker, setReceivedFromBroker] = useState(0);
  
  // Policy profit totals
  const [policyOweToBroker, setPolicyOweToBroker] = useState(0); // from_broker policies
  const [policyBrokerOwesMe, setPolicyBrokerOwesMe] = useState(0); // to_broker policies
  const [policyCount, setPolicyCount] = useState(0);

  // New transaction form - direction selection
  const [direction, setDirection] = useState<'we_owe' | 'broker_owes'>('broker_owes');

  // Payment lines (like Step4)
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

  // Tranzila modal
  const [showTranzilaModal, setShowTranzilaModal] = useState(false);
  const [selectedVisaPaymentIndex, setSelectedVisaPaymentIndex] = useState<number | null>(null);
  const [chequeScannerOpen, setChequeScannerOpen] = useState(false);

  useEffect(() => {
    if (brokerId) {
      fetchBrokerData();
    }
  }, [brokerId]);

  const fetchBrokerData = async () => {
    setLoading(true);
    try {
      const { data: brokerData, error: brokerError } = await supabase
        .from('brokers')
        .select('id, name, phone')
        .eq('id', brokerId)
        .single();

      if (brokerError) throw brokerError;
      setBroker(brokerData);

      // Fetch settlements
      const { data: transactionsData } = await supabase
        .from('broker_settlements')
        .select('*')
        .eq('broker_id', brokerId)
        .order('settlement_date', { ascending: false });

      if (transactionsData) {
        setTransactions(transactionsData as TransactionWithReceipts[]);
        
        const paid = transactionsData
          .filter((t: any) => t.direction === 'we_owe' && !t.refused && t.status === 'completed')
          .reduce((sum: number, t: any) => sum + (t.total_amount || 0), 0);
        const received = transactionsData
          .filter((t: any) => t.direction === 'broker_owes' && !t.refused && t.status === 'completed')
          .reduce((sum: number, t: any) => sum + (t.total_amount || 0), 0);
        
        setPaidToBroker(paid);
        setReceivedFromBroker(received);
      }

      // Fetch policy profits for this broker
      const { data: policiesData } = await supabase
        .from('policies')
        .select('profit, broker_direction')
        .eq('broker_id', brokerId)
        .is('deleted_at', null)
        .eq('cancelled', false);

      if (policiesData) {
        setPolicyCount(policiesData.length);
        
        // from_broker = broker brought this deal, I owe broker the profit
        const fromBrokerProfit = policiesData
          .filter((p: any) => p.broker_direction === 'from_broker')
          .reduce((sum: number, p: any) => sum + Number(p.profit || 0), 0);
        
        // to_broker = I made this for broker, broker owes me the profit
        const toBrokerProfit = policiesData
          .filter((p: any) => p.broker_direction === 'to_broker' || p.broker_direction === null)
          .reduce((sum: number, p: any) => sum + Number(p.profit || 0), 0);
        
        setPolicyOweToBroker(fromBrokerProfit);
        setPolicyBrokerOwesMe(toBrokerProfit);
      }
    } catch (error) {
      console.error('Error fetching broker data:', error);
      toast({
        title: "خطأ",
        description: "فشل في تحميل بيانات الوسيط",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

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

  const handleScannedCheques = (cheques: any[]) => {
    const newPayments: PaymentLine[] = [];
    
    for (const cheque of cheques) {
      const paymentId = crypto.randomUUID();
      const payment: PaymentLine = {
        id: paymentId,
        payment_type: 'cheque' as PaymentType,
        amount: cheque.amount || 0,
        payment_date: cheque.payment_date || new Date().toISOString().split('T')[0],
        cheque_number: cheque.cheque_number || '',
      };
      
      // Store the CDN URL if available
      if (cheque.image_url) {
        payment.cheque_image_url = cheque.image_url;
      }
      
      newPayments.push(payment);
    }
    
    setPaymentLines(prev => [...prev, ...newPayments]);
    toast({ title: "تم الإضافة", description: `تم إضافة ${newPayments.length} دفعة شيك مع الصور` });
  };

  const handleVisaPayClick = (index: number) => {
    const payment = paymentLines[index];
    if (!payment || (payment.amount || 0) <= 0) return;
    
    setSelectedVisaPaymentIndex(index);
    setShowTranzilaModal(true);
  };

  const handleVisaSuccess = () => {
    if (selectedVisaPaymentIndex !== null) {
      const payment = paymentLines[selectedVisaPaymentIndex];
      if (payment) {
        updatePaymentLine(payment.id, 'tranzila_paid', true);
      }
    }
    setShowTranzilaModal(false);
    setSelectedVisaPaymentIndex(null);
    // Refresh data
    fetchBrokerData();
  };

  const handleVisaFailure = () => {
    setShowTranzilaModal(false);
    setSelectedVisaPaymentIndex(null);
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

    // Filter out visa payments that weren't paid (they're handled separately)
    const paymentsToSave = paymentLines.filter(p => {
      if (p.payment_type === 'visa') {
        return p.tranzila_paid; // Only save visa if already paid via Tranzila
      }
      if (p.payment_type === 'customer_cheque') {
        return p.selected_cheques && p.selected_cheques.length > 0;
      }
      return p.amount > 0;
    });

    // Filter only non-visa payments to insert (visa already inserted by Tranzila flow)
    const nonVisaPayments = paymentsToSave.filter(p => p.payment_type !== 'visa');

    if (nonVisaPayments.length === 0 && !paymentLines.some(p => p.tranzila_paid)) {
      toast({ title: "تنبيه", description: "لا توجد دفعات لحفظها", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      // Insert non-visa payments
      for (const payment of nonVisaPayments) {
        // Calculate amount from selected cheques if customer_cheque
        const amount = payment.payment_type === 'customer_cheque' && payment.selected_cheques
          ? payment.selected_cheques.reduce((sum, c) => sum + c.amount, 0)
          : payment.amount;

        // Collect customer cheque IDs if applicable
        const customerChequeIds = payment.payment_type === 'customer_cheque' && payment.selected_cheques
          ? payment.selected_cheques.map(c => c.id)
          : [];

        const { data: settlement, error } = await supabase
          .from('broker_settlements')
          .insert({
            broker_id: brokerId,
            direction,
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
               transferred_to_type: 'broker',
               transferred_to_id: brokerId!,
               transferred_payment_id: settlement.id,
               transferred_at: new Date().toISOString(),
               refused: false,
             })
             .in('id', customerChequeIds);

           if (updateError) {
             console.error('Error updating cheque status:', updateError);
             // Best-effort cleanup so we don't leave a settlement that didn't actually consume cheques
             try {
               await supabase.from('broker_settlements').delete().eq('id', settlement.id);
             } catch {
               // ignore
             }
             throw updateError;
           }
         }
      }

      toast({ title: "تم الحفظ", description: "تم تسجيل جميع الدفعات بنجاح" });
      setShowNewTransaction(false);
      resetForm();
      fetchBrokerData();
    } catch (error) {
      console.error('Error saving payments:', error);
      toast({ title: "خطأ", description: "فشل في حفظ الدفعات", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleRefused = async (transaction: Transaction) => {
    try {
      const { error } = await supabase
        .from('broker_settlements')
        .update({ refused: !transaction.refused })
        .eq('id', transaction.id);

      if (error) throw error;
      
      toast({ 
        title: transaction.refused ? "تم استعادة المعاملة" : "تم إلغاء المعاملة",
      });
      
      fetchBrokerData();
    } catch (error) {
      toast({ title: "خطأ", description: "فشل في تحديث المعاملة", variant: "destructive" });
    }
  };

  // Fetch customer cheque details for settlement detail dialog
  const handleOpenSettlementDetail = async (transaction: TransactionWithReceipts) => {
    let customerCheques: CustomerChequeDetail[] = [];
    
    if (transaction.payment_type === 'customer_cheque' && (transaction as any).customer_cheque_ids && (transaction as any).customer_cheque_ids.length > 0) {
      try {
        // Fetch the cheques with their policy/client/car details
        const { data: payments } = await supabase
          .from('policy_payments')
          .select('id, amount, payment_date, cheque_number, cheque_image_url, policy_id')
          .in('id', (transaction as any).customer_cheque_ids);
        
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
    
    setSettlementDetail({ id: transaction.id, transaction, customerCheques });
  };

  const resetForm = () => {
    setDirection('broker_owes');
    setPaymentLines([]);
    setSplitAmount('');
    setMainReceiptImages([]);
    setMainNotes('');
  };

  // Net balance includes both policy profits AND settlements
  // Policy obligations: toBrokerProfit - fromBrokerProfit
  // Settlement balance: receivedFromBroker - paidToBroker
  const policyNetBalance = policyBrokerOwesMe - policyOweToBroker;
  const settlementNetBalance = receivedFromBroker - paidToBroker;
  const netBalance = policyNetBalance + settlementNetBalance;
  const totalPaymentLines = paymentLines.reduce((sum, p) => sum + (p.amount || 0), 0);

  const selectedVisaPayment = selectedVisaPaymentIndex !== null ? paymentLines[selectedVisaPaymentIndex] : null;

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
            <Button variant="ghost" size="icon" onClick={() => navigate('/brokers')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Wallet className="h-6 w-6" />
                محفظة الوسيط
              </h1>
              <p className="text-muted-foreground">{broker?.name}</p>
            </div>
          </div>
          <Button onClick={() => setShowNewTransaction(true)} className="gap-2" size="lg">
            <Plus className="h-5 w-5" />
            دفعة جديدة
          </Button>
        </div>

        {/* Summary Cards - 3 cards: policy count, total amount, net balance */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* عدد الوثائق - Policy count */}
          <Card className="p-4 border-blue-200 dark:border-blue-800">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-blue-100 dark:bg-blue-900/30">
                <FileText className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">عدد الوثائق</p>
                <p className="text-lg font-bold text-blue-600">{policyCount}</p>
              </div>
            </div>
          </Card>

          {/* إجمالي المبالغ - Total policy amounts from broker */}
          <Card className="p-4 border-green-200 dark:border-green-800">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-green-100 dark:bg-green-900/30">
                <TrendingUp className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">إجمالي الأرباح</p>
                <p className="text-lg font-bold text-green-600">₪{(policyBrokerOwesMe + policyOweToBroker).toLocaleString()}</p>
              </div>
            </div>
          </Card>

          {/* Net Balance - المتبقي */}
          <Card className={cn(
            "p-4 border-2",
            netBalance >= 0 ? 'border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950/20' : 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/20'
          )}>
            <div className="flex items-center gap-3">
              <div className={cn(
                "p-2 rounded-xl",
                netBalance >= 0 ? 'bg-green-100 dark:bg-green-900/30' : 'bg-red-100 dark:bg-red-900/30'
              )}>
                <Wallet className={cn(
                  "h-5 w-5",
                  netBalance >= 0 ? 'text-green-600' : 'text-red-600'
                )} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">
                  {netBalance >= 0 ? 'المتبقي (الوسيط مدين لي)' : 'المتبقي (أنا مدين للوسيط)'}
                </p>
                <p className={cn(
                  "text-lg font-bold",
                  netBalance >= 0 ? 'text-green-600' : 'text-red-600'
                )}>
                  ₪{Math.abs(netBalance).toLocaleString()}
                </p>
              </div>
            </div>
          </Card>
        </div>

        {/* Transactions Table */}
        <Card>
          <div className="p-4 border-b">
            <h2 className="font-semibold">سجل المعاملات</h2>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>الاتجاه</TableHead>
                  <TableHead>طريقة الدفع</TableHead>
                  <TableHead>المبلغ</TableHead>
                  <TableHead>التفاصيل</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead className="w-20">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      لا توجد معاملات بعد
                    </TableCell>
                  </TableRow>
                ) : (
                  transactions.map((transaction) => (
                     <TableRow
                       key={transaction.id}
                       className={cn(
                         "cursor-pointer transition-colors hover:bg-muted/40",
                         transaction.refused && "opacity-50"
                       )}
                       onClick={() => handleOpenSettlementDetail(transaction)}
                     >
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4 text-muted-foreground" />
                          {new Date(transaction.settlement_date).toLocaleDateString('en-GB')}
                        </div>
                      </TableCell>
                      <TableCell>
                        {transaction.direction === 'we_owe' ? (
                          <Badge variant="outline" className="text-red-600 border-red-200">
                            <ArrowUpRight className="h-3 w-3 ml-1" />
                            دفعت للوسيط
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-green-600 border-green-200">
                            <ArrowDownLeft className="h-3 w-3 ml-1" />
                            استلمت من الوسيط
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <PaymentTypeIcon type={transaction.payment_type || 'cash'} />
                          <span>{paymentTypeLabels[(transaction.payment_type || 'cash') as PaymentType]}</span>
                        </div>
                      </TableCell>
                      <TableCell className="font-semibold">
                        ₪{transaction.total_amount.toLocaleString()}
                        {transaction.installments_count && transaction.installments_count > 1 && (
                          <span className="text-xs text-muted-foreground mr-1">
                            ({transaction.installments_count} تقسيطات)
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 flex-wrap">
                           {transaction.payment_type === 'customer_cheque' && transaction.customer_cheque_ids && transaction.customer_cheque_ids.length > 0 && (
                             <Badge variant="secondary" className="text-xs">
                               <FileText className="h-3 w-3 ml-1" />
                               {transaction.customer_cheque_ids.length} شيك عميل
                             </Badge>
                           )}
                          {transaction.cheque_number && (
                            <Badge variant="secondary" className="font-mono text-xs">
                              #{transaction.cheque_number}
                            </Badge>
                          )}
                          {transaction.card_last_four && (
                            <Badge variant="secondary" className="text-xs">
                              ****{transaction.card_last_four}
                            </Badge>
                          )}
                           {transaction.cheque_image_url && (
                             <a href={transaction.cheque_image_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                              <Badge variant="outline" className="text-xs cursor-pointer hover:bg-muted">
                                <Receipt className="h-3 w-3 ml-1" />
                                صورة الشيك
                              </Badge>
                            </a>
                          )}
                           {transaction.receipt_images && transaction.receipt_images.length > 0 && (
                             <Badge variant="outline" className="text-xs">
                               <FileText className="h-3 w-3 ml-1" />
                               سند قبض ({transaction.receipt_images.length})
                             </Badge>
                           )}
                          {transaction.notes && (
                            <span className="text-xs text-muted-foreground truncate max-w-[100px]" title={transaction.notes}>
                              {transaction.notes}
                            </span>
                          )}
                          {!transaction.cheque_number && !transaction.card_last_four && !transaction.receipt_images?.length && !transaction.notes && !(transaction.payment_type === 'customer_cheque' && transaction.customer_cheque_ids?.length) && '-'}
                        </div>
                      </TableCell>
                      <TableCell>
                        {transaction.refused ? (
                          <Badge className="bg-red-100 text-red-700">
                            <XCircle className="h-3 w-3 ml-1" />
                            مرفوض
                          </Badge>
                        ) : transaction.status === 'completed' ? (
                          <Badge className="bg-green-100 text-green-700">
                            <CheckCircle2 className="h-3 w-3 ml-1" />
                            مكتمل
                          </Badge>
                        ) : (
                          <Badge className="bg-yellow-100 text-yellow-700">
                            قيد الانتظار
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                         <Button
                           variant="ghost"
                           size="sm"
                           onClick={(e) => {
                             e.stopPropagation();
                             handleToggleRefused(transaction);
                           }}
                           className={cn(
                             "text-xs",
                             transaction.refused ? "text-green-600 hover:text-green-700" : "text-red-600 hover:text-red-700"
                           )}
                         >
                           {transaction.refused ? "استعادة" : "رفض"}
                         </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </Card>

        {/* Settlement Detail Dialog */}
        <Dialog open={!!settlementDetail} onOpenChange={(open) => !open && setSettlementDetail(null)}>
          <DialogContent className="max-w-lg" dir="rtl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                تفاصيل المعاملة
              </DialogTitle>
            </DialogHeader>
            {settlementDetail && (
              <div className="space-y-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground">التاريخ</p>
                    <p className="font-medium">{new Date(settlementDetail.transaction.settlement_date).toLocaleDateString('en-GB')}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">المبلغ</p>
                    <p className="font-bold text-lg">₪{settlementDetail.transaction.total_amount.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">الاتجاه</p>
                    {settlementDetail.transaction.direction === 'we_owe' ? (
                      <Badge variant="outline" className="text-red-600 border-red-200">دفعت للوسيط</Badge>
                    ) : (
                      <Badge variant="outline" className="text-green-600 border-green-200">استلمت من الوسيط</Badge>
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">طريقة الدفع</p>
                    <div className="flex items-center gap-2">
                      <PaymentTypeIcon type={settlementDetail.transaction.payment_type || 'cash'} />
                      {paymentTypeLabels[(settlementDetail.transaction.payment_type || 'cash') as PaymentType]}
                    </div>
                  </div>
                </div>
                
                {settlementDetail.transaction.cheque_number && (
                  <div>
                    <p className="text-xs text-muted-foreground">رقم الشيك</p>
                    <p className="font-mono">{settlementDetail.transaction.cheque_number}</p>
                  </div>
                )}
                
                {settlementDetail.transaction.bank_reference && (
                  <div>
                    <p className="text-xs text-muted-foreground">رقم المرجع البنكي</p>
                    <p>{settlementDetail.transaction.bank_reference}</p>
                  </div>
                )}
                
                {settlementDetail.transaction.card_last_four && (
                  <div>
                    <p className="text-xs text-muted-foreground">بطاقة الائتمان</p>
                    <p>****{settlementDetail.transaction.card_last_four}</p>
                  </div>
                )}
                
                {settlementDetail.transaction.notes && (
                  <div>
                    <p className="text-xs text-muted-foreground">ملاحظات</p>
                    <p>{settlementDetail.transaction.notes}</p>
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
                
                {settlementDetail.transaction.cheque_image_url && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">صورة الشيك</p>
                    <a href={settlementDetail.transaction.cheque_image_url} target="_blank" rel="noopener noreferrer">
                      <img 
                        src={settlementDetail.transaction.cheque_image_url} 
                        alt="صورة الشيك" 
                        className="max-h-40 rounded border hover:opacity-80 transition-opacity"
                      />
                    </a>
                  </div>
                )}
                
                {settlementDetail.transaction.receipt_images && settlementDetail.transaction.receipt_images.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">سند قبض / إيصال</p>
                    <div className="flex gap-2 flex-wrap">
                      {settlementDetail.transaction.receipt_images.map((url, idx) => (
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

        {/* New Transaction Dialog - Step4 Style */}
        <Dialog open={showNewTransaction} onOpenChange={setShowNewTransaction}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" dir="rtl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Wallet className="h-5 w-5" />
                دفعة جديدة - {broker?.name}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-6 mt-4">
              {/* Direction Selection */}
              <div>
                <Label className="mb-2 block">اتجاه الدفعة</Label>
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    type="button"
                    variant={direction === 'broker_owes' ? 'default' : 'outline'}
                    className={cn(
                      "h-16 flex-col gap-1",
                      direction === 'broker_owes' && "bg-green-600 hover:bg-green-700"
                    )}
                    onClick={() => setDirection('broker_owes')}
                  >
                    <ArrowDownLeft className="h-5 w-5" />
                    <span className="text-sm">استلمت من الوسيط</span>
                  </Button>
                  <Button
                    type="button"
                    variant={direction === 'we_owe' ? 'default' : 'outline'}
                    className={cn(
                      "h-16 flex-col gap-1",
                      direction === 'we_owe' && "bg-red-600 hover:bg-red-700"
                    )}
                    onClick={() => setDirection('we_owe')}
                  >
                    <ArrowUpRight className="h-5 w-5" />
                    <span className="text-sm">دفعت للوسيط</span>
                  </Button>
                </div>
              </div>

              {/* Payment Lines Header */}
              <div className="flex items-center justify-between">
                <Label className="text-base font-semibold">الدفعات</Label>
                <div className="flex gap-2">
                  {/* Split Button */}
                  <Popover open={splitPopoverOpen} onOpenChange={setSplitPopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button type="button" variant="outline" size="sm" className="gap-2">
                        <Split className="h-4 w-4" />
                        تقسيط
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72" align="end" dir="rtl">
                      <div className="space-y-4">
                        <h4 className="font-semibold text-sm">تقسيط المبلغ</h4>
                        <div className="space-y-3">
                          <div>
                            <Label className="text-xs">المبلغ الإجمالي</Label>
                            <Input
                              type="number"
                              value={splitAmount}
                              onChange={(e) => setSplitAmount(e.target.value)}
                              placeholder="0"
                              className="h-9"
                            />
                          </div>
                          <div>
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
                          </div>
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>

                  <Button type="button" variant="outline" size="sm" onClick={() => setChequeScannerOpen(true)} className="gap-2">
                    <Scan className="h-4 w-4" />
                    مسح شيكات
                  </Button>

                  <Button type="button" variant="outline" size="sm" onClick={addPaymentLine} className="gap-2">
                    <Plus className="h-4 w-4" />
                    إضافة دفعة
                  </Button>
                </div>
              </div>

              {/* Payment Lines */}
              {paymentLines.length === 0 ? (
                <Card className="p-8 text-center bg-muted/30">
                  <CreditCard className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                  <p className="text-sm text-muted-foreground">لا توجد دفعات</p>
                  <p className="text-xs text-muted-foreground mt-1">يمكنك إضافة دفعات باستخدام الأزرار أعلاه</p>
                </Card>
              ) : (
                <div className="space-y-3">
                  {paymentLines.map((payment, index) => {
                    const isVisa = payment.payment_type === 'visa';
                    const visaPaid = payment.tranzila_paid;
                    
                    return (
                      <Card key={payment.id} className={cn(
                        "p-4",
                        visaPaid && "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800"
                      )}>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
                          {/* Payment Type */}
                          <div>
                            <Label className="text-xs mb-1.5 block">نوع الدفع</Label>
                            <Select
                              value={payment.payment_type}
                              onValueChange={(v) => {
                                updatePaymentLine(payment.id, 'payment_type', v);
                                // Reset amount when switching to customer_cheque
                                if (v === 'customer_cheque') {
                                  updatePaymentLine(payment.id, 'amount', 0);
                                }
                              }}
                              disabled={visaPaid}
                            >
                              <SelectTrigger className="h-9">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {PAYMENT_TYPES.map((type) => (
                                  <SelectItem key={type.value} value={type.value}>
                                    {type.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          {/* Amount - hide for customer_cheque */}
                          {payment.payment_type !== 'customer_cheque' && (
                            <div>
                              <Label className="text-xs mb-1.5 block">المبلغ (₪)</Label>
                              <Input
                                type="number"
                                value={payment.amount || ''}
                                onChange={(e) => updatePaymentLine(payment.id, 'amount', parseFloat(e.target.value) || 0)}
                                placeholder="0"
                                disabled={visaPaid}
                                className="h-9"
                              />
                            </div>
                          )}

                          {/* Date */}
                          <div>
                            <Label className="text-xs mb-1.5 block">التاريخ</Label>
                            <ArabicDatePicker
                              value={payment.payment_date}
                              onChange={(date) => updatePaymentLine(payment.id, 'payment_date', date)}
                              className="h-9"
                              disabled={visaPaid}
                            />
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-2">
                            {/* Cheque Number */}
                            {payment.payment_type === 'cheque' && (
                              <Input
                                value={payment.cheque_number || ''}
                                onChange={(e) => updatePaymentLine(payment.id, 'cheque_number', e.target.value.replace(/\D/g, '').slice(0, 8))}
                                placeholder="رقم الشيك"
                                maxLength={8}
                                className="h-9 flex-1 font-mono"
                              />
                            )}

                            {/* Bank Reference */}
                            {payment.payment_type === 'bank_transfer' && (
                              <Input
                                value={payment.bank_reference || ''}
                                onChange={(e) => updatePaymentLine(payment.id, 'bank_reference', e.target.value)}
                                placeholder="رقم التحويل"
                                className="h-9 flex-1"
                              />
                            )}
                            
                            {/* Visa Pay Button */}
                            {isVisa && !visaPaid && (
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => handleVisaPayClick(index)}
                                disabled={(payment.amount || 0) <= 0}
                                className="gap-1.5 bg-primary hover:bg-primary/90"
                              >
                                <CreditCard className="h-4 w-4" />
                                ادفع
                              </Button>
                            )}
                            
                            {/* Paid Badge */}
                            {isVisa && visaPaid && (
                              <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                                <CreditCard className="h-3.5 w-3.5" />
                                تم الدفع
                              </span>
                            )}
                            
                            {/* Delete Button */}
                            {!visaPaid && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => removePaymentLine(payment.id)}
                                className="h-9 w-9 text-destructive hover:text-destructive hover:bg-destructive/10"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </div>

                        {/* Customer Cheque Selector */}
                        {payment.payment_type === 'customer_cheque' && !visaPaid && (
                          <div className="mt-3 pt-3 border-t border-border/50">
                            <Label className="text-sm font-semibold mb-2 block">اختر شيكات العميل</Label>
                            <p className="text-xs text-muted-foreground mb-3">
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

                        {/* Cheque Image Upload */}
                        {payment.payment_type === 'cheque' && !visaPaid && (
                          <div className="mt-3 pt-3 border-t border-border/50">
                            <Label className="text-xs text-muted-foreground mb-2 block">صورة الشيك</Label>
                            <FileUploader
                              entityType="broker_cheque"
                              entityId={payment.id}
                              accept="image/*"
                              maxFiles={1}
                              onUploadComplete={(files) => {
                                if (files.length > 0) {
                                  updatePaymentLine(payment.id, 'cheque_image_url', files[0].cdn_url);
                                }
                              }}
                            />
                            {payment.cheque_image_url && (
                              <div className="mt-2">
                                <img 
                                  src={payment.cheque_image_url} 
                                  alt="صورة الشيك" 
                                  className="h-16 w-auto rounded border"
                                />
                              </div>
                            )}
                          </div>
                        )}

                      </Card>
                    );
                  })}
                </div>
              )}

              {/* Main Receipt Image Upload - سند قبض / إيصال - for all payments */}
              {paymentLines.length > 0 && (
                <Card className="p-4 border-dashed border-2">
                  <Label className="font-semibold">سند قبض / إيصال</Label>
                  <p className="text-xs text-muted-foreground mb-2">صورة الإيصال لجميع الدفعات</p>
                  <FileUploader
                    entityType="broker_receipt"
                    entityId={brokerId || 'new'}
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
              )}

              {/* Main Notes */}
              {paymentLines.length > 0 && (
                <div className="space-y-2">
                  <Label>ملاحظات</Label>
                  <Textarea
                    value={mainNotes}
                    onChange={(e) => setMainNotes(e.target.value)}
                    placeholder="ملاحظات إضافية..."
                    rows={2}
                  />
                </div>
              )}

              {/* Total */}
              {paymentLines.length > 0 && (
                <div className="flex justify-between items-center p-4 bg-muted/50 rounded-lg">
                  <span className="font-medium">إجمالي الدفعات:</span>
                  <span className="text-xl font-bold">₪{totalPaymentLines.toLocaleString()}</span>
                </div>
              )}

              {/* Save Button */}
              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button variant="outline" onClick={() => setShowNewTransaction(false)}>
                  إلغاء
                </Button>
                <Button 
                  onClick={handleSaveAllPayments} 
                  disabled={saving || paymentLines.length === 0}
                  className="gap-2"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  حفظ الدفعات
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Tranzila Modal */}
        {selectedVisaPayment && (
          <BrokerPaymentModal
            open={showTranzilaModal}
            onOpenChange={setShowTranzilaModal}
            brokerId={brokerId || ''}
            amount={selectedVisaPayment.amount}
            direction={direction}
            settlementDate={selectedVisaPayment.payment_date}
            notes={selectedVisaPayment.notes}
            onSuccess={handleVisaSuccess}
            onFailure={handleVisaFailure}
          />
        )}

        <ChequeScannerDialog
          open={chequeScannerOpen}
          onOpenChange={setChequeScannerOpen}
          onConfirm={handleScannedCheques}
        />
      </div>
    </MainLayout>
  );
}
