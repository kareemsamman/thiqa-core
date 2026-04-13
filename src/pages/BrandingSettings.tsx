import { useState, useRef } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Upload, Trash2, Image, Save, PenTool, Palette, Receipt } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSiteSettings, useUpdateSiteSettings } from "@/hooks/useSiteSettings";
import { Skeleton } from "@/components/ui/skeleton";

function ImageUploadField({
  label,
  description,
  currentUrl,
  onUpload,
  onRemove,
  accept = "image/*",
}: {
  label: string;
  description: string;
  currentUrl: string | null;
  onUpload: (url: string) => void;
  onRemove: () => void;
  accept?: string;
}) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `${crypto.randomUUID()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("branding")
        .upload(path, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from("branding")
        .getPublicUrl(path);

      onUpload(publicUrl);
      toast.success("تم رفع الملف بنجاح");
    } catch (err) {
      console.error(err);
      toast.error("فشل في رفع الملف");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <p className="text-xs text-muted-foreground">{description}</p>
      {currentUrl ? (
        <div className="flex items-center gap-4">
          <img
            src={currentUrl}
            alt={label}
            className="h-16 w-auto rounded-lg border bg-muted object-contain p-1"
          />
          <Button variant="destructive" size="sm" onClick={onRemove}>
            <Trash2 className="h-4 w-4 ml-1" />
            حذف
          </Button>
        </div>
      ) : (
        <div
          className="flex items-center justify-center h-20 border-2 border-dashed rounded-lg cursor-pointer hover:border-primary/50 transition-colors"
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Upload className="h-4 w-4" />
              اضغط لرفع الصورة
            </div>
          )}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={handleUpload}
        disabled={uploading}
      />
    </div>
  );
}

export default function BrandingSettings() {
  const { data: settings, isLoading } = useSiteSettings();
  const updateSettings = useUpdateSiteSettings();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [faviconUrl, setFaviconUrl] = useState<string | null>(null);
  const [ogImageUrl, setOgImageUrl] = useState<string | null>(null);
  // Signature fields
  const [sigHeader, setSigHeader] = useState("");
  const [sigBody, setSigBody] = useState("");
  const [sigFooter, setSigFooter] = useState("");
  const [sigColor, setSigColor] = useState("#1e3a5f");
  // Invoice fields
  const [ownerName, setOwnerName] = useState("");
  const [taxNumber, setTaxNumber] = useState("");
  const [invoicePrivacyText, setInvoicePrivacyText] = useState("");
  const [initialized, setInitialized] = useState(false);

  // Initialize form from fetched settings
  if (settings && !initialized) {
    setTitle(settings.site_title);
    setDescription(settings.site_description);
    setLogoUrl(settings.logo_url);
    setFaviconUrl(settings.favicon_url);
    setOgImageUrl(settings.og_image_url);
    setSigHeader(settings.signature_header_html || '<h2>نموذج الموافقة على الخصوصية</h2>');
    setSigBody(settings.signature_body_html || '<p>مرحباً.</p><p>أقرّ بأنني قرأت وفهمت سياسة الخصوصية، وأوافق على قيام الشركة بجمع واستخدام ومعالجة بياناتي الشخصية للأغراض المتعلقة بخدمات التأمين والتواصل وإتمام الإجراءات اللازمة.</p><p>بالتوقيع أدناه، أؤكد صحة البيانات وأمنح موافقتي على ما ورد أعلاه.</p>');
    setSigFooter(settings.signature_footer_html || '<p>جميع الحقوق محفوظة</p>');
    setSigColor(settings.signature_primary_color || '#1e3a5f');
    setOwnerName(settings.owner_name || '');
    setTaxNumber(settings.tax_number || '');
    setInvoicePrivacyText(settings.invoice_privacy_text || '');
    setInitialized(true);
  }

  const handleSave = async () => {
    try {
      await updateSettings.mutateAsync({
        site_title: title,
        site_description: description,
        logo_url: logoUrl,
        favicon_url: faviconUrl,
        og_image_url: ogImageUrl,
        signature_header_html: sigHeader,
        signature_body_html: sigBody,
        signature_footer_html: sigFooter,
        signature_primary_color: sigColor,
        owner_name: ownerName.trim() || null,
        tax_number: taxNumber.trim() || null,
        invoice_privacy_text: invoicePrivacyText.trim() || null,
      });
      toast.success("تم حفظ الإعدادات بنجاح");
    } catch {
      toast.error("فشل في حفظ الإعدادات");
    }
  };

  if (isLoading) {
    return (
      <MainLayout>
        <div className="space-y-4 max-w-2xl">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-64 w-full" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold">إعدادات العلامة التجارية</h1>
          <p className="text-muted-foreground text-sm mt-1">
            تخصيص شعار الموقع، العنوان، الوصف، ونص صفحة التوقيع
          </p>
        </div>

        <Tabs defaultValue="branding">
          <TabsList>
            <TabsTrigger value="branding" className="gap-2">
              <Image className="h-4 w-4" />
              العلامة التجارية
            </TabsTrigger>
            <TabsTrigger value="invoice" className="gap-2">
              <Receipt className="h-4 w-4" />
              إعدادات الفاتورة
            </TabsTrigger>
            <TabsTrigger value="signature" className="gap-2">
              <PenTool className="h-4 w-4" />
              صفحة التوقيع
            </TabsTrigger>
          </TabsList>

          <TabsContent value="branding">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Image className="h-5 w-5" />
                  معلومات الموقع
                </CardTitle>
                <CardDescription>
                  هذه الإعدادات تظهر في عنوان المتصفح ونتائج البحث والفواتير
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="site-title">عنوان الموقع (اسم الشركة)</Label>
                  <Input
                    id="site-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="ثقة للتأمين"
                  />
                  <p className="text-xs text-muted-foreground">يظهر في الفواتير، الفوتر، رسائل SMS، وعنوان المتصفح</p>
                </div>

                <ImageUploadField
                  label="شعار الموقع"
                  description="يظهر في الشريط الجانبي، صفحة تسجيل الدخول، والفواتير"
                  currentUrl={logoUrl}
                  onUpload={setLogoUrl}
                  onRemove={() => setLogoUrl(null)}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="invoice">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Receipt className="h-5 w-5" />
                  بيانات الفاتورة
                </CardTitle>
                <CardDescription>
                  هذه الحقول تظهر في الفواتير المُرسَلة للعميل. اتركها فارغة إذا لم ترغب بعرضها.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="owner-name">اسم صاحب الشركة</Label>
                  <Input
                    id="owner-name"
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                    placeholder="الاسم الكامل"
                  />
                  <p className="text-xs text-muted-foreground">يظهر بجانب اسم الوكالة في رأس الفاتورة</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="tax-number">رقم المشغل / الضريبة</Label>
                  <Input
                    id="tax-number"
                    value={taxNumber}
                    onChange={(e) => setTaxNumber(e.target.value)}
                    placeholder="رقم المشغل المرخّص"
                    dir="ltr"
                    className="ltr-input font-mono"
                  />
                  <p className="text-xs text-muted-foreground">يظهر تحت اسم الوكالة في الفاتورة</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="invoice-privacy">نص سياسة الخصوصية / الشروط</Label>
                  <Textarea
                    id="invoice-privacy"
                    value={invoicePrivacyText}
                    onChange={(e) => setInvoicePrivacyText(e.target.value)}
                    placeholder="مثال: جميع المبالغ المدفوعة غير قابلة للاسترداد بعد إصدار الوثيقة..."
                    rows={6}
                  />
                  <p className="text-xs text-muted-foreground">
                    يظهر أسفل جدول البنود وقبل التذييل. استخدمه لعرض شروط الدفع، سياسة الإرجاع، أو أي ملاحظات قانونية.
                  </p>
                </div>

                <div className="rounded-lg border bg-muted/30 p-4 text-sm">
                  <div className="font-medium mb-2 text-muted-foreground">معلومات إضافية تظهر في الفاتورة:</div>
                  <ul className="space-y-1 text-xs text-muted-foreground list-disc pr-5">
                    <li>أرقام هاتف التواصل وعنوان المكتب — تُدار من إعدادات الرسائل النصية</li>
                    <li>اسم الوكالة والشعار — من تبويب «العلامة التجارية» أعلاه</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="signature">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <PenTool className="h-5 w-5" />
                  تخصيص صفحة التوقيع
                </CardTitle>
                <CardDescription>
                  تحكم في النص والمظهر الذي يراه العميل عند فتح رابط التوقيع
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="sig-header">عنوان صفحة التوقيع (HTML)</Label>
                  <Textarea
                    id="sig-header"
                    value={sigHeader}
                    onChange={(e) => setSigHeader(e.target.value)}
                    placeholder="<h2>نموذج الموافقة</h2>"
                    rows={2}
                    dir="ltr"
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">يظهر في أعلى نص الإقرار</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="sig-body">نص الإقرار (HTML)</Label>
                  <Textarea
                    id="sig-body"
                    value={sigBody}
                    onChange={(e) => setSigBody(e.target.value)}
                    placeholder="<p>أقرّ بأنني...</p>"
                    rows={6}
                    dir="ltr"
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">النص القانوني الذي يوقع عليه العميل - يدعم HTML</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="sig-footer">نص الفوتر (HTML)</Label>
                  <Textarea
                    id="sig-footer"
                    value={sigFooter}
                    onChange={(e) => setSigFooter(e.target.value)}
                    placeholder="<p>© شركتي - جميع الحقوق محفوظة</p>"
                    rows={2}
                    dir="ltr"
                    className="font-mono text-sm"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="sig-color" className="flex items-center gap-2">
                    <Palette className="h-4 w-4" />
                    اللون الرئيسي لصفحة التوقيع
                  </Label>
                  <div className="flex items-center gap-3">
                    <input
                      id="sig-color"
                      type="color"
                      value={sigColor}
                      onChange={(e) => setSigColor(e.target.value)}
                      className="h-10 w-14 rounded border cursor-pointer"
                    />
                    <Input
                      value={sigColor}
                      onChange={(e) => setSigColor(e.target.value)}
                      placeholder="#1e3a5f"
                      className="ltr-input w-32 font-mono"
                      dir="ltr"
                    />
                  </div>
                </div>

                {/* Preview */}
                <div className="border rounded-lg overflow-hidden">
                  <div className="text-xs font-medium text-muted-foreground px-3 py-2 bg-muted/50 border-b">معاينة</div>
                  <div className="p-4 space-y-3" style={{ background: `linear-gradient(135deg, ${sigColor}, ${sigColor}dd)` }}>
                    <div className="bg-white rounded-xl p-4 text-sm">
                      {logoUrl && (
                        <img src={logoUrl} alt="Logo" className="h-10 mx-auto mb-2 object-contain" />
                      )}
                      <div className="text-center font-bold text-lg mb-2" style={{ color: sigColor }}>{title || 'اسم الشركة'}</div>
                      <div className="bg-muted/30 rounded-lg p-3 text-xs" dir="rtl" dangerouslySetInnerHTML={{ __html: sigHeader + sigBody }} />
                      <div className="text-center text-xs text-muted-foreground mt-3 pt-2 border-t" dangerouslySetInnerHTML={{ __html: sigFooter }} />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Button
          className="w-full gap-2"
          onClick={handleSave}
          disabled={updateSettings.isPending}
        >
          {updateSettings.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          حفظ جميع الإعدادات
        </Button>
      </div>
    </MainLayout>
  );
}