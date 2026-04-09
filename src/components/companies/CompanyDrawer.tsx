import { useState, useEffect } from 'react';
import { useAgentContext } from '@/hooks/useAgentContext';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerFooter,
} from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Trash2, Loader2 } from 'lucide-react';
import type { Tables, Enums } from '@/integrations/supabase/types';

type Company = Tables<'insurance_companies'>;
type Broker = Tables<'brokers'>;
type PolicyTypeParent = Enums<'policy_type_parent'>;

const POLICY_TYPES: { value: PolicyTypeParent; label: string }[] = [
  { value: "ELZAMI", label: "إلزامي" },
  { value: "THIRD_FULL", label: "ثالث/شامل" },
  { value: "ROAD_SERVICE", label: "خدمات الطريق" },
  { value: "ACCIDENT_FEE_EXEMPTION", label: "إعفاء رسوم حادث" },
];

interface CompanyDrawerProps {
  open: boolean;
  onClose: () => void;
  company: Company | null;
  onSuccess: () => void;
}

export function CompanyDrawer({ open, onClose, company, onSuccess }: CompanyDrawerProps) {
  const { toast } = useToast();
  const { agentId } = useAgentContext();
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [brokers, setBrokers] = useState<Broker[]>([]);
  const [formData, setFormData] = useState({
    name: '',
    name_ar: '',
    category_parents: [] as PolicyTypeParent[],
    active: true,
    elzami_commission: 0,
    broker_id: null as string | null,
  });

  useEffect(() => {
    // Fetch brokers for dropdown
    const fetchBrokers = async () => {
      const { data } = await supabase
        .from('brokers')
        .select('*')
        .order('name');
      if (data) setBrokers(data);
    };
    fetchBrokers();
  }, []);

  useEffect(() => {
    if (company) {
      setFormData({
        name: company.name,
        name_ar: company.name_ar || '',
        category_parents: company.category_parent || [],
        active: company.active ?? true,
        elzami_commission: company.elzami_commission ?? 0,
        broker_id: company.broker_id || null,
      });
    } else {
      setFormData({
        name: '',
        name_ar: '',
        category_parents: [],
        active: true,
        elzami_commission: 0,
        broker_id: null,
      });
    }
  }, [company, open]);

  const handleTypeToggle = (type: PolicyTypeParent, checked: boolean) => {
    setFormData(prev => ({
      ...prev,
      category_parents: checked 
        ? [...prev.category_parents, type]
        : prev.category_parents.filter(t => t !== type)
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name.trim()) {
      toast({
        title: 'خطأ',
        description: 'الرجاء إدخال اسم الشركة بالإنجليزية',
        variant: 'destructive',
      });
      return;
    }

    if (formData.category_parents.length === 0) {
      toast({
        title: 'خطأ',
        description: 'الرجاء اختيار نوع تأمين واحد على الأقل',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      if (company) {
        const { error } = await supabase
          .from('insurance_companies')
          .update({
            name: formData.name.trim(),
            name_ar: formData.name_ar.trim() || null,
            category_parent: formData.category_parents,
            active: formData.active,
            elzami_commission: formData.category_parents.includes('ELZAMI') ? formData.elzami_commission : 0,
            broker_id: formData.broker_id || null,
          })
          .eq('id', company.id);

        if (error) throw error;

        toast({
          title: 'تم التحديث',
          description: 'تم تحديث بيانات الشركة بنجاح',
        });
      } else {
        const { error } = await supabase
          .from('insurance_companies')
          .insert({
            name: formData.name.trim(),
            name_ar: formData.name_ar.trim() || null,
            category_parent: formData.category_parents,
            active: formData.active,
            elzami_commission: formData.category_parents.includes('ELZAMI') ? formData.elzami_commission : 0,
            broker_id: formData.broker_id || null,
            agent_id: agentId,
          });

        if (error) throw error;

        toast({
          title: 'تمت الإضافة',
          description: 'تمت إضافة الشركة بنجاح',
        });
      }

      
      onSuccess();
    } catch (error: any) {
      console.error('Error saving company:', error);
      toast({
        title: 'خطأ',
        description: error.message || 'فشل في حفظ بيانات الشركة',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!company) return;
    
    setDeleting(true);
    try {
      // Check if there are related policies
      const { count, error: countError } = await supabase
        .from('policies')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', company.id)
        .is('deleted_at', null);

      if (countError) throw countError;

      if (count && count > 0) {
        toast({
          title: 'لا يمكن الحذف',
          description: `لا يمكن حذف الشركة لأن هناك ${count} وثيقة تأمين مرتبطة بها. يرجى حذف الوثائق أولاً أو نقلها لشركة أخرى.`,
          variant: 'destructive',
        });
        setDeleteDialogOpen(false);
        setDeleting(false);
        return;
      }

      // First delete all pricing rules for this company
      const { error: rulesError } = await supabase
        .from('pricing_rules')
        .delete()
        .eq('company_id', company.id);

      if (rulesError) throw rulesError;

      // Then delete the company
      const { error: companyError } = await supabase
        .from('insurance_companies')
        .delete()
        .eq('id', company.id);

      if (companyError) throw companyError;

      toast({
        title: 'تم الحذف',
        description: 'تم حذف الشركة وجميع قواعد التسعير المرتبطة بها',
      });

      setDeleteDialogOpen(false);
      onSuccess();
    } catch (error: any) {
      console.error('Error deleting company:', error);
      toast({
        title: 'خطأ',
        description: error.message || 'فشل في حذف الشركة',
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Drawer open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
        <DrawerContent className="max-h-[90vh]">
          <DrawerHeader className="flex flex-row items-center justify-between">
            <DrawerTitle>
              {company ? 'تعديل شركة التأمين' : 'إضافة شركة تأمين جديدة'}
            </DrawerTitle>
            {company && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setDeleteDialogOpen(true)}
              >
                <Trash2 className="h-4 w-4 ml-1" />
                حذف
              </Button>
            )}
          </DrawerHeader>

          <form onSubmit={handleSubmit} className="p-4 space-y-4 overflow-y-auto">
            <div className="space-y-2">
              <Label htmlFor="name" className="text-right block">الاسم بالإنجليزية *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Company Name"
                className="ltr-input"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="name_ar" className="text-right block">الاسم بالعربية</Label>
              <Input
                id="name_ar"
                value={formData.name_ar}
                onChange={(e) => setFormData({ ...formData, name_ar: e.target.value })}
                placeholder="اسم الشركة"
                className="text-right"
              />
            </div>

            <div className="space-y-3">
              <Label className="text-right block">أنواع التأمين *</Label>
              <div className="grid grid-cols-2 gap-3">
                {POLICY_TYPES.map(type => (
                  <div key={type.value} className="flex items-center gap-2">
                    <Checkbox
                      id={`type-${type.value}`}
                      checked={formData.category_parents.includes(type.value)}
                      onCheckedChange={(checked) => handleTypeToggle(type.value, checked as boolean)}
                    />
                    <Label 
                      htmlFor={`type-${type.value}`} 
                      className="text-sm cursor-pointer"
                    >
                      {type.label}
                    </Label>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                يمكنك اختيار أكثر من نوع تأمين للشركة الواحدة
              </p>
            </div>

            {/* ELZAMI Commission Field - Only show when type includes ELZAMI */}
            {formData.category_parents.includes('ELZAMI') && (
              <div className="space-y-2">
                <Label htmlFor="elzami_commission" className="text-right block">
                  تكلفة الإلزامي (₪)
                  <span className="text-xs text-destructive mr-2">
                    (مبلغ يُخصم من AB)
                  </span>
                </Label>
                <Input
                  id="elzami_commission"
                  type="number"
                  step="0.01"
                  value={formData.elzami_commission}
                  onChange={(e) => setFormData({ ...formData, elzami_commission: parseFloat(e.target.value) || 0 })}
                  placeholder="0"
                  className="ltr-input"
                />
                <p className="text-xs text-muted-foreground">
                  هذا المبلغ يُدفع للشركة عند كل وثيقة إلزامي. الربح = سعر التأمين - هذا المبلغ
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="broker_id" className="text-right block">الوسيط المرتبط</Label>
              <Select
                value={formData.broker_id || "none"}
                onValueChange={(value) => setFormData({ ...formData, broker_id: value === "none" ? null : value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="اختر الوسيط (اختياري)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">بدون وسيط</SelectItem>
                  {brokers.map((broker) => (
                    <SelectItem key={broker.id} value={broker.id}>
                      {broker.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                إذا كانت الشركة مرتبطة بوسيط، سيتم اختيار الوسيط تلقائياً عند إنشاء وثيقة
              </p>
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="active">الشركة نشطة</Label>
              <Switch
                id="active"
                checked={formData.active}
                onCheckedChange={(checked) => setFormData({ ...formData, active: checked })}
              />
            </div>
          </form>

          <DrawerFooter>
            <div className="flex gap-2 w-full">
              <Button
                type="submit"
                className="flex-1"
                disabled={loading}
                onClick={handleSubmit}
              >
                {loading ? 'جاري الحفظ...' : 'حفظ'}
              </Button>
              <Button variant="outline" onClick={onClose} disabled={loading}>
                إلغاء
              </Button>
            </div>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-right">تأكيد الحذف</AlertDialogTitle>
            <AlertDialogDescription className="text-right">
              هل أنت متأكد أنك تريد حذف الشركة "{company?.name_ar || company?.name}"؟
              <br />
              <span className="text-destructive font-medium">
                سيتم حذف جميع قواعد التسعير المرتبطة بها نهائياً.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel disabled={deleting}>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? (
                <>
                  <Loader2 className="h-4 w-4 ml-1 animate-spin" />
                  جاري الحذف...
                </>
              ) : (
                'حذف'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}