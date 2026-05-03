import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Loader2, MessageSquare, Megaphone, Bot } from "lucide-react";

type UsageType = "sms" | "marketing_sms" | "ai_chat";

interface Row {
  key: UsageType;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  walletColumn: "sms_credit_balance" | "marketing_sms_credit_balance" | "ai_credit_balance";
}

const ROWS: Row[] = [
  { key: "sms",           label: "رسائل SMS",     Icon: MessageSquare, walletColumn: "sms_credit_balance" },
  { key: "marketing_sms", label: "SMS تسويقية",   Icon: Megaphone,     walletColumn: "marketing_sms_credit_balance" },
  { key: "ai_chat",       label: "استعلامات AI", Icon: Bot,           walletColumn: "ai_credit_balance" },
];

interface Props {
  agentId: string;
  /** Called after a successful adjustment so the parent can refresh
   *  any other widgets that read agent_credit_wallet. */
  onAdjusted?: () => void;
}

export function AgentCreditAdjuster({ agentId, onAdjusted }: Props) {
  const [loading, setLoading] = useState(true);
  const [balances, setBalances] = useState<Record<UsageType, number>>({
    sms: 0,
    marketing_sms: 0,
    ai_chat: 0,
  });
  const [drafts, setDrafts] = useState<Record<UsageType, string>>({
    sms: "",
    marketing_sms: "",
    ai_chat: "",
  });
  const [pending, setPending] = useState<Record<UsageType, boolean>>({
    sms: false,
    marketing_sms: false,
    ai_chat: false,
  });

  const fetchBalances = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("agent_credit_wallet")
      .select("sms_credit_balance, marketing_sms_credit_balance, ai_credit_balance")
      .eq("agent_id", agentId)
      .maybeSingle();
    if (error) {
      toast.error("فشل في تحميل الرصيد: " + error.message);
    } else {
      setBalances({
        sms: data?.sms_credit_balance ?? 0,
        marketing_sms: data?.marketing_sms_credit_balance ?? 0,
        ai_chat: data?.ai_credit_balance ?? 0,
      });
    }
    setLoading(false);
  };

  useEffect(() => {
    if (agentId) fetchBalances();
  }, [agentId]);

  const handleApply = async (row: Row) => {
    const raw = drafts[row.key].trim();
    // Accept "+5", "-5", "5". parseInt handles all three.
    const delta = parseInt(raw, 10);
    if (!Number.isFinite(delta) || delta === 0) {
      toast.error("أدخل عدداً غير صفري (مثال: +5 أو -5)");
      return;
    }
    setPending((p) => ({ ...p, [row.key]: true }));
    const { data, error } = await supabase.rpc("adjust_agent_credit", {
      p_agent_id: agentId,
      p_usage_type: row.key,
      p_delta: delta,
    });
    setPending((p) => ({ ...p, [row.key]: false }));
    if (error) {
      toast.error("فشل التعديل: " + error.message);
      return;
    }
    const newBalance = (data as number | null) ?? 0;
    setBalances((b) => ({ ...b, [row.key]: newBalance }));
    setDrafts((d) => ({ ...d, [row.key]: "" }));
    toast.success(
      delta > 0
        ? `تمت إضافة ${delta} إلى رصيد ${row.label} (الرصيد الآن ${newBalance})`
        : `تم خصم ${Math.abs(delta)} من رصيد ${row.label} (الرصيد الآن ${newBalance})`
    );
    onAdjusted?.();
  };

  return (
    <Card className="rounded-2xl shadow-sm">
      <CardHeader>
        <CardTitle>تعديل الرصيد الإضافي</CardTitle>
        <CardDescription>
          أضف أو اخصم من رصيد الوكيل الإضافي. يستخدم بعد استنفاد حصة الباقة الشهرية.
          استخدم عدداً موجباً للإضافة (مثال: 5) أو سالباً للخصم (مثال: -5).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : (
          <div className="space-y-3">
            {ROWS.map((row) => (
              <div
                key={row.key}
                className="grid grid-cols-1 sm:grid-cols-[180px_1fr_140px_auto] items-center gap-3 p-3 border rounded-lg"
              >
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <row.Icon className="h-4 w-4" />
                  </div>
                  <div className="text-sm font-medium">{row.label}</div>
                </div>
                <div className="text-xs text-muted-foreground">
                  الرصيد الحالي:{" "}
                  <strong className="tabular-nums text-foreground">
                    {balances[row.key].toLocaleString("en-US")}
                  </strong>
                </div>
                <Input
                  type="number"
                  inputMode="numeric"
                  placeholder="+5 أو -5"
                  value={drafts[row.key]}
                  onChange={(e) =>
                    setDrafts((d) => ({ ...d, [row.key]: e.target.value }))
                  }
                  className="h-9"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleApply(row);
                  }}
                />
                <Button
                  size="sm"
                  onClick={() => handleApply(row)}
                  disabled={pending[row.key] || drafts[row.key].trim() === ""}
                  className="gap-2"
                >
                  {pending[row.key] && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  تطبيق
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
