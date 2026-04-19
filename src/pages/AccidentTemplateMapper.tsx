import { useState, useEffect, useRef, useCallback } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Save,
  Loader2,
  ZoomIn,
  ZoomOut,
  Trash2,
  FileText,
  CheckCircle,
  Plus,
  Eye,
  Move,
  Type,
  GripVertical,
} from "lucide-react";

// Load PDF.js from CDN dynamically
const loadPdfJs = (): Promise<any> => {
  return new Promise((resolve, reject) => {
    if ((window as any).pdfjsLib) {
      resolve((window as any).pdfjsLib);
      return;
    }

    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    script.onload = () => {
      const pdfjsLib = (window as any).pdfjsLib;
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      resolve(pdfjsLib);
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
};

// All canonical fields from accident_reports - comprehensive list based on insurance forms
const CANONICAL_FIELDS = [
  // Policy & Insurance
  { id: "policy_number", label: "رقم المعاملة", group: "المعاملة", sample: "POL-2024-12345" },
  { id: "policy_type", label: "نوع المعاملة", group: "المعاملة", sample: "شامل" },
  { id: "policy_start_date", label: "تاريخ بداية التأمين", group: "المعاملة", sample: "2024-01-01" },
  { id: "policy_end_date", label: "تاريخ نهاية التأمين", group: "المعاملة", sample: "2025-01-01" },
  { id: "company_name", label: "اسم شركة التأمين", group: "المعاملة", sample: "ترست للتأمين" },
  
  // Owner (Client) Info
  { id: "owner_name", label: "اسم صاحب السيارة", group: "المالك", sample: "أحمد محمد علي" },
  { id: "owner_id_number", label: "رقم هوية المالك", group: "المالك", sample: "123456789" },
  { id: "owner_phone", label: "هاتف المالك", group: "المالك", sample: "0501234567" },
  { id: "owner_address", label: "عنوان المالك", group: "المالك", sample: "رام الله - شارع الإرسال" },
  
  // Vehicle Info
  { id: "car_number", label: "رقم المركبة", group: "المركبة", sample: "12-345-67" },
  { id: "car_chassis", label: "رقم الشاصي", group: "المركبة", sample: "ABC123XYZ456" },
  { id: "car_manufacturer", label: "الصنع / المصنّع", group: "المركبة", sample: "تويوتا" },
  { id: "car_model", label: "النوع / الموديل", group: "المركبة", sample: "كامري" },
  { id: "car_year", label: "سنة الصنع", group: "المركبة", sample: "2022" },
  { id: "car_color", label: "اللون", group: "المركبة", sample: "أبيض" },
  { id: "car_usage", label: "استعمال السيارة", group: "المركبة", sample: "خصوصي" },
  { id: "vehicle_license_expiry", label: "تاريخ انتهاء رخصة المركبة", group: "المركبة", sample: "2025-06-15" },
  
  // Accident Details
  { id: "accident_date", label: "تاريخ الحادث", group: "الحادث", sample: "2024-06-15" },
  { id: "accident_time", label: "ساعة الحادث", group: "الحادث", sample: "14:30" },
  { id: "accident_location", label: "مكان الحادث", group: "الحادث", sample: "شارع الملك فيصل" },
  { id: "accident_description", label: "كيف وقع الحادث (بالتفصيل)", group: "الحادث", sample: "اصطدام خلفي بسيارة أخرى" },
  { id: "vehicle_usage_purpose", label: "الغرض من استعمال السيارة وقت الحادث", group: "الحادث", sample: "شخصي" },
  { id: "passengers_count", label: "عدد الركاب بالسيارة", group: "الحادث", sample: "2" },
  { id: "responsible_party", label: "من المسؤول عن الحادث", group: "الحادث", sample: "الطرف الآخر" },
  
  // Driver Info
  { id: "driver_name", label: "اسم السائق وقت الحادث", group: "السائق", sample: "خالد عبدالله" },
  { id: "driver_address", label: "عنوان السائق", group: "السائق", sample: "بيت لحم - وادي معالي" },
  { id: "driver_id_number", label: "رقم هوية السائق", group: "السائق", sample: "987654321" },
  { id: "driver_phone", label: "هاتف السائق", group: "السائق", sample: "0509876543" },
  { id: "driver_age", label: "عمر السائق", group: "السائق", sample: "35" },
  { id: "driver_occupation", label: "مهنة السائق", group: "السائق", sample: "موظف" },
  { id: "driver_license_number", label: "رقم رخصة السائق", group: "السائق", sample: "DL-12345" },
  { id: "license_issue_place", label: "مكان صدور الرخصة", group: "السائق", sample: "رام الله" },
  { id: "license_expiry_date", label: "تاريخ انتهاء الرخصة", group: "السائق", sample: "2026-03-20" },
  { id: "first_license_date", label: "تاريخ الحصول الأول على الرخصة", group: "السائق", sample: "2010-05-15" },
  
  // Damages
  { id: "own_car_damages", label: "الأضرار التي لحقت بسيارتك (بالتفصيل)", group: "الأضرار", sample: "كسر في المصد الأمامي وخدوش في غطاء المحرك" },
  { id: "was_anyone_injured", label: "هل أصيب أحد", group: "الأضرار", sample: "لا" },
  { id: "injuries_description", label: "تفاصيل الإصابات الشخصية", group: "الأضرار", sample: "-" },
  
  // Police
  { id: "police_reported", label: "هل حققت الشرطة بالحادث", group: "الشرطة", sample: "نعم" },
  { id: "police_station", label: "مخفر الشرطة", group: "الشرطة", sample: "مركز شرطة رام الله" },
  { id: "police_report_number", label: "رقم المحضر", group: "الشرطة", sample: "PR-2024-789" },
  
  // Witnesses & Passengers
  { id: "witnesses_info", label: "أسماء الشهود وعناوينهم", group: "الشهود والركاب", sample: "محمد أحمد - رام الله" },
  { id: "passengers_info", label: "أسماء الركاب وعناوينهم", group: "الشهود والركاب", sample: "سامي خالد - القدس" },
  { id: "additional_details", label: "تفاصيل إضافية", group: "الشهود والركاب", sample: "-" },
  
  // Third Party
  { id: "third_party_1_name", label: "اسم الطرف الثالث 1 وعنوانه", group: "الطرف الثالث", sample: "سمير حسن - نابلس" },
  { id: "third_party_1_id", label: "هوية الطرف الثالث 1", group: "الطرف الثالث", sample: "111222333" },
  { id: "third_party_1_phone", label: "هاتف الطرف الثالث 1", group: "الطرف الثالث", sample: "0521112222" },
  { id: "third_party_1_car_number", label: "رقم سيارة الطرف الثالث 1", group: "الطرف الثالث", sample: "98-765-43" },
  { id: "third_party_1_car_type", label: "نوع سيارة الطرف الثالث 1", group: "الطرف الثالث", sample: "هيونداي توسان 2020" },
  { id: "third_party_1_insurance", label: "شركة تأمين الطرف الثالث 1", group: "الطرف الثالث", sample: "شركة التأمين الوطنية" },
  { id: "third_party_1_policy", label: "رقم معاملة الطرف الثالث 1", group: "الطرف الثالث", sample: "POL-999888" },
  { id: "third_party_1_damages", label: "أضرار سيارة الطرف الثالث 1", group: "الطرف الثالث", sample: "خدوش في الباب الخلفي" },
  
  // Second Third Party (optional)
  { id: "third_party_2_name", label: "اسم الطرف الثالث 2 وعنوانه", group: "الطرف الثالث 2", sample: "-" },
  { id: "third_party_2_id", label: "هوية الطرف الثالث 2", group: "الطرف الثالث 2", sample: "-" },
  { id: "third_party_2_phone", label: "هاتف الطرف الثالث 2", group: "الطرف الثالث 2", sample: "-" },
  { id: "third_party_2_car_number", label: "رقم سيارة الطرف الثالث 2", group: "الطرف الثالث 2", sample: "-" },
  { id: "third_party_2_car_type", label: "نوع سيارة الطرف الثالث 2", group: "الطرف الثالث 2", sample: "-" },
  { id: "third_party_2_insurance", label: "شركة تأمين الطرف الثالث 2", group: "الطرف الثالث 2", sample: "-" },
  
  // Report metadata
  { id: "report_date", label: "تاريخ التقرير", group: "التقرير", sample: "2024-06-16" },
  { id: "signature_placeholder", label: "مكان التوقيع", group: "التقرير", sample: "_______________" },
 
   // New fields - Owner override
   { id: "owner_name_override", label: "اسم صاحب السيارة (إذا مختلف)", group: "المالك", sample: "محمد أحمد" },
   { id: "owner_phone_override", label: "هاتف صاحب السيارة (إذا مختلف)", group: "المالك", sample: "0501234567" },
   
   // New fields - Driver extended
   { id: "driver_license_grade", label: "درجة رخصة السائق", group: "السائق", sample: "خصوصي" },
   { id: "driver_license_issue_date", label: "تاريخ إصدار رخصة السائق", group: "السائق", sample: "2020-01-15" },
   
   // New fields - Vehicle extended
   { id: "vehicle_chassis_number", label: "رقم الشاصي", group: "المركبة", sample: "JTDKN3DU5A0123456" },
   { id: "vehicle_speed_at_accident", label: "سرعة السيارة وقت الحادث", group: "الحادث", sample: "60 كم/س" },
   
   // New fields - Employee notes
   { id: "employee_notes", label: "ملاحظات الموظف", group: "التقرير", sample: "تم التحقق من البيانات" },
   { id: "employee_signature_date", label: "تاريخ توقيع الموظف", group: "التقرير", sample: "2024-06-17" },
   
   // Customer signature
   { id: "customer_signature", label: "توقيع العميل", group: "التقرير", sample: "[توقيع]" },
];

interface FieldMapping {
  page: number;
  x: number;
  y: number;
  size: number;
  type: "text" | "checkbox" | "freetext";
  freeTextValue?: string;
}

interface MappingJson {
  [fieldId: string]: FieldMapping;
}

export default function AccidentTemplateMapper() {
  const { companyId } = useParams<{ companyId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [company, setCompany] = useState<{ name: string; name_ar: string | null } | null>(null);
  const [templateUrl, setTemplateUrl] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [mappingJson, setMappingJson] = useState<MappingJson>({});

  // PDF rendering
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [pageImages, setPageImages] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pdfLoading, setPdfLoading] = useState(false);

  // Field placement
  const [selectedField, setSelectedField] = useState<string | null>(null);
  const [draggingField, setDraggingField] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  // Free text dialog
  const [freeTextDialogOpen, setFreeTextDialogOpen] = useState(false);
  const [freeTextValue, setFreeTextValue] = useState("");
  const [freeTextCounter, setFreeTextCounter] = useState(1);

  // Preview mode
  const [previewMode, setPreviewMode] = useState(false);

  const canvasContainerRef = useRef<HTMLDivElement>(null);

  // Fetch company and template
  useEffect(() => {
    const fetchData = async () => {
      if (!companyId) return;

      setLoading(true);
      try {
        const { data: companyData } = await supabase
          .from("insurance_companies")
          .select("name, name_ar")
          .eq("id", companyId)
          .single();

        if (companyData) setCompany(companyData);

        const { data: templateData } = await supabase
          .from("company_accident_templates")
          .select("*")
          .eq("company_id", companyId)
          .eq("is_active", true)
          .maybeSingle();

        if (templateData) {
          setTemplateId(templateData.id);
          setTemplateUrl(templateData.template_pdf_url);
          const jsonData = templateData.mapping_json;
          if (jsonData && typeof jsonData === "object" && !Array.isArray(jsonData)) {
            setMappingJson(jsonData as unknown as MappingJson);
            // Count existing free text fields
            const freeTextIds = Object.keys(jsonData).filter((k) => k.startsWith("freetext_"));
            if (freeTextIds.length > 0) {
              const maxNum = Math.max(...freeTextIds.map((id) => parseInt(id.split("_")[1]) || 0));
              setFreeTextCounter(maxNum + 1);
            }
          }
        }
      } catch (error) {
        console.error("Error fetching template:", error);
        toast({ title: "خطأ", description: "فشل في تحميل القالب", variant: "destructive" });
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [companyId, toast]);

  // Load PDF and render pages
  useEffect(() => {
    if (!templateUrl) return;

    let cancelled = false;
    setPdfLoading(true);

    (async () => {
      try {
        // Load PDF.js from CDN
        const pdfjsLib = await loadPdfJs();

        // Fetch via proxy to avoid CORS
        const { data, error } = await supabase.functions.invoke("proxy-cdn-file", {
          body: { url: templateUrl },
        });

        if (error) throw error;
        if (!(data instanceof Blob)) throw new Error("Invalid PDF");

        const arrayBuffer = await data.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

        if (cancelled) return;

        setPdfDoc(pdf);
        setTotalPages(pdf.numPages);

        // Render all pages as images
        const images: string[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d")!;
          canvas.width = viewport.width;
          canvas.height = viewport.height;

          await page.render({ canvasContext: ctx, viewport }).promise;
          images.push(canvas.toDataURL("image/png"));
        }

        if (!cancelled) {
          setPageImages(images);
          setCurrentPage(0);
        }
      } catch (e: any) {
        console.error("PDF load error:", e);
        toast({ title: "خطأ", description: "فشل في تحميل ملف PDF", variant: "destructive" });
      } finally {
        if (!cancelled) setPdfLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [templateUrl, toast]);

  // Handle click on canvas to place field
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!selectedField || draggingField) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const x = (e.clientX - rect.left) / zoom;
      const y = (e.clientY - rect.top) / zoom;

      setMappingJson((prev) => ({
        ...prev,
        [selectedField]: {
          page: currentPage,
          x: Math.round(x),
          y: Math.round(y),
          size: 12,
          type: selectedField.startsWith("freetext_") ? "freetext" : "text",
          ...(selectedField.startsWith("freetext_") ? { freeTextValue: freeTextValue } : {}),
        },
      }));

      const field = CANONICAL_FIELDS.find((f) => f.id === selectedField);
      toast({
        title: "تم تعيين الحقل",
        description: field?.label || selectedField,
      });

      setSelectedField(null);
      setFreeTextValue("");
    },
    [selectedField, currentPage, zoom, toast, draggingField, freeTextValue]
  );

  // Handle drag start
  const handleDragStart = (e: React.MouseEvent, fieldId: string) => {
    e.stopPropagation();
    const mapping = mappingJson[fieldId];
    if (!mapping) return;

    const rect = canvasContainerRef.current?.getBoundingClientRect();
    if (!rect) return;

    setDraggingField(fieldId);
    setDragOffset({
      x: e.clientX - rect.left - mapping.x * zoom,
      y: e.clientY - rect.top - mapping.y * zoom,
    });
  };

  // Handle drag move
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!draggingField) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const x = (e.clientX - rect.left - dragOffset.x) / zoom;
      const y = (e.clientY - rect.top - dragOffset.y) / zoom;

      setMappingJson((prev) => ({
        ...prev,
        [draggingField]: {
          ...prev[draggingField],
          x: Math.max(0, Math.round(x)),
          y: Math.max(0, Math.round(y)),
        },
      }));
    },
    [draggingField, dragOffset, zoom]
  );

  // Handle drag end
  const handleMouseUp = useCallback(() => {
    if (draggingField) {
      setDraggingField(null);
    }
  }, [draggingField]);

  // Remove field mapping
  const removeFieldMapping = (fieldId: string) => {
    setMappingJson((prev) => {
      const newMapping = { ...prev };
      delete newMapping[fieldId];
      return newMapping;
    });
  };

  // Add free text field
  const handleAddFreeText = () => {
    if (!freeTextValue.trim()) {
      toast({ title: "خطأ", description: "يرجى إدخال النص", variant: "destructive" });
      return;
    }

    const fieldId = `freetext_${freeTextCounter}`;
    setSelectedField(fieldId);
    setFreeTextCounter((c) => c + 1);
    setFreeTextDialogOpen(false);

    toast({ title: "اختر موقع النص", description: "انقر على PDF لوضع النص" });
  };

  // Save mapping
  const handleSave = async () => {
    if (!templateId) {
      toast({ title: "خطأ", description: "لا يوجد قالب للحفظ", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from("company_accident_templates")
        .update({ mapping_json: JSON.parse(JSON.stringify(mappingJson)) })
        .eq("id", templateId);

      if (error) throw error;

      toast({ title: "تم الحفظ", description: "تم حفظ تعيين الحقول بنجاح" });
    } catch (error: any) {
      console.error("Error saving mapping:", error);
      toast({ title: "خطأ", description: "فشل في حفظ التعيين", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // Group fields by category
  const fieldsByGroup = CANONICAL_FIELDS.reduce(
    (acc, field) => {
      if (!acc[field.group]) acc[field.group] = [];
      acc[field.group].push(field);
      return acc;
    },
    {} as Record<string, typeof CANONICAL_FIELDS>
  );

  // Get display text for a field
  const getFieldDisplayText = (fieldId: string, inPreview: boolean) => {
    if (fieldId.startsWith("freetext_")) {
      return mappingJson[fieldId]?.freeTextValue || "نص حر";
    }
    const field = CANONICAL_FIELDS.find((f) => f.id === fieldId);
    if (!field) return fieldId;
    return inPreview ? field.sample : field.label;
  };

  if (loading) {
    return (
      <MainLayout>
        <div className="p-6 space-y-6" dir="rtl">
          <Skeleton className="h-10 w-48" />
          <div className="grid grid-cols-4 gap-4">
            <Skeleton className="h-[600px]" />
            <Skeleton className="h-[600px] col-span-3" />
          </div>
        </div>
      </MainLayout>
    );
  }

  if (!templateUrl) {
    return (
      <MainLayout>
        <div className="flex flex-col items-center justify-center h-[60vh] gap-4" dir="rtl">
          <FileText className="h-16 w-16 text-muted-foreground" />
          <h2 className="text-xl font-semibold">لا يوجد قالب PDF</h2>
          <p className="text-muted-foreground">يرجى رفع قالب PDF أولاً من صفحة الشركة</p>
          <Button onClick={() => navigate(-1)}>
            <ArrowRight className="h-4 w-4 ml-2" />
            العودة
          </Button>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="h-[calc(100vh-80px)] flex flex-col" dir="rtl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
              <ArrowRight className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-xl font-bold">تعيين حقول القالب</h1>
              <p className="text-sm text-muted-foreground">
                {company?.name_ar || company?.name}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Badge variant="secondary">
              {Object.keys(mappingJson).length} حقل معيّن
            </Badge>
            <Button
              variant={previewMode ? "default" : "outline"}
              onClick={() => setPreviewMode(!previewMode)}
            >
              <Eye className="h-4 w-4 ml-2" />
              {previewMode ? "إنهاء المعاينة" : "معاينة بالبيانات"}
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin ml-2" />
              ) : (
                <Save className="h-4 w-4 ml-2" />
              )}
              حفظ التعيين
            </Button>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Page Thumbnails */}
          <div className="w-24 border-l bg-muted/30 flex flex-col">
            <div className="p-2 border-b text-center text-xs font-medium">
              الصفحات
            </div>
            <ScrollArea className="flex-1">
              <div className="p-2 space-y-2">
                {pdfLoading ? (
                  Array.from({ length: 2 }).map((_, i) => (
                    <Skeleton key={i} className="aspect-[3/4] w-full" />
                  ))
                ) : (
                  pageImages.map((img, idx) => (
                    <div
                      key={idx}
                      onClick={() => setCurrentPage(idx)}
                      className={`cursor-pointer border-2 rounded overflow-hidden transition-all ${
                        currentPage === idx
                          ? "border-primary ring-2 ring-primary/30"
                          : "border-transparent hover:border-muted-foreground/30"
                      }`}
                    >
                      <img src={img} alt={`صفحة ${idx + 1}`} className="w-full" />
                      <div className="text-xs text-center py-1 bg-background">
                        {idx + 1}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>

          {/* Fields Panel */}
          <div className="w-72 border-l bg-muted/30 flex flex-col">
            <div className="p-3 border-b">
              <h3 className="font-medium mb-1">الحقول المتاحة</h3>
              <p className="text-xs text-muted-foreground">
                {selectedField
                  ? "انقر على PDF لوضع الحقل"
                  : "اختر حقلاً ثم انقر على موقعه"}
              </p>
            </div>

            <ScrollArea className="flex-1 p-3">
              <div className="space-y-4">
                {/* Add Free Text Button */}
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => setFreeTextDialogOpen(true)}
                >
                  <Type className="h-4 w-4 ml-2" />
                  إضافة نص حر
                </Button>

                {Object.entries(fieldsByGroup).map(([group, fields]) => (
                  <div key={group}>
                    <h4 className="text-sm font-medium text-muted-foreground mb-2">
                      {group}
                    </h4>
                    <div className="space-y-1">
                      {fields.map((field) => {
                        const isMapped = !!mappingJson[field.id];
                        const isSelected = selectedField === field.id;

                        return (
                          <div
                            key={field.id}
                            className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors text-sm ${
                              isSelected
                                ? "bg-primary text-primary-foreground"
                                : isMapped
                                ? "bg-green-500/10 hover:bg-green-500/20"
                                : "bg-background hover:bg-muted"
                            }`}
                            onClick={() =>
                              setSelectedField(isSelected ? null : field.id)
                            }
                          >
                            <div className="flex items-center gap-2">
                              {isMapped && !isSelected && (
                                <CheckCircle className="h-3 w-3 text-green-600" />
                              )}
                              {isSelected && <Move className="h-3 w-3" />}
                              <span>{field.label}</span>
                            </div>
                            {isMapped && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-5 w-5"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeFieldMapping(field.id);
                                }}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}

                {/* Free Text Fields */}
                {Object.keys(mappingJson).filter((k) => k.startsWith("freetext_"))
                  .length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground mb-2">
                      نصوص حرة
                    </h4>
                    <div className="space-y-1">
                      {Object.entries(mappingJson)
                        .filter(([k]) => k.startsWith("freetext_"))
                        .map(([fieldId, mapping]) => (
                          <div
                            key={fieldId}
                            className="flex items-center justify-between p-2 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 text-sm"
                          >
                            <span className="truncate flex-1">
                              {mapping.freeTextValue || "نص حر"}
                            </span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5"
                              onClick={() => removeFieldMapping(fieldId)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>

          {/* PDF Preview */}
          <div className="flex-1 flex flex-col bg-muted/50">
            {/* Toolbar */}
            <div className="flex items-center justify-between p-3 border-b bg-background">
              <div className="flex items-center gap-2">
                <span className="text-sm">
                  صفحة {currentPage + 1} / {totalPages || 1}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
                >
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <span className="text-sm min-w-[50px] text-center">
                  {Math.round(zoom * 100)}%
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setZoom((z) => Math.min(2, z + 0.25))}
                >
                  <ZoomIn className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Canvas Area */}
            <div className="flex-1 overflow-auto p-4 flex items-start justify-center">
              {pdfLoading ? (
                <Skeleton className="w-[600px] h-[800px]" />
              ) : pageImages[currentPage] ? (
                <div
                  ref={canvasContainerRef}
                  className="relative bg-white shadow-lg cursor-crosshair"
                  style={{
                    transform: `scale(${zoom})`,
                    transformOrigin: "top center",
                  }}
                  onClick={handleCanvasClick}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                >
                  <img
                    src={pageImages[currentPage]}
                    alt={`صفحة ${currentPage + 1}`}
                    draggable={false}
                    className="select-none"
                  />

                  {/* Field markers */}
                  {Object.entries(mappingJson)
                    .filter(([_, mapping]) => mapping.page === currentPage)
                    .map(([fieldId, mapping]) => (
                      <div
                        key={fieldId}
                        className={`absolute flex items-center gap-1 px-1.5 py-0.5 rounded shadow-sm cursor-move select-none ${
                          fieldId.startsWith("freetext_")
                            ? "bg-purple-500 text-white"
                            : previewMode
                            ? "bg-blue-600 text-white"
                            : "bg-primary/90 text-primary-foreground"
                        } ${draggingField === fieldId ? "opacity-70" : ""}`}
                        style={{
                          left: mapping.x,
                          top: mapping.y,
                          fontSize: mapping.size,
                        }}
                        onMouseDown={(e) => handleDragStart(e, fieldId)}
                      >
                        <GripVertical className="h-3 w-3 opacity-60" />
                        <span>{getFieldDisplayText(fieldId, previewMode)}</span>
                      </div>
                    ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-[400px] gap-3">
                  <FileText className="h-12 w-12 text-muted-foreground" />
                  <p className="text-muted-foreground">لا توجد صفحات للعرض</p>
                </div>
              )}
            </div>

            {/* Status Bar */}
            {selectedField && (
              <div className="p-3 border-t bg-primary/10 text-sm text-center">
                <Move className="h-4 w-4 inline ml-2" />
                انقر على PDF لوضع:{" "}
                <strong>
                  {selectedField.startsWith("freetext_")
                    ? freeTextValue
                    : CANONICAL_FIELDS.find((f) => f.id === selectedField)?.label}
                </strong>
              </div>
            )}
          </div>
        </div>

        {/* Free Text Dialog */}
        <Dialog open={freeTextDialogOpen} onOpenChange={setFreeTextDialogOpen}>
          <DialogContent dir="rtl">
            <DialogHeader>
              <DialogTitle>إضافة نص حر</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>النص</Label>
                <Input
                  value={freeTextValue}
                  onChange={(e) => setFreeTextValue(e.target.value)}
                  placeholder="أدخل النص الذي تريد إضافته..."
                />
              </div>
              <p className="text-xs text-muted-foreground">
                سيظهر هذا النص بشكل ثابت في كل بلاغ حادث
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setFreeTextDialogOpen(false)}>
                إلغاء
              </Button>
              <Button onClick={handleAddFreeText}>
                <Plus className="h-4 w-4 ml-2" />
                إضافة
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
