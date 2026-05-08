import { useState, useRef } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Header } from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Upload, Trash2, Image, Save, PenTool, Palette, Receipt, Keyboard, Sparkles, RefreshCw } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSiteSettings, useUpdateSiteSettings } from "@/hooks/useSiteSettings";
import { Skeleton } from "@/components/ui/skeleton";
import { createSafeHtml } from "@/lib/sanitize";
import { ShortcutsTabContent } from "@/components/admin/ShortcutsTabContent";

// Defaults for the signature-page settings — same values used to seed
// the form on first load. The "إعادة للافتراضي" button writes these
// back into the form (the user still has to click "حفظ" to persist).
const SIGNATURE_DEFAULTS = {
  header: "نموذج الموافقة على الخصوصية",
  body:
    "مرحباً.\n\nأقرّ بأنني قرأت وفهمت سياسة الخصوصية، وأوافق على قيام الشركة بجمع واستخدام ومعالجة بياناتي الشخصية للأغراض المتعلقة بخدمات التأمين والتواصل وإتمام الإجراءات اللازمة.\n\nبالتوقيع أدناه، أؤكد صحة البيانات وأمنح موافقتي على ما ورد أعلاه.",
  footer: "جميع الحقوق محفوظة",
  // Matches Thiqa primary (rgb 69 94 187 = #455ebb)
  color: "#455ebb",
} as const;

// Resolve the current user's agent_id, used to scope uploads under the
// `{agent_id}/...` folder that the `branding` bucket's RLS policy
// requires.
async function resolveAgentId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: au } = await supabase
    .from("agent_users")
    .select("agent_id")
    .eq("user_id", user.id)
    .maybeSingle();
  return au?.agent_id ?? null;
}

