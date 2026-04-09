import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Mail, Smartphone, Save, Eye, EyeOff, AlertCircle, Send, Loader2, Phone } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PbxExtensionsSection } from "@/components/settings/PbxExtensionsSection";

interface AuthSettingsData {
  id: string;
  email_otp_enabled: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_user: string;
  smtp_password: string;
  email_subject_template: string | null;
  email_body_template: string | null;
  sms_otp_enabled: boolean;
  sms_019_user: string | null;
  sms_019_token: string | null;
  sms_019_source: string | null;
  sms_message_template: string | null;
  // IPPBX settings
  ippbx_enabled: boolean;
  ippbx_token_id: string | null;
}

export default function AuthSettings() {
  const { isAdmin, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingSmtp, setTestingSmtp] = useState(false);
  const [showSmtpPassword, setShowSmtpPassword] = useState(false);
  const [showSmsToken, setShowSmsToken] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  
  const [settings, setSettings] = useState<AuthSettingsData>({
    id: "",
    email_otp_enabled: false,
    smtp_host: "smtp.hostinger.com",
    smtp_port: 465,
    smtp_secure: true,
    smtp_user: "",
    smtp_password: "",
    email_subject_template: "رمز التحقق: {code}",
    email_body_template: "رمز التحقق الخاص بك هو: {code}\n\nهذا الرمز صالح لمدة 5 دقائق.",
    sms_otp_enabled: false,
    sms_019_user: "",
    sms_019_token: "",
    sms_019_source: "",
    sms_message_template: "رمز التحقق الخاص بك هو: {code}",
    ippbx_enabled: false,
    ippbx_token_id: "",
  });

  useEffect(() => {
    if (!authLoading && !isAdmin) {
      navigate("/");
      toast.error("ليس لديك صلاحية الوصول لهذه الصفحة");
    }
  }, [authLoading, isAdmin, navigate]);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const { data, error } = await supabase
        .from("auth_settings")
        .select("*")
        .limit(1)
        .single();

      if (error) {
        if (error.code === "PGRST116") {
          // No settings found, create default
          const { data: newData, error: insertError } = await supabase
            .from("auth_settings")
            .insert({
              smtp_host: "smtp.hostinger.com",
              smtp_port: 465,
              smtp_secure: true,
            })
            .select()
            .single();
          
          if (insertError) throw insertError;
          if (newData) {
            setSettings({
              ...settings,
              id: newData.id,
              ...newData,
            });
          }
        } else {
          throw error;
        }
      } else if (data) {
        setSettings({
          id: data.id,
          email_otp_enabled: data.email_otp_enabled || false,
          smtp_host: (data as any).smtp_host || "smtp.hostinger.com",
          smtp_port: (data as any).smtp_port || 465,
          smtp_secure: (data as any).smtp_secure !== false,
          smtp_user: (data as any).smtp_user || "",
          smtp_password: (data as any).smtp_password || "",
          email_subject_template: data.email_subject_template || "رمز التحقق: {code}",
          email_body_template: data.email_body_template || "رمز التحقق الخاص بك هو: {code}\n\nهذا الرمز صالح لمدة 5 دقائق.",
          sms_otp_enabled: data.sms_otp_enabled || false,
          sms_019_user: data.sms_019_user || "",
          sms_019_token: data.sms_019_token || "",
          sms_019_source: data.sms_019_source || "",
          sms_message_template: data.sms_message_template || "رمز التحقق الخاص بك هو: {code}",
          ippbx_enabled: (data as any).ippbx_enabled || false,
          ippbx_token_id: (data as any).ippbx_token_id || "",
        });
      }
    } catch (error) {
      console.error("Error fetching auth settings:", error);
      toast.error("فشل في تحميل الإعدادات");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("auth_settings")
        .update({
          email_otp_enabled: settings.email_otp_enabled,
          smtp_host: settings.smtp_host || "smtp.hostinger.com",
          smtp_port: settings.smtp_port || 465,
          smtp_secure: settings.smtp_secure,
          smtp_user: settings.smtp_user || null,
          smtp_password: settings.smtp_password || null,
          email_subject_template: settings.email_subject_template,
          email_body_template: settings.email_body_template,
          sms_otp_enabled: settings.sms_otp_enabled,
          sms_019_user: settings.sms_019_user || null,
          sms_019_token: settings.sms_019_token || null,
          sms_019_source: settings.sms_019_source || null,
          sms_message_template: settings.sms_message_template,
          ippbx_enabled: settings.ippbx_enabled,
          ippbx_token_id: settings.ippbx_token_id || null,
        } as any)
        .eq("id", settings.id);

      if (error) throw error;
      toast.success("تم حفظ الإعدادات بنجاح");
    } catch (error) {
      console.error("Error saving auth settings:", error);
      toast.error("فشل في حفظ الإعدادات");
    } finally {
      setSaving(false);
    }
  };

  const handleTestSmtp = async () => {
    if (!testEmail || !testEmail.includes("@")) {
      toast.error("يرجى إدخال بريد إلكتروني صالح للاختبار");
      return;
    }

    // First save settings to ensure latest are used
    await handleSave();

    setTestingSmtp(true);
    try {
      const { data, error } = await supabase.functions.invoke("test-smtp", {
        body: { testEmail },
      });

      if (error) throw error;

      if (data.success) {
        toast.success(data.message || "تم إرسال البريد الاختباري بنجاح");
      } else {
        toast.error(data.error || "فشل في اختبار SMTP");
      }
    } catch (error) {
      console.error("Error testing SMTP:", error);
      toast.error("فشل في اختبار SMTP");
    } finally {
      setTestingSmtp(false);
    }
  };

  if (authLoading || loading) {
    return (
      <MainLayout>
        <div className="p-6 space-y-6">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-96 w-full" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">إعدادات المصادقة</h1>
            <p className="text-muted-foreground">إدارة طرق تسجيل الدخول OTP</p>
          </div>
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            <Save className="h-4 w-4" />
            {saving ? "جاري الحفظ..." : "حفظ الإعدادات"}
          </Button>
        </div>

        <Tabs defaultValue="email" className="w-full">
          <TabsList className="grid w-full max-w-lg grid-cols-3">
            <TabsTrigger value="email" className="gap-2">
              <Mail className="h-4 w-4" />
              البريد الإلكتروني
            </TabsTrigger>
            <TabsTrigger value="sms" className="gap-2">
              <Smartphone className="h-4 w-4" />
              الرسائل النصية
            </TabsTrigger>
            <TabsTrigger value="ippbx" className="gap-2">
              <Phone className="h-4 w-4" />
              الاتصال السريع
            </TabsTrigger>
          </TabsList>

          <TabsContent value="email" className="space-y-4 mt-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>تسجيل الدخول بالبريد الإلكتروني OTP</CardTitle>
                    <CardDescription>
                      إرسال رمز التحقق عبر البريد الإلكتروني (Hostinger SMTP)
                    </CardDescription>
                  </div>
                  <Switch
                    checked={settings.email_otp_enabled}
                    onCheckedChange={(checked) =>
                      setSettings({ ...settings, email_otp_enabled: checked })
                    }
                  />
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    استخدم بيانات SMTP من Hostinger. يمكنك الحصول عليها من لوحة تحكم Hostinger → Email → SMTP Settings
                  </AlertDescription>
                </Alert>

                {/* SMTP Server Settings */}
                <div className="space-y-3 p-4 border rounded-lg bg-muted/30">
                  <h4 className="font-medium text-sm">إعدادات خادم SMTP</h4>
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="space-y-2">
                      <Label htmlFor="smtp_host">خادم SMTP</Label>
                      <Input
                        id="smtp_host"
                        value={settings.smtp_host}
                        onChange={(e) =>
                          setSettings({ ...settings, smtp_host: e.target.value })
                        }
                        placeholder="smtp.hostinger.com"
                        className="ltr-input"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="smtp_port">المنفذ (Port)</Label>
                      <Input
                        id="smtp_port"
                        type="number"
                        value={settings.smtp_port}
                        onChange={(e) =>
                          setSettings({ ...settings, smtp_port: parseInt(e.target.value) || 465 })
                        }
                        placeholder="465"
                        className="ltr-input"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>TLS/SSL</Label>
                      <div className="flex items-center gap-2 h-10">
                        <Switch
                          checked={settings.smtp_secure}
                          onCheckedChange={(checked) =>
                            setSettings({ ...settings, smtp_secure: checked })
                          }
                        />
                        <span className="text-sm text-muted-foreground">
                          {settings.smtp_secure ? "مفعل (موصى به)" : "معطل"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* SMTP Credentials */}
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="smtp_user">البريد الإلكتروني / اسم المستخدم</Label>
                    <Input
                      id="smtp_user"
                      type="email"
                      placeholder="info@yourdomain.com"
                      value={settings.smtp_user}
                      onChange={(e) =>
                        setSettings({ ...settings, smtp_user: e.target.value })
                      }
                      className="ltr-input"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="smtp_password">كلمة المرور</Label>
                    <div className="relative">
                      <Input
                        id="smtp_password"
                        type={showSmtpPassword ? "text" : "password"}
                        placeholder="كلمة مرور البريد"
                        value={settings.smtp_password}
                        onChange={(e) =>
                          setSettings({ ...settings, smtp_password: e.target.value })
                        }
                        className="ltr-input"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute left-0 top-0 h-full px-3"
                        onClick={() => setShowSmtpPassword(!showSmtpPassword)}
                      >
                        {showSmtpPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Test SMTP */}
                <div className="p-4 border rounded-lg bg-muted/30 space-y-3">
                  <h4 className="font-medium text-sm">اختبار إعدادات SMTP</h4>
                  <div className="flex gap-2">
                    <Input
                      type="email"
                      placeholder="أدخل بريد إلكتروني للاختبار"
                      value={testEmail}
                      onChange={(e) => setTestEmail(e.target.value)}
                      className="ltr-input flex-1"
                    />
                    <Button 
                      onClick={handleTestSmtp} 
                      disabled={testingSmtp || !testEmail}
                      variant="outline"
                      className="gap-2"
                    >
                      {testingSmtp ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                      اختبار
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    سيتم إرسال بريد اختباري للتحقق من صحة إعدادات SMTP
                  </p>
                </div>

                {/* Email Templates */}
                <div className="space-y-2">
                  <Label htmlFor="email_subject">عنوان الرسالة</Label>
                  <Input
                    id="email_subject"
                    value={settings.email_subject_template || ""}
                    onChange={(e) =>
                      setSettings({ ...settings, email_subject_template: e.target.value })
                    }
                    placeholder="رمز التحقق: {code}"
                  />
                  <p className="text-xs text-muted-foreground">استخدم {"{code}"} لإدراج رمز التحقق</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email_body">نص الرسالة</Label>
                  <Textarea
                    id="email_body"
                    rows={4}
                    value={settings.email_body_template || ""}
                    onChange={(e) =>
                      setSettings({ ...settings, email_body_template: e.target.value })
                    }
                    placeholder="رمز التحقق الخاص بك هو: {code}"
                  />
                  <p className="text-xs text-muted-foreground">استخدم {"{code}"} لإدراج رمز التحقق</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="sms" className="space-y-4 mt-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>تسجيل الدخول بالرسائل النصية OTP</CardTitle>
                    <CardDescription>
                      إرسال رمز التحقق عبر الرسائل النصية (019)
                    </CardDescription>
                  </div>
                  <Switch
                    checked={settings.sms_otp_enabled}
                    onCheckedChange={(checked) =>
                      setSettings({ ...settings, sms_otp_enabled: checked })
                    }
                  />
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="sms_user">اسم المستخدم (019)</Label>
                    <Input
                      id="sms_user"
                      value={settings.sms_019_user || ""}
                      onChange={(e) =>
                        setSettings({ ...settings, sms_019_user: e.target.value })
                      }
                      className="ltr-input"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sms_token">رمز API</Label>
                    <div className="relative">
                      <Input
                        id="sms_token"
                        type={showSmsToken ? "text" : "password"}
                        value={settings.sms_019_token || ""}
                        onChange={(e) =>
                          setSettings({ ...settings, sms_019_token: e.target.value })
                        }
                        className="ltr-input"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute left-0 top-0 h-full px-3"
                        onClick={() => setShowSmsToken(!showSmsToken)}
                      >
                        {showSmsToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sms_source">مصدر الرسالة</Label>
                    <Input
                      id="sms_source"
                      value={settings.sms_019_source || ""}
                      onChange={(e) =>
                        setSettings({ ...settings, sms_019_source: e.target.value })
                      }
                      className="ltr-input"
                      placeholder="ABInsurance"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="sms_message">نص الرسالة</Label>
                  <Textarea
                    id="sms_message"
                    rows={3}
                    value={settings.sms_message_template || ""}
                    onChange={(e) =>
                      setSettings({ ...settings, sms_message_template: e.target.value })
                    }
                    placeholder="رمز التحقق الخاص بك هو: {code}"
                  />
                  <p className="text-xs text-muted-foreground">استخدم {"{code}"} لإدراج رمز التحقق</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="ippbx" className="space-y-4 mt-6">
            <PbxExtensionsSection
              ippbxEnabled={settings.ippbx_enabled}
              onIppbxEnabledChange={(enabled) =>
                setSettings({ ...settings, ippbx_enabled: enabled })
              }
              ippbxTokenId={settings.ippbx_token_id || ""}
              onTokenIdChange={(tokenId) =>
                setSettings({ ...settings, ippbx_token_id: tokenId })
              }
            />
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
