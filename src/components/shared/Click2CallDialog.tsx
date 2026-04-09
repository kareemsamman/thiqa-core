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

interface PbxExtension {
  id: string;
  extension_number: string;
  extension_name: string | null;
  is_default: boolean;
}

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
  const [isLoading, setIsLoading] = useState(false);
  const [extensions, setExtensions] = useState<PbxExtension[]>([]);
  const [selectedExtensionId, setSelectedExtensionId] = useState<string>("");
  const [loadingExtensions, setLoadingExtensions] = useState(false);

  useEffect(() => {
    if (open) {
      fetchExtensions();
    }
  }, [open]);

  const fetchExtensions = async () => {
    setLoadingExtensions(true);
    try {
      const { data, error } = await supabase
        .from("pbx_extensions")
        .select("id, extension_number, extension_name, is_default")
        .order("is_default", { ascending: false })
        .order("extension_number", { ascending: true });

      if (error) throw error;

      setExtensions(data || []);
      
      // Set default extension
      const defaultExt = data?.find((ext) => ext.is_default);
      if (defaultExt) {
        setSelectedExtensionId(defaultExt.id);
      } else if (data && data.length > 0) {
        setSelectedExtensionId(data[0].id);
      }
    } catch (error) {
      console.error("Error fetching extensions:", error);
    } finally {
      setLoadingExtensions(false);
    }
  };

  const handleCall = async () => {
    if (!selectedExtensionId) {
      toast({
        title: "خطأ",
        description: "يرجى اختيار تحويلة",
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
        console.error('Click2Call error:', error);
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
    } catch (err) {
      console.error('Click2Call exception:', err);
      toast({
        title: "خطأ",
        description: "حدث خطأ غير متوقع",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

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

          {extensions.length > 0 && (
            <div className="space-y-2">
              <Label>اختر التحويلة</Label>
              <Select
                value={selectedExtensionId}
                onValueChange={setSelectedExtensionId}
                disabled={loadingExtensions}
              >
                <SelectTrigger>
                  <SelectValue placeholder="اختر التحويلة">
                    {selectedExtension && (
                      <span className="flex items-center gap-2">
                        <Phone className="h-4 w-4" />
                        {selectedExtension.extension_number}
                        {selectedExtension.extension_name && ` - ${selectedExtension.extension_name}`}
                        {selectedExtension.is_default && " ★"}
                      </span>
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {extensions.map((ext) => (
                    <SelectItem key={ext.id} value={ext.id}>
                      <span className="flex items-center gap-2">
                        <Phone className="h-4 w-4" />
                        {ext.extension_number}
                        {ext.extension_name && ` - ${ext.extension_name}`}
                        {ext.is_default && " ★"}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {extensions.length === 0 && !loadingExtensions && (
            <div className="text-center text-muted-foreground py-2">
              لا توجد تحويلات. يرجى إضافة تحويلات من إعدادات المصادقة.
            </div>
          )}
        </div>

        <DialogFooter className="flex gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            إلغاء
          </Button>
          <Button
            onClick={handleCall}
            disabled={isLoading || extensions.length === 0 || !selectedExtensionId}
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
