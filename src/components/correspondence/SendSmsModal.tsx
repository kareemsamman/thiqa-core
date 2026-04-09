import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Send } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { digitsOnly } from '@/lib/validation';

interface SendSmsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  letterId: string;
  defaultPhone?: string | null;
  recipientName?: string;
  onSent: () => void;
}

export function SendSmsModal({
  open,
  onOpenChange,
  letterId,
  defaultPhone,
  recipientName,
  onSent,
}: SendSmsModalProps) {
  const [phone, setPhone] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (open) {
      setPhone(defaultPhone || '');
    }
  }, [open, defaultPhone]);

  const handleSend = async () => {
    const cleanPhone = digitsOnly(phone);
    if (!cleanPhone || cleanPhone.length < 9) {
      toast.error('يرجى إدخال رقم هاتف صحيح');
      return;
    }

    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-correspondence-sms', {
        body: {
          letter_id: letterId,
          phone_number: cleanPhone,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast.success('تم إرسال الرسالة بنجاح');
      onSent();
      onOpenChange(false);
    } catch (error) {
      console.error('Error sending SMS:', error);
      toast.error('فشل إرسال الرسالة');
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>إرسال عبر SMS</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {recipientName && (
            <p className="text-sm text-muted-foreground">
              إرسال رسالة إلى: <strong>{recipientName}</strong>
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor="phone">رقم الهاتف</Label>
            <Input
              id="phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="05XXXXXXXX"
              dir="ltr"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button onClick={handleSend} disabled={sending}>
            {sending ? (
              <Loader2 className="h-4 w-4 ml-2 animate-spin" />
            ) : (
              <Send className="h-4 w-4 ml-2" />
            )}
            إرسال
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
