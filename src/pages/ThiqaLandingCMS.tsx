import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Save, Loader2, Type, Image, ExternalLink, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";

type ContentRow = {
  id: string;
  section_key: string;
  content_type: string;
  text_value: string | null;
  image_url: string | null;
  json_value: any;
  updated_at: string;
};

const SECTION_GROUPS: { id: string; label: string; keys: { key: string; label: string; multiline?: boolean }[] }[] = [
  {
    id: "hero",
    label: "القسم الرئيسي (Hero)",
    keys: [
      { key: "hero_title", label: "العنوان الرئيسي", multiline: true },
      { key: "hero_subtitle", label: "النص الفرعي", multiline: true },
      { key: "hero_cta", label: "نص الزر" },
      { key: "navbar_cta", label: "نص زر شريط التنقل" },
      { key: "hero_bg_image", label: "صورة الخلفية (URL)" },
      { key: "dashboard_mockup_image", label: "صورة Dashboard (URL)" },
    ],
  },
  {
    id: "benefits",
    label: "قسم المميزات",
    keys: [
      { key: "benefits_section_label", label: "التسمية" },
      { key: "benefits_section_title", label: "العنوان" },
      { key: "benefits_section_subtitle", label: "الوصف" },
      { key: "benefit_card_1_title", label: "بطاقة 1 - العنوان" },
      { key: "benefit_card_1_desc", label: "بطاقة 1 - الوصف", multiline: true },
      { key: "benefit_card_1_image", label: "بطاقة 1 - صورة (URL)" },
      { key: "benefit_card_2_title", label: "بطاقة 2 - العنوان" },
      { key: "benefit_card_2_desc", label: "بطاقة 2 - الوصف", multiline: true },
      { key: "benefit_card_2_image", label: "بطاقة 2 - صورة (URL)" },
      { key: "benefit_card_3_title", label: "بطاقة 3 - العنوان" },
      { key: "benefit_card_3_desc", label: "بطاقة 3 - الوصف", multiline: true },
      { key: "benefit_card_3_image", label: "بطاقة 3 - صورة (URL)" },
    ],
  },
  {
    id: "showcase",
    label: "قسم العرض التوضيحي",
    keys: [
      { key: "showcase_label", label: "التسمية" },
      { key: "showcase_title", label: "العنوان" },
      { key: "showcase_subtitle", label: "الوصف" },
      { key: "features_mockup_image", label: "صورة الميزات (URL)" },
    ],
  },
  {
    id: "slider",
    label: "قسم السلايدر",
    keys: [
      { key: "slider_title", label: "العنوان" },
      { key: "slider_bg_image", label: "صورة الخلفية (URL)" },
    ],
  },
  {
    id: "grid",
    label: "قسم الشبكة",
    keys: [
      { key: "grid_label", label: "التسمية" },
      { key: "grid_title", label: "العنوان" },
      { key: "grid_desc", label: "الوصف", multiline: true },
      { key: "grid_logo_bg_image", label: "صورة الخلفية (URL)" },
    ],
  },
  {
    id: "testimonials",
    label: "قسم الشهادات",
    keys: [
      { key: "testimonials_label", label: "التسمية" },
      { key: "testimonials_title", label: "العنوان" },
      { key: "testimonials_stat_1", label: "إحصائية 1 (رقم)" },
      { key: "testimonials_stat_1_desc", label: "إحصائية 1 (وصف)" },
      { key: "testimonials_stat_2", label: "إحصائية 2 (رقم)" },
      { key: "testimonials_stat_2_desc", label: "إحصائية 2 (وصف)" },
    ],
  },
  {
    id: "faq",
    label: "الأسئلة الشائعة",
    keys: [
      { key: "faq_label", label: "التسمية" },
      { key: "faq_title", label: "العنوان" },
    ],
  },
  {
    id: "pricing",
    label: "صفحة الأسعار",
    keys: [
      { key: "pricing_label", label: "التسمية" },
      { key: "pricing_title", label: "العنوان" },
      { key: "pricing_subtitle", label: "النص الفرعي" },
    ],
  },
];

