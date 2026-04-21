import { useState, useEffect } from 'react';
import { useAgentContext } from '@/hooks/useAgentContext';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

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
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    name_ar: '',
    description: '',
    active: true,
    sort_order: 0,
  });

  useEffect(() => {
    if (open) {
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
    }
  }, [open, service]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim() && !formData.name_ar.trim()) {
      toast.error('الرجاء إدخال اسم الخدمة');
      return;
    }

    setSaving(true);
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
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{service ? 'تعديل خدمة إعفاء رسوم الحادث' : 'إضافة خدمة إعفاء رسوم حادث'}</SheetTitle>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="space-y-6 mt-6">
          <div className="space-y-2">
            <Label htmlFor="name">اسم الخدمة (إنجليزي)</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              placeholder="Service Name"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="name_ar">اسم الخدمة (عربي) *</Label>
            <Input
              id="name_ar"
              value={formData.name_ar}
              onChange={(e) => setFormData(prev => ({ ...prev, name_ar: e.target.value }))}
              placeholder="اسم الخدمة"
              dir="rtl"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">الوصف</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              placeholder="وصف الخدمة..."
              dir="rtl"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="sort_order">الترتيب</Label>
            <Input
              id="sort_order"
              type="number"
              value={formData.sort_order}
              onChange={(e) => setFormData(prev => ({ ...prev, sort_order: parseInt(e.target.value) || 0 }))}
              min={0}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="active">فعال</Label>
            <Switch
              id="active"
              checked={formData.active}
              onCheckedChange={(checked) => setFormData(prev => ({ ...prev, active: checked }))}
            />
          </div>

          <div className="flex gap-2 pt-4">
            <Button type="submit" disabled={saving} className="flex-1">
              {saving && <Loader2 className="h-4 w-4 animate-spin ml-2" />}
              {service ? 'تحديث' : 'إضافة'}
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              إلغاء
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
