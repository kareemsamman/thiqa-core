import { useState, useEffect } from 'react';
import { useAgentContext } from '@/hooks/useAgentContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

interface AccidentFeeService {
  id: string;
  name: string;
  name_ar: string | null;
  description: string | null;
  active: boolean;
  sort_order: number;
}

interface AccidentFeeServiceDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  service: AccidentFeeService | null;
  onSaved?: () => void;
}

export function AccidentFeeServiceDrawer({ open, onOpenChange, service, onSaved }: AccidentFeeServiceDrawerProps) {
  const { agentId } = useAgentContext();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    name_ar: '',
    description: '',
    active: true,
    sort_order: 0,
  });

  useEffect(() => {
    if (service) {
      setFormData({
        name: service.name,
        name_ar: service.name_ar || '',
        description: service.description || '',
        active: service.active,
        sort_order: service.sort_order,
      });
    } else {
      setFormData({
        name: '',
        name_ar: '',
        description: '',
        active: true,
        sort_order: 0,
      });
    }
  }, [service, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim() && !formData.name_ar.trim()) {
      toast.error('الرجاء إدخال اسم الخدمة');
      return;
    }

    setLoading(true);
    try {
      const payload = {
        name: formData.name.trim() || formData.name_ar.trim(),
        name_ar: formData.name_ar.trim() || null,
        description: formData.description.trim() || null,
        active: formData.active,
        sort_order: formData.sort_order,
        ...(service ? {} : { agent_id: agentId }),
      };

      if (service) {
        const { error } = await supabase
          .from('accident_fee_services')
          .update(payload)
          .eq('id', service.id);

        if (error) throw error;
        toast.success('تم تحديث الخدمة بنجاح');
      } else {
        const { error } = await supabase
          .from('accident_fee_services')
          .insert(payload);

        if (error) throw error;
        toast.success('تمت إضافة الخدمة بنجاح');
      }

      onSaved?.();
    } catch (error: any) {
      console.error('Error saving accident fee service:', error);
      toast.error(error.message || 'فشل في حفظ الخدمة');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-right">
            {service ? 'تعديل خدمة إعفاء رسوم الحادث' : 'إضافة خدمة إعفاء رسوم حادث جديدة'}
          </DialogTitle>
          <DialogDescription className="text-right">
            {service
              ? 'عدّل بيانات الخدمة ثم احفظ التغييرات.'
              : 'أدخل بيانات الخدمة لإضافتها إلى كتالوج إعفاء رسوم الحادث.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name_ar" className="text-right block">الاسم بالعربية *</Label>
              <Input
                id="name_ar"
                value={formData.name_ar}
                onChange={(e) => setFormData({ ...formData, name_ar: e.target.value })}
                placeholder="اسم الخدمة"
                className="text-right"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="name" className="text-right block">الاسم بالإنجليزية</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Service Name"
                className="ltr-input"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description" className="text-right block">الوصف</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="وصف الخدمة..."
              className="text-right resize-none"
              rows={3}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-4 items-end">
            <div className="space-y-2">
              <Label htmlFor="sort_order" className="text-right block">ترتيب العرض</Label>
              <Input
                id="sort_order"
                type="number"
                value={formData.sort_order}
                onChange={(e) => setFormData({ ...formData, sort_order: parseInt(e.target.value) || 0 })}
                placeholder="0"
                className="ltr-input"
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 h-10">
              <Label htmlFor="active" className="cursor-pointer">الخدمة فعالة</Label>
              <Switch
                id="active"
                checked={formData.active}
                onCheckedChange={(checked) => setFormData({ ...formData, active: checked })}
              />
            </div>
          </div>
        </form>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            إلغاء
          </Button>
          <Button
            type="submit"
            disabled={loading}
            onClick={handleSubmit}
            className="gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                جاري الحفظ...
              </>
            ) : (
              'حفظ'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}