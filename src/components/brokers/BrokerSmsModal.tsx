import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { extractFunctionErrorMessage, toastFunctionError } from "@/lib/functionError";
import { MessageSquare, Send, Loader2 } from "lucide-react";

interface BrokerSmsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  broker: {
    id: string;
    name: string;
    phone: string | null;
  };
  defaultMessage?: string;
}

export function BrokerSmsModal({
  open,
  onOpenChange,
  broker,
  defaultMessage = "",
}: BrokerSmsModalProps) {
  const { toast } = useToast();
  const { user, profile } = useAuth();
  const [phone, setPhone] = useState(broker.phone || "");
  const [message, setMessage] = useState(defaultMessage);
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!phone.trim()) {
      toast({
        title: "خطأ",
        description: "رقم الهاتف مطلوب",
        variant: "destructive",
      });
      return;
    }

    if (!message.trim()) {
      toast({
        title: "خطأ",
        description: "نص الرسالة مطلوب",
        variant: "destructive",
      });
      return;
    }

    setSending(true);
    try {
      // Send SMS via edge function
      const { data, error } = await supabase.functions.invoke("send-sms", {
        body: { phone, message },
      });

      if (error) throw error;

      // Log the SMS
      await supabase.from("sms_logs").insert({
        phone_number: phone,
        message,
        sms_type: "manual",
        status: "sent",
        sent_at: new Date().toISOString(),
        created_by: user?.id,
        branch_id: profile?.branch_id,
      });

      toast({
        title: "تم الإرسال",
        description: `تم إرسال الرسالة إلى ${broker.name}`,
      });
      onOpenChange(false);
    } catch (error: any) {
      console.error("Error sending SMS:", error);
      const description = await extractFunctionErrorMessage(error);

      // Log failed SMS
      await supabase.from("sms_logs").insert({
        phone_number: phone,
        message,
        sms_type: "manual",
        status: "failed",
        error_message: description || "فشل في الإرسال",
        created_by: user?.id,
        branch_id: profile?.branch_id,
      });

      // Shows a sonner toast with a "buy more" action if this is a quota error.
      await toastFunctionError(error, "فشل في إرسال الرسالة");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            إرسال رسالة SMS - {broker.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>رقم الهاتف</Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="05xxxxxxxx"
              className="ltr-input text-left"
              dir="ltr"
            />
          </div>

          <div className="space-y-2">
            <Label>نص الرسالة</Label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="اكتب رسالتك هنا..."
              rows={5}
            />
            <p className="text-xs text-muted-foreground text-left">
              {message.length} حرف
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button onClick={handleSend} disabled={sending} className="gap-2">
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            إرسال
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
