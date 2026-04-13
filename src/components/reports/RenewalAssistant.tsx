import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { getInsuranceTypeLabel } from '@/lib/insuranceTypes';
import {
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  Clock,
  XCircle,
  SkipForward,
  Loader2,
  Phone,
  User,
} from 'lucide-react';

interface RenewalAssistantProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
  month: string; // 'YYYY-MM' format
}

interface PolicyRow {
  id: string;
  policy_type_parent: string;
  policy_type_child: string | null;
  end_date: string;
  insurance_price: number;
  car: { car_number: string } | null;
  company: { name: string; name_ar: string | null } | null;
}

interface ClientGroup {
  clientId: string;
  clientName: string;
  clientPhone: string | null;
  policies: PolicyRow[];
  existingStatus: string | null;
  existingDeclineReason: string | null;
}

type RenewalStatus = 'renewed' | 'pending' | 'declined_renewal';

export function RenewalAssistant({ open, onOpenChange, agentId, month }: RenewalAssistantProps) {
  const [clients, setClients] = useState<ClientGroup[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showDeclineInput, setShowDeclineInput] = useState(false);
  const [declineReason, setDeclineReason] = useState('');

  const fetchClients = useCallback(async () => {
    if (!open || !agentId || !month) return;

    setLoading(true);
    try {
      // Calculate month boundaries
      const [year, mon] = month.split('-').map(Number);
      const monthStart = `${month}-01`;
      const lastDay = new Date(year, mon, 0).getDate();
      const monthEnd = `${month}-${String(lastDay).padStart(2, '0')}`;

      // Fetch all policies expiring in this month
      const { data: policiesData, error: policiesError } = await supabase
        .from('policies')
        .select(`
          id,
          client_id,
          policy_type_parent,
          policy_type_child,
          end_date,
          insurance_price,
          car:cars(car_number),
          company:insurance_companies(name, name_ar),
          client:clients(full_name, phone_number)
        `)
        .eq('agent_id', agentId)
        .eq('cancelled', false)
        .is('deleted_at', null)
        .gte('end_date', monthStart)
        .lte('end_date', monthEnd)
        .order('end_date', { ascending: true });

      if (policiesError) throw policiesError;
      if (!policiesData || policiesData.length === 0) {
        setClients([]);
        setCurrentIndex(0);
        setLoading(false);
        return;
      }

      // Fetch existing renewal_followups for this month
      const uniqueClientIds = [...new Set(policiesData.map((p: any) => p.client_id))];

      const { data: followupsData } = await supabase
        .from('renewal_followups' as any)
        .select('client_id, status, decline_reason')
        .eq('follow_up_month', month)
        .in('client_id', uniqueClientIds);

      const followupsMap = new Map<string, { status: string; decline_reason: string | null }>();
      if (followupsData) {
        (followupsData as any[]).forEach((f: any) => {
          followupsMap.set(f.client_id, {
            status: f.status,
            decline_reason: f.decline_reason,
          });
        });
      }

      // Group policies by client, excluding already renewed or declined
      const grouped = new Map<string, ClientGroup>();

      for (const policy of policiesData as any[]) {
        const clientId = policy.client_id;
        const followup = followupsMap.get(clientId);

        // Skip clients that are already renewed or declined
        if (followup && (followup.status === 'renewed' || followup.status === 'declined_renewal')) {
          continue;
        }

        if (!grouped.has(clientId)) {
          grouped.set(clientId, {
            clientId,
            clientName: policy.client?.full_name || 'غير معروف',
            clientPhone: policy.client?.phone_number || null,
            policies: [],
            existingStatus: followup?.status || null,
            existingDeclineReason: followup?.decline_reason || null,
          });
        }

        grouped.get(clientId)!.policies.push({
          id: policy.id,
          policy_type_parent: policy.policy_type_parent,
          policy_type_child: policy.policy_type_child,
          end_date: policy.end_date,
          insurance_price: policy.insurance_price,
          car: policy.car,
          company: policy.company,
        });
      }

      const clientList = Array.from(grouped.values());
      setClients(clientList);
      setCurrentIndex(0);
    } catch (error) {
      console.error('Error fetching renewal clients:', error);
      toast.error('فشل في تحميل بيانات التجديد');
    } finally {
      setLoading(false);
    }
  }, [open, agentId, month]);

  useEffect(() => {
    if (open) {
      fetchClients();
      setShowDeclineInput(false);
      setDeclineReason('');
    }
  }, [open, fetchClients]);

  const currentClient = clients[currentIndex] ?? null;
  const totalClients = clients.length;

  const goToNext = () => {
    setShowDeclineInput(false);
    setDeclineReason('');
    if (currentIndex < totalClients - 1) {
      setCurrentIndex((i) => i + 1);
    }
  };

  const goToPrev = () => {
    setShowDeclineInput(false);
    setDeclineReason('');
    if (currentIndex > 0) {
      setCurrentIndex((i) => i - 1);
    }
  };

  const upsertFollowup = async (status: RenewalStatus, declineReasonValue?: string) => {
    if (!currentClient) return;

    setSaving(true);
    try {
      const payload: Record<string, any> = {
        client_id: currentClient.clientId,
        follow_up_month: month,
        agent_id: agentId,
        status,
        updated_at: new Date().toISOString(),
      };

      if (status === 'declined_renewal' && declineReasonValue) {
        payload.decline_reason = declineReasonValue;
      }

      const { error } = await supabase
        .from('renewal_followups' as any)
        .upsert(payload as any, { onConflict: 'client_id,follow_up_month' });

      if (error) throw error;

      const statusLabels: Record<RenewalStatus, string> = {
        renewed: 'تم التجديد',
        pending: 'معلّق',
        declined_renewal: 'رفض التجديد',
      };

      toast.success(`${currentClient.clientName}: ${statusLabels[status]}`);

      // Remove client from list if renewed or declined
      if (status === 'renewed' || status === 'declined_renewal') {
        setClients((prev) => {
          const next = prev.filter((_, i) => i !== currentIndex);
          if (currentIndex >= next.length && next.length > 0) {
            setCurrentIndex(next.length - 1);
          }
          return next;
        });
      } else {
        // For pending, just move to next
        goToNext();
      }
    } catch (error) {
      console.error('Error saving followup:', error);
      toast.error('فشل في حفظ المتابعة');
    } finally {
      setSaving(false);
      setShowDeclineInput(false);
      setDeclineReason('');
    }
  };

  const handleRenewed = () => upsertFollowup('renewed');
  const handlePending = () => upsertFollowup('pending');
  const handleDeclinedSubmit = () => {
    if (!declineReason.trim()) {
      toast.error('يرجى إدخال سبب الرفض');
      return;
    }
    upsertFollowup('declined_renewal', declineReason.trim());
  };
  const handleSkip = () => goToNext();

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('en-GB', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-xl">مساعد التجديد</DialogTitle>
          <DialogDescription>
            متابعة تجديد وثائق شهر {month}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <span className="mr-3 text-muted-foreground">جاري التحميل...</span>
          </div>
        ) : totalClients === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <CheckCircle2 className="h-12 w-12 text-green-500 mb-4" />
            <p className="text-lg font-medium">لا يوجد عملاء بحاجة للمتابعة</p>
            <p className="text-sm text-muted-foreground mt-1">
              تم متابعة جميع العملاء لهذا الشهر
            </p>
          </div>
        ) : currentClient ? (
          <div className="space-y-4">
            {/* Progress indicator */}
            <div className="flex items-center justify-between">
              <Badge variant="secondary" className="text-sm px-3 py-1">
                العميل {currentIndex + 1} من {totalClients}
              </Badge>
              {currentClient.existingStatus && (
                <Badge variant="outline" className="text-sm">
                  الحالة الحالية: {currentClient.existingStatus === 'pending' ? 'معلّق' : currentClient.existingStatus}
                </Badge>
              )}
            </div>

            {/* Progress bar */}
            <div className="w-full bg-muted rounded-full h-1.5">
              <div
                className="bg-primary h-1.5 rounded-full transition-all duration-300"
                style={{ width: `${((currentIndex + 1) / totalClients) * 100}%` }}
              />
            </div>

            {/* Client info */}
            <div className="bg-muted/50 rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-2">
                <User className="h-5 w-5 text-muted-foreground" />
                <span className="font-semibold text-lg">{currentClient.clientName}</span>
              </div>
              {currentClient.clientPhone && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Phone className="h-4 w-4" />
                  <span dir="ltr">{currentClient.clientPhone}</span>
                </div>
              )}
            </div>

            {/* Policies table */}
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">نوع التأمين</TableHead>
                    <TableHead className="text-right">الشركة</TableHead>
                    <TableHead className="text-right">رقم السيارة</TableHead>
                    <TableHead className="text-right">تاريخ الانتهاء</TableHead>
                    <TableHead className="text-right">السعر</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {currentClient.policies.map((policy) => (
                    <TableRow key={policy.id}>
                      <TableCell>
                        {getInsuranceTypeLabel(
                          policy.policy_type_parent as any,
                          policy.policy_type_child as any
                        )}
                      </TableCell>
                      <TableCell>
                        {policy.company?.name_ar || policy.company?.name || '—'}
                      </TableCell>
                      <TableCell>{policy.car?.car_number || '—'}</TableCell>
                      <TableCell>{formatDate(policy.end_date)}</TableCell>
                      <TableCell className="font-medium">
                        {policy.insurance_price.toLocaleString('en-US')} &#8362;
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Total */}
            {currentClient.policies.length > 1 && (
              <div className="flex justify-between items-center px-2 text-sm">
                <span className="text-muted-foreground">
                  إجمالي ({currentClient.policies.length} وثائق)
                </span>
                <span className="font-bold">
                  {currentClient.policies
                    .reduce((sum, p) => sum + p.insurance_price, 0)
                    .toLocaleString('en-US')}{' '}
                  &#8362;
                </span>
              </div>
            )}

            {/* Decline reason input */}
            {showDeclineInput && (
              <div className="space-y-2 border rounded-lg p-3 bg-destructive/5">
                <label className="text-sm font-medium text-destructive">
                  سبب رفض التجديد
                </label>
                <div className="flex gap-2">
                  <Input
                    value={declineReason}
                    onChange={(e) => setDeclineReason(e.target.value)}
                    placeholder="أدخل سبب الرفض..."
                    className="flex-1"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleDeclinedSubmit();
                    }}
                  />
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={handleDeclinedSubmit}
                    disabled={saving || !declineReason.trim()}
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'تأكيد'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setShowDeclineInput(false);
                      setDeclineReason('');
                    }}
                  >
                    إلغاء
                  </Button>
                </div>
              </div>
            )}

            {/* Action buttons */}
            {!showDeclineInput && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Button
                  onClick={handleRenewed}
                  disabled={saving}
                  className="bg-green-600 hover:bg-green-700 text-white"
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin ml-2" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 ml-2" />
                  )}
                  تم التجديد
                </Button>
                <Button
                  onClick={handlePending}
                  disabled={saving}
                  variant="outline"
                  className="border-amber-500 text-amber-600 hover:bg-amber-50"
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin ml-2" />
                  ) : (
                    <Clock className="h-4 w-4 ml-2" />
                  )}
                  معلّق
                </Button>
                <Button
                  onClick={() => setShowDeclineInput(true)}
                  disabled={saving}
                  variant="outline"
                  className="border-destructive text-destructive hover:bg-destructive/10"
                >
                  <XCircle className="h-4 w-4 ml-2" />
                  رفض التجديد
                </Button>
                <Button
                  onClick={handleSkip}
                  disabled={saving || currentIndex >= totalClients - 1}
                  variant="ghost"
                >
                  <SkipForward className="h-4 w-4 ml-2" />
                  تخطي
                </Button>
              </div>
            )}

            {/* Navigation */}
            <div className="flex items-center justify-between pt-2 border-t">
              <Button
                variant="ghost"
                size="sm"
                onClick={goToPrev}
                disabled={currentIndex === 0 || saving}
              >
                <ChevronRight className="h-4 w-4 ml-1" />
                السابق
              </Button>
              <span className="text-xs text-muted-foreground">
                {currentIndex + 1} / {totalClients}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={goToNext}
                disabled={currentIndex >= totalClients - 1 || saving}
              >
                التالي
                <ChevronLeft className="h-4 w-4 mr-1" />
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
