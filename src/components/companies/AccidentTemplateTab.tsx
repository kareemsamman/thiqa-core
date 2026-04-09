import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import {
  FileText,
  Upload,
  Settings,
  Save,
  Loader2,
  ExternalLink,
  Trash2,
  Plus,
  AlertTriangle,
} from "lucide-react";
import { FileUploader } from "@/components/media/FileUploader";

interface AccidentTemplate {
  id: string;
  company_id: string;
  template_pdf_url: string;
  mapping_json: Record<string, any>;
  version: string;
  is_active: boolean;
  notes: string | null;
  created_at: string;
}

interface AccidentTemplateTabProps {
  companyId: string;
}

export function AccidentTemplateTab({ companyId }: AccidentTemplateTabProps) {
  const { toast } = useToast();
  const { profile } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [template, setTemplate] = useState<AccidentTemplate | null>(null);

  const [templatePdfUrl, setTemplatePdfUrl] = useState("");
  const [version, setVersion] = useState("1.0");
  const [isActive, setIsActive] = useState(true);
  const [notes, setNotes] = useState("");
  const [mappingJson, setMappingJson] = useState<Record<string, any>>({});
  const [showUploader, setShowUploader] = useState(false);

  const fetchTemplate = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("company_accident_templates")
        .select("*")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setTemplate(data as AccidentTemplate);
        setTemplatePdfUrl(data.template_pdf_url);
        setVersion(data.version);
        setIsActive(data.is_active);
        setNotes(data.notes || "");
        setMappingJson((data.mapping_json as Record<string, any>) || {});
      }
    } catch (error: any) {
      console.error("Error fetching template:", error);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    fetchTemplate();
  }, [fetchTemplate]);

  const handleSave = async () => {
    if (!templatePdfUrl) {
      toast({ title: "خطأ", description: "يرجى رفع ملف PDF للقالب", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const templateData = {
        company_id: companyId,
        template_pdf_url: templatePdfUrl,
        mapping_json: mappingJson,
        version,
        is_active: isActive,
        notes: notes || null,
      };

      if (template) {
        // Update existing
        const { error } = await supabase
          .from("company_accident_templates")
          .update(templateData)
          .eq("id", template.id);

        if (error) throw error;
      } else {
        // Create new
        const { error } = await supabase
          .from("company_accident_templates")
          .insert({
            ...templateData,
            created_by_admin_id: profile?.id,
          });

        if (error) throw error;
      }

      toast({ title: "تم الحفظ", description: "تم حفظ قالب بلاغ الحادث بنجاح" });
      await fetchTemplate();
    } catch (error: any) {
      console.error("Error saving template:", error);
      toast({ 
        title: "خطأ", 
        description: error.message || "فشل في حفظ القالب", 
        variant: "destructive" 
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!template) return;

    if (!confirm("هل أنت متأكد من حذف هذا القالب؟")) return;

    try {
      const { error } = await supabase
        .from("company_accident_templates")
        .delete()
        .eq("id", template.id);

      if (error) throw error;

      toast({ title: "تم الحذف", description: "تم حذف القالب بنجاح" });
      setTemplate(null);
      setTemplatePdfUrl("");
      setVersion("1.0");
      setNotes("");
      setMappingJson({});
    } catch (error: any) {
      console.error("Error deleting template:", error);
      toast({ title: "خطأ", description: "فشل في حذف القالب", variant: "destructive" });
    }
  };

  const handleFileUploaded = async (files: any[]) => {
    if (files.length > 0 && files[0].cdn_url) {
      const uploadedUrl = files[0].cdn_url;
      setTemplatePdfUrl(uploadedUrl);
      setShowUploader(false);

      // Auto-save immediately after upload
      setSaving(true);
      try {
        const templateData = {
          company_id: companyId,
          template_pdf_url: uploadedUrl,
          mapping_json: mappingJson,
          version,
          is_active: isActive,
          notes: notes || null,
        };

        if (template) {
          // Update existing
          const { error } = await supabase
            .from("company_accident_templates")
            .update({ template_pdf_url: uploadedUrl })
            .eq("id", template.id);

          if (error) throw error;
        } else {
          // Create new
          const { error } = await supabase
            .from("company_accident_templates")
            .insert({
              ...templateData,
              created_by_admin_id: profile?.id,
            });

          if (error) throw error;
        }

        toast({ title: "تم الحفظ", description: "تم رفع وحفظ القالب تلقائياً" });
        await fetchTemplate();
      } catch (error: any) {
        console.error("Error auto-saving template:", error);
        toast({ 
          title: "خطأ", 
          description: error.message || "فشل في حفظ القالب تلقائياً", 
          variant: "destructive" 
        });
      } finally {
        setSaving(false);
      }
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-orange-500" />
            قالب بلاغ الحادث
          </h3>
          <p className="text-sm text-muted-foreground">
            قالب PDF خاص بهذه الشركة لإنشاء بلاغات الحوادث
          </p>
        </div>
        {template && (
          <Badge variant="secondary">الإصدار: {template.version}</Badge>
        )}
      </div>

      {/* Template Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">ملف القالب</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {templatePdfUrl ? (
            <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/30">
              <div className="flex items-center gap-3">
                <FileText className="h-10 w-10 text-red-500" />
                <div>
                  <p className="font-medium">قالب PDF</p>
                  <p className="text-sm text-muted-foreground truncate max-w-[300px]">
                    {templatePdfUrl.split("/").pop()}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(templatePdfUrl, "_blank")}
                >
                  <ExternalLink className="h-4 w-4 ml-2" />
                  عرض
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowUploader(true)}
                >
                  <Upload className="h-4 w-4 ml-2" />
                  تغيير
                </Button>
              </div>
            </div>
          ) : (
            <div className="border-2 border-dashed rounded-lg p-8 text-center">
              <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <p className="text-muted-foreground mb-4">لم يتم رفع قالب PDF بعد</p>
              <Button onClick={() => setShowUploader(true)}>
                <Upload className="h-4 w-4 ml-2" />
                رفع ملف PDF
              </Button>
            </div>
          )}

          {showUploader && (
            <div className="border rounded-lg p-4 bg-background">
              <FileUploader
                entityType="company_accident_template"
                entityId={companyId}
                onUploadComplete={handleFileUploaded}
                accept="application/pdf"
              />
              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={() => setShowUploader(false)}
              >
                إلغاء
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Settings Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Settings className="h-4 w-4" />
            إعدادات القالب
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>الإصدار</Label>
              <Input
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="1.0"
              />
            </div>
            <div className="flex items-center justify-between">
              <Label>تفعيل القالب</Label>
              <Switch
                checked={isActive}
                onCheckedChange={setIsActive}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>ملاحظات</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="ملاحظات حول هذا القالب..."
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      {/* Field Mapping Info */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">تعيين الحقول</CardTitle>
            {templatePdfUrl && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.location.href = `/admin/accident-template-mapper/${companyId}`}
              >
                <Settings className="h-4 w-4 ml-2" />
                فتح أداة التصميم
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground space-y-2">
            <p>
              يحدد تعيين الحقول مواقع البيانات على ملف PDF. استخدم أداة تصميم القالب لتحديد مواقع الحقول.
            </p>
            {Object.keys(mappingJson).length > 0 ? (
              <Badge variant="secondary">
                {Object.keys(mappingJson).length} حقل معيّن
              </Badge>
            ) : (
              <Badge variant="outline" className="text-amber-600">
                لم يتم تعيين أي حقول
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex items-center justify-between">
        {template && (
          <Button variant="destructive" onClick={handleDelete}>
            <Trash2 className="h-4 w-4 ml-2" />
            حذف القالب
          </Button>
        )}
        <div className="flex gap-2 mr-auto">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin ml-2" />
            ) : (
              <Save className="h-4 w-4 ml-2" />
            )}
            حفظ القالب
          </Button>
        </div>
      </div>
    </div>
  );
}
