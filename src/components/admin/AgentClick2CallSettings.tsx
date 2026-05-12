import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, Save, Plus, Trash2, Star, Phone, PhoneCall } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// Providers the system supports today. Add new entries here as we
// onboard more vendors; the DB column is plain TEXT so no migration
// is needed for each new option.
const PROVIDERS: { value: string; label: string }[] = [
  { value: "talkchief", label: "Talkchief" },
];

interface SettingsRow {
  id: string;
  agent_id: string;
  provider: string;
  api_key: string;
  is_enabled: boolean;
}

interface ExtensionRow {
  id: string;
  extension: string;
  label: string | null;
  is_default: boolean;
}

interface Props {
  agentId: string;
}

/**
 * Per-agent Click2Call configuration manager. Thiqa super-admin
 * opens this from the agent detail page — picks the provider, drops
 * in the agency's vendor api_key, and curates the shared pool of
 * extensions. Every employee in this agent will then see the call
 * button next to phone numbers across the app.
 *
 * Mirrors AgentWhatsAppSettings in shape so the agent detail page
 * stays uniform; differs in that settings is a 1:1 row (not a list)
 * because each agency holds a single vendor account.
 */
export function AgentClick2CallSettings({ agentId }: Props) {
  const queryClient = useQueryClient();

  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ["click2call-agent-settings", agentId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("click2call_agent_settings")
        .select("id, agent_id, provider, api_key, is_enabled")
        .eq("agent_id", agentId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as SettingsRow | null;
    },
  });

  const { data: extensions, isLoading: extensionsLoading } = useQuery({
    queryKey: ["click2call-agent-extensions", agentId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("click2call_agent_extensions")
        .select("id, extension, label, is_default")
        .eq("agent_id", agentId)
        .order("is_default", { ascending: false })
        .order("extension", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ExtensionRow[];
    },
  });

  // Form state mirrors the row so the admin sees current values on
  // load and any edits land in local state until "حفظ" persists them.
  const [provider, setProvider] = useState<string>(PROVIDERS[0].value);
  const [apiKey, setApiKey] = useState("");
  const [isEnabled, setIsEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings) {
      setProvider(settings.provider || PROVIDERS[0].value);
      setApiKey(settings.api_key || "");
      setIsEnabled(settings.is_enabled);
    } else {
      setProvider(PROVIDERS[0].value);
      setApiKey("");
      setIsEnabled(true);
    }
  }, [settings]);

  const [newExtension, setNewExtension] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [adding, setAdding] = useState(false);

  // Test-call dialog state. Opens when the admin clicks the phone
  // icon on an extension row — lets them dial a real number through
  // this agent's vendor config to verify api_key + extension before
  // handing the line over to the agency's employees.
  const [testExtension, setTestExtension] = useState<ExtensionRow | null>(null);
  const [testNumber, setTestNumber] = useState("");
  const [testing, setTesting] = useState(false);

  const handleTestCall = async () => {
    if (!testExtension) return;
    const num = testNumber.trim();
    if (!num) {
      toast.error("أدخل رقم للاختبار");
      return;
    }
    setTesting(true);
    try {
      // agent_id override lets the super-admin invoke the function
      // for an agency they don't belong to. The edge function
      // re-validates super-admin status before honoring it.
      const { data, error } = await supabase.functions.invoke("click2call", {
        body: {
          phone_number: num,
          extension_id: testExtension.id,
          agent_id: agentId,
        },
      });
      if (error) throw error;
      if (data?.success) {
        toast.success(data.message || "تم بدء الاتصال");
        setTestExtension(null);
        setTestNumber("");
      } else {
        toast.error(data?.message || "فشل الاتصال");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "فشل الاتصال");
    } finally {
      setTesting(false);
    }
  };

  const handleSaveSettings = async () => {
    if (!apiKey.trim()) {
      toast.error("مفتاح API مطلوب");
      return;
    }
    setSaving(true);
    try {
      const { error } = await (supabase as any)
        .from("click2call_agent_settings")
        .upsert(
          {
            agent_id: agentId,
            provider,
            api_key: apiKey.trim(),
            is_enabled: isEnabled,
          },
          { onConflict: "agent_id" }
        );
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ["click2call-agent-settings", agentId] });
      toast.success("تم حفظ إعدادات الاتصال السريع");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "فشل في حفظ الإعدادات");
    } finally {
      setSaving(false);
    }
  };

  const handleAddExtension = async () => {
    const ext = newExtension.trim();
    if (!ext) return;
    setAdding(true);
    try {
      // First extension auto-becomes the default so the employee call
      // dialog always has something pre-selected.
      const isFirst = (extensions?.length ?? 0) === 0;
      const { error } = await (supabase as any)
        .from("click2call_agent_extensions")
        .insert({
          agent_id: agentId,
          extension: ext,
          label: newLabel.trim() || null,
          is_default: isFirst,
        });
      if (error) throw error;
      setNewExtension("");
      setNewLabel("");
      await queryClient.invalidateQueries({ queryKey: ["click2call-agent-extensions", agentId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "فشل في إضافة الخط");
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const { error } = await (supabase as any)
        .from("click2call_agent_extensions")
        .delete()
        .eq("id", id);
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ["click2call-agent-extensions", agentId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "فشل في حذف الخط");
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      // Unset others first — the partial unique index on (agent_id)
      // WHERE is_default would reject a second default row otherwise.
      const sb = supabase as any;
      const { error: clearErr } = await sb
        .from("click2call_agent_extensions")
        .update({ is_default: false })
        .eq("agent_id", agentId)
        .neq("id", id);
      if (clearErr) throw clearErr;
      const { error: setErr } = await sb
        .from("click2call_agent_extensions")
        .update({ is_default: true })
        .eq("id", id);
      if (setErr) throw setErr;
      await queryClient.invalidateQueries({ queryKey: ["click2call-agent-extensions", agentId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "فشل في تعيين الخط الافتراضي");
    }
  };

  const loading = settingsLoading || extensionsLoading;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Phone className="h-5 w-5" />
          الاتصال السريع (Click2Call)
        </CardTitle>
        <CardDescription>
          إعدادات الاتصال السريع لهذا الوكيل. كل الموظفين بهذا الوكيل بقدروا يستخدموا الخطوط المضافة هون.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <>
            {/* Settings */}
            <div className="space-y-4 rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="c2c-enabled" className="font-medium">
                  تفعيل الاتصال السريع
                </Label>
                <Switch
                  id="c2c-enabled"
                  checked={isEnabled}
                  onCheckedChange={setIsEnabled}
                />
              </div>

              <div className="space-y-2">
                <Label>شركة الاتصال</Label>
                <Select value={provider} onValueChange={setProvider}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDERS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>مفتاح API</Label>
                <Input
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="api_key الخاص بحساب الوكيل لدى الشركة المزوّدة"
                  dir="ltr"
                  type="password"
                  autoComplete="off"
                />
                <p className="text-xs text-muted-foreground">
                  يحصل عليه الوكيل من حسابه لدى Talkchief (أو الشركة المزوّدة).
                </p>
              </div>

              <Button onClick={handleSaveSettings} disabled={saving}>
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin ml-2" />
                ) : (
                  <Save className="h-4 w-4 ml-2" />
                )}
                حفظ الإعدادات
              </Button>
            </div>

            {/* Extensions. Hidden until settings exist — we need a
                stable agent_settings row before attaching extensions,
                and it avoids the admin filling in a list that they
                then have to re-confirm anyway. */}
            <div className="space-y-3 rounded-lg border p-4">
              <div>
                <h4 className="font-medium">الخطوط (Extensions)</h4>
                <p className="text-xs text-muted-foreground mt-1">
                  أضف خطوط الوكيل وسمِّها لتميزها (مثل "خط تامر"، "خط أحمد"). الخط الافتراضي هو الذي يُختار تلقائياً.
                </p>
              </div>

              {!settings ? (
                <div className="text-sm text-muted-foreground py-4 text-center">
                  احفظ الإعدادات أولاً ثم أضف الخطوط.
                </div>
              ) : (
                <>
                  {extensions && extensions.length > 0 && (
                    <div className="border rounded-md overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-right">رقم الخط</TableHead>
                            <TableHead className="text-right">الاسم</TableHead>
                            <TableHead className="text-center w-32">افتراضي</TableHead>
                            <TableHead className="text-center w-24">إجراءات</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {extensions.map((ext) => (
                            <TableRow key={ext.id}>
                              <TableCell className="font-mono">
                                <bdi>{ext.extension}</bdi>
                              </TableCell>
                              <TableCell>{ext.label || "-"}</TableCell>
                              <TableCell className="text-center">
                                {ext.is_default ? (
                                  <span className="inline-flex items-center gap-1 text-primary text-xs">
                                    <Star className="h-3.5 w-3.5 fill-current" />
                                    افتراضي
                                  </span>
                                ) : (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => handleSetDefault(ext.id)}
                                  >
                                    تعيين
                                  </Button>
                                )}
                              </TableCell>
                              <TableCell className="text-center">
                                <div className="flex items-center justify-center gap-1">
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => {
                                      setTestExtension(ext);
                                      setTestNumber("");
                                    }}
                                    disabled={!settings?.is_enabled}
                                    className="text-primary hover:text-primary"
                                    title={settings?.is_enabled ? "اختبار الاتصال" : "فعّل الإعدادات أولاً"}
                                  >
                                    <PhoneCall className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => handleDelete(ext.id)}
                                    className="text-destructive hover:text-destructive"
                                    title="حذف"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}

                  <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
                    <div>
                      <Label className="text-xs">رقم الخط</Label>
                      <Input
                        value={newExtension}
                        onChange={(e) => setNewExtension(e.target.value)}
                        placeholder="501"
                        dir="ltr"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">الاسم</Label>
                      <Input
                        value={newLabel}
                        onChange={(e) => setNewLabel(e.target.value)}
                        placeholder="خط تامر"
                      />
                    </div>
                    <Button
                      onClick={handleAddExtension}
                      disabled={adding || !newExtension.trim()}
                      size="sm"
                    >
                      {adding ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Plus className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </CardContent>

      {/* Test call dialog — verifies api_key + extension actually
          place a real call through the vendor before the agency's
          employees ever try it. */}
      <Dialog
        open={!!testExtension}
        onOpenChange={(open) => {
          if (!open) {
            setTestExtension(null);
            setTestNumber("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PhoneCall className="h-5 w-5 text-primary" />
              اختبار الاتصال
            </DialogTitle>
            <DialogDescription>
              {testExtension && (
                <>
                  سيتم الاتصال من الخط{" "}
                  <strong>
                    <bdi className="font-mono">{testExtension.extension}</bdi>
                    {testExtension.label && ` - ${testExtension.label}`}
                  </strong>
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-4">
            <Label>الرقم للاختبار</Label>
            <Input
              value={testNumber}
              onChange={(e) => setTestNumber(e.target.value)}
              placeholder="0501234567"
              dir="ltr"
              type="tel"
              inputMode="tel"
            />
            <p className="text-xs text-muted-foreground">
              أدخل رقم حقيقي (موبايلك مثلاً) للتأكد من نجاح المكالمة.
            </p>
          </div>
          <DialogFooter className="flex gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => {
                setTestExtension(null);
                setTestNumber("");
              }}
              disabled={testing}
            >
              إلغاء
            </Button>
            <Button onClick={handleTestCall} disabled={testing || !testNumber.trim()}>
              {testing ? (
                <Loader2 className="h-4 w-4 animate-spin ml-2" />
              ) : (
                <PhoneCall className="h-4 w-4 ml-2" />
              )}
              اتصال
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