export default function ThiqaLandingCMS() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [localValues, setLocalValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(new Set());

  const { data: rows, isLoading } = useQuery({
    queryKey: ["landing-content-admin"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("landing_content" as any)
        .select("*")
        .order("section_key");
      if (error) throw error;
      return (data as any) as ContentRow[];
    },
  });

  useEffect(() => {
    if (rows) {
      const vals: Record<string, string> = {};
      rows.forEach((r) => {
        if (r.content_type === "image") {
          vals[r.section_key] = r.image_url || "";
        } else {
          vals[r.section_key] = r.text_value || "";
        }
      });
      setLocalValues(vals);
      setDirtyKeys(new Set());
    }
  }, [rows]);

  const handleChange = (key: string, value: string) => {
    setLocalValues((prev) => ({ ...prev, [key]: value }));
    setDirtyKeys((prev) => new Set(prev).add(key));
  };

  const isImageKey = (key: string) => {
    const row = rows?.find((r) => r.section_key === key);
    return row?.content_type === "image" || key.includes("_image");
  };

  const saveAll = async () => {
    if (dirtyKeys.size === 0) return;
    setSaving(true);
    try {
      for (const key of dirtyKeys) {
        const isImg = isImageKey(key);
        const updateData = isImg
          ? { image_url: localValues[key] || null, updated_at: new Date().toISOString() }
          : { text_value: localValues[key] || null, updated_at: new Date().toISOString() };

        const { error } = await (supabase.from("landing_content" as any) as any)
          .update(updateData)
          .eq("section_key", key);
        if (error) throw error;
      }
      toast.success(`تم حفظ ${dirtyKeys.size} تعديل`);
      setDirtyKeys(new Set());
      queryClient.invalidateQueries({ queryKey: ["landing-content-admin"] });
      queryClient.invalidateQueries({ queryKey: ["landing-content"] });
    } catch (err: any) {
      toast.error(err.message || "خطأ في الحفظ");
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <MainLayout>
        <div className="p-6 space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-96 w-full" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="p-4 md:p-6 max-w-5xl space-y-4" dir="rtl">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/thiqa/settings")}>
              <ArrowRight className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-xl md:text-2xl font-bold">إدارة محتوى Landing و Pricing</h1>
              <p className="text-sm text-muted-foreground">تعديل النصوص والصور المعروضة على الموقع</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {dirtyKeys.size > 0 && (
              <Badge variant="secondary" className="text-xs">
                {dirtyKeys.size} تعديل غير محفوظ
              </Badge>
            )}
            <Button onClick={saveAll} disabled={saving || dirtyKeys.size === 0}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <Save className="h-4 w-4 ml-2" />}
              حفظ الكل
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href="/landing" target="_blank" rel="noopener">
                <ExternalLink className="h-4 w-4 ml-1" />
                معاينة
              </a>
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="hero" className="space-y-4">
          <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
            <TabsList className="inline-flex h-auto gap-1 w-max">
              {SECTION_GROUPS.map((g) => (
                <TabsTrigger key={g.id} value={g.id} className="text-xs md:text-sm px-2 md:px-3 whitespace-nowrap">
                  {g.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {SECTION_GROUPS.map((group) => (
            <TabsContent key={group.id} value={group.id}>
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">{group.label}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                  {group.keys.map((field) => {
                    const isImg = isImageKey(field.key);
                    const isDirty = dirtyKeys.has(field.key);
                    return (
                      <div key={field.key} className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          {isImg ? (
                            <Image className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <Type className="h-4 w-4 text-muted-foreground" />
                          )}
                          <label className="text-sm font-medium">{field.label}</label>
                          {isDirty && (
                            <Badge variant="outline" className="text-[10px] border-warning text-warning">
                              معدّل
                            </Badge>
                          )}
                        </div>
                        {isImg ? (
                          <div className="space-y-2">
                            <Input
                              value={localValues[field.key] || ""}
                              onChange={(e) => handleChange(field.key, e.target.value)}
                              placeholder="https://cdn.example.com/image.png"
                              dir="ltr"
                              className="font-mono text-sm"
                            />
                            {localValues[field.key] && (
                              <div className="border rounded-lg p-2 bg-muted/30">
                                <img
                                  src={localValues[field.key]}
                                  alt="Preview"
                                  className="max-h-32 object-contain rounded"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = "none";
                                  }}
                                />
                              </div>
                            )}
                          </div>
                        ) : field.multiline ? (
                          <Textarea
                            value={localValues[field.key] || ""}
                            onChange={(e) => handleChange(field.key, e.target.value)}
                            rows={3}
                            className="resize-none"
                          />
                        ) : (
                          <Input
                            value={localValues[field.key] || ""}
                            onChange={(e) => handleChange(field.key, e.target.value)}
                          />
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </MainLayout>
  );
}
