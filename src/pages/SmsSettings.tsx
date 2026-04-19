import { useState, useEffect } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Header } from "@/components/layout/Header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { extractFunctionErrorMessage, toastFunctionError } from "@/lib/functionError";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Save, Loader2, MessageSquare, Send, Settings2, FileSignature, Image, Upload, X, Building2, Plus, Trash2 } from "lucide-react";
import { Navigate } from "react-router-dom";
import { createSafeHtml } from "@/lib/sanitize";

interface SmsSettings {
  id?: string;
  provider: string;
  sms_user: string;
  sms_token: string;
  sms_source: string;
  is_enabled: boolean;
  invoice_sms_template?: string | null;
  signature_sms_template?: string | null;
  reminder_1month_template?: string | null;
  reminder_1week_template?: string | null;
  payment_request_template?: string | null;
  enable_auto_reminders?: boolean;
  birthday_sms_enabled?: boolean;
  birthday_sms_template?: string | null;
  license_expiry_sms_enabled?: boolean;
  license_expiry_sms_template?: string | null;
}

interface PhoneLink {
  phone: string;
  href: string;
}

interface CompanySettings {
  company_email: string;
  company_phone_links: PhoneLink[];
  company_location: string;
}

interface SignaturePageSettings {
  logo_url: string;
  header_html: string;
  body_html: string;
  footer_html: string;
}

