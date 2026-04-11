import { useState, useEffect } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Settings, Mail, Save, Loader2, Eye, EyeOff, Shield, Send, CheckCircle2, XCircle, HardDrive, CreditCard, Plus, Trash2, GripVertical, Pencil, Bot, Users } from "lucide-react";

function useThiqaPlatformSettings() {
  return useQuery({
    queryKey: ["thiqa-platform-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("thiqa_platform_settings")
        .select("setting_key, setting_value");
      if (error) throw error;
      const map: Record<string, string> = {};
      (data || []).forEach((r) => { map[r.setting_key] = r.setting_value || ""; });
      return map;
    },
  });
}

interface SuperAdmin {
  id: string;
  email: string;
  name: string | null;
  created_at: string;
}

function useSuperAdmins() {
  return useQuery({
    queryKey: ["thiqa-super-admins"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("thiqa_super_admins")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as SuperAdmin[];
    },
  });
}

function GeneralSettingsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useThiqaPlatformSettings();
  const { data: superAdmins = [], isLoading: saLoading } = useSuperAdmins();
  const skipVerification = settings?.skip_email_verification === "true";

  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");

  const toggleMutation = useMutation({
    mutationFn: async (newValue: boolean) => {
      const { error } = await supabase
        .from("thiqa_platform_settings")
        .upsert(
          { setting_key: "skip_email_verification", setting_value: String(newValue), updated_at: new Date().toISOString() },
          { onConflict: "setting_key" }
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["thiqa-platform-settings"] });
      toast({ title: "تم الحفظ", description: "تم تحديث الإعداد بنجاح" });
    },
    onError: () => {
      toast({ title: "خطأ", description: "فشل في حفظ الإعداد", variant: "destructive" });
    },
  });

  const addSuperAdminMutation = useMutation({
    mutationFn: async ({ email, name }: { email: string; name: string }) => {
      const { error } = await supabase
        .from("thiqa_super_admins")
        .insert({ email: email.trim().toLowerCase(), name: name.trim() || null });
      if (error) {
        if (error.code === "23505") throw new Error("هذا البريد مضاف مسبقاً");
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["thiqa-super-admins"] });
      setNewEmail("");
      setNewName("");
      toast({ title: "تمت الإضافة", description: "تمت إضافة مدير جديد بنجاح" });
    },
    onError: (err: Error) => {
      toast({ title: "خطأ", description: err.message || "فشل في إضافة المدير", variant: "destructive" });
    },
  });

  const removeSuperAdminMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("thiqa_super_admins")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["thiqa-super-admins"] });
      toast({ title: "تمت الإزالة", description: "تمت إزالة المدير بنجاح" });
    },
    onError: () => {
      toast({ title: "خطأ", description: "فشل في إزالة المدير", variant: "destructive" });
    },
  });

  if (isLoading || saLoading) return <Skeleton className="h-32 w-full" />;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            إعدادات عامة
          </CardTitle>
          <CardDescription>إعدادات التسجيل والتفعيل</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/30">
            <div className="space-y-0.5">
              <Label className="text-base font-medium">تخطي تفعيل البريد الإلكتروني</Label>
              <p className="text-sm text-muted-foreground">
                عند التفعيل، لن يُطلب من الوكلاء الجدد تأكيد بريدهم الإلكتروني عبر OTP
              </p>
            </div>
            <Switch
              checked={skipVerification}
              onCheckedChange={(checked) => toggleMutation.mutate(checked)}
              disabled={toggleMutation.isPending}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            مديرو المنصة (Super Admins)
          </CardTitle>
          <CardDescription>جميع المديرين يحصلون على إشعارات تسجيل الوكلاء الجدد عبر البريد</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Existing super admins */}
          <div className="space-y-2">
            {superAdmins.map((sa) => (
              <div key={sa.id} className="flex items-center justify-between p-3 border rounded-lg bg-muted/20">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center">
                    <Shield className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{sa.name || "بدون اسم"}</p>
                    <p className="text-xs text-muted-foreground" dir="ltr">{sa.email}</p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => {
                    if (superAdmins.length <= 1) {
                      toast({ title: "تنبيه", description: "لا يمكن حذف آخر مدير", variant: "destructive" });
                      return;
                    }
                    removeSuperAdminMutation.mutate(sa.id);
                  }}
                  disabled={removeSuperAdminMutation.isPending}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

          <Separator />

          {/* Add new super admin */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">إضافة مدير جديد</Label>
            <div className="flex gap-2">
              <Input
                type="text"
                placeholder="الاسم"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="flex-[0.4]"
              />
              <Input
                type="email"
                dir="ltr"
                placeholder="admin@example.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="flex-[0.6]"
              />
              <Button
                onClick={() => addSuperAdminMutation.mutate({ email: newEmail, name: newName })}
                disabled={!newEmail.includes("@") || addSuperAdminMutation.isPending}
              >
                {addSuperAdminMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 ml-2" />}
                إضافة
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface SmtpForm {
  smtp_host: string;
  smtp_port: string;
  smtp_user: string;
  smtp_password: string;
  smtp_sender_name: string;
}

function SmtpSettingsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useThiqaPlatformSettings();
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState<SmtpForm>({
    smtp_host: "",
    smtp_port: "465",
    smtp_user: "",
    smtp_password: "",
    smtp_sender_name: "Thiqa Insurance",
  });

  useEffect(() => {
    if (settings) {
      setForm({
        smtp_host: settings.smtp_host || "smtp.hostinger.com",
        smtp_port: settings.smtp_port || "465",
        smtp_user: settings.smtp_user || "",
        smtp_password: settings.smtp_password || "",
        smtp_sender_name: settings.smtp_sender_name || "Thiqa Insurance",
      });
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async (formData: SmtpForm) => {
      for (const [key, value] of Object.entries(formData)) {
        const { error } = await supabase
          .from("thiqa_platform_settings")
          .update({ setting_value: value, updated_at: new Date().toISOString() })
          .eq("setting_key", key);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["thiqa-platform-settings"] });
      toast({ title: "تم الحفظ", description: "تم حفظ إعدادات SMTP بنجاح" });
    },
    onError: () => {
      toast({ title: "خطأ", description: "فشل في حفظ الإعدادات", variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5" />
          إعدادات SMTP للمنصة
        </CardTitle>
        <CardDescription>
          إعدادات البريد الإلكتروني المستخدم لإرسال رسائل التحقق والتفعيل
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="smtp_host">خادم SMTP (Host)</Label>
            <Input
              id="smtp_host"
              value={form.smtp_host}
              onChange={(e) => setForm(f => ({ ...f, smtp_host: e.target.value }))}
              placeholder="smtp.hostinger.com"
              className="ltr-input"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="smtp_port">المنفذ (Port)</Label>
            <Input
              id="smtp_port"
              value={form.smtp_port}
              onChange={(e) => setForm(f => ({ ...f, smtp_port: e.target.value }))}
              placeholder="465"
              className="ltr-input"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="smtp_user">البريد الإلكتروني (SMTP User)</Label>
          <Input
            id="smtp_user"
            type="email"
            value={form.smtp_user}
            onChange={(e) => setForm(f => ({ ...f, smtp_user: e.target.value }))}
            placeholder="noreply@thiqa.app"
            className="ltr-input"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="smtp_password">كلمة المرور (SMTP Password)</Label>
          <div className="relative">
            <Input
              id="smtp_password"
              type={showPassword ? "text" : "password"}
              value={form.smtp_password}
              onChange={(e) => setForm(f => ({ ...f, smtp_password: e.target.value }))}
              placeholder="••••••••"
              className="ltr-input pe-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="smtp_sender_name">اسم المرسل</Label>
          <Input
            id="smtp_sender_name"
            value={form.smtp_sender_name}
            onChange={(e) => setForm(f => ({ ...f, smtp_sender_name: e.target.value }))}
            placeholder="Thiqa Insurance"
          />
        </div>

        <div className="flex justify-end pt-4 border-t">
          <Button
            onClick={() => saveMutation.mutate(form)}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? (
              <Loader2 className="h-4 w-4 ml-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 ml-2" />
            )}
            حفظ الإعدادات
          </Button>
        </div>

        <SmtpTestSection />
      </CardContent>
    </Card>
  );
}

function SmtpTestSection() {
  const { toast } = useToast();
  const [testEmail, setTestEmail] = useState("");
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const testMutation = useMutation({
    mutationFn: async (email: string) => {
      const { data, error } = await supabase.functions.invoke("test-platform-smtp", {
        body: { testEmail: email },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "فشل الاختبار");
      return data;
    },
    onSuccess: (data) => {
      setTestResult({ success: true, message: data.message });
      toast({ title: "نجح الاختبار ✅", description: data.message });
    },
    onError: (err: Error) => {
      setTestResult({ success: false, message: err.message });
      toast({ title: "فشل الاختبار", description: err.message, variant: "destructive" });
    },
  });

  return (
    <>
      <Separator className="my-6" />
      <div className="space-y-4">
        <div>
          <h3 className="text-base font-semibold flex items-center gap-2">
            <Send className="h-4 w-4" />
            اختبار إعدادات البريد
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            أرسل رسالة تجريبية للتأكد من أن إعدادات SMTP تعمل بشكل صحيح
          </p>
        </div>

        <div className="flex gap-3 items-end">
          <div className="flex-1 space-y-2">
            <Label htmlFor="test_email">بريد المستلم</Label>
            <Input
              id="test_email"
              type="email"
              value={testEmail}
              onChange={(e) => { setTestEmail(e.target.value); setTestResult(null); }}
              placeholder="example@email.com"
              className="ltr-input"
            />
          </div>
          <Button
            onClick={() => testMutation.mutate(testEmail)}
            disabled={testMutation.isPending || !testEmail.includes("@")}
            variant="outline"
            className="h-10"
          >
            {testMutation.isPending ? (
              <Loader2 className="h-4 w-4 ml-2 animate-spin" />
            ) : (
              <Send className="h-4 w-4 ml-2" />
            )}
            إرسال اختبار
          </Button>
        </div>

        {testResult && (
          <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
            testResult.success 
              ? "bg-success/10 text-success border border-success/20" 
              : "bg-destructive/10 text-destructive border border-destructive/20"
          }`}>
            {testResult.success ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
            {testResult.message}
          </div>
        )}
      </div>
    </>
  );
}

interface BunnyCdnForm {
  bunny_cdn_url: string;
  bunny_storage_zone: string;
  bunny_api_key: string;
}

function StorageSettingsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useThiqaPlatformSettings();
  const [showApiKey, setShowApiKey] = useState(false);
  const [form, setForm] = useState<BunnyCdnForm>({
    bunny_cdn_url: "",
    bunny_storage_zone: "",
    bunny_api_key: "",
  });

  useEffect(() => {
    if (settings) {
      setForm({
        bunny_cdn_url: settings.bunny_cdn_url || "",
        bunny_storage_zone: settings.bunny_storage_zone || "",
        bunny_api_key: settings.bunny_api_key || "",
      });
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async (formData: BunnyCdnForm) => {
      for (const [key, value] of Object.entries(formData)) {
        const { error } = await supabase
          .from("thiqa_platform_settings")
          .upsert(
            { setting_key: key, setting_value: value, updated_at: new Date().toISOString() },
            { onConflict: "setting_key" }
          );
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["thiqa-platform-settings"] });
      toast({ title: "تم الحفظ", description: "تم حفظ إعدادات التخزين بنجاح" });
    },
    onError: () => {
      toast({ title: "خطأ", description: "فشل في حفظ الإعدادات", variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HardDrive className="h-5 w-5" />
          إعدادات التخزين (Bunny CDN)
        </CardTitle>
        <CardDescription>
          إعدادات تخزين الملفات وشبكة توصيل المحتوى
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="bunny_cdn_url">رابط CDN</Label>
          <Input
            id="bunny_cdn_url"
            value={form.bunny_cdn_url}
            onChange={(e) => setForm(f => ({ ...f, bunny_cdn_url: e.target.value }))}
            placeholder="https://kareem.b-cdn.net"
            className="ltr-input"
            dir="ltr"
          />
          <p className="text-xs text-muted-foreground">رابط شبكة توصيل المحتوى (مثال: https://kareem.b-cdn.net)</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="bunny_storage_zone">منطقة التخزين (Storage Zone)</Label>
          <Input
            id="bunny_storage_zone"
            value={form.bunny_storage_zone}
            onChange={(e) => setForm(f => ({ ...f, bunny_storage_zone: e.target.value }))}
            placeholder="kareem"
            className="ltr-input"
            dir="ltr"
          />
          <p className="text-xs text-muted-foreground">اسم منطقة التخزين في Bunny (مثال: kareem)</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="bunny_api_key">مفتاح API</Label>
          <div className="relative">
            <Input
              id="bunny_api_key"
              type={showApiKey ? "text" : "password"}
              value={form.bunny_api_key}
              onChange={(e) => setForm(f => ({ ...f, bunny_api_key: e.target.value }))}
              placeholder="••••••••"
              className="ltr-input pe-10"
              dir="ltr"
            />
            <button
              type="button"
              onClick={() => setShowApiKey(!showApiKey)}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">مفتاح API الخاص بمنطقة التخزين (Storage Zone Password)</p>
        </div>

        <div className="flex justify-end pt-4 border-t">
          <Button
            onClick={() => saveMutation.mutate(form)}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? (
              <Loader2 className="h-4 w-4 ml-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 ml-2" />
            )}
            حفظ الإعدادات
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Plans Settings Tab ───

interface PlanFeature {
  text: string;
  info: boolean;
}

interface SubscriptionPlan {
  id: string;
  plan_key: string;
  name: string;
  name_ar: string | null;
  description: string | null;
  monthly_price: number;
  yearly_price: number;
  badge: string | null;
  features: PlanFeature[];
  default_features: Record<string, boolean>;
  sort_order: number;
  is_active: boolean;
}

const SYSTEM_FEATURES = [
  { key: 'sms', label: 'إرسال SMS' },
  { key: 'financial_reports', label: 'التقارير المالية' },
  { key: 'broker_wallet', label: 'محفظة الوسطاء' },
  { key: 'company_settlement', label: 'تسويات الشركات' },
  { key: 'expenses', label: 'السندات والمصروفات' },
  { key: 'cheques', label: 'الشيكات' },
  { key: 'leads', label: 'Whatsapp Leads' },
  { key: 'accident_reports', label: 'بلاغات الحوادث' },
  { key: 'repair_claims', label: 'المطالبات' },
  { key: 'marketing_sms', label: 'SMS تسويقية' },
  { key: 'road_services', label: 'خدمات الطريق' },
  { key: 'accident_fees', label: 'رسوم الحوادث' },
  { key: 'correspondence', label: 'الترويسات' },
  { key: 'receipts', label: 'الإيصالات' },
  { key: 'accounting', label: 'المحاسبة' },
  { key: 'renewal_reports', label: 'تقارير التجديد' },
  { key: 'ai_assistant', label: 'المساعد الذكي (ثاقب)' },
  { key: 'ippbx', label: 'Click2Call / PBX' },
];

function PlansSettingsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editPlan, setEditPlan] = useState<SubscriptionPlan | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: plans, isLoading } = useQuery({
    queryKey: ["subscription-plans"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscription_plans")
        .select("*")
        .order("sort_order");
      if (error) throw error;
      return (data || []).map((p: any) => ({
        ...p,
        default_features: (typeof p.default_features === 'string' ? JSON.parse(p.default_features) : p.default_features) || {},
        features: (typeof p.features === 'string' ? JSON.parse(p.features) : p.features) || [],
      })) as SubscriptionPlan[];
    },
  });

  const openEdit = (plan: SubscriptionPlan) => {
    setEditPlan({ ...plan, features: [...plan.features] });
    setDialogOpen(true);
  };

  const openNew = () => {
    setEditPlan({
      id: "",
      plan_key: "",
      name: "",
      name_ar: "",
      description: "",
      monthly_price: 0,
      yearly_price: 0,
      badge: null,
      features: [],
      default_features: {},
      sort_order: (plans?.length || 0) + 1,
      is_active: true,
    });
    setDialogOpen(true);
  };

  const savePlan = async () => {
    if (!editPlan || !editPlan.plan_key || !editPlan.name) {
      toast({ title: "خطأ", description: "يرجى تعبئة المفتاح والاسم", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        plan_key: editPlan.plan_key,
        name: editPlan.name,
        name_ar: editPlan.name_ar || null,
        description: editPlan.description || null,
        monthly_price: editPlan.monthly_price,
        yearly_price: editPlan.yearly_price,
        badge: editPlan.badge || null,
        features: editPlan.features as unknown as Json,
        default_features: editPlan.default_features as unknown as Json,
        sort_order: editPlan.sort_order,
        is_active: editPlan.is_active,
      };

      if (editPlan.id) {
        const { error } = await supabase
          .from("subscription_plans")
          .update(payload)
          .eq("id", editPlan.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("subscription_plans")
          .insert(payload);
        if (error) throw error;
      }

      queryClient.invalidateQueries({ queryKey: ["subscription-plans"] });
      setDialogOpen(false);
      toast({ title: "تم الحفظ", description: "تم حفظ الخطة بنجاح" });
    } catch (e: any) {
      toast({ title: "خطأ", description: e.message || "فشل في الحفظ", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const deletePlan = async (id: string) => {
    if (!confirm("هل أنت متأكد من حذف هذه الخطة؟")) return;
    const { error } = await supabase.from("subscription_plans").delete().eq("id", id);
    if (error) {
      toast({ title: "خطأ", description: error.message, variant: "destructive" });
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["subscription-plans"] });
    toast({ title: "تم الحذف" });
  };

  const addFeature = () => {
    if (!editPlan) return;
    setEditPlan({ ...editPlan, features: [...editPlan.features, { text: "", info: false }] });
  };

  const removeFeature = (idx: number) => {
    if (!editPlan) return;
    setEditPlan({ ...editPlan, features: editPlan.features.filter((_, i) => i !== idx) });
  };

  const updateFeature = (idx: number, field: keyof PlanFeature, value: any) => {
    if (!editPlan) return;
    const updated = [...editPlan.features];
    updated[idx] = { ...updated[idx], [field]: value };
    setEditPlan({ ...editPlan, features: updated });
  };

  if (isLoading) return <Skeleton className="h-32 w-full" />;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                خطط الاشتراك
              </CardTitle>
              <CardDescription>إدارة خطط الأسعار والميزات — تظهر في صفحة /pricing وفي إعدادات الوكيل</CardDescription>
            </div>
            <Button size="sm" onClick={openNew}>
              <Plus className="h-4 w-4 ml-1" />
              خطة جديدة
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {(plans || []).map((plan) => (
              <div key={plan.id} className="flex items-center gap-3 p-4 border rounded-lg">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-base">{plan.name}</span>
                    {plan.name_ar && <span className="text-muted-foreground text-sm">({plan.name_ar})</span>}
                    {plan.badge && <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">{plan.badge}</span>}
                    {!plan.is_active && <span className="text-xs bg-destructive/10 text-destructive px-2 py-0.5 rounded">معطل</span>}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">
                    ₪{plan.monthly_price}/شهر — ₪{plan.yearly_price}/سنوي — {plan.features.length} ميزة — المفتاح: {plan.plan_key}
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => openEdit(plan)}>
                  <Pencil className="h-3.5 w-3.5 ml-1" />
                  تعديل
                </Button>
                <Button variant="ghost" size="sm" className="text-destructive" onClick={() => deletePlan(plan.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            {(!plans || plans.length === 0) && (
              <p className="text-center text-muted-foreground py-8">لا توجد خطط بعد</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Edit/Create Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>{editPlan?.id ? "تعديل الخطة" : "إنشاء خطة جديدة"}</DialogTitle>
          </DialogHeader>
          {editPlan && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>المفتاح (plan_key)</Label>
                  <Input
                    value={editPlan.plan_key}
                    onChange={(e) => setEditPlan({ ...editPlan, plan_key: e.target.value })}
                    placeholder="basic"
                    dir="ltr"
                    disabled={!!editPlan.id}
                  />
                </div>
                <div className="space-y-2">
                  <Label>الاسم (English)</Label>
                  <Input
                    value={editPlan.name}
                    onChange={(e) => setEditPlan({ ...editPlan, name: e.target.value })}
                    placeholder="Basic"
                    dir="ltr"
                  />
                </div>
                <div className="space-y-2">
                  <Label>الاسم (عربي)</Label>
                  <Input
                    value={editPlan.name_ar || ""}
                    onChange={(e) => setEditPlan({ ...editPlan, name_ar: e.target.value })}
                    placeholder="الأساسي"
                  />
                </div>
                <div className="space-y-2">
                  <Label>الشارة (Badge)</Label>
                  <Input
                    value={editPlan.badge || ""}
                    onChange={(e) => setEditPlan({ ...editPlan, badge: e.target.value })}
                    placeholder="الأكثر شعبية"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>الوصف</Label>
                <Textarea
                  value={editPlan.description || ""}
                  onChange={(e) => setEditPlan({ ...editPlan, description: e.target.value })}
                  placeholder="مناسب لوكالات التأمين..."
                  rows={2}
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>السعر الشهري (₪)</Label>
                  <Input
                    type="number"
                    value={editPlan.monthly_price}
                    onChange={(e) => setEditPlan({ ...editPlan, monthly_price: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>السعر السنوي (₪)</Label>
                  <Input
                    type="number"
                    value={editPlan.yearly_price}
                    onChange={(e) => setEditPlan({ ...editPlan, yearly_price: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>الترتيب</Label>
                  <Input
                    type="number"
                    value={editPlan.sort_order}
                    onChange={(e) => setEditPlan({ ...editPlan, sort_order: Number(e.target.value) })}
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  checked={editPlan.is_active}
                  onCheckedChange={(v) => setEditPlan({ ...editPlan, is_active: v })}
                />
                <Label>فعالة</Label>
              </div>

              <Separator />

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-base font-semibold">الميزات</Label>
                  <Button variant="outline" size="sm" onClick={addFeature}>
                    <Plus className="h-3.5 w-3.5 ml-1" />
                    إضافة ميزة
                  </Button>
                </div>
                {editPlan.features.map((f, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      className="flex-1"
                      value={f.text}
                      onChange={(e) => updateFeature(i, "text", e.target.value)}
                      placeholder="وصف الميزة..."
                    />
                    <div className="flex items-center gap-1">
                      <Switch
                        checked={f.info}
                        onCheckedChange={(v) => updateFeature(i, "info", v)}
                      />
                      <span className="text-xs text-muted-foreground whitespace-nowrap">info</span>
                    </div>
                    <Button variant="ghost" size="sm" className="text-destructive shrink-0" onClick={() => removeFeature(i)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>

              <Separator />

              <div className="space-y-3">
                <Label className="text-base font-semibold">الميزات المفعّلة تلقائياً لهذه الخطة</Label>
                <p className="text-xs text-muted-foreground">عند اشتراك وكيل في هذه الخطة، سيتم تفعيل الميزات المحددة تلقائياً</p>
                <div className="grid grid-cols-2 gap-2">
                  {SYSTEM_FEATURES.map(feat => (
                    <div key={feat.key} className="flex items-center justify-between p-2 border rounded-lg">
                      <span className="text-sm">{feat.label}</span>
                      <Switch
                        checked={editPlan.default_features[feat.key] ?? false}
                        onCheckedChange={(v) => setEditPlan({
                          ...editPlan,
                          default_features: { ...editPlan.default_features, [feat.key]: v }
                        })}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>إلغاء</Button>
            <Button onClick={savePlan} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 ml-2 animate-spin" /> : <Save className="h-4 w-4 ml-2" />}
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AiAssistantSettingsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useThiqaPlatformSettings();
  const [prompt, setPrompt] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings?.ai_assistant_prompt) {
      setPrompt(settings.ai_assistant_prompt);
    }
  }, [settings]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data: existing } = await supabase
        .from("thiqa_platform_settings")
        .select("id")
        .eq("setting_key", "ai_assistant_prompt")
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from("thiqa_platform_settings")
          .update({ setting_value: prompt || null })
          .eq("setting_key", "ai_assistant_prompt");
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("thiqa_platform_settings")
          .insert({ setting_key: "ai_assistant_prompt", setting_value: prompt || null });
        if (error) throw error;
      }

      queryClient.invalidateQueries({ queryKey: ["thiqa-platform-settings"] });
      toast({ title: "تم الحفظ", description: "تم حفظ تعليمات المساعد الذكي بنجاح" });
    } catch (err: any) {
      toast({ title: "خطأ", description: err.message || "فشل في الحفظ", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="h-5 w-5" />
          تعليمات المساعد الذكي (ثاقب)
        </CardTitle>
        <CardDescription>
          أضف تعليمات وقواعد عامة للمساعد الذكي. هذه التعليمات تُطبق على جميع الوكلاء وتُضاف إلى التعليمات الافتراضية.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="p-3 bg-muted/50 rounded-lg text-sm text-muted-foreground" dir="rtl">
          <strong>التعليمات الافتراضية المدمجة:</strong> ثاقب يجيب بالعربية، يعتمد على البيانات فقط، لا يخترع معلومات، ويفرّق بين صلاحيات المدير والعامل تلقائيًا.
        </div>
        <div>
          <Label>تعليمات إضافية</Label>
          <Textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="مثال: عند سؤال العميل عن وثيقة، اعرض تاريخ الانتهاء دائمًا. لا تعرض أرقام الهواتف. كن مختصرًا جدًا..."
            className="min-h-[200px] mt-2 text-right"
            dir="rtl"
          />
        </div>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 ml-1 animate-spin" /> : <Save className="h-4 w-4 ml-1" />}
          حفظ التعليمات
        </Button>
      </CardContent>
    </Card>
  );
}

function AgentDefaultsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useThiqaPlatformSettings();
  const [form, setForm] = useState({
    default_sms_019_user: "",
    default_sms_019_token: "",
    default_sms_019_source: "",
    default_agent_smtp_host: "",
    default_agent_smtp_port: "465",
    default_agent_smtp_user: "",
    default_agent_smtp_password: "",
    default_sms_limit_type: "monthly",
    default_sms_limit_count: "100",
    default_ai_limit_type: "monthly",
    default_ai_limit_count: "100",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showToken, setShowToken] = useState(false);

  useEffect(() => {
    if (settings) {
      setForm({
        default_sms_019_user: settings.default_sms_019_user || "",
        default_sms_019_token: settings.default_sms_019_token || "",
        default_sms_019_source: settings.default_sms_019_source || "",
        default_agent_smtp_host: settings.default_agent_smtp_host || "",
        default_agent_smtp_port: settings.default_agent_smtp_port || "465",
        default_agent_smtp_user: settings.default_agent_smtp_user || "",
        default_agent_smtp_password: settings.default_agent_smtp_password || "",
        default_sms_limit_type: settings.default_sms_limit_type || "monthly",
        default_sms_limit_count: settings.default_sms_limit_count || "100",
        default_ai_limit_type: settings.default_ai_limit_type || "monthly",
        default_ai_limit_count: settings.default_ai_limit_count || "100",
      });
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      for (const [key, value] of Object.entries(form)) {
        await supabase.from("thiqa_platform_settings").upsert(
          { setting_key: key, setting_value: value, updated_at: new Date().toISOString() },
          { onConflict: "setting_key" }
        );
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["thiqa-platform-settings"] });
      toast({ title: "تم الحفظ", description: "تم حفظ الإعدادات الافتراضية" });
    },
    onError: () => {
      toast({ title: "خطأ", description: "فشل في الحفظ", variant: "destructive" });
    },
  });

  if (isLoading) return <Skeleton className="h-40 w-full" />;

  return (
    <div className="space-y-4">
      {/* Default SMS 019 Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            إعدادات SMS الافتراضية (019)
          </CardTitle>
          <CardDescription>ستُطبق تلقائياً على الوكلاء الجدد</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>اسم المستخدم (019)</Label>
              <Input value={form.default_sms_019_user} onChange={e => setForm(f => ({ ...f, default_sms_019_user: e.target.value }))} dir="ltr" />
            </div>
            <div className="space-y-2">
              <Label>Token (019)</Label>
              <div className="relative">
                <Input type={showToken ? "text" : "password"} value={form.default_sms_019_token} onChange={e => setForm(f => ({ ...f, default_sms_019_token: e.target.value }))} dir="ltr" className="pe-10" />
                <button type="button" onClick={() => setShowToken(!showToken)} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>رقم المصدر الافتراضي</Label>
              <Input value={form.default_sms_019_source} onChange={e => setForm(f => ({ ...f, default_sms_019_source: e.target.value }))} dir="ltr" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Default Agent SMTP */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            SMTP افتراضي للوكلاء
          </CardTitle>
          <CardDescription>إعدادات البريد الإلكتروني الافتراضية للوكلاء الجدد</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>SMTP Host</Label>
              <Input value={form.default_agent_smtp_host} onChange={e => setForm(f => ({ ...f, default_agent_smtp_host: e.target.value }))} dir="ltr" placeholder="smtp.hostinger.com" />
            </div>
            <div className="space-y-2">
              <Label>SMTP Port</Label>
              <Input value={form.default_agent_smtp_port} onChange={e => setForm(f => ({ ...f, default_agent_smtp_port: e.target.value }))} dir="ltr" placeholder="465" />
            </div>
            <div className="space-y-2">
              <Label>SMTP User</Label>
              <Input value={form.default_agent_smtp_user} onChange={e => setForm(f => ({ ...f, default_agent_smtp_user: e.target.value }))} dir="ltr" placeholder="noreply@example.com" />
            </div>
            <div className="space-y-2">
              <Label>SMTP Password</Label>
              <div className="relative">
                <Input type={showPassword ? "text" : "password"} value={form.default_agent_smtp_password} onChange={e => setForm(f => ({ ...f, default_agent_smtp_password: e.target.value }))} dir="ltr" className="pe-10" />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Default Usage Limits */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            حدود الاستخدام الافتراضية
          </CardTitle>
          <CardDescription>الحدود التي ستُطبق على الوكلاء الجدد تلقائياً</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="border rounded-lg p-4 space-y-3">
              <Label className="font-bold">حدود SMS</Label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">النوع</Label>
                  <Select value={form.default_sms_limit_type} onValueChange={v => setForm(f => ({ ...f, default_sms_limit_type: v }))}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">شهري</SelectItem>
                      <SelectItem value="yearly">سنوي</SelectItem>
                      <SelectItem value="unlimited">غير محدود</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {form.default_sms_limit_type !== 'unlimited' && (
                  <div>
                    <Label className="text-xs">العدد</Label>
                    <Input type="number" className="h-8 text-xs" value={form.default_sms_limit_count} onChange={e => setForm(f => ({ ...f, default_sms_limit_count: e.target.value }))} />
                  </div>
                )}
              </div>
            </div>
            <div className="border rounded-lg p-4 space-y-3">
              <Label className="font-bold">حدود المساعد الذكي</Label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">النوع</Label>
                  <Select value={form.default_ai_limit_type} onValueChange={v => setForm(f => ({ ...f, default_ai_limit_type: v }))}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">شهري</SelectItem>
                      <SelectItem value="yearly">سنوي</SelectItem>
                      <SelectItem value="unlimited">غير محدود</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {form.default_ai_limit_type !== 'unlimited' && (
                  <div>
                    <Label className="text-xs">العدد</Label>
                    <Input type="number" className="h-8 text-xs" value={form.default_ai_limit_count} onChange={e => setForm(f => ({ ...f, default_ai_limit_count: e.target.value }))} />
                  </div>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
        {saveMutation.isPending ? <Loader2 className="h-4 w-4 ml-2 animate-spin" /> : <Save className="h-4 w-4 ml-2" />}
        حفظ الإعدادات الافتراضية
      </Button>
    </div>
  );
}

export default function ThiqaSettings() {
  return (
    <MainLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Settings className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">إعدادات المنصة</h1>
            <p className="text-muted-foreground">إدارة إعدادات منصة ثقة</p>
          </div>
        </div>

        <Tabs defaultValue="general" className="w-full">
          <TabsList>
            <TabsTrigger value="general" className="gap-2">
              <Shield className="h-4 w-4" />
              عام
            </TabsTrigger>
            <TabsTrigger value="smtp" className="gap-2">
              <Mail className="h-4 w-4" />
              البريد الإلكتروني
            </TabsTrigger>
            <TabsTrigger value="storage" className="gap-2">
              <HardDrive className="h-4 w-4" />
              التخزين
            </TabsTrigger>
            <TabsTrigger value="plans" className="gap-2">
              <CreditCard className="h-4 w-4" />
              الخطط والأسعار
            </TabsTrigger>
            <TabsTrigger value="ai" className="gap-2">
              <Bot className="h-4 w-4" />
              المساعد الذكي
            </TabsTrigger>
            <TabsTrigger value="agent-defaults" className="gap-2">
              <Settings className="h-4 w-4" />
              إعدادات الوكلاء
            </TabsTrigger>
          </TabsList>

          <TabsContent value="general">
            <GeneralSettingsTab />
          </TabsContent>

          <TabsContent value="smtp">
            <SmtpSettingsTab />
          </TabsContent>

          <TabsContent value="storage">
            <StorageSettingsTab />
          </TabsContent>

          <TabsContent value="plans">
            <PlansSettingsTab />
          </TabsContent>

          <TabsContent value="ai">
            <AiAssistantSettingsTab />
          </TabsContent>

          <TabsContent value="agent-defaults">
            <AgentDefaultsTab />
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}