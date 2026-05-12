import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
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
import { Loader2, Save, Plus, Trash2, Star, Phone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAgentContext } from "@/hooks/useAgentContext";

// Providers the system supports today. Add new entries here as we
// onboard more vendors; the DB column is plain TEXT so no migration
// is needed for each new option.
const PROVIDERS: { value: string; label: string }[] = [
  { value: "talkchief", label: "Talkchief" },
];

interface UserRow {
  id: string;
  full_name: string | null;
  email: string;
}

interface SettingsRow {
  id: string;
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

interface Click2CallUserDialogProps {
  user: UserRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function Click2CallUserDialog({ user, open, onOpenChange }: Click2CallUserDialogProps) {
  const { toast } = useToast();
  const { agentId } = useAgentContext();

  const [loading, setLoading] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settings, setSettings] = useState<SettingsRow | null>(null);
  const [provider, setProvider] = useState<string>(PROVIDERS[0].value);
  const [apiKey, setApiKey] = useState("");
  const [isEnabled, setIsEnabled] = useState(true);

  const [extensions, setExtensions] = useState<ExtensionRow[]>([]);
  const [newExtension, setNewExtension] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [addingExtension, setAddingExtension] = useState(false);

  // Pulls fresh state every time the sheet opens so two admins editing
  // the same user don't overwrite each other based on stale form state.
  useEffect(() => {
    if (!user || !open || !agentId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const sb = supabase as any;
        const [settingsRes, extensionsRes] = await Promise.all([
          sb
            .from("click2call_user_settings")
            .select("id, provider, api_key, is_enabled")
            .eq("user_id", user.id)
            .eq("agent_id", agentId)
            .maybeSingle(),
          sb
            .from("click2call_user_extensions")
            .select("id, extension, label, is_default")
            .eq("user_id", user.id)
            .eq("agent_id", agentId)
            .order("is_default", { ascending: false })
            .order("extension", { ascending: true }),
        ]);
        if (cancelled) return;
        if (settingsRes.error) throw settingsRes.error;
        if (extensionsRes.error) throw extensionsRes.error;

        const row = (settingsRes.data ?? null) as SettingsRow | null;
        setSettings(row);
        setProvider(row?.provider || PROVIDERS[0].value);
        setApiKey(row?.api_key || "");
        setIsEnabled(row?.is_enabled ?? true);
        setExtensions((extensionsRes.data ?? []) as ExtensionRow[]);
      } catch (err) {
        toast({
          title: "خطأ",
          description: err instanceof Error ? err.message : "فشل في تحميل الإعدادات",
          variant: "destructive",
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, open, agentId, toast]);

  const handleSaveSettings = async () => {
    if (!user || !agentId) return;
    if (!apiKey.trim()) {
      toast({ title: "خطأ", description: "مفتاح API مطلوب", variant: "destructive" });
      return;
    }
    setSavingSettings(true);
    try {
      const { data, error } = await (supabase as any)
        .from("click2call_user_settings")
        .upsert(
          {
            user_id: user.id,
            agent_id: agentId,
            provider,
            api_key: apiKey.trim(),
            is_enabled: isEnabled,
          },
          { onConflict: "user_id,agent_id" }
        )
        .select("id, provider, api_key, is_enabled")
        .single();
      if (error) throw error;
      setSettings(data as SettingsRow);
      toast({ title: "تم الحفظ", description: "تم حفظ إعدادات الاتصال السريع" });
    } catch (err) {
      toast({
        title: "خطأ",
        description: err instanceof Error ? err.message : "فشل في حفظ الإعدادات",
        variant: "destructive",
      });
    } finally {
      setSavingSettings(false);
    }
  };

  const handleAddExtension = async () => {
    if (!user || !agentId) return;
    const ext = newExtension.trim();
    if (!ext) return;
    setAddingExtension(true);
    try {
      // First extension auto-becomes the default so the worker always
      // has something to call from without an extra "mark default" click.
      const isFirst = extensions.length === 0;
      const { data, error } = await (supabase as any)
        .from("click2call_user_extensions")
        .insert({
          user_id: user.id,
          agent_id: agentId,
          extension: ext,
          label: newLabel.trim() || null,
          is_default: isFirst,
        })
        .select("id, extension, label, is_default")
        .single();
      if (error) throw error;
      setExtensions((prev) =>
        [...prev, data as ExtensionRow].sort((a, b) => {
          if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
          return a.extension.localeCompare(b.extension);
        })
      );
      setNewExtension("");
      setNewLabel("");
    } catch (err) {
      toast({
        title: "خطأ",
        description: err instanceof Error ? err.message : "فشل في إضافة التحويلة",
        variant: "destructive",
      });
    } finally {
      setAddingExtension(false);
    }
  };

  const handleDeleteExtension = async (id: string) => {
    try {
      const { error } = await (supabase as any).from("click2call_user_extensions").delete().eq("id", id);
      if (error) throw error;
      setExtensions((prev) => prev.filter((e) => e.id !== id));
    } catch (err) {
      toast({
        title: "خطأ",
        description: err instanceof Error ? err.message : "فشل في حذف التحويلة",
        variant: "destructive",
      });
    }
  };

  const handleSetDefault = async (id: string) => {
    if (!user || !agentId) return;
    try {
      // Unset everyone else first — the partial unique index on
      // (user_id, agent_id) WHERE is_default would reject a second
      // default row otherwise. Two statements rather than a single
      // upsert because we don't have a deterministic ordering of
      // "unset then set" inside one Supabase call.
      const sb = supabase as any;
      const { error: clearError } = await sb
        .from("click2call_user_extensions")
        .update({ is_default: false })
        .eq("user_id", user.id)
        .eq("agent_id", agentId)
        .neq("id", id);
      if (clearError) throw clearError;
      const { error: setError } = await sb
        .from("click2call_user_extensions")
        .update({ is_default: true })
        .eq("id", id);
      if (setError) throw setError;
      setExtensions((prev) =>
        prev
          .map((e) => ({ ...e, is_default: e.id === id }))
          .sort((a, b) => {
            if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
            return a.extension.localeCompare(b.extension);
          })
      );
    } catch (err) {
      toast({
        title: "خطأ",
        description: err instanceof Error ? err.message : "فشل في تعيين التحويلة الافتراضية",
        variant: "destructive",
      });
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5 text-primary" />
            الاتصال السريع
          </SheetTitle>
          <SheetDescription>
            إعدادات الاتصال السريع للمستخدم{" "}
            <strong>{user?.full_name || user?.email}</strong>
          </SheetDescription>
        </SheetHeader>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-6 mt-6">
            {/* Settings section */}
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
                  placeholder="api_key الخاص بحساب المستخدم"
                  dir="ltr"
                  type="password"
                  autoComplete="off"
                />
                <p className="text-xs text-muted-foreground">
                  لكل مستخدم مفتاحه الخاص — يحصل عليه من حسابه لدى الشركة المزوّدة.
                </p>
              </div>

              <Button onClick={handleSaveSettings} disabled={savingSettings} className="w-full">
                {savingSettings ? (
                  <Loader2 className="h-4 w-4 animate-spin ml-2" />
                ) : (
                  <Save className="h-4 w-4 ml-2" />
                )}
                حفظ الإعدادات
              </Button>
            </div>

            {/* Extensions section. Hidden until the settings row exists
                — we need a stable click2call_user_settings record before
                attaching extensions, and it avoids the admin filling in
                a list that they then have to re-confirm anyway. */}
            <div className="space-y-3 rounded-lg border p-4">
              <div>
                <h4 className="font-medium">الخطوط (Extensions)</h4>
                <p className="text-xs text-muted-foreground mt-1">
                  أضف خطوط المستخدم. الخط الافتراضي هو الذي يُستخدم تلقائياً عند الاتصال.
                </p>
              </div>

              {!settings ? (
                <div className="text-sm text-muted-foreground py-4 text-center">
                  احفظ الإعدادات أولاً ثم أضف الخطوط.
                </div>
              ) : (
                <>
                  {extensions.length > 0 && (
                    <div className="border rounded-md">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-right">رقم الخط</TableHead>
                            <TableHead className="text-right">الاسم</TableHead>
                            <TableHead className="text-center w-32">افتراضي</TableHead>
                            <TableHead className="text-center w-16">حذف</TableHead>
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
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => handleDeleteExtension(ext.id)}
                                  className="text-destructive hover:text-destructive"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
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
                      <Label className="text-xs">الاسم (اختياري)</Label>
                      <Input
                        value={newLabel}
                        onChange={(e) => setNewLabel(e.target.value)}
                        placeholder="مكتب"
                      />
                    </div>
                    <Button
                      onClick={handleAddExtension}
                      disabled={addingExtension || !newExtension.trim()}
                      size="sm"
                    >
                      {addingExtension ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Plus className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
