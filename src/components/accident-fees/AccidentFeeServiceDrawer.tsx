import { useState, useEffect } from 'react';
import { useAgentContext } from '@/hooks/useAgentContext';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerFooter } from '@/components/ui/drawer';
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
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[90vh]">
        <DrawerHeader>
          <DrawerTitle>
            {service ? 'تعديل خدمة إعفاء رسوم الحادث' : 'إضافة خدمة إعفاء رسوم حادث جديدة'}
          </DrawerTitle>
        </DrawerHeader>

        <form onSubmit={handleSubmit} className="p-4 space-y-4 overflow-y-auto">
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
            <Label htmlFor="description" className="text-right block">الوصف</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="وصف الخدمة..."
              className="text-right"
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="sort_order" className="text-right block">ترتيب العرض</Label>
            <Input
              id="sort_order"
              type="number"
              value={formData.sort_order}
              onChange={(e) => setFormData({ ...formData, sort_order: parseInt(e.target.value) || 0 })}
              placeholder="0"
              className="ltr-input w-24"
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="active">الخدمة فعالة</Label>
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
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                  جاري الحفظ...
                </>
              ) : (
                'حفظ'
              )}
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
              إلغاء
            </Button>
          </div>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}