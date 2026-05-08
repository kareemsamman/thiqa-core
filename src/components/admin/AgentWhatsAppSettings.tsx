import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Save, Trash2, Copy, ExternalLink, MessageCircle, Building2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const ALL_BRANCHES = "__all__";

interface GreenApiRow {
  id: string;
  agent_id: string;
  branch_id: string | null;
  instance_id: string;
  api_token_instance: string;
  enabled: boolean;
  custom_prompt: string | null;
  fallback_message: string | null;
  phone_label: string | null;
  phone_number: string | null;
  created_at: string;
  updated_at: string;
}

interface BranchRow {
  id: string;
  name: string;
  name_ar: string | null;
}

interface Props {
  agentId: string;
}

/** Per-agent WhatsApp / Green API instance manager. Used by Thiqa
 *  super-admins from the agent detail page. The agency itself never
 *  sees this UI — they don't manage their own tokens. */
export function AgentWhatsAppSettings({ agentId }: Props) {
  const queryClient = useQueryClient();

  const { data: rows, isLoading } = useQuery({
    queryKey: ["green-api-settings-list", agentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("green_api_settings")
        .select("*")
        .eq("agent_id", agentId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as GreenApiRow[];
    },
  });

  const { data: branches } = useQuery({
    queryKey: ["agent-branches", agentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branches")
        .select("id, name, name_ar")
        .eq("agent_id", agentId)
        .order("name");
      if (error) throw error;
      return (data ?? []) as BranchRow[];
    },
  });

  const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL ?? "";
  const webhookUrl = `${supabaseUrl}/functions/v1/green-api-webhook`;

  const copyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      toast.success("تم نسخ الرابط");
    } catch {
      toast.error("تعذّر النسخ");
    }
  };

  const addRow = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("green_api_settings").insert({
        agent_id: agentId,
        branch_id: null,
        instance_id: "",
        api_token_instance: "",
        enabled: false,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["green-api-settings-list", agentId] });
    },
    onError: (err: any) => toast.error(`فشل الإضافة: ${err.message}`),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageCircle className="h-5 w-5 text-primary" />
          أرقام WhatsApp للبوت
        </CardTitle>
        <CardDescription>
          أرقام واتساب الوكيل المربوطة على Green API. كل رقم ممكن يكون لفرع محدد أو لكل الفروع.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Webhook URL banner */}
        <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-2">
          <div className="flex items-center gap-2 font-medium">
            <ExternalLink className="h-4 w-4" />
            رابط Webhook لإدخاله في إعدادات Green API
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <code className="bg-background border px-3 py-1.5 rounded text-xs flex-1 break-all" dir="ltr">
              {webhookUrl}
            </code>
            <Button variant="outline" size="sm" onClick={copyWebhook} className="gap-1.5 shrink-0">
              <Copy className="h-3.5 w-3.5" />
              نسخ
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            الصق هذا في Settings → Outgoing webhook لكل instance، وفعّل الحدث{" "}
            <code className="bg-background px-1 rounded">incomingMessageReceived</code>.
          </p>
        </div>

        {/* List of numbers */}
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : rows && rows.length > 0 ? (
          <div className="space-y-3">
            {rows.map((row) => (
              <NumberRow
                key={row.id}
                row={row}
                branches={branches ?? []}
                agentId={agentId}
                onChanged={() =>
                  queryClient.invalidateQueries({ queryKey: ["green-api-settings-list", agentId] })
                }
              />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
            لا يوجد أي رقم WhatsApp مربوط حالياً لهذا الوكيل.
          </div>
        )}

        <Button
          variant="outline"
          onClick={() => addRow.mutate()}
          disabled={addRow.isPending}
          className="gap-2"
        >
          {addRow.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          إضافة رقم WhatsApp جديد
        </Button>
      </CardContent>
    </Card>
  );
}

function NumberRow({
  row,
  branches,
  agentId,
  onChanged,
}: {
  row: GreenApiRow;
  branches: BranchRow[];
  agentId: string;
  onChanged: () => void;
}) {
  // Local form state, hydrated from the row. Never invalidate the parent
  // query while editing — invalidate only after save/delete.
  const [instanceId, setInstanceId] = useState(row.instance_id ?? "");
  const [apiToken, setApiToken] = useState(row.api_token_instance ?? "");
  const [phoneLabel, setPhoneLabel] = useState(row.phone_label ?? "");
  const [phoneNumber, setPhoneNumber] = useState(row.phone_number ?? "");
  const [branchId, setBranchId] = useState<string>(row.branch_id ?? ALL_BRANCHES);
  const [enabled, setEnabled] = useState(row.enabled);
  const [customPrompt, setCustomPrompt] = useState(row.custom_prompt ?? "");

  // Re-hydrate when the underlying row changes (e.g. after save).
  useEffect(() => {
    setInstanceId(row.instance_id ?? "");
    setApiToken(row.api_token_instance ?? "");
    setPhoneLabel(row.phone_label ?? "");
    setPhoneNumber(row.phone_number ?? "");
    setBranchId(row.branch_id ?? ALL_BRANCHES);
    setEnabled(row.enabled);
    setCustomPrompt(row.custom_prompt ?? "");
  }, [row.id, row.updated_at]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        instance_id: instanceId.trim(),
        api_token_instance: apiToken.trim(),
        phone_label: phoneLabel.trim() || null,
        phone_number: phoneNumber.trim() || null,
        branch_id: branchId === ALL_BRANCHES ? null : branchId,
        enabled,
        custom_prompt: customPrompt.trim() || null,
      };
      const { error } = await supabase.from("green_api_settings").update(payload).eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم الحفظ");
      onChanged();
    },
    onError: (err: any) => toast.error(`فشل الحفظ: ${err.message}`),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("green_api_settings").delete().eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم الحذف");
      onChanged();
    },
    onError: (err: any) => toast.error(`فشل الحذف: ${err.message}`),
  });

  const branchLabel =
    branchId === ALL_BRANCHES
      ? "كل الفروع"
      : branches.find((b) => b.id === branchId)?.name_ar ||
        branches.find((b) => b.id === branchId)?.name ||
        "—";

  return (
    <div className="rounded-xl border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="gap-1">
            <Building2 className="h-3 w-3" />
            {branchLabel}
          </Badge>
          {phoneNumber && (
            <span className="font-mono text-sm" dir="ltr">
              {phoneNumber}
            </span>
          )}
          {row.enabled ? (
            <Badge variant="success">مفعّل</Badge>
          ) : (
            <Badge variant="outline">معطّل</Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (confirm("هل تريد حذف هذا الرقم نهائياً؟")) remove.mutate();
          }}
          disabled={remove.isPending}
          className="text-destructive gap-1.5"
        >
          <Trash2 className="h-4 w-4" />
          حذف
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>الفرع</Label>
          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_BRANCHES}>كل الفروع (Agency-wide)</SelectItem>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name_ar || b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>التسمية (اختياري)</Label>
          <Input
            value={phoneLabel}
            onChange={(e) => setPhoneLabel(e.target.value)}
            placeholder="مثلاً: فرع رام الله"
          />
        </div>

        <div className="space-y-1.5">
          <Label>رقم الواتساب (اختياري — للعرض فقط)</Label>
          <Input
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            placeholder="0501234567"
            className="ltr-input font-mono"
            dir="ltr"
          />
        </div>

        <div className="space-y-1.5">
          <Label>Instance ID (Green API)</Label>
          <Input
            value={instanceId}
            onChange={(e) => setInstanceId(e.target.value)}
            placeholder="1101000000"
            className="ltr-input font-mono"
            dir="ltr"
          />
        </div>

        <div className="space-y-1.5 md:col-span-2">
          <Label>API Token Instance</Label>
          <Input
            type="password"
            value={apiToken}
            onChange={(e) => setApiToken(e.target.value)}
            placeholder="••••••••"
            className="ltr-input font-mono"
            dir="ltr"
            autoComplete="off"
          />
        </div>

        <div className="md:col-span-2 flex items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3">
          <div>
            <Label className="text-base">تفعيل البوت</Label>
            <p className="text-xs text-muted-foreground">
              لمّا يكون مفعّل، البوت يرد تلقائياً على رسائل العملاء على هذا الرقم.
            </p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>

        <div className="md:col-span-2 space-y-1.5">
          <Label>تعليمات إضافية للبوت (اختياري)</Label>
          <Input
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder="مثلاً: ساعات الدوام من 8 صباحاً حتى 5 مساءً"
          />
        </div>
      </div>

      <div className="flex justify-end">
        <Button
          onClick={() => save.mutate()}
          disabled={save.isPending || !instanceId.trim() || !apiToken.trim()}
          size="sm"
          className="gap-2"
        >
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          حفظ
        </Button>
      </div>
    </div>
  );
}
