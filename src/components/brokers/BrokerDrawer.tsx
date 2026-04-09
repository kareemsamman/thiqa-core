import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Save } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const brokerSchema = z.object({
  name: z.string().min(2, 'الاسم مطلوب'),
  phone: z.string().optional(),
  notes: z.string().optional(),
});

type BrokerFormData = z.infer<typeof brokerSchema>;

interface Broker {
  id: string;
  name: string;
  phone: string | null;
  image_url: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface BrokerDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  broker: Broker | null;
  onSaved: () => void;
}

export function BrokerDrawer({ open, onOpenChange, broker, onSaved }: BrokerDrawerProps) {
  const [saving, setSaving] = useState(false);
  const isEditing = !!broker;

  const form = useForm<BrokerFormData>({
    resolver: zodResolver(brokerSchema),
    defaultValues: {
      name: '',
      phone: '',
      notes: '',
    },
  });

  // Reset form immediately when broker prop changes or drawer opens
  useEffect(() => {
    if (open && broker) {
      // Force immediate reset with broker data
      form.reset({
        name: broker.name || '',
        phone: broker.phone || '',
        notes: broker.notes || '',
      });
    } else if (open && !broker) {
      // New broker - clear the form
      form.reset({
        name: '',
        phone: '',
        notes: '',
      });
    }
  }, [open, broker?.id, broker?.name, broker?.phone, broker?.notes, form]);

  const onSubmit = async (data: BrokerFormData) => {
    setSaving(true);
    try {
      if (isEditing) {
        const { error } = await supabase
          .from('brokers')
          .update({
            name: data.name,
            phone: data.phone || null,
            notes: data.notes || null,
          })
          .eq('id', broker.id);

        if (error) throw error;
        toast.success('تم تحديث بيانات الوسيط');
      } else {
        const { error } = await supabase
          .from('brokers')
          .insert({
            name: data.name,
            phone: data.phone || null,
            notes: data.notes || null,
          });

        if (error) throw error;
        toast.success('تمت إضافة الوسيط بنجاح');
      }

      form.reset();
      onSaved();
    } catch (error: any) {
      console.error('Save error:', error);
      toast.error('فشل حفظ البيانات');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{isEditing ? 'تعديل بيانات الوسيط' : 'إضافة وسيط جديد'}</SheetTitle>
        </SheetHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-6">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>اسم الوسيط *</FormLabel>
                  <FormControl>
                    <Input placeholder="أدخل اسم الوسيط" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>رقم الهاتف</FormLabel>
                  <FormControl>
                    <Input placeholder="أدخل رقم الهاتف" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>ملاحظات</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="أضف ملاحظات عن الوسيط..."
                      className="min-h-[100px]"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex gap-3 pt-4">
              <Button type="submit" disabled={saving} className="flex-1">
                {saving ? (
                  <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 ml-2" />
                )}
                {saving ? 'جاري الحفظ...' : 'حفظ'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={saving}
              >
                إلغاء
              </Button>
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}