export default function SmsSettings() {
  const { toast } = useToast();
  const { isAdmin, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [uploadingLogo, setUploadingLogo] = useState(false);
  
  const [settings, setSettings] = useState<SmsSettings>({
    provider: "019sms",
    sms_user: "",
    sms_token: "",
    sms_source: "",
    is_enabled: false,
    invoice_sms_template: null,
    signature_sms_template: null,
    reminder_1month_template: null,
    reminder_1week_template: null,
    payment_request_template: null,
    enable_auto_reminders: false,
    birthday_sms_enabled: false,
    birthday_sms_template: null,
    license_expiry_sms_enabled: false,
    license_expiry_sms_template: null,
  });

  const [signaturePageSettings, setSignaturePageSettings] = useState<SignaturePageSettings>({
    logo_url: "",
    header_html: "",
    body_html: "",
    footer_html: "",
  });
  
  const [signatureTemplateId, setSignatureTemplateId] = useState<string | null>(null);
  
  const [companySettings, setCompanySettings] = useState<CompanySettings>({
    company_email: "",
    company_phone_links: [],
    company_location: "",
  });
  const [newPhoneNumber, setNewPhoneNumber] = useState("");
  const [newPhoneHref, setNewPhoneHref] = useState("");

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("sms_settings")
        .select("*, invoice_templates:default_signature_template_id(*)")
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      if (data) {
        setSettings({
          id: data.id,
          provider: data.provider || "019sms",
          sms_user: data.sms_user || "",
          sms_token: data.sms_token || "",
          sms_source: data.sms_source || "",
          is_enabled: data.is_enabled || false,
          invoice_sms_template: data.invoice_sms_template ?? null,
          signature_sms_template: data.signature_sms_template ?? null,
          reminder_1month_template: data.reminder_1month_template ?? null,
          reminder_1week_template: data.reminder_1week_template ?? null,
          payment_request_template: data.payment_request_template ?? null,
          enable_auto_reminders: data.enable_auto_reminders ?? false,
          birthday_sms_enabled: data.birthday_sms_enabled ?? false,
          birthday_sms_template: data.birthday_sms_template ?? null,
          license_expiry_sms_enabled: data.license_expiry_sms_enabled ?? false,
          license_expiry_sms_template: data.license_expiry_sms_template ?? null,
        });
        
        // Load company settings
        setCompanySettings({
          company_email: data.company_email || "",
          company_phone_links: Array.isArray(data.company_phone_links) ? (data.company_phone_links as unknown as PhoneLink[]) : [],
          company_location: data.company_location || "",
        });

        // Load signature template settings
        if (data.default_signature_template_id && data.invoice_templates) {
          const template = data.invoice_templates as any;
          setSignatureTemplateId(data.default_signature_template_id);
          setSignaturePageSettings({
            logo_url: template.logo_url || "",
            header_html: template.header_html || "",
            body_html: template.body_html || "",
            footer_html: template.footer_html || "",
          });
        }
      }
    } catch (error) {
      console.error("Error fetching SMS settings:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (settings.id) {
        // Update existing
        const { error } = await supabase
          .from("sms_settings")
          .update({
            sms_user: settings.sms_user,
            sms_token: settings.sms_token,
            sms_source: settings.sms_source,
            is_enabled: settings.is_enabled,
            invoice_sms_template: settings.invoice_sms_template ?? null,
            signature_sms_template: settings.signature_sms_template ?? null,
            reminder_1month_template: settings.reminder_1month_template ?? null,
            reminder_1week_template: settings.reminder_1week_template ?? null,
            payment_request_template: settings.payment_request_template ?? null,
            enable_auto_reminders: settings.enable_auto_reminders ?? false,
            birthday_sms_enabled: settings.birthday_sms_enabled ?? false,
            birthday_sms_template: settings.birthday_sms_template ?? null,
            license_expiry_sms_enabled: settings.license_expiry_sms_enabled ?? false,
            license_expiry_sms_template: settings.license_expiry_sms_template ?? null,
            company_email: companySettings.company_email || null,
            company_phone_links: companySettings.company_phone_links.length > 0 ? JSON.parse(JSON.stringify(companySettings.company_phone_links)) : null,
            company_location: companySettings.company_location || null,
          })
          .eq("id", settings.id);

        if (error) throw error;
      } else {
        // Insert new
        const { data, error } = await supabase
          .from("sms_settings")
          .insert({
            provider: "019sms",
            sms_user: settings.sms_user,
            sms_token: settings.sms_token,
            sms_source: settings.sms_source,
            is_enabled: settings.is_enabled,
            invoice_sms_template: settings.invoice_sms_template ?? null,
            signature_sms_template: settings.signature_sms_template ?? null,
            reminder_1month_template: settings.reminder_1month_template ?? null,
            reminder_1week_template: settings.reminder_1week_template ?? null,
            payment_request_template: settings.payment_request_template ?? null,
            enable_auto_reminders: settings.enable_auto_reminders ?? false,
            birthday_sms_enabled: settings.birthday_sms_enabled ?? false,
            birthday_sms_template: settings.birthday_sms_template ?? null,
            license_expiry_sms_enabled: settings.license_expiry_sms_enabled ?? false,
            license_expiry_sms_template: settings.license_expiry_sms_template ?? null,
            company_email: companySettings.company_email || null,
            company_phone_links: companySettings.company_phone_links.length > 0 ? JSON.parse(JSON.stringify(companySettings.company_phone_links)) : null,
            company_location: companySettings.company_location || null,
          })
          .select()
          .single();

        if (error) throw error;
        setSettings((prev) => ({ ...prev, id: data.id }));
      }

      toast({ title: "تم الحفظ", description: "تم حفظ إعدادات SMS بنجاح" });
    } catch (error: any) {
      console.error("Error saving SMS settings:", error);
      toast({
        title: "خطأ",
        description: error.message || "فشل في حفظ الإعدادات",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSignaturePage = async () => {
    setSaving(true);
    try {
      if (signatureTemplateId) {
        // Update existing signature template
        const { error } = await supabase
          .from("invoice_templates")
          .update({
            logo_url: signaturePageSettings.logo_url || null,
            header_html: signaturePageSettings.header_html || null,
            body_html: signaturePageSettings.body_html || null,
            footer_html: signaturePageSettings.footer_html || null,
          })
          .eq("id", signatureTemplateId);

        if (error) throw error;
      } else {
        // Create new signature template
        const { data: newTemplate, error: createError } = await supabase
          .from("invoice_templates")
          .insert({
            name: "Signature Page Template",
            template_type: "signature",
            language: "ar",
            direction: "rtl",
            is_active: true,
            logo_url: signaturePageSettings.logo_url || null,
            header_html: signaturePageSettings.header_html || null,
            body_html: signaturePageSettings.body_html || null,
            footer_html: signaturePageSettings.footer_html || null,
          })
          .select()
          .single();

        if (createError) throw createError;

        // Update sms_settings with the new template id
        if (settings.id) {
          const { error: updateError } = await supabase
            .from("sms_settings")
            .update({ default_signature_template_id: newTemplate.id })
            .eq("id", settings.id);

          if (updateError) throw updateError;
        }

        setSignatureTemplateId(newTemplate.id);
      }

      toast({ title: "تم الحفظ", description: "تم حفظ إعدادات صفحة التوقيع بنجاح" });
    } catch (error: any) {
      console.error("Error saving signature page settings:", error);
      toast({
        title: "خطأ",
        description: error.message || "فشل في حفظ الإعدادات",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('entity_type', 'signature_logo');
      // entity_id في media_files هو UUID، لذلك لا نرسل "global".
      if (signatureTemplateId) {
        formData.append('entity_id', signatureTemplateId);
      }

      const { data, error } = await supabase.functions.invoke('upload-media', {
        body: formData,
      });

      if (error) {
        throw new Error(error.message || 'Upload failed');
      }

      const uploaded = data?.file;
      if (!uploaded?.cdn_url) {
        throw new Error('Upload failed');
      }

      setSignaturePageSettings(prev => ({ ...prev, logo_url: uploaded.cdn_url }));
      toast({ title: "تم الرفع", description: "تم رفع الشعار بنجاح" });
    } catch (error: any) {
      console.error('Error uploading logo:', error);
      toast({ 
        title: "خطأ", 
        description: error.message || "فشل في رفع الشعار", 
        variant: "destructive" 
      });
    } finally {
      setUploadingLogo(false);
      event.target.value = '';
    }
  };

  const handleTestSms = async () => {
    if (!testPhone.trim()) {
      toast({ title: "خطأ", description: "يرجى إدخال رقم الهاتف للاختبار", variant: "destructive" });
      return;
    }

    setTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-sms", {
        body: {
          phone: testPhone,
          message: "رسالة اختبار من ثقة للتأمين - Test message from Thiqa Insurance CRM",
        },
      });

      if (error) throw error;

      toast({ title: "تم الإرسال", description: data?.message || "تم إرسال رسالة الاختبار بنجاح" });
    } catch (error: any) {
      console.error("Error sending test SMS:", error);
      await toastFunctionError(error, "فشل في إرسال رسالة الاختبار");
    } finally {
      setTesting(false);
    }
  };

  if (authLoading) {
    return (
      <MainLayout>
        <div className="p-6">
          <Skeleton className="h-8 w-48 mb-4" />
          <Skeleton className="h-64 w-full" />
        </div>
      </MainLayout>
    );
  }

  if (!isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <MainLayout>
      <Header title="إعدادات SMS" subtitle="إدارة خدمة الرسائل النصية" />

      <div className="p-6 space-y-6">
        <Tabs defaultValue="settings" dir="rtl">
          <TabsList className="grid w-full max-w-xl grid-cols-4">
            <TabsTrigger value="settings" className="gap-2">
              <Settings2 className="h-4 w-4" />
              الإعدادات
            </TabsTrigger>
            <TabsTrigger value="company" className="gap-2">
              <Building2 className="h-4 w-4" />
              بيانات الشركة
            </TabsTrigger>
            <TabsTrigger value="signature" className="gap-2">
              <FileSignature className="h-4 w-4" />
              صفحة التوقيع
            </TabsTrigger>
            <TabsTrigger value="test" className="gap-2">
              <Send className="h-4 w-4" />
              اختبار
            </TabsTrigger>
          </TabsList>

          <TabsContent value="settings" className="mt-6">
            {loading ? (
              <Card>
                <CardHeader>
                  <Skeleton className="h-6 w-40" />
                  <Skeleton className="h-4 w-60" />
                </CardHeader>
                <CardContent className="space-y-4">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MessageSquare className="h-5 w-5 text-primary" />
                    إعدادات 019sms
                  </CardTitle>
                  <CardDescription>
                    قم بإدخال بيانات الاتصال بخدمة 019sms لإرسال الرسائل النصية
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Enable/Disable Toggle */}
                  <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/30">
                    <div className="space-y-0.5">
                      <Label className="font-medium">تفعيل خدمة SMS</Label>
                      <p className="text-sm text-muted-foreground">
                        تفعيل أو تعطيل إرسال الرسائل النصية
                      </p>
                    </div>
                    <Switch
                      checked={settings.is_enabled}
                      onCheckedChange={(checked) =>
                        setSettings((prev) => ({ ...prev, is_enabled: checked }))
                      }
                    />
                  </div>

                  {/* SMS User */}
                  <div className="space-y-2">
                    <Label htmlFor="sms_user">اسم المستخدم (SMSUSER)</Label>
                    <Input
                      id="sms_user"
                      placeholder="أدخل اسم المستخدم..."
                      value={settings.sms_user}
                      onChange={(e) =>
                        setSettings((prev) => ({ ...prev, sms_user: e.target.value }))
                      }
                      className="ltr-input"
                    />
                  </div>

                  {/* SMS Token */}
                  <div className="space-y-2">
                    <Label htmlFor="sms_token">رمز API (SMSTOKEN)</Label>
                    <Input
                      id="sms_token"
                      type="password"
                      placeholder="أدخل رمز API..."
                      value={settings.sms_token}
                      onChange={(e) =>
                        setSettings((prev) => ({ ...prev, sms_token: e.target.value }))
                      }
                      className="ltr-input"
                    />
                  </div>

                  {/* SMS Source */}
                  <div className="space-y-2">
                    <Label htmlFor="sms_source">مصدر الرسالة (SMSSOURCE)</Label>
                    <Input
                      id="sms_source"
                      placeholder="اسم المرسل (مثال: ABInsurance)..."
                      value={settings.sms_source}
                      onChange={(e) =>
                        setSettings((prev) => ({ ...prev, sms_source: e.target.value }))
                      }
                      className="ltr-input"
                    />
                    <p className="text-xs text-muted-foreground">
                      الاسم الذي سيظهر للعميل كمرسل الرسالة
                    </p>
                  </div>

                  {/* Auto Reminders Toggle */}
                  <div className="flex items-center justify-between p-4 rounded-lg border bg-amber-500/10 border-amber-500/20">
                    <div className="space-y-0.5">
                      <Label className="font-medium">تفعيل التذكيرات التلقائية</Label>
                      <p className="text-sm text-muted-foreground">
                        إرسال تذكيرات تلقائية قبل انتهاء المعاملة (شهر وأسبوع)
                      </p>
                    </div>
                    <Switch
                      checked={settings.enable_auto_reminders || false}
                      onCheckedChange={(checked) =>
                        setSettings((prev) => ({ ...prev, enable_auto_reminders: checked }))
                      }
                    />
                  </div>

                  {/* Templates */}
                  <div className="space-y-2">
                    <Label htmlFor="signature_sms_template">نص رسالة التوقيع</Label>
                    <Textarea
                      id="signature_sms_template"
                      value={settings.signature_sms_template || ""}
                      onChange={(e) =>
                        setSettings((prev) => ({ ...prev, signature_sms_template: e.target.value }))
                      }
                      placeholder="مرحباً {{client_name}}، يرجى التوقيع على الرابط التالي: {{signature_url}}"
                      className="min-h-[100px]"
                    />
                    <p className="text-xs text-muted-foreground">
                      المتغيرات المتاحة: {"{{client_name}}"} ، {"{{signature_url}}"}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="invoice_sms_template">نص رسالة المعاملات والفواتير</Label>
                    <Textarea
                      id="invoice_sms_template"
                      value={settings.invoice_sms_template || ""}
                      onChange={(e) =>
                        setSettings((prev) => ({ ...prev, invoice_sms_template: e.target.value }))
                      }
                      placeholder="مرحباً {{client_name}}، معاملة التأمين جاهزة. البوليصة: {{policy_url}} فاتورة AB: {{ab_invoice_url}}"
                      className="min-h-[100px]"
                    />
                    <p className="text-xs text-muted-foreground">
                      المتغيرات المتاحة: {"{{client_name}}"} ، {"{{policy_number}}"} ، {"{{policy_url}}"} ، {"{{ab_invoice_url}}"}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="reminder_1month_template">نص تذكير قبل شهر</Label>
                    <Textarea
                      id="reminder_1month_template"
                      value={settings.reminder_1month_template || ""}
                      onChange={(e) =>
                        setSettings((prev) => ({ ...prev, reminder_1month_template: e.target.value }))
                      }
                      placeholder="مرحباً {{client_name}}، تنتهي معاملة التأمين رقم {{policy_number}} خلال شهر. المبلغ المتبقي: {{remaining_amount}} شيكل."
                      className="min-h-[100px]"
                    />
                    <p className="text-xs text-muted-foreground">
                      المتغيرات: {"{{client_name}}"} ، {"{{policy_number}}"} ، {"{{remaining_amount}}"} ، {"{{end_date}}"}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="reminder_1week_template">نص تذكير قبل أسبوع</Label>
                    <Textarea
                      id="reminder_1week_template"
                      value={settings.reminder_1week_template || ""}
                      onChange={(e) =>
                        setSettings((prev) => ({ ...prev, reminder_1week_template: e.target.value }))
                      }
                      placeholder="مرحباً {{client_name}}، تنتهي معاملة التأمين رقم {{policy_number}} خلال أسبوع. المبلغ المتبقي: {{remaining_amount}} شيكل."
                      className="min-h-[100px]"
                    />
                    <p className="text-xs text-muted-foreground">
                      المتغيرات: {"{{client_name}}"} ، {"{{policy_number}}"} ، {"{{remaining_amount}}"} ، {"{{end_date}}"}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="payment_request_template">نص طلب الدفع اليدوي</Label>
                    <Textarea
                      id="payment_request_template"
                      value={settings.payment_request_template || ""}
                      onChange={(e) =>
                        setSettings((prev) => ({ ...prev, payment_request_template: e.target.value }))
                      }
                      placeholder="مرحباً {{client_name}}، لديك مبلغ متبقي {{remaining_amount}} شيكل على معاملة التأمين رقم {{policy_number}}."
                      className="min-h-[100px]"
                    />
                    <p className="text-xs text-muted-foreground">
                      المتغيرات: {"{{client_name}}"} ، {"{{policy_number}}"} ، {"{{remaining_amount}}"} ، {"{{end_date}}"}
                    </p>
                  </div>

                  {/* Birthday SMS Section */}
                  <div className="border-t pt-6 mt-6">
                    <h3 className="text-lg font-semibold mb-4">🎂 رسائل عيد الميلاد التلقائية</h3>
                    
                    <div className="flex items-center justify-between p-4 rounded-lg border bg-pink-500/10 border-pink-500/20 mb-4">
                      <div className="space-y-0.5">
                        <Label className="font-medium">تفعيل رسائل عيد الميلاد</Label>
                        <p className="text-sm text-muted-foreground">
                          إرسال رسالة تهنئة تلقائياً في يوم ميلاد العميل
                        </p>
                      </div>
                      <Switch
                        checked={settings.birthday_sms_enabled || false}
                        onCheckedChange={(checked) =>
                          setSettings((prev) => ({ ...prev, birthday_sms_enabled: checked }))
                        }
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="birthday_sms_template">نص رسالة عيد الميلاد</Label>
                      <Textarea
                        id="birthday_sms_template"
                        value={settings.birthday_sms_template || ""}
                        onChange={(e) =>
                          setSettings((prev) => ({ ...prev, birthday_sms_template: e.target.value }))
                        }
                        placeholder="عيد ميلاد سعيد {client_name}! 🎂 نتمنى لك سنة مليئة بالفرح والسعادة."
                        className="min-h-[100px]"
                      />
                      <p className="text-xs text-muted-foreground">
                        المتغيرات: {"{client_name}"}
                      </p>
                    </div>
                  </div>

                  {/* License Expiry SMS Section */}
                  <div className="border-t pt-6 mt-6">
                    <h3 className="text-lg font-semibold mb-4">🚗 رسائل انتهاء الترخيص التلقائية</h3>
                    
                    <div className="flex items-center justify-between p-4 rounded-lg border bg-orange-500/10 border-orange-500/20 mb-4">
                      <div className="space-y-0.5">
                        <Label className="font-medium">تفعيل رسائل انتهاء الترخيص</Label>
                        <p className="text-sm text-muted-foreground">
                          إرسال تذكير قبل شهر من انتهاء ترخيص السيارة (التست)
                        </p>
                      </div>
                      <Switch
                        checked={settings.license_expiry_sms_enabled || false}
                        onCheckedChange={(checked) =>
                          setSettings((prev) => ({ ...prev, license_expiry_sms_enabled: checked }))
                        }
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="license_expiry_sms_template">نص رسالة انتهاء الترخيص</Label>
                      <Textarea
                        id="license_expiry_sms_template"
                        value={settings.license_expiry_sms_template || ""}
                        onChange={(e) =>
                          setSettings((prev) => ({ ...prev, license_expiry_sms_template: e.target.value }))
                        }
                        placeholder="مرحباً {client_name}، نذكرك أن رخصة سيارتك رقم {car_number} ستنتهي خلال شهر. يرجى التواصل معنا لتجديدها."
                        className="min-h-[100px]"
                      />
                      <p className="text-xs text-muted-foreground">
                        المتغيرات: {"{client_name}"} ، {"{car_number}"}
                      </p>
                    </div>
                  </div>

                  {/* Save Button */}
                  <Button onClick={handleSave} disabled={saving} className="w-full">
                    {saving ? (
                      <Loader2 className="h-4 w-4 animate-spin ml-2" />
                    ) : (
                      <Save className="h-4 w-4 ml-2" />
                    )}
                    حفظ الإعدادات
                  </Button>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Company Info Tab */}
          <TabsContent value="company" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-primary" />
                  بيانات الشركة
                </CardTitle>
                <CardDescription>
                  بيانات التواصل التي تظهر في الفواتير والإيصالات المرسلة للعملاء
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Company Email */}
                <div className="space-y-2">
                  <Label htmlFor="company_email">البريد الإلكتروني</Label>
                  <Input
                    id="company_email"
                    type="email"
                    placeholder="info@company.com"
                    value={companySettings.company_email}
                    onChange={(e) =>
                      setCompanySettings((prev) => ({ ...prev, company_email: e.target.value }))
                    }
                    className="ltr-input"
                  />
                </div>

                {/* Phone Numbers with Custom Links */}
                <div className="space-y-3">
                  <Label>أرقام الهواتف (مع روابط مخصصة)</Label>
                  <div className="space-y-3">
                    {companySettings.company_phone_links.map((item, index) => (
                      <div key={index} className="flex items-center gap-2 p-3 border rounded-lg bg-muted/20">
                        <div className="flex-1 space-y-2">
                          <Input
                            value={item.phone}
                            onChange={(e) => {
                              const newLinks = [...companySettings.company_phone_links];
                              newLinks[index] = { ...newLinks[index], phone: e.target.value };
                              setCompanySettings((prev) => ({ ...prev, company_phone_links: newLinks }));
                            }}
                            placeholder="رقم الهاتف (مثل: 026307377)"
                            className="ltr-input"
                          />
                          <Input
                            value={item.href}
                            onChange={(e) => {
                              const newLinks = [...companySettings.company_phone_links];
                              newLinks[index] = { ...newLinks[index], href: e.target.value };
                              setCompanySettings((prev) => ({ ...prev, company_phone_links: newLinks }));
                            }}
                            placeholder="الرابط (مثل: tel:026307377 أو https://wa.me/972...)"
                            className="ltr-input text-xs"
                          />
                        </div>
                        <Button
                          variant="destructive"
                          size="icon"
                          onClick={() => {
                            const newLinks = companySettings.company_phone_links.filter((_, i) => i !== index);
                            setCompanySettings((prev) => ({ ...prev, company_phone_links: newLinks }));
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    <div className="flex items-start gap-2 p-3 border rounded-lg border-dashed">
                      <div className="flex-1 space-y-2">
                        <Input
                          value={newPhoneNumber}
                          onChange={(e) => setNewPhoneNumber(e.target.value)}
                          placeholder="رقم الهاتف الجديد..."
                          className="ltr-input"
                        />
                        <Input
                          value={newPhoneHref}
                          onChange={(e) => setNewPhoneHref(e.target.value)}
                          placeholder="الرابط (tel: أو https://wa.me/...)"
                          className="ltr-input text-xs"
                        />
                      </div>
                      <Button
                        variant="outline"
                        onClick={() => {
                          if (newPhoneNumber.trim()) {
                            const href = newPhoneHref.trim() || `tel:${newPhoneNumber.replace(/[^0-9+]/g, '')}`;
                            setCompanySettings((prev) => ({
                              ...prev,
                              company_phone_links: [...prev.company_phone_links, { phone: newPhoneNumber.trim(), href }],
                            }));
                            setNewPhoneNumber("");
                            setNewPhoneHref("");
                          }
                        }}
                      >
                        <Plus className="h-4 w-4 ml-2" />
                        إضافة
                      </Button>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    كل رقم يمكن أن يكون له رابط مختلف: <code className="bg-muted px-1 rounded">tel:</code> للاتصال أو <code className="bg-muted px-1 rounded">https://wa.me/972...</code> للواتساب
                  </p>
                </div>

                {/* Location */}
                <div className="space-y-2">
                  <Label htmlFor="company_location">العنوان</Label>
                  <Input
                    id="company_location"
                    placeholder="الناصرة - شارع المركز"
                    value={companySettings.company_location}
                    onChange={(e) =>
                      setCompanySettings((prev) => ({ ...prev, company_location: e.target.value }))
                    }
                  />
                </div>

                {/* Preview */}
                {(companySettings.company_email || companySettings.company_phone_links.length > 0 || companySettings.company_location) && (
                  <div className="space-y-2">
                    <Label>معاينة كيف ستظهر البيانات</Label>
                    <div className="border rounded-lg p-4 bg-muted/30 text-center">
                      <p className="font-bold text-lg mb-2">شكراً لتعاملكم معنا 🙏</p>
                      <div className="inline-block text-sm space-y-1 text-right bg-background p-3 rounded-lg">
                        {companySettings.company_email && (
                          <div className="flex items-center gap-2">
                            <span>📧</span>
                            <span className="text-primary">{companySettings.company_email}</span>
                          </div>
                        )}
                        {companySettings.company_phone_links.length > 0 && (
                          <div className="flex items-center gap-2">
                            <span>📞</span>
                            <div className="flex items-center gap-1">
                              {companySettings.company_phone_links.map((item, idx) => (
                                <span key={idx}>
                                  <a href={item.href} className="text-primary underline">{item.phone}</a>
                                  {idx < companySettings.company_phone_links.length - 1 && ' | '}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        {companySettings.company_location && (
                          <div className="flex items-center gap-2">
                            <span>📍</span>
                            <span>{companySettings.company_location}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Save Button */}
                <Button onClick={handleSave} disabled={saving} className="w-full">
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin ml-2" />
                  ) : (
                    <Save className="h-4 w-4 ml-2" />
                  )}
                  حفظ بيانات الشركة
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Signature Page Editor Tab */}
          <TabsContent value="signature" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileSignature className="h-5 w-5 text-primary" />
                  إعدادات صفحة التوقيع
                </CardTitle>
                <CardDescription>
                  تخصيص المحتوى الذي يظهر للعميل عند فتح رابط التوقيع
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Logo Upload */}
                <div className="space-y-2">
                  <Label>شعار الشركة</Label>
                  <div className="flex items-center gap-4">
                    {signaturePageSettings.logo_url ? (
                      <div className="relative">
                        <img 
                          src={signaturePageSettings.logo_url} 
                          alt="الشعار" 
                          className="h-16 w-auto rounded border"
                        />
                        <Button
                          variant="destructive"
                          size="icon"
                          className="absolute -top-2 -right-2 h-6 w-6"
                          onClick={() => setSignaturePageSettings(prev => ({ ...prev, logo_url: "" }))}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <div className="relative">
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleLogoUpload}
                          className="absolute inset-0 opacity-0 cursor-pointer"
                          disabled={uploadingLogo}
                        />
                        <Button variant="outline" disabled={uploadingLogo}>
                          {uploadingLogo ? (
                            <Loader2 className="h-4 w-4 animate-spin ml-2" />
                          ) : (
                            <Upload className="h-4 w-4 ml-2" />
                          )}
                          رفع شعار
                        </Button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Header HTML */}
                <div className="space-y-2">
                  <Label htmlFor="header_html">العنوان (يمكن إضافة HTML)</Label>
                  <Textarea
                    id="header_html"
                    value={signaturePageSettings.header_html}
                    onChange={(e) =>
                      setSignaturePageSettings(prev => ({ ...prev, header_html: e.target.value }))
                    }
                    placeholder="<h2>عنوان الصفحة</h2>"
                    className="min-h-[80px] font-mono text-sm"
                    dir="rtl"
                  />
                  <p className="text-xs text-muted-foreground">
                    يظهر في أعلى صفحة التوقيع
                  </p>
                </div>

                {/* Body HTML */}
                <div className="space-y-2">
                  <Label htmlFor="body_html">المحتوى الرئيسي (يمكن إضافة HTML)</Label>
                  <Textarea
                    id="body_html"
                    value={signaturePageSettings.body_html}
                    onChange={(e) =>
                      setSignaturePageSettings(prev => ({ ...prev, body_html: e.target.value }))
                    }
                    placeholder="<p>أقرّ أنا الموقع أدناه بأنني قد اطلعت على شروط التأمين وأوافق عليها.</p>"
                    className="min-h-[150px] font-mono text-sm"
                    dir="rtl"
                  />
                  <p className="text-xs text-muted-foreground">
                    النص الذي يجب على العميل قراءته قبل التوقيع
                  </p>
                </div>

                {/* Footer HTML */}
                <div className="space-y-2">
                  <Label htmlFor="footer_html">التذييل (يمكن إضافة HTML)</Label>
                  <Textarea
                    id="footer_html"
                    value={signaturePageSettings.footer_html}
                    onChange={(e) =>
                      setSignaturePageSettings(prev => ({ ...prev, footer_html: e.target.value }))
                    }
                    placeholder="<p>جميع الحقوق محفوظة © ثقة للتأمين</p>"
                    className="min-h-[60px] font-mono text-sm"
                    dir="rtl"
                  />
                </div>

                {/* Preview */}
                {(signaturePageSettings.header_html || signaturePageSettings.body_html || signaturePageSettings.footer_html) && (
                  <div className="space-y-2">
                    <Label>معاينة</Label>
                    <div className="border rounded-lg p-4 bg-muted/30 prose prose-sm max-w-none" dir="rtl">
                      {signaturePageSettings.logo_url && (
                        <img src={signaturePageSettings.logo_url} alt="الشعار" className="h-12 mx-auto mb-4" />
                      )}
                      {signaturePageSettings.header_html && (
                        <div dangerouslySetInnerHTML={createSafeHtml(signaturePageSettings.header_html)} />
                      )}
                      {signaturePageSettings.body_html && (
                        <div dangerouslySetInnerHTML={createSafeHtml(signaturePageSettings.body_html)} />
                      )}
                      {signaturePageSettings.footer_html && (
                        <div dangerouslySetInnerHTML={createSafeHtml(signaturePageSettings.footer_html)} />
                      )}
                    </div>
                  </div>
                )}

                {/* Save Button */}
                <Button onClick={handleSaveSignaturePage} disabled={saving} className="w-full">
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin ml-2" />
                  ) : (
                    <Save className="h-4 w-4 ml-2" />
                  )}
                  حفظ إعدادات صفحة التوقيع
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="test" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Send className="h-5 w-5 text-primary" />
                  اختبار الإرسال
                </CardTitle>
                <CardDescription>
                  أرسل رسالة اختبار للتأكد من صحة الإعدادات
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="test_phone">رقم الهاتف</Label>
                  <Input
                    id="test_phone"
                    placeholder="05xxxxxxxx"
                    value={testPhone}
                    onChange={(e) => setTestPhone(e.target.value)}
                    className="ltr-input"
                  />
                </div>

                <Button
                  onClick={handleTestSms}
                  disabled={testing || !settings.is_enabled}
                  className="w-full"
                >
                  {testing ? (
                    <Loader2 className="h-4 w-4 animate-spin ml-2" />
                  ) : (
                    <Send className="h-4 w-4 ml-2" />
                  )}
                  إرسال رسالة اختبار
                </Button>

                {!settings.is_enabled && (
                  <p className="text-sm text-amber-600 text-center">
                    يجب تفعيل خدمة SMS أولاً من تبويب الإعدادات
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
