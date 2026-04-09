import { useState, useEffect } from 'react';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { Tables, Enums } from '@/integrations/supabase/types';

type Company = Tables<'insurance_companies'>;
type PricingRule = Tables<'pricing_rules'>;

interface PricingRulesDrawerProps {
  open: boolean;
  onClose: () => void;
  company: Company | null;
}

const RULE_TYPE_LABELS: Record<Enums<'pricing_rule_type'>, string> = {
  THIRD_PRICE: 'سعر الطرف الثالث',
  FULL_PERCENT: 'نسبة الشامل',
  DISCOUNT: 'خصم',
  MIN_PRICE: 'الحد الأدنى',
  ROAD_SERVICE_PRICE: 'سعر خدمات الطريق',
  ROAD_SERVICE_BASE: 'سعر أساسي خدمات الطريق',
  ROAD_SERVICE_EXTRA_OLD_CAR: 'إضافة سيارة قديمة (≤2007)',
};

const POLICY_TYPE_LABELS: Record<Enums<'policy_type_parent'>, string> = {
  ELZAMI: 'إلزامي',
  THIRD_FULL: 'طرف ثالث / شامل',
  ROAD_SERVICE: 'خدمات الطريق',
  ACCIDENT_FEE_EXEMPTION: 'إعفاء رسوم حادث',
  HEALTH: 'التأمين الصحي',
  LIFE: 'تأمين الحياة',
  PROPERTY: 'تأمين الممتلكات',
  TRAVEL: 'تأمين السفر',
  BUSINESS: 'تأمين الشركات',
  OTHER: 'أخرى',
};

const AGE_BAND_LABELS: Record<Enums<'age_band'>, string> = {
  UNDER_24: 'أقل من 24',
  UP_24: '24 فما فوق',
  ANY: 'الكل',
};

const CAR_TYPE_LABELS: Record<Enums<'car_type'>, string> = {
  car: 'خصوصي',
  cargo: 'شحن',
  small: 'أوتوبس زعير',
  taxi: 'تاكسي',
  tjeradown4: 'تجاري أقل من 4 طن',
  tjeraup4: 'تجاري أكثر من 4 طن',
};

// Helper to get document type label from rule type
const getDocumentTypeLabel = (ruleType: Enums<'pricing_rule_type'>): string => {
  if (ruleType === 'THIRD_PRICE') return 'ثالث';
  if (['FULL_PERCENT', 'DISCOUNT', 'MIN_PRICE'].includes(ruleType)) return 'شامل';
  if (['ROAD_SERVICE_PRICE', 'ROAD_SERVICE_BASE', 'ROAD_SERVICE_EXTRA_OLD_CAR'].includes(ruleType)) return 'خدمات طريق';
  return '-';
};

// Helper to format value with correct unit (only FULL_PERCENT is %)
const formatRuleValue = (ruleType: Enums<'pricing_rule_type'>, value: number): string => {
  if (ruleType === 'FULL_PERCENT') return `${value}%`;
  return `₪${value}`;
};

// Check if rule type uses percent
const isPercentRule = (ruleType: Enums<'pricing_rule_type'>): boolean => {
  return ruleType === 'FULL_PERCENT';
};

