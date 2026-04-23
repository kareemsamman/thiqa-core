import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Eye, EyeOff, Send, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

/**
 * Shared SMS-provider config block used in three places:
 *   1. /thiqa/settings (platform defaults)            context='platform'
 *   2. /thiqa/agents/:id (per-agent override)         context='agent'
 *   3. /sms-settings (agent self-service)             context='agent'
 *
 * The same layout, same fields, same test-send button everywhere. The
 * only difference is that the agent contexts have an extra dropdown
 * option — "استخدام الافتراضي من ثقة" — which stores NULL and makes
 * the backend inherit the platform default.
 */

export type SmsProviderChoice = "019sms" | "htd" | "";

export interface SmsProviderValue {
  provider: SmsProviderChoice;
  sms_user: string;
  sms_token: string;
  sms_source: string;
  htd_id: string;
  htd_sender: string;
}

export function emptySmsProviderValue(): SmsProviderValue {
  return {
    provider: "",
    sms_user: "",
    sms_token: "",
    sms_source: "",
    htd_id: "",
    htd_sender: "",
  };
}

interface Props {
  context: "platform" | "agent";
  value: SmsProviderValue;
  onChange: (next: SmsProviderValue) => void;
  /**
   * When context='agent', show the effective provider the platform
   * falls back to if the agent picks "inherit". Used for the label.
   */
  platformDefaultProvider?: "019sms" | "htd";
}

function resolveEffectiveProvider(
  value: SmsProviderValue,
  context: "platform" | "agent",
  platformDefault?: "019sms" | "htd",
): "019sms" | "htd" {
  if (value.provider === "htd") return "htd";
  if (value.provider === "019sms") return "019sms";
  // Empty = inherit (agent context). In the platform context "empty"
  // shouldn't happen but we fall back to 019sms to be safe.
  if (context === "agent" && platformDefault) return platformDefault;
  return "019sms";
}

