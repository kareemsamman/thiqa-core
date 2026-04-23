import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Save, Users, Building2, FileText, MessageSquare, Megaphone, Bot, Infinity as InfinityIcon } from "lucide-react";

/**
 * Per-agent limit override editor. Writes nullable *_limit_override
 * columns on the agents row:
 *   - null → inherit plan
 *   - -1   → unlimited
 *   - >=0  → explicit value
 *
 * get_agent_effective_limit + useAgentLimits both respect this,
 * so the value set here drives both server-side enforcement (triggers)
 * and the client-side usage bars the agent sees on /subscription.
 */

type ResourceKey =
  | "users"
  | "branches"
  | "policies"
  | "sms"
  | "marketing_sms"
  | "ai";

interface Resource {
  key: ResourceKey;
  column: string;
  label: string;
  helpText: string;
  Icon: React.ComponentType<{ className?: string }>;
}

const RESOURCES: Resource[] = [
  {
    key: "users",
    column: "users_limit_override",
    label: "المستخدمون",
    helpText: "عدد المستخدمين الذين يمكن للوكيل إنشاؤهم",
    Icon: Users,
  },
  {
    key: "branches",
    column: "branches_limit_override",
    label: "الفروع",
    helpText: "عدد الفروع التي يمكن إنشاؤها",
    Icon: Building2,
  },
  {
    key: "policies",
    column: "policies_limit_override",
    label: "المعاملات",
    helpText: "عدد المعاملات حسب الفترة (شهرية/سنوية)",
    Icon: FileText,
  },
  {
    key: "sms",
    column: "sms_limit_override",
    label: "رسائل SMS",
    helpText: "عدد الرسائل النصية المسموح بها شهرياً",
    Icon: MessageSquare,
  },
  {
    key: "marketing_sms",
    column: "marketing_sms_limit_override",
    label: "SMS تسويقية",
    helpText: "عدد الرسائل التسويقية المسموح بها شهرياً",
    Icon: Megaphone,
  },
  {
    key: "ai",
    column: "ai_limit_override",
    label: "المساعد الذكي",
    helpText: "عدد محادثات المساعد الذكي الشهرية",
    Icon: Bot,
  },
];

type OverrideMode = "inherit" | "custom" | "unlimited";

interface RowState {
  mode: OverrideMode;
  value: string; // keep as string to avoid react/input number quirks
}

function overrideToState(raw: number | null | undefined): RowState {
  if (raw == null) return { mode: "inherit", value: "" };
  if (raw === -1) return { mode: "unlimited", value: "" };
  return { mode: "custom", value: String(raw) };
}

function stateToOverride(state: RowState): number | null {
  if (state.mode === "inherit") return null;
  if (state.mode === "unlimited") return -1;
  const n = parseInt(state.value, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

interface Props {
  agentId: string;
  /** Live values from useAgentLimits so the admin sees what takes effect. */
  effectiveLimits?: Partial<Record<ResourceKey, number | null>>;
}

export function AgentLimitOverrides({ agentId, effectiveLimits }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState<Record<ResourceKey, RowState>>({
    users: { mode: "inherit", value: "" },
    branches: { mode: "inherit", value: "" },
    policies: { mode: "inherit", value: "" },
    sms: { mode: "inherit", value: "" },
    marketing_sms: { mode: "inherit", value: "" },
    ai: { mode: "inherit", value: "" },
  });

  const fetchOverrides = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("agents")
        .select(
          "users_limit_override, branches_limit_override, policies_limit_override, sms_limit_override, marketing_sms_limit_override, ai_limit_override",
        )
        .eq("id", agentId)
        .maybeSingle();
      if (error) throw error;
      const row = (data ?? {}) as Record<string, number | null>;
      setRows({
        users: overrideToState(row.users_limit_override),
        branches: overrideToState(row.branches_limit_override),
        policies: overrideToState(row.policies_limit_override),
        sms: overrideToState(row.sms_limit_override),
        marketing_sms: overrideToState(row.marketing_sms_limit_override),
        ai: overrideToState(row.ai_limit_override),
      });
    } catch (err: any) {
      toast.error("فشل في تحميل الحدود: " + (err?.message ?? ""));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (agentId) fetchOverrides();
  }, [agentId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: Record<string, number | null> = {};
      for (const r of RESOURCES) {
        payload[r.column] = stateToOverride(rows[r.key]);
      }
      const { error } = await supabase.from("agents").update(payload).eq("id", agentId);
      if (error) throw error;
      toast.success("تم حفظ الحدود المخصصة");
    } catch (err: any) {
      toast.error("فشل في الحفظ: " + (err?.message ?? ""));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>حدود مخصصة لهذا الوكيل</CardTitle>
        <CardDescription>
          هذه الحدود تتجاوز القيم الافتراضية للباقة لهذا الوكيل فقط. اترك الصف على "من الباقة" ليتبع إعدادات الباقة تلقائياً.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : (
          <div className="space-y-3">
            {RESOURCES.map((r) => {
              const state = rows[r.key];
              const effective = effectiveLimits?.[r.key];
              const effectiveLabel =
                effective === undefined
                  ? ""
                  : effective === null
                    ? "غير محدود"
                    : String(effective);
              return (
                <div key={r.key} className="grid grid-cols-1 md:grid-cols-[180px_180px_1fr_220px] items-center gap-3 p-3 border rounded-lg">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <r.Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm">{r.label}</p>
                      <p className="text-[11px] text-muted-foreground leading-tight">{r.helpText}</p>
                    </div>
                  </div>
                  <Select
                    value={state.mode}
                    onValueChange={(v) =>
                      setRows((prev) => ({ ...prev, [r.key]: { ...prev[r.key], mode: v as OverrideMode } }))
                    }
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="inherit">من الباقة</SelectItem>
                      <SelectItem value="custom">قيمة مخصصة</SelectItem>
                      <SelectItem value="unlimited">غير محدود</SelectItem>
                    </SelectContent>
                  </Select>
                  {state.mode === "custom" ? (
                    <Input
                      type="number"
                      min={0}
                      value={state.value}
                      onChange={(e) =>
                        setRows((prev) => ({ ...prev, [r.key]: { ...prev[r.key], value: e.target.value } }))
                      }
                      placeholder="أدخل العدد"
                      className="h-9"
                    />
                  ) : state.mode === "unlimited" ? (
                    <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <InfinityIcon className="h-3.5 w-3.5" />
                      لا يوجد حد على هذا المورد لهذا الوكيل
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">
                      يتبع القيمة الافتراضية من الباقة الحالية.
                    </div>
                  )}
                  {effectiveLabel !== "" && (
                    <div className="text-xs text-muted-foreground text-end">
                      المُطبَّق حالياً: <strong className="tabular-nums">{effectiveLabel}</strong>
                    </div>
                  )}
                </div>
              );
            })}
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              حفظ الحدود المخصصة
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
