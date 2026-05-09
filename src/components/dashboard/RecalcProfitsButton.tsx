import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { RefreshCw, Calculator, Lock, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAgentContext } from "@/hooks/useAgentContext";
import { useUpgradePrompt } from "@/components/pricing/UpgradePromptProvider";
import { recalculatePolicyProfit } from "@/lib/pricingCalculator";

/**
 * One-tap "Recalculate all profits" action. Mirrors the button on the
 * Policies page so an agent with only accounting access can trigger it
 * from the dashboard. Iterates every non-deleted policy in 1000-row
 * batches and rewrites profit + payed_for_company via the shared
 * pricing calculator.
 */
export function RecalcProfitsButton() {
  const { toast } = useToast();
  const { hasFeature } = useAgentContext();
  const { showUpgradePrompt } = useUpgradePrompt();
  const canAccounting = hasFeature("accounting");

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [lockedCount, setLockedCount] = useState<number | null>(null);
  const cancelRef = useRef(false);

  const onClick = async () => {
    if (!canAccounting) {
      showUpgradePrompt({ featureKey: "accounting", featureLabel: "المحاسبة" });
      return;
    }
    // Pre-fetch the count of manually-overridden rows so the confirm
    // dialog can warn the user that those rows will be skipped.
    const { count } = await supabase
      .from("policies")
      .select("*", { count: "exact", head: true })
      .is("deleted_at", null)
      .eq("skip_recalc", false)
      .eq("manual_override", true);
    setLockedCount(count ?? 0);
    setConfirmOpen(true);
  };

  const runRecalc = async () => {
    setConfirmOpen(false);
    setRunning(true);
    cancelRef.current = false;
    try {
      const { count, error: countError } = await supabase
        .from("policies")
        .select("*", { count: "exact", head: true })
        .is("deleted_at", null)
        .eq("skip_recalc", false)
        .eq("manual_override", false);
      if (countError) throw countError;
      if (!count) {
        toast({ title: "لا توجد معاملات", description: "لا توجد معاملات لإعادة حسابها" });
        return;
      }

      setProgress({ done: 0, total: count });

      const batch = 1000;
      let ids: string[] = [];
      for (let offset = 0; offset < count; offset += batch) {
        const { data, error } = await supabase
          .from("policies")
          .select("id")
          .is("deleted_at", null)
          .eq("skip_recalc", false)
          .eq("manual_override", false)
          .range(offset, offset + batch - 1);
        if (error) throw error;
        if (data) ids = ids.concat(data.map((p) => p.id));
      }

      let success = 0;
      let failed = 0;
      for (let i = 0; i < ids.length; i++) {
        if (cancelRef.current) {
          toast({
            title: "تم الإلغاء",
            description: `تم تحديث ${success} معاملة قبل الإلغاء`,
          });
          break;
        }
        const res = await recalculatePolicyProfit(ids[i]);
        if (res) success++;
        else failed++;
        setProgress({ done: i + 1, total: ids.length });
      }

      if (!cancelRef.current) {
        toast({
          title: "تم إعادة الحساب",
          description: `تم تحديث ${success} معاملة${failed > 0 ? ` · فشل ${failed}` : ""}`,
        });
        // Nudge dashboard widgets to refetch. The KPI / top-companies /
        // income widgets already listen for this event on mount.
        window.dispatchEvent(new CustomEvent("thiqa:policy-created"));
      }
    } catch (e) {
      console.error("Error recalculating:", e);
      toast({
        title: "خطأ",
        description: "فشل في إعادة حساب الأرباح",
        variant: "destructive",
      });
    } finally {
      setRunning(false);
      setProgress({ done: 0, total: 0 });
      cancelRef.current = false;
    }
  };

  if (running) {
    const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
    return (
      <div className="flex items-center gap-3 rounded-full border bg-card/60 px-4 py-2 text-sm shadow-sm">
        <RefreshCw className="h-4 w-4 animate-spin text-primary" />
        <span className="font-medium">جاري إعادة الحساب…</span>
        <div className="w-32">
          <Progress value={pct} className="h-1.5" />
        </div>
        <span className="ltr-nums text-muted-foreground">
          {progress.done}/{progress.total}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10"
          onClick={() => (cancelRef.current = true)}
          title="إلغاء"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  const locked = !canAccounting;

  return (
    <>
      <Button
        onClick={onClick}
        variant={locked ? "outline" : "default"}
        className={cn(
          "h-10 px-4 rounded-full gap-2 shadow-sm text-sm font-medium",
          locked
            ? "border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10 bg-transparent"
            : "bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 border border-amber-500/20"
        )}
        title={locked ? "يتطلب باقة تشمل المحاسبة" : "إعادة حساب أرباح جميع المعاملات حسب قواعد التسعير الحالية"}
      >
        {locked ? <Lock className="h-4 w-4" /> : <Calculator className="h-4 w-4" />}
        إعادة حساب الأرباح
        {locked && <Sparkles className="h-3.5 w-3.5 opacity-70" />}
      </Button>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>إعادة حساب الأرباح</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم إعادة حساب الأرباح والمستحق للشركة لجميع المعاملات باستخدام قواعد التسعير الحالية.
              هذه العملية قد تستغرق دقائق عدة حسب عدد المعاملات.
              {lockedCount && lockedCount > 0 ? (
                <span className="mt-2 block text-amber-700 dark:text-amber-300">
                  سيتم تجاوز {lockedCount} معاملة معدّلة يدوياً (محمية بقفل) — لن تتأثر قيمها.
                </span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={runRecalc}>متابعة</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