export function PricingRulesDrawer({ open, onClose, company }: PricingRulesDrawerProps) {
  const { toast } = useToast();
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<PricingRule | null>(null);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    rule_type: '' as Enums<'pricing_rule_type'> | '',
    policy_type_parent: '' as Enums<'policy_type_parent'> | '',
    age_band: 'ANY' as Enums<'age_band'>,
    car_type: 'car' as Enums<'car_type'>,
    value: '',
    notes: '',
    min_car_value: '',
    max_car_value: '',
  });

  const fetchRules = async () => {
    if (!company) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('pricing_rules')
        .select('*')
        .eq('company_id', company.id)
        .order('policy_type_parent')
        .order('rule_type')
        .order('car_type');

      if (error) throw error;
      setRules(data || []);
    } catch (error) {
      console.error('Error fetching pricing rules:', error);
      toast({
        title: 'خطأ',
        description: 'فشل في جلب قواعد التسعير',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && company) {
      fetchRules();
    }
  }, [open, company]);

  const handleAddRule = () => {
    setEditingRule(null);
    setFormData({
      rule_type: '',
      policy_type_parent: '',
      age_band: 'ANY',
      car_type: 'car',
      value: '',
      notes: '',
      min_car_value: '',
      max_car_value: '',
    });
    setDialogOpen(true);
  };

  const handleEditRule = (rule: PricingRule) => {
    setEditingRule(rule);
    setFormData({
      rule_type: rule.rule_type,
      policy_type_parent: rule.policy_type_parent,
      age_band: rule.age_band || 'ANY',
      car_type: rule.car_type || 'car',
      value: rule.value.toString(),
      notes: rule.notes || '',
      min_car_value: (rule as any).min_car_value?.toString() || '',
      max_car_value: (rule as any).max_car_value?.toString() || '',
    });
    setDialogOpen(true);
  };

  const handleDeleteRule = async (rule: PricingRule) => {
    if (!confirm('هل أنت متأكد من حذف هذه القاعدة؟')) return;

    try {
      const { error } = await supabase
        .from('pricing_rules')
        .delete()
        .eq('id', rule.id);

      if (error) throw error;

      toast({
        title: 'تم الحذف',
        description: 'تم حذف القاعدة بنجاح',
      });
      fetchRules();
    } catch (error: any) {
      console.error('Error deleting rule:', error);
      toast({
        title: 'خطأ',
        description: error.message || 'فشل في حذف القاعدة',
        variant: 'destructive',
      });
    }
  };

  const handleSaveRule = async () => {
    if (!company) return;
    
    if (!formData.rule_type || !formData.policy_type_parent || !formData.value) {
      toast({
        title: 'خطأ',
        description: 'الرجاء تعبئة جميع الحقول المطلوبة',
        variant: 'destructive',
      });
      return;
    }

    const value = parseFloat(formData.value);
    if (isNaN(value)) {
      toast({
        title: 'خطأ',
        description: 'الرجاء إدخال قيمة صحيحة',
        variant: 'destructive',
      });
      return;
    }

    setSaving(true);
    try {
      const ruleData = {
        company_id: company.id,
        rule_type: formData.rule_type as Enums<'pricing_rule_type'>,
        policy_type_parent: formData.policy_type_parent as Enums<'policy_type_parent'>,
        age_band: formData.age_band,
        car_type: formData.car_type,
        value,
        notes: formData.notes || null,
        min_car_value: formData.min_car_value ? parseFloat(formData.min_car_value) : null,
        max_car_value: formData.max_car_value ? parseFloat(formData.max_car_value) : null,
      };

      if (editingRule) {
        const { error } = await supabase
          .from('pricing_rules')
          .update(ruleData)
          .eq('id', editingRule.id);

        if (error) throw error;

        toast({
          title: 'تم التحديث',
          description: 'تم تحديث القاعدة بنجاح',
        });
      } else {
        const { error } = await supabase
          .from('pricing_rules')
          .insert(ruleData);

        if (error) throw error;

        toast({
          title: 'تمت الإضافة',
          description: 'تمت إضافة القاعدة بنجاح',
        });
      }

      setDialogOpen(false);
      fetchRules();
    } catch (error: any) {
      console.error('Error saving rule:', error);
      toast({
        title: 'خطأ',
        description: error.message || 'فشل في حفظ القاعدة',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Drawer open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
        <DrawerContent className="max-h-[90vh]">
          <DrawerHeader className="flex flex-row items-center justify-between">
            <DrawerTitle>
              قواعد التسعير - {company?.name_ar || company?.name}
            </DrawerTitle>
            <Button size="sm" onClick={handleAddRule}>
              <Plus className="h-4 w-4 ml-2" />
              إضافة قاعدة
            </Button>
          </DrawerHeader>

          <div className="p-4 overflow-y-auto">
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">نوع الوثيقة</TableHead>
                    <TableHead className="text-right">نوع القاعدة</TableHead>
                    <TableHead className="text-right">نوع السيارة</TableHead>
                    <TableHead className="text-right">الفئة العمرية</TableHead>
                    <TableHead className="text-right">القيمة</TableHead>
                    <TableHead className="text-right">الإجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                        <TableCell><Skeleton className="h-8 w-20" /></TableCell>
                      </TableRow>
                    ))
                  ) : rules.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        لا توجد قواعد تسعير لهذه الشركة
                      </TableCell>
                    </TableRow>
                  ) : (
                    rules.map((rule) => (
                      <TableRow key={rule.id}>
                        <TableCell>
                          <Badge variant="outline">
                            {getDocumentTypeLabel(rule.rule_type)}
                          </Badge>
                        </TableCell>
                        <TableCell>{RULE_TYPE_LABELS[rule.rule_type]}</TableCell>
                        <TableCell>
                          {rule.car_type ? CAR_TYPE_LABELS[rule.car_type] : '-'}
                        </TableCell>
                        <TableCell>
                          {rule.age_band ? AGE_BAND_LABELS[rule.age_band] : '-'}
                        </TableCell>
                        <TableCell className="font-mono">
                          {formatRuleValue(rule.rule_type, rule.value)}
                          {((rule as any).min_car_value || (rule as any).max_car_value) && (
                            <span className="text-xs text-muted-foreground block">
                              {(rule as any).min_car_value ? `من ₪${(rule as any).min_car_value.toLocaleString()}` : ''}
                              {(rule as any).min_car_value && (rule as any).max_car_value ? ' - ' : ''}
                              {(rule as any).max_car_value ? `حتى ₪${(rule as any).max_car_value.toLocaleString()}` : ''}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleEditRule(rule)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDeleteRule(rule)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </DrawerContent>
      </Drawer>

      {/* Add/Edit Rule Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingRule ? 'تعديل قاعدة التسعير' : 'إضافة قاعدة تسعير'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>نوع الوثيقة *</Label>
              <Select
                value={formData.policy_type_parent}
                onValueChange={(v) => setFormData({ ...formData, policy_type_parent: v as Enums<'policy_type_parent'> })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="اختر نوع الوثيقة" />
                </SelectTrigger>
                <SelectContent align="end">
                  {Object.entries(POLICY_TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>نوع القاعدة *</Label>
              <Select
                value={formData.rule_type}
                onValueChange={(v) => setFormData({ ...formData, rule_type: v as Enums<'pricing_rule_type'> })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="اختر نوع القاعدة" />
                </SelectTrigger>
                <SelectContent align="end">
                  {Object.entries(RULE_TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>نوع السيارة</Label>
                <Select
                  value={formData.car_type}
                  onValueChange={(v) => setFormData({ ...formData, car_type: v as Enums<'car_type'> })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="end">
                    {Object.entries(CAR_TYPE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>الفئة العمرية</Label>
                <Select
                  value={formData.age_band}
                  onValueChange={(v) => setFormData({ ...formData, age_band: v as Enums<'age_band'> })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="end">
                    {Object.entries(AGE_BAND_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>القيمة *</Label>
              <Input
                type="number"
                step="0.01"
                value={formData.value}
                onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                placeholder={isPercentRule(formData.rule_type as Enums<'pricing_rule_type'>) ? 'النسبة المئوية' : 'المبلغ بالشيكل'}
                className="ltr-input"
              />
              <p className="text-xs text-muted-foreground">
                {isPercentRule(formData.rule_type as Enums<'pricing_rule_type'>)
                  ? 'أدخل النسبة المئوية (مثال: 2.5 تعني 2.5%)'
                  : 'أدخل المبلغ بالشيكل (₪)'}
              </p>
            </div>

            <div className="space-y-2">
              <Label>ملاحظات</Label>
              <Input
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="ملاحظات إضافية (اختياري)"
              />
            </div>

            {/* Car Value Range - show for FULL_PERCENT */}
            {formData.rule_type === 'FULL_PERCENT' && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>من قيمة سيارة (₪)</Label>
                  <Input
                    type="number"
                    value={formData.min_car_value}
                    onChange={(e) => setFormData({ ...formData, min_car_value: e.target.value })}
                    placeholder="مثلاً 60000"
                  />
                </div>
                <div className="space-y-2">
                  <Label>حتى قيمة سيارة (₪)</Label>
                  <Input
                    type="number"
                    value={formData.max_car_value}
                    onChange={(e) => setFormData({ ...formData, max_car_value: e.target.value })}
                    placeholder="مثلاً 100000"
                  />
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              إلغاء
            </Button>
            <Button onClick={handleSaveRule} disabled={saving}>
              {saving ? 'جاري الحفظ...' : 'حفظ'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
