import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Loader2, Plus, Tag, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { arDZ as ar } from 'date-fns/locale';

interface Discount {
  id: string;
  discounted_price: number;
  starts_at: string;
  ends_at: string;
  reason: string | null;
  created_at: string;
}

interface AgentDiscountManagerProps {
  agentId: string;
}

/**
 * Time-boxed price override for a single agent. Lets Thiqa admin do
 * "150 ₪ instead of 300 for 3 months" sales. The effective monthly
 * price resolver (phase 7, subscription page) picks the active
 * discount whose [starts_at, ends_at] window covers today, falling
 * back to the plan's own monthly_price.
 */
export function AgentDiscountManager({ agentId }: AgentDiscountManagerProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const todayIso = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    discounted_price: 0,
    starts_at: todayIso,
    ends_at: '',
    reason: '',
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('agent_discounts')
        .select('*')
        .eq('agent_id', agentId)
        .order('starts_at', { ascending: false });
      if (error) throw error;
      setDiscounts((data ?? []) as Discount[]);
    } catch (err: any) {
      toast({ title: 'خطأ', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (agentId) fetchData();
  }, [agentId]);

  const openAdd = () => {
    setForm({
      discounted_price: 0,
      starts_at: todayIso,
      ends_at: '',
      reason: '',
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (form.ends_at === '') {
      toast({
        title: 'خطأ',
        description: 'يجب تحديد تاريخ نهاية الخصم',
        variant: 'destructive',
      });
      return;
    }
    if (form.discounted_price < 0) {
      toast({
        title: 'خطأ',
        description: 'السعر لا يمكن أن يكون سالباً',
        variant: 'destructive',
      });
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from('agent_discounts').insert({
        agent_id: agentId,
        discounted_price: form.discounted_price,
        starts_at: form.starts_at,
        ends_at: form.ends_at,
        reason: form.reason || null,
      });
      if (error) throw error;
      toast({ title: 'تم الحفظ', description: 'تم إضافة الخصم' });
      setDialogOpen(false);
      fetchData();
    } catch (err: any) {
      toast({ title: 'خطأ', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase.from('agent_discounts').delete().eq('id', id);
      if (error) throw error;
      toast({ title: 'تم الحذف' });
      fetchData();
    } catch (err: any) {
      toast({ title: 'خطأ', description: err.message, variant: 'destructive' });
    }
  };

  const isActive = (d: Discount) =>
    d.starts_at <= todayIso && d.ends_at >= todayIso;

  const isUpcoming = (d: Discount) => d.starts_at > todayIso;

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Tag className="h-5 w-5 text-primary" />
                خصومات الوكيل
              </CardTitle>
              <CardDescription>
                السعر المخفّض يستبدل السعر الشهري للحزمة خلال الفترة المحددة. بعد النهاية يعود تلقائياً لسعر الحزمة.
              </CardDescription>
            </div>
            <Button onClick={openAdd} size="sm" className="gap-2">
              <Plus className="h-4 w-4" />
              خصم جديد
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : discounts.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground border border-dashed rounded-lg">
              <Tag className="h-8 w-8 opacity-40" />
              <p className="text-sm">لا توجد خصومات مسجّلة</p>
            </div>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead className="text-right">السعر المخفّض</TableHead>
                    <TableHead className="text-right">من</TableHead>
                    <TableHead className="text-right">إلى</TableHead>
                    <TableHead className="text-right">السبب</TableHead>
                    <TableHead className="text-right">الحالة</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {discounts.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="font-mono ltr-nums font-semibold">
                        ₪{d.discounted_price}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {format(new Date(d.starts_at), 'dd/MM/yyyy', { locale: ar })}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {format(new Date(d.ends_at), 'dd/MM/yyyy', { locale: ar })}
                      </TableCell>
                      <TableCell className="text-sm">{d.reason || '—'}</TableCell>
                      <TableCell>
                        {isActive(d) ? (
                          <Badge className="bg-emerald-500/10 text-emerald-700 border-emerald-500/20" variant="outline">
                            فعّال الآن
                          </Badge>
                        ) : isUpcoming(d) ? (
                          <Badge variant="secondary">قادم</Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">منتهي</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-destructive h-8 w-8"
                          onClick={() => handleDelete(d.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle>خصم جديد</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>السعر الشهري المخفّض (₪)</Label>
              <Input
                type="number"
                min={0}
                value={form.discounted_price}
                onChange={(e) => setForm({ ...form, discounted_price: Number(e.target.value) })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>من</Label>
                <Input
                  type="date"
                  value={form.starts_at}
                  onChange={(e) => setForm({ ...form, starts_at: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>إلى</Label>
                <Input
                  type="date"
                  value={form.ends_at}
                  onChange={(e) => setForm({ ...form, ends_at: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>السبب (اختياري)</Label>
              <Input
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                placeholder="مثال: عرض افتتاحي لمدة 3 أشهر"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              إلغاء
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin ml-2" />}
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