export function SmsProviderConfig({
  context,
  value,
  onChange,
  platformDefaultProvider,
}: Props) {
  const { toast } = useToast();
  const [showToken, setShowToken] = useState(false);
  const [showHtdId, setShowHtdId] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [testing, setTesting] = useState(false);

  const effectiveProvider = resolveEffectiveProvider(
    value,
    context,
    platformDefaultProvider,
  );
  const isInheriting = context === "agent" && value.provider === "";

  const patch = (changes: Partial<SmsProviderValue>) => {
    onChange({ ...value, ...changes });
  };

  const handleTest = async () => {
    const phone = testPhone.trim();
    if (!phone) {
      toast({ title: "خطأ", description: "يرجى إدخال رقم هاتف للاختبار", variant: "destructive" });
      return;
    }
    setTesting(true);
    try {
      // The test-sms-credentials edge function accepts raw credentials
      // in the body and doesn't touch any stored row, so the user sees
      // the result of what's currently typed in the form.
      const { data, error } = await supabase.functions.invoke("test-sms-credentials", {
        body: {
          provider: effectiveProvider === "htd" ? "htd" : "019",
          phone,
          sms_user: value.sms_user,
          sms_token: value.sms_token,
          sms_source: value.sms_source,
          htd_id: value.htd_id,
          htd_sender: value.htd_sender,
        },
      });
      if (error) throw error;
      if (data?.success) {
        toast({
          title: "نجح الإرسال",
          description: `عبر ${data.provider === "htd" ? "HTD" : "019sms"} — ${data.api_message || "تم إرسال الرسالة"}`,
        });
      } else {
        toast({
          title: "فشل الإرسال",
          description: data?.error || data?.raw || "تعذّر إرسال الرسالة",
          variant: "destructive",
        });
      }
    } catch (err: any) {
      toast({
        title: "فشل الإرسال",
        description: err?.message || "تعذّر الاتصال بوظيفة الاختبار",
        variant: "destructive",
      });
    } finally {
      setTesting(false);
    }
  };

  // ─── Provider selector ────────────────────────────────────────────
  const providerSelectValue =
    value.provider === "" ? "__inherit__" : value.provider;

  const platformLabel =
    platformDefaultProvider === "htd"
      ? "HTD"
      : platformDefaultProvider === "019sms"
      ? "019sms"
      : "";

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label className="font-bold">المزوّد</Label>
        <Select
          value={providerSelectValue}
          onValueChange={(v) =>
            patch({ provider: v === "__inherit__" ? "" : (v as SmsProviderChoice) })
          }
        >
          <SelectTrigger className="w-full md:w-96">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {context === "agent" && (
              <SelectItem value="__inherit__">
                استخدام الافتراضي من ثقة
                {platformLabel && ` (${platformLabel})`}
              </SelectItem>
            )}
            <SelectItem value="019sms">019sms (إسرائيل)</SelectItem>
            <SelectItem value="htd">HTD (sms.htd.ps — فلسطين)</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">
          {context === "platform"
            ? "هذا المزوّد هو الافتراضي لكل وكيل لم يختر مزوّداً خاصاً."
            : isInheriting
              ? `هذا الوكيل يتبع الافتراضي${platformLabel ? ` (${platformLabel})` : ""}. اختر مزوّداً صريحاً لتجاوزه.`
              : "هذا الوكيل سيستخدم المزوّد أعلاه حتى لو غيّرت الافتراضي في إعدادات ثقة."}
        </p>
      </div>

      {/* 019sms credentials */}
      <div className="border rounded-lg p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold">019sms</span>
          {effectiveProvider === "019sms" && (
            <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full">
              {isInheriting ? "الافتراضي (مُطبّق)" : "المُختار"}
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label>اسم المستخدم</Label>
            <Input
              value={value.sms_user}
              onChange={(e) => patch({ sms_user: e.target.value })}
              dir="ltr"
            />
          </div>
          <div className="space-y-2">
            <Label>Token</Label>
            <div className="relative">
              <Input
                type={showToken ? "text" : "password"}
                value={value.sms_token}
                onChange={(e) => patch({ sms_token: e.target.value })}
                dir="ltr"
                className="pe-10"
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <Label>رقم المصدر (Sender)</Label>
            <Input
              value={value.sms_source}
              onChange={(e) => patch({ sms_source: e.target.value })}
              dir="ltr"
            />
          </div>
        </div>
      </div>

      {/* HTD credentials */}
      <div className="border rounded-lg p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold">HTD</span>
          {effectiveProvider === "htd" && (
            <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full">
              {isInheriting ? "الافتراضي (مُطبّق)" : "المُختار"}
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>API ID</Label>
            <div className="relative">
              <Input
                type={showHtdId ? "text" : "password"}
                value={value.htd_id}
                onChange={(e) => patch({ htd_id: e.target.value })}
                dir="ltr"
                className="pe-10"
                placeholder="من صفحة My Account في htd.ps"
              />
              <button
                type="button"
                onClick={() => setShowHtdId(!showHtdId)}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showHtdId ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Sender ID</Label>
            <Input
              value={value.htd_sender}
              onChange={(e) => patch({ htd_sender: e.target.value })}
              dir="ltr"
              placeholder="الاسم الذي يظهر للمستلم"
            />
          </div>
        </div>
      </div>

      {/* Test-send section */}
      <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
        <div className="flex items-center gap-2 flex-wrap">
          <Send className="h-4 w-4 text-primary" />
          <span className="text-sm font-bold">اختبار الإرسال</span>
          <span className="text-[10px] text-muted-foreground">
            يستخدم القيم المكتوبة أعلاه — لا حاجة للحفظ أولاً
          </span>
        </div>
        <div className="flex flex-col md:flex-row gap-2">
          <Input
            placeholder="05xxxxxxxx أو 972xxxxxxxxx"
            value={testPhone}
            onChange={(e) => setTestPhone(e.target.value)}
            dir="ltr"
            className="md:max-w-xs"
          />
          <Button
            onClick={handleTest}
            disabled={testing}
            variant="outline"
            className="gap-2"
          >
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            إرسال رسالة اختبار
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          سيُرسَل عبر{" "}
          <strong>{effectiveProvider === "htd" ? "HTD" : "019sms"}</strong>
          {isInheriting && " (الافتراضي من ثقة)"}
          {" "}باستخدام البيانات الحالية في الحقول.
        </p>
      </div>
    </div>
  );
}
