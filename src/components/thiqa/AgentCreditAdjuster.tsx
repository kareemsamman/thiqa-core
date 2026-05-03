import { useEffect, useState } from "react";
import { format } from "date-fns";
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
}

const ROWS: Row[] = [
  { key: "sms",           label: "رسائل SMS",     Icon: MessageSquare },
  { key: "marketing_sms", label: "SMS تسويقية",   Icon: Megaphone     },
  { key: "ai_chat",       label: "استعلامات AI", Icon: Bot           },
];

interface Props {
  agentId: string;
  /** Called after a successful adjustment so the parent can refresh
   *  the usage tiles that read agent_usage_log. */
  onAdjusted?: () => void;
}

export function AgentCreditAdjuster({ agentId, onAdjusted }: Props) {
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState<Record<UsageType, number>>({
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

  const fetchCounts = async () => {
    setLoading(true);
    const period = format(new Date(), "yyyy-MM");
    const { data, error } = await supabase
      .from("agent_usage_log")
      .select("usage_type, count")
      .eq("agent_id", agentId)
      .eq("period", period);
    if (error) {
      toast.error("فشل في تحميل العدّادات: " + error.message);
    } else {
      const map: Record<UsageType, number> = { sms: 0, marketing_sms: 0, ai_chat: 0 };
      (data || []).forEach((r: any) => {
        if (r.usage_type === "sms" || r.usage_type === "marketing_sms" || r.usage_type === "ai_chat") {
          map[r.usage_type as UsageType] = (map[r.usage_type as UsageType] ?? 0) + (r.count ?? 0);
        }
      });
      setCounts(map);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (agentId) fetchCounts();
  }, [agentId]);

  const handleApply = async (row: Row) => {
    const raw = drafts[row.key].trim();
    const delta = parseInt(raw, 10);
    if (!Number.isFinite(delta) || delta === 0) {
      toast.error("أدخل عدداً غير صفري (مثال: +5 أو -5)");
      return;
    }
    setPending((p) => ({ ...p, [row.key]: true }));
    const { data, error } = await supabase.rpc("adjust_agent_usage", {
      p_agent_id: agentId,
      p_usage_type: row.key,
      p_delta: delta,
    });
    setPending((p) => ({ ...p, [row.key]: false }));
    if (error) {
      toast.error("فشل التعديل: " + error.message);
      return;
    }
    const newCount = (data as number | null) ?? 0;
    setCounts((c) => ({ ...c, [row.key]: newCount }));
    setDrafts((d) => ({ ...d, [row.key]: "" }));
    toast.success(`العدّاد الآن ${newCount} لـ ${row.label}`);
    onAdjusted?.();
  };

  return (
    <Card className="rounded-2xl shadow-sm">
      <CardHeader>
        <CardTitle>تعديل عدّاد الاستخدام</CardTitle>
        <CardDescription>
          يعدّل العدّاد المعروض على شاشة الاشتراك مباشرة (مثل "8 / 150").
          أدخل عدداً موجباً للإضافة إلى العدّاد (مثال: 5)، أو سالباً للخصم (مثال: -5).
          العدّاد لا يقلّ عن صفر.
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
                  العدّاد الحالي:{" "}
                  <strong className="tabular-nums text-foreground">
                    {counts[row.key].toLocaleString("en-US")}
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
