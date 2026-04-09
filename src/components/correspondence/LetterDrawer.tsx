import { useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LetterEditor } from './LetterEditor';
import { LetterPreview } from './LetterPreview';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { Loader2, Save, Eye, Edit } from 'lucide-react';
import { digitsOnly } from '@/lib/validation';

interface Letter {
  id: string;
  title: string;
  recipient_name: string;
  recipient_phone: string | null;
  body_html: string | null;
  generated_url: string | null;
  status: string;
}

interface LetterDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  letter?: Letter | null;
  onSaved: () => void;
}

export function LetterDrawer({ open, onOpenChange, letter, onSaved }: LetterDrawerProps) {
  const { user, profile } = useAuth();
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit');
  
  const [title, setTitle] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');

  // Reset form when letter changes
  useEffect(() => {
    if (letter) {
      setTitle(letter.title || '');
      setRecipientName(letter.recipient_name || '');
      setRecipientPhone(letter.recipient_phone || '');
      setBodyHtml(letter.body_html || '');
    } else {
      setTitle('');
      setRecipientName('');
      setRecipientPhone('');
      setBodyHtml('');
    }
    setActiveTab('edit');
  }, [letter, open]);

  const handleSave = async () => {
    if (!title.trim()) {
      toast.error('يرجى إدخال عنوان الرسالة');
      return;
    }
    if (!recipientName.trim()) {
      toast.error('يرجى إدخال اسم المستلم');
      return;
    }

    setSaving(true);
    try {
      const data = {
        title: title.trim(),
        recipient_name: recipientName.trim(),
        recipient_phone: recipientPhone ? digitsOnly(recipientPhone) : null,
        body_html: bodyHtml,
        created_by_admin_id: user?.id,
        branch_id: profile?.branch_id,
      };

      if (letter?.id) {
        // Update
        const { error } = await supabase
          .from('correspondence_letters')
          .update({ ...data, updated_at: new Date().toISOString() })
          .eq('id', letter.id);
        
        if (error) throw error;
        toast.success('تم تحديث الرسالة');
      } else {
        // Create
        const { error } = await supabase
          .from('correspondence_letters')
          .insert(data);
        
        if (error) throw error;
        toast.success('تم إنشاء الرسالة');
      }

      onSaved();
      onOpenChange(false);
    } catch (error) {
      console.error('Error saving letter:', error);
      toast.error('فشل حفظ الرسالة');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{letter ? 'تعديل رسالة' : 'رسالة جديدة'}</SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Basic Info */}
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label htmlFor="title">عنوان الرسالة (داخلي)</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="مثال: خطاب للشركة س"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="recipientName">اسم المستلم</Label>
                <Input
                  id="recipientName"
                  value={recipientName}
                  onChange={(e) => setRecipientName(e.target.value)}
                  placeholder="شركة أو شخص"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="recipientPhone">رقم الهاتف (اختياري)</Label>
                <Input
                  id="recipientPhone"
                  value={recipientPhone}
                  onChange={(e) => setRecipientPhone(e.target.value)}
                  placeholder="05XXXXXXXX"
                  dir="ltr"
                />
              </div>
            </div>
          </div>

          {/* Content Tabs */}
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'edit' | 'preview')}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="edit" className="flex items-center gap-2">
                <Edit className="h-4 w-4" />
                تحرير
              </TabsTrigger>
              <TabsTrigger value="preview" className="flex items-center gap-2">
                <Eye className="h-4 w-4" />
                معاينة
              </TabsTrigger>
            </TabsList>

            <TabsContent value="edit" className="mt-4">
              <LetterEditor
                value={bodyHtml}
                onChange={setBodyHtml}
              />
            </TabsContent>

            <TabsContent value="preview" className="mt-4">
              <LetterPreview
                title={title}
                recipientName={recipientName}
                bodyHtml={bodyHtml}
              />
            </TabsContent>
          </Tabs>

          {/* Actions */}
          <div className="flex gap-2 pt-4 border-t">
            <Button onClick={handleSave} disabled={saving} className="flex-1">
              {saving ? (
                <Loader2 className="h-4 w-4 ml-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 ml-2" />
              )}
              حفظ
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              إلغاء
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
