import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Phone, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/use-toast";
import { useClick2Call, type Click2CallExtension } from "@/hooks/useClick2Call";

interface Click2CallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  phoneNumber: string;
  onSuccess?: () => void;
}

export function Click2CallDialog({
  open,
  onOpenChange,
  phoneNumber,
  onSuccess,
}: Click2CallDialogProps) {
  const { extensions, ready, loading: stateLoading } = useClick2Call();
  const [isLoading, setIsLoading] = useState(false);
  const [selectedExtensionId, setSelectedExtensionId] = useState<string>("");

  // Re-sync the default extension every time the dialog opens. The
  // worker may have added/removed lines since the last open, and we
  // want the dialog to land on the current default — not whatever was
  // selected last time.
  useEffect(() => {
    if (!open) return;
    const defaultExt = extensions.find((e) => e.is_default) ?? extensions[0];
    if (defaultExt) {
      setSelectedExtensionId(defaultExt.id);
    } else {
      setSelectedExtensionId("");
    }
  }, [open, extensions]);

  const handleCall = async () => {
    if (!selectedExtensionId) {
      toast({
        title: "خطأ",
        description: "يرجى اختيار خط",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('click2call', {
        body: {
          phone_number: phoneNumber,
          extension_id: selectedExtensionId,
        },
      });

      if (error) {
        toast({
          title: "خطأ",
          description: "تعذر بدء الاتصال",
          variant: "destructive",
        });
        return;
      }

      if (data?.success) {
        toast({
          title: "تم بدء الاتصال",
          description: `جاري الاتصال بـ ${phoneNumber}`,
        });
        onSuccess?.();
        onOpenChange(false);
      } else {
        toast({
          title: "فشل الاتصال",
          description: data?.message || "تعذر بدء الاتصال",
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "خطأ",
        description: "حدث خطأ غير متوقع",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const renderExtensionLabel = (ext: Click2CallExtension) => (
    <span className="flex items-center gap-2">
      <Phone className="h-4 w-4" />
      <bdi className="font-mono">{ext.number}</bdi>
      {ext.label && ` - ${ext.label}`}
      {ext.is_default && " ★"}
    </span>
  );

  const selectedExtension = extensions.find((ext) => ext.id === selectedExtensionId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5 text-primary" />
            هل تريد الاتصال؟
          </DialogTitle>
          <DialogDescription>
            سيتم بدء مكالمة هاتفية إلى الرقم التالي
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="flex justify-center">
            <div className="text-2xl font-bold text-foreground" dir="ltr">
              {phoneNumber}
            </div>
          </div>

          {stateLoading ? (
            <div className="flex justify-center py-2">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : extensions.length > 0 ? (
            <div className="space-y-2">
              <Label>اختر الخط</Label>
              <Select
                value={selectedExtensionId}
                onValueChange={setSelectedExtensionId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="اختر الخط">
                    {selectedExtension && renderExtensionLabel(selectedExtension)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {extensions.map((ext) => (
                    <SelectItem key={ext.id} value={ext.id}>
                      {renderExtensionLabel(ext)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="text-center text-muted-foreground py-2 text-sm">
              {ready
                ? "لا توجد خطوط مهيّأة لهذا المستخدم."
                : "خاصية الاتصال السريع غير مفعلة لحسابك. تواصل مع المدير لتفعيلها."}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            إلغاء
          </Button>
          <Button
            onClick={handleCall}
            disabled={isLoading || !ready || !selectedExtensionId}
            variant="default"
          >
            {isLoading ? (
              <>
                <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                جاري الاتصال...
              </>
            ) : (
              <>
                <Phone className="ml-2 h-4 w-4" />
                اتصال
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
