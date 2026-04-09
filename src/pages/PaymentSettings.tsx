import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { CreditCard, Save, Loader2, Shield, TestTube, AlertCircle } from "lucide-react";

interface TranzilaSettings {
  id: string;
  terminal_name: string | null;
  api_password: string | null;
  success_url: string | null;
  fail_url: string | null;
  notify_url: string | null;
  is_enabled: boolean;
  test_mode: boolean;
  sandbox_terminal_name: string | null;
}

export default function PaymentSettings() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isAdmin, isSuperAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<TranzilaSettings | null>(null);
  const [formData, setFormData] = useState({
    terminal_name: "",
    api_password: "",
    success_url: "",
    fail_url: "",
    notify_url: "",
    is_enabled: false,
    test_mode: true,
    sandbox_terminal_name: "demo5964",
  });

  // Redirect if not admin
  useEffect(() => {
    if (!isAdmin && !isSuperAdmin) {
      navigate('/');
    }
  }, [isAdmin, isSuperAdmin, navigate]);

  // Fetch settings
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const { data, error } = await supabase
          .from('payment_settings')
          .select('*')
          .eq('provider', 'tranzila')
          .single();

        if (error && error.code !== 'PGRST116') throw error;

        if (data) {
          setSettings(data);
          setFormData({
            terminal_name: data.terminal_name || "",
            api_password: data.api_password || "",
            success_url: data.success_url || "",
            fail_url: data.fail_url || "",
            notify_url: data.notify_url || "",
            is_enabled: data.is_enabled,
            test_mode: data.test_mode,
            sandbox_terminal_name: data.sandbox_terminal_name || "demo5964",
          });
        }
      } catch (error) {
        console.error('Error fetching payment settings:', error);
        toast({
          title: "خطأ",
          description: "فشل في تحميل إعدادات الدفع",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };

    fetchSettings();
  }, [toast]);

  const handleSave = async () => {
    // Validate required fields if enabled
    if (formData.is_enabled && !formData.terminal_name) {
      toast({
        title: "خطأ",
        description: "يجب إدخال اسم المسوف لتفعيل Tranzila",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from('payment_settings')
        .update({
          terminal_name: formData.terminal_name || null,
          api_password: formData.api_password || null,
          success_url: formData.success_url || null,
          fail_url: formData.fail_url || null,
          notify_url: formData.notify_url || null,
          is_enabled: formData.is_enabled,
          test_mode: formData.test_mode,
          sandbox_terminal_name: formData.sandbox_terminal_name || null,
        })
        .eq('provider', 'tranzila');

      if (error) throw error;

      toast({
        title: "تم الحفظ",
        description: "تم حفظ إعدادات الدفع بنجاح",
      });
    } catch (error) {
      console.error('Error saving payment settings:', error);
      toast({
        title: "خطأ",
        description: "فشل في حفظ الإعدادات",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  // Generate default URLs based on current origin
  const generateDefaultUrls = () => {
    const origin = window.location.origin;
    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    const baseUrl = `https://${projectId}.supabase.co/functions/v1`;
    
    setFormData(f => ({
      ...f,
      success_url: `${origin}/payment/success`,
      fail_url: `${origin}/payment/fail`,
      notify_url: `${baseUrl}/tranzila-webhook`,
    }));
  };

  if (loading) {
    return (
      <MainLayout>
        <div className="p-6 space-y-6">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-[400px] w-full" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <CreditCard className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">إعدادات الدفع</h1>
            <p className="text-muted-foreground">إدارة إعدادات بوابة الدفع Tranzila</p>
          </div>
        </div>

        {/* Main Settings Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              إعدادات Tranzila
            </CardTitle>
            <CardDescription>
              قم بإدخال بيانات حسابك في Tranzila لتفعيل الدفع بالبطاقة
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Enable Toggle */}
            <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/30">
              <div className="space-y-0.5">
                <Label className="text-base font-medium">تفعيل Tranzila</Label>
                <p className="text-sm text-muted-foreground">
                  السماح بالدفع عبر البطاقة الائتمانية
                </p>
              </div>
              <Switch
                checked={formData.is_enabled}
                onCheckedChange={(checked) => setFormData(f => ({ ...f, is_enabled: checked }))}
              />
            </div>

            {/* Test Mode Toggle - only visible for super admin */}
            {isSuperAdmin && (
              <>
                <div className="flex items-center justify-between p-4 border rounded-lg bg-amber-500/10 border-amber-500/20">
                  <div className="flex items-center gap-3">
                    <TestTube className="h-5 w-5 text-amber-600" />
                    <div className="space-y-0.5">
                      <Label className="text-base font-medium">وضع Sandbox (تجريبي)</Label>
                      <p className="text-sm text-muted-foreground">
                        استخدام ترمينال تجريبي - لا يتم خصم أموال حقيقية (فقط لحسابك)
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={formData.test_mode}
                    onCheckedChange={(checked) => setFormData(f => ({ ...f, test_mode: checked }))}
                  />
                </div>

                {formData.test_mode && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="sandbox_terminal_name">
                        اسم الترمينال التجريبي (Sandbox Terminal)
                      </Label>
                      <Input
                        id="sandbox_terminal_name"
                        value={formData.sandbox_terminal_name}
                        onChange={(e) => setFormData(f => ({ ...f, sandbox_terminal_name: e.target.value }))}
                        placeholder="demo5964"
                        className="ltr-input"
                      />
                      <p className="text-xs text-muted-foreground">
                        ترمينال تجريبي من Tranzila - الافتراضي: demo5964
                      </p>
                    </div>

                    <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-700">
                      <AlertCircle className="h-5 w-5 mt-0.5 shrink-0" />
                      <p className="text-sm">
                        وضع Sandbox يفتح نافذة الدفع الحقيقية لكن مع ترمينال تجريبي.
                        <br />
                        لا يتم خصم أموال حقيقية. استخدم بطاقات الاختبار أدناه.
                      </p>
                    </div>
                  </div>
                )}

                {/* Test Cards Info - show when sandbox mode is on */}
                {formData.test_mode && (
                  <div className="p-4 border rounded-lg bg-blue-500/10 border-blue-500/20">
                    <h4 className="font-medium text-blue-700 mb-2 flex items-center gap-2">
                      <CreditCard className="h-4 w-4" />
                      بطاقات تجريبية للاختبار
                    </h4>
                    <div className="text-sm text-blue-600 space-y-1 font-mono ltr-nums">
                      <p>Card: <span className="bg-blue-100 px-2 py-0.5 rounded">4580 4580 4580 4580</span></p>
                      <p>Expiry: Any future date (e.g., 12/29)</p>
                      <p>CVV: <span className="bg-blue-100 px-2 py-0.5 rounded">123</span></p>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Terminal Name */}
            <div className="space-y-2">
              <Label htmlFor="terminal_name">
                اسم المسوف (Terminal Name) <span className="text-destructive">*</span>
              </Label>
              <Input
                id="terminal_name"
                value={formData.terminal_name}
                onChange={(e) => setFormData(f => ({ ...f, terminal_name: e.target.value }))}
                placeholder="اسم الطرفية"
                className="ltr-input"
              />
              <p className="text-xs text-muted-foreground">
                اسم المسوف الخاص بك في Tranzila
              </p>
            </div>

            {/* API Password */}
            <div className="space-y-2">
              <Label htmlFor="api_password">
                سيسمات API للزيכויים והביטולים
              </Label>
              <Input
                id="api_password"
                type="password"
                value={formData.api_password}
                onChange={(e) => setFormData(f => ({ ...f, api_password: e.target.value }))}
                placeholder="••••••••"
                className="ltr-input"
              />
              <p className="text-xs text-muted-foreground">
                يُستخدم فقط لعمليات الإرجاع والإلغاء (اختياري)
              </p>
            </div>

            {/* URLs Section */}
            <div className="space-y-4 pt-4 border-t">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">روابط الاستجابة</h3>
                <Button 
                  type="button" 
                  variant="outline" 
                  size="sm"
                  onClick={generateDefaultUrls}
                >
                  توليد تلقائي
                </Button>
              </div>

              <div className="space-y-2">
                <Label htmlFor="success_url">رابط النجاح (Success URL)</Label>
                <Input
                  id="success_url"
                  value={formData.success_url}
                  onChange={(e) => setFormData(f => ({ ...f, success_url: e.target.value }))}
                  placeholder="https://yoursite.com/payment/success"
                  className="ltr-input text-sm"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="fail_url">رابط الفشل (Fail URL)</Label>
                <Input
                  id="fail_url"
                  value={formData.fail_url}
                  onChange={(e) => setFormData(f => ({ ...f, fail_url: e.target.value }))}
                  placeholder="https://yoursite.com/payment/fail"
                  className="ltr-input text-sm"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="notify_url">رابط الإشعار (Notify URL - Webhook)</Label>
                <Input
                  id="notify_url"
                  value={formData.notify_url}
                  onChange={(e) => setFormData(f => ({ ...f, notify_url: e.target.value }))}
                  placeholder="https://yourproject.supabase.co/functions/v1/tranzila-webhook"
                  className="ltr-input text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  هذا الرابط يُستخدم للتحقق من الدفع (server-to-server)
                </p>
              </div>
            </div>

            {/* Save Button */}
            <div className="flex justify-end pt-4 border-t">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? (
                  <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 ml-2" />
                )}
                حفظ الإعدادات
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