function ImageUploadField({
  label,
  description,
  currentUrl,
  onUpload,
  onRemove,
  accept = "image/*",
  enableAiEnhance = false,
}: {
  label: string;
  description: string;
  currentUrl: string | null;
  onUpload: (url: string) => void;
  onRemove: () => void;
  accept?: string;
  enableAiEnhance?: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const [aiOpen, setAiOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSaving, setAiSaving] = useState(false);
  const [enhancedDataUrl, setEnhancedDataUrl] = useState<string | null>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const agentId = await resolveAgentId();
      if (!agentId) {
        toast.error("تعذر تحديد الوكالة. حاول إعادة تسجيل الدخول.");
        return;
      }

      const ext = file.name.split(".").pop();
      const path = `${agentId}/${crypto.randomUUID()}.${ext}`;

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

  const runEnhance = async () => {
    if (!currentUrl) return;
    setAiLoading(true);
    setEnhancedDataUrl(null);
    try {
      const { data, error } = await supabase.functions.invoke("enhance-logo", {
        body: { imageUrl: currentUrl },
      });
      if (error) throw error;
      const dataUrl = (data as any)?.imageDataUrl as string | undefined;
      if (!dataUrl) throw new Error((data as any)?.error || "no image returned");
      setEnhancedDataUrl(dataUrl);
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || "فشل في تحسين الصورة");
      setAiOpen(false);
    } finally {
      setAiLoading(false);
    }
  };

  const openEnhanceDialog = () => {
    setAiOpen(true);
    void runEnhance();
  };

  const acceptEnhanced = async () => {
    if (!enhancedDataUrl) return;
    setAiSaving(true);
    try {
      const agentId = await resolveAgentId();
      if (!agentId) {
        toast.error("تعذر تحديد الوكالة. حاول إعادة تسجيل الدخول.");
        return;
      }
      const res = await fetch(enhancedDataUrl);
      const blob = await res.blob();
      const ext = (blob.type.split("/")[1] || "png").replace("jpeg", "jpg");
      const path = `${agentId}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("branding")
        .upload(path, blob, { upsert: true, contentType: blob.type || "image/png" });
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage
        .from("branding")
        .getPublicUrl(path);
      onUpload(publicUrl);
      toast.success("تم تحديث الشعار");
      setAiOpen(false);
      setEnhancedDataUrl(null);
    } catch (err: any) {
      console.error(err);
      toast.error("فشل في حفظ الصورة المُحسَّنة");
    } finally {
      setAiSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <p className="text-xs text-muted-foreground">{description}</p>
      {currentUrl ? (
        <div className="flex items-center gap-2 flex-wrap">
          <img
            src={currentUrl}
            alt={label}
            className="h-16 w-auto rounded-lg border bg-muted object-contain p-1"
          />
          <Button variant="destructive" size="sm" onClick={onRemove}>
            <Trash2 className="h-4 w-4 ml-1" />
            حذف
          </Button>
          {enableAiEnhance && (
            <Button
              variant="secondary"
              size="sm"
              onClick={openEnhanceDialog}
              disabled={aiLoading || aiSaving}
              className="gap-1"
            >
              <Sparkles className="h-4 w-4" />
              تحسين بالذكاء الاصطناعي
            </Button>
          )}
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

      {enableAiEnhance && (
        <Dialog
          open={aiOpen}
          onOpenChange={(open) => {
            if (aiSaving) return;
            setAiOpen(open);
            if (!open) setEnhancedDataUrl(null);
          }}
        >
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                تحسين الشعار بالذكاء الاصطناعي
              </DialogTitle>
              <DialogDescription>
                قارن بين الشعار الأصلي والنسخة المُحسَّنة، ثم اختر ما يناسبك.
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground text-center">الأصلية</div>
                <div className="aspect-square rounded-lg border bg-muted/30 flex items-center justify-center p-2">
                  {currentUrl && (
                    <img src={currentUrl} alt="original" className="max-h-full max-w-full object-contain" />
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground text-center">المُحسَّنة</div>
                <div className="aspect-square rounded-lg border bg-muted/30 flex items-center justify-center p-2">
                  {aiLoading ? (
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-6 w-6 animate-spin" />
                      <span className="text-xs">جاري التحسين...</span>
                    </div>
                  ) : enhancedDataUrl ? (
                    <img src={enhancedDataUrl} alt="enhanced" className="max-h-full max-w-full object-contain" />
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 justify-end pt-2">
              <Button
                variant="ghost"
                onClick={() => setAiOpen(false)}
                disabled={aiSaving}
              >
                احتفظ بالأصلية
              </Button>
              <Button
                variant="outline"
                onClick={runEnhance}
                disabled={aiLoading || aiSaving}
                className="gap-1"
              >
                <RefreshCw className={`h-4 w-4 ${aiLoading ? "animate-spin" : ""}`} />
                جرّب مرة أخرى
              </Button>
              <Button
                onClick={acceptEnhanced}
                disabled={!enhancedDataUrl || aiLoading || aiSaving}
                className="gap-1"
              >
                {aiSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                استخدم هذه
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// Signature page content is stored in site_settings as HTML so the
// edge function can render it directly, but the admin UI edits plain
// text. These helpers convert between the two: stored HTML → what the
// staff see in the textareas, and plain text → the HTML written back
// to the DB.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function htmlToPlain(html: string | null | undefined): string {
  if (!html) return '';
  return html
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/?(h[1-6]|p|div|span|strong|em|b|i|u)[^>]*>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function titlePlainToHtml(plain: string): string {
  const safe = plain.trim();
  return safe ? `<h2>${escapeHtml(safe)}</h2>` : '';
}

function bodyPlainToHtml(plain: string): string {
  return plain
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br/>')}</p>`)
    .join('');
}

function footerPlainToHtml(plain: string): string {
  const safe = plain.trim();
  return safe ? `<p>${escapeHtml(safe)}</p>` : '';
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
  const [sigColor, setSigColor] = useState<string>(SIGNATURE_DEFAULTS.color);
  // Invoice fields
  const [ownerName, setOwnerName] = useState("");
  const [taxNumber, setTaxNumber] = useState("");
  const [invoicePrivacyText, setInvoicePrivacyText] = useState("");
  const [invoicePhonesInput, setInvoicePhonesInput] = useState("");
  const [invoiceAddress, setInvoiceAddress] = useState("");
  const [initialized, setInitialized] = useState(false);

  // Initialize form from fetched settings
  if (settings && !initialized) {
    setTitle(settings.site_title);
    setDescription(settings.site_description);
    setLogoUrl(settings.logo_url);
    setFaviconUrl(settings.favicon_url);
    setOgImageUrl(settings.og_image_url);
    setSigHeader(htmlToPlain(settings.signature_header_html) || SIGNATURE_DEFAULTS.header);
    setSigBody(htmlToPlain(settings.signature_body_html) || SIGNATURE_DEFAULTS.body);
    setSigFooter(htmlToPlain(settings.signature_footer_html) || SIGNATURE_DEFAULTS.footer);
    setSigColor(settings.signature_primary_color || SIGNATURE_DEFAULTS.color);
    setOwnerName(settings.owner_name || '');
    setTaxNumber(settings.tax_number || '');
    setInvoicePrivacyText(settings.invoice_privacy_text || '');
    setInvoicePhonesInput((settings.invoice_phones || []).join(', '));
    setInvoiceAddress(settings.invoice_address || '');
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
        signature_header_html: titlePlainToHtml(sigHeader),
        signature_body_html: bodyPlainToHtml(sigBody),
        signature_footer_html: footerPlainToHtml(sigFooter),
        signature_primary_color: sigColor,
        owner_name: ownerName.trim() || null,
        tax_number: taxNumber.trim() || null,
        invoice_privacy_text: invoicePrivacyText.trim() || null,
        invoice_phones: invoicePhonesInput
          .split(/[,،\n]/)
          .map((s) => s.trim())
          .filter(Boolean),
        invoice_address: invoiceAddress.trim() || null,
      });
      toast.success("تم حفظ الإعدادات بنجاح");
    } catch {
      toast.error("فشل في حفظ الإعدادات");
    }
  };

  if (isLoading) {
    return (
      <MainLayout>
        <div className="md:p-6 space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-64 w-full" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <Header
        title="العلامة التجارية"
        subtitle="تخصيص شعار الموقع، العنوان، الوصف، ونص صفحة التوقيع"
      />

      <div className="md:p-6 space-y-6">
        <Tabs defaultValue="branding" className="space-y-6">
          <TabsList className="grid w-full grid-cols-2 md:grid-cols-4 h-auto gap-1 p-1">
            <TabsTrigger value="branding" className="gap-2 py-2.5">
              <Image className="h-4 w-4" />
              العلامة التجارية
            </TabsTrigger>
            <TabsTrigger value="invoice" className="gap-2 py-2.5">
              <Receipt className="h-4 w-4" />
              إعدادات الفاتورة
            </TabsTrigger>
            <TabsTrigger value="signature" className="gap-2 py-2.5">
              <PenTool className="h-4 w-4" />
              صفحة التوقيع
            </TabsTrigger>
            <TabsTrigger value="shortcuts" className="gap-2 py-2.5">
              <Keyboard className="h-4 w-4" />
              اختصارات
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
                  enableAiEnhance
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
                  <Label htmlFor="invoice-phones">أرقام هاتف التواصل</Label>
                  <Input
                    id="invoice-phones"
                    value={invoicePhonesInput}
                    onChange={(e) => setInvoicePhonesInput(e.target.value)}
                    placeholder="04-6555123, 052-1234567"
                    dir="ltr"
                    className="ltr-input font-mono"
                  />
                  <p className="text-xs text-muted-foreground">
                    افصل بين الأرقام بفاصلة (,). تظهر في تذييل الفاتورة بعد عبارة الشكر.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="invoice-address">عنوان المكتب</Label>
                  <Input
                    id="invoice-address"
                    value={invoiceAddress}
                    onChange={(e) => setInvoiceAddress(e.target.value)}
                    placeholder="مثال: الناصرة - شارع المركز"
                  />
                  <p className="text-xs text-muted-foreground">يظهر في تذييل الفاتورة بجانب أرقام التواصل</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="invoice-privacy">نص سياسة الخصوصية / الشروط</Label>
                  <Textarea
                    id="invoice-privacy"
                    value={invoicePrivacyText}
                    onChange={(e) => setInvoicePrivacyText(e.target.value)}
                    placeholder="مثال: جميع المبالغ المدفوعة غير قابلة للاسترداد بعد إصدار المعاملة..."
                    rows={6}
                  />
                  <p className="text-xs text-muted-foreground">
                    يظهر أسفل جدول البنود وقبل التذييل. استخدمه لعرض شروط الدفع، سياسة الإرجاع، أو أي ملاحظات قانونية.
                  </p>
                </div>

                <div className="rounded-lg border bg-muted/30 p-4 text-sm">
                  <div className="font-medium mb-2 text-muted-foreground">يُسحب من تبويبات أخرى:</div>
                  <ul className="space-y-1 text-xs text-muted-foreground list-disc pr-5">
                    <li>اسم الوكالة والشعار — من تبويب «العلامة التجارية» أعلاه</li>
                    <li>إذا لم يوجد شعار، تظهر العلامة الافتراضية لـ Thiqa</li>
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
                  <Label htmlFor="sig-header">عنوان صفحة التوقيع</Label>
                  <Input
                    id="sig-header"
                    value={sigHeader}
                    onChange={(e) => setSigHeader(e.target.value)}
                    placeholder="نموذج الموافقة على الخصوصية"
                  />
                  <p className="text-xs text-muted-foreground">يظهر في أعلى نص الإقرار</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="sig-body">نص الإقرار</Label>
                  <Textarea
                    id="sig-body"
                    value={sigBody}
                    onChange={(e) => setSigBody(e.target.value)}
                    placeholder="اكتب النص الذي يقرأه العميل قبل التوقيع..."
                    rows={8}
                  />
                  <p className="text-xs text-muted-foreground">
                    اكتب النص بشكل عادي. اترك سطراً فارغاً للفصل بين الفقرات.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="sig-footer">نص الفوتر</Label>
                  <Input
                    id="sig-footer"
                    value={sigFooter}
                    onChange={(e) => setSigFooter(e.target.value)}
                    placeholder="© شركتي - جميع الحقوق محفوظة"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="sig-color" className="flex items-center gap-2">
                    <Palette className="h-4 w-4" />
                    اللون الرئيسي لصفحة التوقيع
                  </Label>
                  <div className="flex items-center gap-3 flex-wrap">
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
                      placeholder={SIGNATURE_DEFAULTS.color}
                      className="ltr-input w-32 font-mono"
                      dir="ltr"
                    />
                    {sigColor.toLowerCase() !== SIGNATURE_DEFAULTS.color.toLowerCase() && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSigColor(SIGNATURE_DEFAULTS.color);
                          toast.success("تم استرجاع اللون الافتراضي — اضغط حفظ لتثبيته");
                        }}
                        className="gap-1.5 h-9 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <RefreshCw className="h-3 w-3" />
                        إعادة للون الافتراضي
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    اللون الافتراضي:{" "}
                    <span
                      className="inline-block h-3 w-3 rounded-sm align-middle border ltr-nums font-mono"
                      style={{ backgroundColor: SIGNATURE_DEFAULTS.color }}
                    />{" "}
                    <span className="font-mono ltr-nums" dir="ltr">{SIGNATURE_DEFAULTS.color}</span>
                  </p>
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
                      <div className="bg-muted/30 rounded-lg p-3 text-xs" dir="rtl" dangerouslySetInnerHTML={createSafeHtml(titlePlainToHtml(sigHeader) + bodyPlainToHtml(sigBody))} />
                      <div className="text-center text-xs text-muted-foreground mt-3 pt-2 border-t" dangerouslySetInnerHTML={createSafeHtml(footerPlainToHtml(sigFooter))} />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="shortcuts">
            <ShortcutsTabContent />
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