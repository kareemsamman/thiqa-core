import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { MessageCircle, Sparkles, Loader2, Plus, Info } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { extractFunctionErrorMessage } from "@/lib/functionError";

export type OverageUsageType = "sms" | "ai_chat";

interface AddQuotaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  usageType: OverageUsageType;
  /** Called after a successful purchase so parents can refresh usage stats. */
  onPurchased?: () => void;
}

const UNIT_LABEL: Record<OverageUsageType, { title: string; singular: string; plural: string }> = {
  sms: { title: "رسائل SMS", singular: "رسالة", plural: "رسائل" },
  ai_chat: { title: "المساعد الذكي (ثاقب)", singular: "محادثة", plural: "محادثات" },
};

const PRESET_QUANTITIES: Record<OverageUsageType, number[]> = {
  sms: [50, 100, 250, 500],
  ai_chat: [25, 50, 100, 200],
};

// Fallback defaults if thiqa_platform_settings doesn't have them.
const FALLBACK_UNIT_PRICE: Record<OverageUsageType, number> = {
  sms: 0.3,
  ai_chat: 0.5,
};

export function AddQuotaDialog({
  open,
  onOpenChange,
  usageType,
  onPurchased,
}: AddQuotaDialogProps) {
  const [unitPrice, setUnitPrice] = useState<number>(FALLBACK_UNIT_PRICE[usageType]);
  const [quantity, setQuantity] = useState<number>(PRESET_QUANTITIES[usageType][1]);
  const [loadingPrice, setLoadingPrice] = useState(false);
  const [purchasing, setPurchasing] = useState(false);

  const label = UNIT_LABEL[usageType];
  const presets = PRESET_QUANTITIES[usageType];

  // Load the current platform unit price whenever the dialog opens.
  useEffect(() => {
    if (!open) return;
    setQuantity(PRESET_QUANTITIES[usageType][1]);
    setLoadingPrice(true);
    const key = usageType === "sms" ? "sms_overage_unit_price" : "ai_overage_unit_price";
    (async () => {
      try {
        const { data } = await supabase
          .from("thiqa_platform_settings" as any)
          .select("setting_value")
          .eq("setting_key", key)
          .maybeSingle() as any;
        const raw = data?.setting_value;
        const parsed = raw != null ? parseFloat(String(raw)) : NaN;
        setUnitPrice(Number.isFinite(parsed) && parsed >= 0 ? parsed : FALLBACK_UNIT_PRICE[usageType]);
      } catch {
        setUnitPrice(FALLBACK_UNIT_PRICE[usageType]);
      } finally {
        setLoadingPrice(false);
      }
    })();
  }, [open, usageType]);

  const totalAmount = useMemo(() => {
    const q = Number.isFinite(quantity) ? quantity : 0;
    return Math.round(q * unitPrice * 100) / 100;
  }, [quantity, unitPrice]);

  const handlePurchase = async () => {
    if (quantity <= 0) {
      toast.error("يجب تحديد كمية صحيحة");
      return;
    }
    setPurchasing(true);
    try {
      const { data, error } = await supabase.functions.invoke("purchase-usage-overage", {
        body: { usage_type: usageType, extra_count: quantity },
      });
      if (error) {
        const msg = (await extractFunctionErrorMessage(error)) || "فشل في تفعيل الباقة";
        throw new Error(msg);
      }
      toast.success(data?.message || "تم تفعيل الباقة بنجاح");
      onOpenChange(false);
      onPurchased?.();
    } catch (e: any) {
      toast.error(e.message || "فشل في تفعيل الباقة");
    } finally {
      setPurchasing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              {usageType === "sms" ? (
                <MessageCircle className="h-5 w-5" />
              ) : (
                <Sparkles className="h-5 w-5" />
              )}
            </div>
            إضافة رصيد — {label.title}
          </DialogTitle>
          <DialogDescription className="text-right pt-1">
            اختر الكمية التي تريد إضافتها لرصيدك. الرصيد يبقى معك ولا ينتهي شهرياً —
            يُستخدم تلقائياً بعد انتهاء الحد المجاني، والمبلغ يُضاف إلى فاتورتك القادمة.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Preset quantities */}
          <div>
            <Label className="text-xs text-muted-foreground mb-2 block">اختر كمية جاهزة</Label>
            <div className="grid grid-cols-4 gap-2">
              {presets.map((preset) => (
                <button
                  type="button"
                  key={preset}
                  onClick={() => setQuantity(preset)}
                  className={cn(
                    "rounded-lg border py-2 text-sm font-semibold transition-colors",
                    quantity === preset
                      ? "bg-primary text-primary-foreground border-primary shadow-sm"
                      : "bg-background hover:bg-muted border-input"
                  )}
                >
                  +{preset}
                </button>
              ))}
            </div>
          </div>

          {/* Custom quantity */}
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">أو أدخل كمية مخصصة</Label>
            <Input
              type="number"
              min={1}
              max={5000}
              value={quantity}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                setQuantity(Number.isFinite(v) && v > 0 ? v : 0);
              }}
              className="h-11 text-lg font-semibold tabular-nums text-center"
            />
          </div>

          {/* Summary */}
          <div className="rounded-xl border bg-muted/30 p-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">سعر الوحدة</span>
              <span className="font-semibold tabular-nums">
                {loadingPrice ? "..." : `₪${unitPrice.toFixed(2)}`}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">الكمية</span>
              <span className="font-semibold tabular-nums">
                {quantity.toLocaleString()} {quantity === 1 ? label.singular : label.plural}
              </span>
            </div>
            <div className="h-px bg-border my-1" />
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">الإجمالي</span>
              <span className="text-2xl font-bold tabular-nums text-primary">
                ₪{totalAmount.toFixed(2)}
              </span>
            </div>
          </div>

          <div className="flex items-start gap-2 text-[11px] text-muted-foreground">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <p>
              المبلغ يُضاف إلى فاتورتك القادمة. الرصيد يُضاف فوراً إلى محفظتك ولا ينتهي —
              كل رسالة أو محادثة بعد استنفاد الحد المجاني تُخصم من هذا الرصيد حتى يُستهلك كاملاً.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={purchasing}
          >
            إلغاء
          </Button>
          <Button onClick={handlePurchase} disabled={purchasing || quantity <= 0 || loadingPrice}>
            {purchasing ? (
              <Loader2 className="h-4 w-4 ml-2 animate-spin" />
            ) : (
              <Plus className="h-4 w-4 ml-2" />
            )}
            تأكيد الإضافة (₪{totalAmount.toFixed(2)})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
