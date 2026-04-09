import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Plus,
  Banknote,
  Car,
  Calendar,
  ArrowDownLeft,
  FileText,
  RefreshCw,
  Loader2,
  Trash2,
} from 'lucide-react';
import { DeleteConfirmDialog } from '@/components/shared/DeleteConfirmDialog';
import { toast } from 'sonner';
import { ArabicDatePicker } from '@/components/ui/arabic-date-picker';
import { useAuth } from '@/hooks/useAuth';
import { formatCurrency, formatDate } from '@/lib/utils';

interface RefundsTabProps {
  clientId: string;
  branchId: string | null;
  onRefundAdded?: () => void;
}

interface Car {
  id: string;
  car_number: string;
  manufacturer_name: string | null;
  model: string | null;
}

interface RefundRecord {
  id: string;
  amount: number;
  transaction_type: string;
  description: string | null;
  notes: string | null;
  created_at: string;
  refund_date: string | null;
  payment_method: string | null;
  car_id: string | null;
  policy_id: string | null;
  car?: { car_number: string; manufacturer_name: string | null } | null;
  policy?: { policy_number: string | null; policy_type_parent: string } | null;
  creator?: { full_name: string | null } | null;
}

const paymentMethodLabels: Record<string, string> = {
  cash: 'نقدي',
  transfer: 'حوالة',
};

const transactionTypeLabels: Record<string, string> = {
  refund: 'إلغاء تأمين',
  transfer_refund_owed: 'تحويل تأمين',
  manual_refund: 'مرتجع يدوي',
};

const transactionTypeBadgeColors: Record<string, string> = {
  refund: 'bg-destructive/10 text-destructive border-destructive/20',
  transfer_refund_owed: 'bg-primary/10 text-primary border-primary/20',
  manual_refund: 'bg-warning/10 text-warning-foreground border-warning/20',
};

