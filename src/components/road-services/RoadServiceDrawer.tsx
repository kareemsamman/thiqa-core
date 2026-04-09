import { useState, useEffect } from 'react';
import { useAgentContext } from '@/hooks/useAgentContext';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { Database } from '@/integrations/supabase/types';

type CarType = Database['public']['Enums']['car_type'];

interface RoadService {
  id: string;
  name: string;
  name_ar: string | null;
  description: string | null;
  allowed_car_types: CarType[];
  active: boolean;
  sort_order: number;
}

interface RoadServiceDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  service: RoadService | null;
  onSaved: () => void;
}

const CAR_TYPES: { value: CarType; label: string }[] = [
  { value: 'car', label: 'خصوصي' },
  { value: 'cargo', label: 'شحن' },
  { value: 'small', label: 'أوتوبس زعير' },
  { value: 'taxi', label: 'تكسي' },
  { value: 'tjeradown4', label: 'تجاري أقل من 4 طن' },
  { value: 'tjeraup4', label: 'تجاري أكثر من 4 طن' },
];

export function RoadServiceDrawer({ open, onOpenChange, service, onSaved }: RoadServiceDrawerProps) {
  const { agentId } = useAgentContext();
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    name_ar: '',
    description: '',
    allowed_car_types: ['car'] as CarType[],
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
          allowed_car_types: service.allowed_car_types,
          active: service.active,
          sort_order: service.sort_order,
        });
      } else {
        setFormData({
          name: '',
          name_ar: '',
          description: '',
          allowed_car_types: ['car'],
          active: true,
          sort_order: 0,
        });
      }
    }
  }, [open, service]);

  const handleCarTypeToggle = (carType: CarType, checked: boolean) => {
    setFormData(prev => ({
      ...prev,
      allowed_car_types: checked
        ? [...prev.allowed_car_types, carType]
        : prev.allowed_car_types.filter(t => t !== carType),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      toast.error('يرجى إدخال اسم الخدمة');
      return;
    }

    if (formData.allowed_car_types.length === 0) {
      toast.error('يرجى اختيار نوع سيارة واحد على الأقل');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: formData.name.trim(),
        name_ar: formData.name_ar.trim() || null,
        description: formData.description.trim() || null,
        allowed_car_types: formData.allowed_car_types,
        active: formData.active,
        sort_order: formData.sort_order,
        ...(service ? {} : { agent_id: agentId }),
      };

      if (service) {
        const { error } = await supabase
          .from('road_services')
          .update(payload)
          .eq('id', service.id);
        if (error) throw error;
        toast.success('تم تحديث الخدمة بنجاح');
      } else {
        const { error } = await supabase
          .from('road_services')
          .insert(payload);
        if (error) throw error;
        toast.success('تم إضافة الخدمة بنجاح');
      }

      onSaved();
    } catch (error) {
      console.error('Error saving road service:', error);
      toast.error('فشل في حفظ الخدمة');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{service ? 'تعديل خدمة الطريق' : 'إضافة خدمة طريق'}</SheetTitle>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="space-y-6 mt-6">
          <div className="space-y-2">
            <Label htmlFor="name">اسم الخدمة (إنجليزي)</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              placeholder="Road Service Name"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="name_ar">اسم الخدمة (عربي)</Label>
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

          <div className="space-y-3">
            <Label>أنواع السيارات المسموحة</Label>
            <div className="grid grid-cols-2 gap-2">
              {CAR_TYPES.map(({ value, label }) => (
                <label
                  key={value}
                  className="flex items-center gap-2 p-2 rounded-md border cursor-pointer hover:bg-muted/50"
                >
                  <Checkbox
                    checked={formData.allowed_car_types.includes(value)}
                    onCheckedChange={(checked) => handleCarTypeToggle(value, !!checked)}
                  />
                  <span className="text-sm">{label}</span>
                </label>
              ))}
            </div>
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
