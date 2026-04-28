import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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
import { Loader2, Plus, ShoppingCart, Trash2, Check, X, Clock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { arDZ as ar } from 'date-fns/locale';

const ADDON_TYPES = [
  { value: 'extra_user', label: 'مستخدم إضافي', billing: 'monthly' as const, settingKey: 'addon_extra_user_price' },
  { value: 'extra_branch', label: 'فرع إضافي', billing: 'monthly' as const, settingKey: 'addon_extra_branch_price' },
  { value: 'extra_sms', label: 'باقة SMS', billing: 'monthly' as const, settingKey: 'addon_extra_sms_price' },
  { value: 'extra_marketing_sms', label: 'باقة SMS تسويقية', billing: 'monthly' as const, settingKey: 'addon_extra_marketing_sms_price' },
  { value: 'extra_ai', label: 'باقة AI', billing: 'monthly' as const, settingKey: 'addon_extra_ai_price' },
  { value: 'onboarding', label: 'إعداد أولي', billing: 'one_time' as const, settingKey: 'addon_onboarding_price' },
  { value: 'data_migration', label: 'هجرة بيانات', billing: 'one_time' as const, settingKey: 'addon_data_migration_price' },
];

interface Addon {
  id: string;
  addon_type: string;
  quantity: number;
  unit_price: number;
  billing_cycle: 'monthly' | 'one_time';
  starts_at: string;
  ends_at: string | null;
  status: 'active' | 'cancelled' | 'pending_approval' | 'rejected';
  notes: string | null;
  rejection_reason: string | null;
  requested_at: string | null;
  created_at: string;
}

interface AgentAddonsManagerProps {
  agentId: string;
}

/**
 * Cart-style add-on manager for a single agent, used by Thiqa admin
 * from /thiqa/agents/:agentId. Every addon row is billable; the
 * recurring ones (extra_user/branch/sms/marketing_sms/ai) also
 * expand the agent's effective limit in
 * get_agent_effective_limit so enforce_*_limit triggers let more
 * activity through.
 *
 * Defaults for unit_price come from thiqa_platform_settings —
 * editing individual lines lets the admin override per-deal.
 */
export function AgentAddonsManager({ agentId }: AgentAddonsManagerProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [addons, setAddons] = useState<Addon[]>([]);
  const [priceDefaults, setPriceDefaults] = useState<Record<string, number>>({});
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    addon_type: 'extra_user',
    quantity: 1,
    unit_price: 30,
    billing_cycle: 'monthly' as 'monthly' | 'one_time',
    starts_at: new Date().toISOString().slice(0, 10),
    ends_at: '' as string,
    notes: '',
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [addonsResp, settingsResp] = await Promise.all([
        supabase
          .from('agent_addons')
          .select('*')
          .eq('agent_id', agentId)
          .order('created_at', { ascending: false }),
        supabase
          .from('thiqa_platform_settings')
          .select('setting_key, setting_value')
          .in('setting_key', ADDON_TYPES.map((a) => a.settingKey)),
      ]);

      setAddons((addonsResp.data ?? []) as Addon[]);

      const prices: Record<string, number> = {};
      (settingsResp.data ?? []).forEach((s) => {
        prices[s.setting_key] = Number(s.setting_value ?? 0);
      });
      setPriceDefaults(prices);
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
    const first = ADDON_TYPES[0];
    setForm({
      addon_type: first.value,
      quantity: 1,
      unit_price: priceDefaults[first.settingKey] ?? 0,
      billing_cycle: first.billing,
      starts_at: new Date().toISOString().slice(0, 10),
      ends_at: '',
      notes: '',
    });
    setDialogOpen(true);
  };

  const handleTypeChange = (value: string) => {
    const meta = ADDON_TYPES.find((a) => a.value === value);
    if (!meta) return;
    setForm((prev) => ({
      ...prev,
      addon_type: value,
      billing_cycle: meta.billing,
      unit_price: priceDefaults[meta.settingKey] ?? prev.unit_price,
    }));
  };

  const handleSave = async () => {
    // Client-side guards on dates + quantity + price. The DB doesn't
    // enforce any of this today (no CHECK constraints), so without
    // these gates an admin could create addons with end<start, past
    // start dates, or zero quantity — every one of which has bitten
    // the limits engine before.
    const today = new Date().toISOString().slice(0, 10);
    if (!form.starts_at) {
      toast({ title: 'خطأ', description: 'تاريخ البداية مطلوب', variant: 'destructive' });
      return;
    }
    if (form.starts_at < today) {
      toast({
        title: 'تاريخ البداية في الماضي',
        description: 'لا يمكن أن يبدأ الإضافة قبل اليوم. عدّل التاريخ أو اضبط على اليوم.',
        variant: 'destructive',
      });
      return;
    }
    if (form.ends_at && form.ends_at <= form.starts_at) {
      toast({
        title: 'تاريخ نهاية غير صالح',
        description: 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية.',
        variant: 'destructive',
      });
      return;
    }
    if (!Number.isFinite(form.quantity) || form.quantity < 1) {
      toast({ title: 'خطأ', description: 'الكمية يجب أن تكون 1 أو أكثر', variant: 'destructive' });
      return;
    }
    if (!Number.isFinite(form.unit_price) || form.unit_price < 0) {
      toast({ title: 'خطأ', description: 'السعر يجب أن يكون رقماً غير سالب', variant: 'destructive' });
      return;
    }

    // Soft overlap check — recurring addons of the same type with
    // overlapping date windows usually mean the admin forgot to
    // cancel the old one. Warn instead of blocking, because there
    // are legitimate scenarios (different quantity tiers, manual
    // proration, etc.) where overlap is intentional.
    if (form.billing_cycle === 'monthly') {
      const newStart = form.starts_at;
      const newEnd = form.ends_at || '9999-12-31';
      const overlapping = addons.find((a) =>
        a.status === 'active' &&
        a.addon_type === form.addon_type &&
        a.billing_cycle === 'monthly' &&
        a.starts_at <= newEnd &&
        (a.ends_at ?? '9999-12-31') >= newStart,
      );
      if (overlapping) {
        const confirmed = window.confirm(
          `يوجد إضافة فعّالة من نفس النوع (${labelFor(form.addon_type)}) تتداخل مع هذه الفترة.\n\nالإضافة الموجودة: ${overlapping.starts_at} → ${overlapping.ends_at ?? 'بدون نهاية'}\nالإضافة الجديدة: ${newStart} → ${form.ends_at || 'بدون نهاية'}\n\nالاستمرار سيؤدي لاحتساب كلتا الإضافتين معاً. متابعة؟`,
        );
        if (!confirmed) return;
      }
    }

    setSaving(true);
    try {
      const { error } = await supabase.from('agent_addons').insert({
        agent_id: agentId,
        addon_type: form.addon_type,
        quantity: form.quantity,
        unit_price: form.unit_price,
        billing_cycle: form.billing_cycle,
        starts_at: form.starts_at,
        ends_at: form.ends_at || null,
        notes: form.notes || null,
      });
      if (error) throw error;
      toast({ title: 'تم الإضافة', description: 'تم تسجيل الإضافة' });
      setDialogOpen(false);
      fetchData();
    } catch (err: any) {
      toast({ title: 'خطأ', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async (id: string) => {
    try {
      const { error } = await supabase
        .from('agent_addons')
        .update({ status: 'cancelled' })
        .eq('id', id);
      if (error) throw error;
      toast({ title: 'تم الإلغاء' });
      fetchData();
    } catch (err: any) {
      toast({ title: 'خطأ', description: err.message, variant: 'destructive' });
    }
  };

  const handleApprove = async (id: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('agent_addons')
        .update({
          status: 'active',
          reviewed_by_user_id: user?.id ?? null,
          reviewed_at: new Date().toISOString(),
          starts_at: new Date().toISOString().slice(0, 10),
        })
        .eq('id', id);
      if (error) throw error;
      toast({ title: 'تمت الموافقة', description: 'تم تفعيل الإضافة للوكيل' });
      fetchData();
    } catch (err: any) {
      toast({ title: 'خطأ', description: err.message, variant: 'destructive' });
    }
  };

  const handleReject = async (id: string) => {
    const reason = window.prompt('سبب الرفض (اختياري):') ?? '';
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('agent_addons')
        .update({
          status: 'rejected',
          reviewed_by_user_id: user?.id ?? null,
          reviewed_at: new Date().toISOString(),
          rejection_reason: reason.trim() || null,
        })
        .eq('id', id);
      if (error) throw error;
      toast({ title: 'تم الرفض' });
      fetchData();
    } catch (err: any) {
      toast({ title: 'خطأ', description: err.message, variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase.from('agent_addons').delete().eq('id', id);
      if (error) throw error;
      toast({ title: 'تم الحذف' });
      fetchData();
    } catch (err: any) {
      toast({ title: 'خطأ', description: err.message, variant: 'destructive' });
    }
  };

  const labelFor = (type: string) =>
    ADDON_TYPES.find((a) => a.value === type)?.label ?? type;

  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ShoppingCart className="h-5 w-5 text-primary" />
                إضافات الوكيل (Cart)
              </CardTitle>
              <CardDescription>
                الإضافات المتكررة ترفع حدود الحزمة تلقائياً. الإضافات لمرة واحدة (إعداد / هجرة) للفوترة فقط.
              </CardDescription>
            </div>
            <Button onClick={openAdd} size="sm" className="gap-2">
              <Plus className="h-4 w-4" />
              إضافة جديدة
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : addons.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground border border-dashed rounded-lg">
              <ShoppingCart className="h-8 w-8 opacity-40" />
              <p className="text-sm">لا توجد إضافات لهذا الوكيل</p>
            </div>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead className="text-right">النوع</TableHead>
                    <TableHead className="text-right">الكمية</TableHead>
                    <TableHead className="text-right">السعر / وحدة</TableHead>
                    <TableHead className="text-right">الفوترة</TableHead>
                    <TableHead className="text-right">الفترة</TableHead>
                    <TableHead className="text-right">الحالة</TableHead>
                    <TableHead className="w-32 text-right">إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {addons.map((a) => {
                    const isActive = a.status === 'active' &&
                      a.starts_at <= today &&
                      (!a.ends_at || a.ends_at >= today);
                    return (
                      <TableRow key={a.id}>
                        <TableCell className="font-medium">{labelFor(a.addon_type)}</TableCell>
                        <TableCell>{a.quantity}</TableCell>
                        <TableCell className="font-mono ltr-nums">₪{a.unit_price}</TableCell>
                        <TableCell>
                          <Badge variant={a.billing_cycle === 'monthly' ? 'default' : 'secondary'}>
                            {a.billing_cycle === 'monthly' ? 'شهرية' : 'مرة واحدة'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {format(new Date(a.starts_at), 'dd/MM/yyyy', { locale: ar })}
                          {a.ends_at && ` → ${format(new Date(a.ends_at), 'dd/MM/yyyy', { locale: ar })}`}
                        </TableCell>
                        <TableCell>
                          {a.status === 'pending_approval' ? (
                            <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30 gap-1">
                              <Clock className="h-3 w-3" />
                              طلب قيد المراجعة
                            </Badge>
                          ) : a.status === 'rejected' ? (
                            <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">
                              مرفوض
                            </Badge>
                          ) : a.status === 'cancelled' ? (
                            <Badge variant="outline" className="text-muted-foreground">ملغاة</Badge>
                          ) : isActive ? (
                            <Badge className="bg-emerald-500/10 text-emerald-700 border-emerald-500/20" variant="outline">
                              فعّالة
                            </Badge>
                          ) : (
                            <Badge variant="outline">منتهية</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {a.status === 'pending_approval' ? (
                              <>
                                <Button
                                  size="sm"
                                  className="gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                                  onClick={() => handleApprove(a.id)}
                                >
                                  <Check className="h-3.5 w-3.5" />
                                  موافقة
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="gap-1 text-destructive hover:text-destructive"
                                  onClick={() => handleReject(a.id)}
                                >
                                  <X className="h-3.5 w-3.5" />
                                  رفض
                                </Button>
                              </>
                            ) : (
                              <>
                                {a.status === 'active' && (
                                  <Button size="sm" variant="outline" onClick={() => handleCancel(a.id)}>
                                    إلغاء
                                  </Button>
                                )}
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="text-destructive h-8 w-8"
                                  onClick={() => handleDelete(a.id)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle>إضافة جديدة</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>النوع</Label>
              <Select value={form.addon_type} onValueChange={handleTypeChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ADDON_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>الكمية</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label>السعر / وحدة (₪)</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.unit_price}
                  onChange={(e) => setForm({ ...form, unit_price: Number(e.target.value) })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>تاريخ البداية</Label>
                <Input
                  type="date"
                  value={form.starts_at}
                  onChange={(e) => setForm({ ...form, starts_at: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>تاريخ النهاية (اختياري)</Label>
                <Input
                  type="date"
                  value={form.ends_at}
                  onChange={(e) => setForm({ ...form, ends_at: e.target.value })}
                  disabled={form.billing_cycle === 'one_time'}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>ملاحظات</Label>
              <Input
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
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
