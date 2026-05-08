import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MainLayout } from "@/components/layout/MainLayout";
import { Header } from "@/components/layout/Header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Loader2, Save, MessageCircle, Copy, ExternalLink, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

interface GreenApiSettingsRow {
  id: string;
  agent_id: string;
  instance_id: string;
  api_token_instance: string;
  enabled: boolean;
  custom_prompt: string | null;
  fallback_message: string | null;
}

export default function GreenApiSettings() {
  const { profile } = useAuth();
  const agentId = profile?.agent_id ?? null;
  const queryClient = useQueryClient();

  const [instanceId, setInstanceId] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [fallback, setFallback] = useState("");

  const { data: settings, isLoading } = useQuery({
    queryKey: ["green-api-settings", agentId],
    enabled: !!agentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("green_api_settings")
        .select("*")
        .eq("agent_id", agentId!)
        .maybeSingle();
      if (error) throw error;
      return data as GreenApiSettingsRow | null;
    },
  });

  // Hydrate the form once the row loads.
  useEffect(() => {
    if (!settings) return;
    setInstanceId(settings.instance_id ?? "");
    setApiToken(settings.api_token_instance ?? "");
    setEnabled(settings.enabled);
    setCustomPrompt(settings.custom_prompt ?? "");
    setFallback(settings.fallback_message ?? "");
  }, [settings]);

  const save = useMutation({
    mutationFn: async () => {
      if (!agentId) throw new Error("No agent");
      const payload = {
        agent_id: agentId,
        instance_id: instanceId.trim(),
        api_token_instance: apiToken.trim(),
        enabled,
        custom_prompt: customPrompt.trim() || null,
        fallback_message: fallback.trim() || null,
      };
      const { error } = await supabase
        .from("green_api_settings")
        .upsert(payload, { onConflict: "agent_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم حفظ الإعدادات");
      queryClient.invalidateQueries({ queryKey: ["green-api-settings", agentId] });
    },
    onError: (err: any) => {
      toast.error(`فشل الحفظ: ${err.message ?? err}`);
    },
  });

  const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL ?? "";
  const webhookUrl = `${supabaseUrl}/functions/v1/green-api-webhook`;

  const copyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      toast.success("تم نسخ رابط الـ Webhook");
    } catch {
      toast.error("تعذّر النسخ");
    }
  };

  if (isLoading) {
    return (
      <MainLayout>
        <Header title="بوت الواتساب (Green API)" subtitle="ربط حساب الواتساب الخاص بمكتبك مع المساعد الآلي" />
        <div className="md:p-6 space-y-4">
          <Skeleton className="h-64 w-full" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <Header
        title="بوت الواتساب (Green API)"
        subtitle="ربط حساب الواتساب الخاص بمكتبك مع المساعد الآلي للعملاء"
      />

      <div className="md:p-6 space-y-6 max-w-3xl">
        {/* Setup steps card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5 text-primary" />
              خطوات الربط
            </CardTitle>
            <CardDescription>تنفّذ هذه الخطوات لمرة واحدة</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <ol className="list-decimal pr-5 space-y-2 text-foreground/85">
              <li>
                سجّل / ادخل حسابك في{" "}
                <a
                  href="https://console.green-api.com"
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline inline-flex items-center gap-1"
                >
                  console.green-api.com <ExternalLink className="h-3 w-3" />
                </a>{" "}
                ثم أنشئ Instance جديد.
              </li>
              <li>
                من صفحة الـ Instance، انسخ <code className="bg-muted px-1 rounded">idInstance</code> و{" "}
                <code className="bg-muted px-1 rounded">apiTokenInstance</code> وضعهما أدناه.
              </li>
              <li>اربط رقم واتساب المكتب بالـ Instance بمسح QR (مثل WhatsApp Web).</li>
              <li>
                في صفحة الـ Instance، تبويب{" "}
                <code className="bg-muted px-1 rounded">Settings</code>، ضع رابط الـ Webhook التالي:
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <code className="bg-muted px-3 py-1.5 rounded text-xs flex-1 break-all">
                    {webhookUrl}
                  </code>
                  <Button variant="outline" size="sm" onClick={copyWebhook} className="gap-2">
                    <Copy className="h-3.5 w-3.5" />
                    نسخ
                  </Button>
                </div>
                وفعّل خيار <code className="bg-muted px-1 rounded">incomingMessageReceived</code>.
              </li>
              <li>ارجع لهنا، أدخل البيانات، فعّل البوت واضغط حفظ.</li>
            </ol>
          </CardContent>
        </Card>

        {/* Credentials + toggle */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <CardTitle>إعدادات الاتصال</CardTitle>
              <CardDescription>بيانات الـ Instance من Green API</CardDescription>
            </div>
            {settings?.enabled ? (
              <Badge variant="success" className="gap-1">
                <CheckCircle2 className="h-3.5 w-3.5" />
                مفعّل
              </Badge>
            ) : (
              <Badge variant="outline">معطّل</Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="instance-id">Instance ID</Label>
              <Input
                id="instance-id"
                value={instanceId}
                onChange={(e) => setInstanceId(e.target.value)}
                placeholder="مثلاً 1101000000"
                className="ltr-input font-mono"
                dir="ltr"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="api-token">API Token Instance</Label>
              <Input
                id="api-token"
                type="password"
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                placeholder="••••••••"
                className="ltr-input font-mono"
                dir="ltr"
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                الـ Token يُحفظ مشفّراً ولا يُعرض إلا في هذه الشاشة.
              </p>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3">
              <div>
                <Label htmlFor="enabled" className="text-base">
                  تفعيل البوت
                </Label>
                <p className="text-xs text-muted-foreground">
                  لمّا تشغّله، أي رسالة من عميل على رقم الواتساب رح يرد عليها البوت تلقائياً.
                </p>
              </div>
              <Switch id="enabled" checked={enabled} onCheckedChange={setEnabled} />
            </div>
          </CardContent>
        </Card>

        {/* Customizations */}
        <Card>
          <CardHeader>
            <CardTitle>التخصيص (اختياري)</CardTitle>
            <CardDescription>تعليمات إضافية للبوت ورسالة احتياطية</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="custom-prompt">تعليمات إضافية للبوت</Label>
              <Textarea
                id="custom-prompt"
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="مثلاً: ساعات الدوام من 8 صباحاً حتى 5 مساءً. لو السؤال خارج الدوام أرجع للزبون: 'سيتم الرد صباحاً.'"
                className="min-h-[100px]"
              />
              <p className="text-xs text-muted-foreground">
                هذا النص بينضاف للـ System Prompt الأساسي.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="fallback">رسالة احتياطية عند فشل البوت</Label>
              <Input
                id="fallback"
                value={fallback}
                onChange={(e) => setFallback(e.target.value)}
                placeholder="مثلاً: عذراً، خدمة الرد المباشر مش متاحة الآن. تواصل مع المكتب على 02-1234567"
              />
            </div>
          </CardContent>
        </Card>

        {/* Save */}
        <div className="flex justify-end">
          <Button
            onClick={() => save.mutate()}
            disabled={save.isPending || !instanceId.trim() || !apiToken.trim()}
            size="lg"
            className="gap-2"
          >
            {save.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            حفظ
          </Button>
        </div>
      </div>
    </MainLayout>
  );
}