export function RefundsTab({ clientId, branchId, onRefundAdded }: RefundsTabProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [refundDate, setRefundDate] = useState(new Date().toISOString().split('T')[0]);
  const [paymentMethod, setPaymentMethod] = useState<string>('cash');
  const [selectedCarId, setSelectedCarId] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [refundToDelete, setRefundToDelete] = useState<RefundRecord | null>(null);

  // Fetch refunds (wallet transactions)
  const { data: refunds, isLoading, refetch } = useQuery({
    queryKey: ['client-refunds', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customer_wallet_transactions')
        .select(`
          id, amount, transaction_type, description, notes, created_at, 
          refund_date, payment_method, car_id, policy_id,
          car:cars(car_number, manufacturer_name),
          policy:policies(policy_number, policy_type_parent),
          creator:profiles!customer_wallet_transactions_created_by_admin_id_fkey(full_name)
        `)
        .eq('client_id', clientId)
        .in('transaction_type', ['refund', 'transfer_refund_owed', 'manual_refund'])
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as RefundRecord[];
    },
  });

  // Fetch client's cars for selection
  const { data: cars } = useQuery({
    queryKey: ['client-cars-refund', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cars')
        .select('id, car_number, manufacturer_name, model')
        .eq('client_id', clientId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as Car[];
    },
  });

  // Add manual refund mutation
  const addRefundMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('customer_wallet_transactions')
        .insert({
          client_id: clientId,
          car_id: selectedCarId || null,
          transaction_type: 'manual_refund',
          amount: parseFloat(amount),
          description: `مرتجع يدوي`,
          notes: notes || null,
          payment_method: paymentMethod,
          refund_date: refundDate,
          created_by_admin_id: user?.id || null,
          branch_id: branchId,
        });

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('تم إضافة المرتجع بنجاح');
      queryClient.invalidateQueries({ queryKey: ['client-refunds', clientId] });
      setAddDialogOpen(false);
      resetForm();
      onRefundAdded?.();
    },
    onError: (error) => {
      console.error('Error adding refund:', error);
      toast.error('حدث خطأ أثناء إضافة المرتجع');
    },
  });

  const resetForm = () => {
    setAmount('');
    setRefundDate(new Date().toISOString().split('T')[0]);
    setPaymentMethod('cash');
    setSelectedCarId('');
    setNotes('');
  };

  const handleSubmit = () => {
    if (!amount || parseFloat(amount) <= 0) {
      toast.error('يجب إدخال مبلغ صحيح');
      return;
    }
    addRefundMutation.mutate();
  };

  // Delete refund mutation
  const deleteRefundMutation = useMutation({
    mutationFn: async (refundId: string) => {
      const { error } = await supabase
        .from('customer_wallet_transactions')
        .delete()
        .eq('id', refundId);

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('تم حذف المرتجع بنجاح');
      queryClient.invalidateQueries({ queryKey: ['client-refunds', clientId] });
      setDeleteDialogOpen(false);
      setRefundToDelete(null);
      onRefundAdded?.();
    },
    onError: (error) => {
      console.error('Error deleting refund:', error);
      toast.error('حدث خطأ أثناء حذف المرتجع');
    },
  });

  const handleDeleteClick = (refund: RefundRecord) => {
    setRefundToDelete(refund);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (refundToDelete) {
      deleteRefundMutation.mutate(refundToDelete.id);
    }
  };

  const totalRefunds = refunds?.reduce((sum, r) => sum + r.amount, 0) || 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-lg">المرتجعات</h3>
          <p className="text-sm text-muted-foreground">
            إجمالي المرتجعات: <span className="font-bold text-warning-foreground">{formatCurrency(totalRefunds)}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 ml-2" />
            تحديث
          </Button>
          <Button size="sm" onClick={() => setAddDialogOpen(true)}>
            <Plus className="h-4 w-4 ml-2" />
            إضافة مرتجع
          </Button>
        </div>
      </div>

      {/* Refunds Table */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : refunds?.length === 0 ? (
        <Card className="text-center py-12">
          <Banknote className="h-12 w-12 mx-auto mb-3 text-muted-foreground/50" />
          <p className="text-muted-foreground">لا توجد مرتجعات مسجلة</p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="text-right">المبلغ</TableHead>
                <TableHead className="text-right">النوع</TableHead>
                <TableHead className="text-right">السيارة</TableHead>
                <TableHead className="text-right">تاريخ الارجاع</TableHead>
                <TableHead className="text-right">طريقة الدفع</TableHead>
                <TableHead className="text-right">الوصف</TableHead>
                <TableHead className="text-right">تاريخ الإنشاء</TableHead>
                <TableHead className="text-right w-[80px]">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {refunds?.map((refund) => (
                <TableRow key={refund.id}>
                  <TableCell className="font-bold text-warning-foreground">
                    {formatCurrency(refund.amount)}
                  </TableCell>
                  <TableCell>
                    <Badge 
                      variant="outline" 
                      className={transactionTypeBadgeColors[refund.transaction_type] || 'bg-muted/10'}
                    >
                      {transactionTypeLabels[refund.transaction_type] || refund.transaction_type}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {refund.car ? (
                      <div className="flex items-center gap-2">
                        <Car className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">
                          {refund.car.car_number}
                          {refund.car.manufacturer_name && (
                            <span className="text-muted-foreground"> ({refund.car.manufacturer_name})</span>
                          )}
                        </span>
                      </div>
                    ) : refund.policy?.policy_number ? (
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">
                          وثيقة {refund.policy.policy_number}
                        </span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {refund.refund_date ? (
                      <div className="flex items-center gap-1 text-sm">
                        <Calendar className="h-3 w-3 text-muted-foreground" />
                        {formatDate(refund.refund_date)}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {refund.payment_method ? (
                      <Badge variant="secondary">
                        {paymentMethodLabels[refund.payment_method] || refund.payment_method}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[200px]">
                    <p className="text-sm truncate" title={refund.description || ''}>
                      {refund.description || '-'}
                    </p>
                    {refund.notes && (
                      <p className="text-xs text-muted-foreground truncate" title={refund.notes}>
                        {refund.notes}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(refund.created_at)}
                    {refund.creator?.full_name && (
                      <p className="text-xs">{refund.creator.full_name}</p>
                    )}
                  </TableCell>
                  <TableCell>
                    {refund.transaction_type === 'manual_refund' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => handleDeleteClick(refund)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Add Refund Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowDownLeft className="h-5 w-5 text-warning-foreground" />
              إضافة مرتجع يدوي
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Car Selection */}
            <div className="space-y-2">
              <Label>السيارة</Label>
              <Select value={selectedCarId} onValueChange={setSelectedCarId}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر السيارة (اختياري)" />
                </SelectTrigger>
                <SelectContent>
                  {cars?.map((car) => (
                    <SelectItem key={car.id} value={car.id}>
                      {car.car_number} {car.manufacturer_name && `- ${car.manufacturer_name}`} {car.model && car.model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Amount */}
            <div className="space-y-2">
              <Label>المبلغ *</Label>
              <div className="relative">
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">₪</span>
                <Input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0"
                  className="pr-8"
                  dir="ltr"
                />
              </div>
            </div>

            {/* Refund Date */}
            <div className="space-y-2">
              <Label>تاريخ الارجاع *</Label>
              <ArabicDatePicker
                value={refundDate}
                onChange={(date) => setRefundDate(date)}
              />
            </div>

            {/* Payment Method */}
            <div className="space-y-2">
              <Label>طريقة الدفع *</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">نقدي</SelectItem>
                  <SelectItem value="transfer">حوالة</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label>ملاحظات</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="أي ملاحظات إضافية..."
                rows={3}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
              إلغاء
            </Button>
            <Button 
              onClick={handleSubmit} 
              disabled={addRefundMutation.isPending || !amount}
            >
              {addRefundMutation.isPending && <Loader2 className="h-4 w-4 ml-2 animate-spin" />}
              حفظ المرتجع
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={confirmDelete}
        title="حذف المرتجع"
        description={`هل أنت متأكد من حذف مرتجع بقيمة ₪${refundToDelete?.amount?.toLocaleString()}؟ لا يمكن التراجع عن هذا الإجراء.`}
        loading={deleteRefundMutation.isPending}
      />
    </div>
  );
}
