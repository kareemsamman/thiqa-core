import { useState, useEffect, useRef, useCallback } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
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
  Plus,
  Type,
  GripVertical,
  Printer,
  Bold,
  Underline,
  Palette,
  Copy,
  ClipboardPaste,
} from "lucide-react";

// Load PDF.js from CDN
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

interface OverlayField {
  id: string;
  page: number;
  x: number;
  y: number;
  text: string;
  fontSize: number;
  color?: string;
  bold?: boolean;
  underline?: boolean;
  width?: number;
  height?: number;
}

export default function FormTemplateEditor() {
  const { fileId } = useParams<{ fileId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [file, setFile] = useState<any>(null);
  const [overlayFields, setOverlayFields] = useState<OverlayField[]>([]);

  // PDF/Image rendering
  const [pageImages, setPageImages] = useState<string[]>([]);
  const [pageNaturalSizes, setPageNaturalSizes] = useState<{ w: number; h: number }[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [contentLoading, setContentLoading] = useState(false);

  // Interaction
  const [addingText, setAddingText] = useState(false);
  const [draggingField, setDraggingField] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);

  // Inline editing
  const [inlineEditId, setInlineEditId] = useState<string | null>(null);
  const [inlineEditText, setInlineEditText] = useState("");

  // Clipboard
  const [clipboardField, setClipboardField] = useState<OverlayField | null>(null);

  // Resize
  const [resizingField, setResizingField] = useState<string | null>(null);
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, w: 0, h: 0 });

  const canvasContainerRef = useRef<HTMLDivElement>(null);

  // Fetch file data
  useEffect(() => {
    if (!fileId) return;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from("form_template_files")
          .select("*")
          .eq("id", fileId)
          .single();
        if (error) throw error;
        setFile(data);
        const fields = Array.isArray(data.overlay_fields) ? data.overlay_fields : [];
        setOverlayFields(fields as unknown as OverlayField[]);
      } catch (err: any) {
        toast({ title: "خطأ", description: "فشل تحميل الملف", variant: "destructive" });
      } finally {
        setLoading(false);
      }
    })();
  }, [fileId, toast]);

  // Load content (PDF or image)
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    setContentLoading(true);

    (async () => {
      try {
        if (file.file_type === "pdf") {
          const pdfjsLib = await loadPdfJs();
          const { data, error } = await supabase.functions.invoke("proxy-cdn-file", {
            body: { url: file.file_url },
          });
          if (error) throw error;
          if (!(data instanceof Blob)) throw new Error("Invalid PDF");

          const arrayBuffer = await data.arrayBuffer();
          const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
          if (cancelled) return;

          setTotalPages(pdf.numPages);
          const images: string[] = [];
          const sizes: { w: number; h: number }[] = [];
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 1.5 });
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d")!;
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            await page.render({ canvasContext: ctx, viewport }).promise;
            images.push(canvas.toDataURL("image/png"));
            sizes.push({ w: viewport.width, h: viewport.height });
          }
          if (!cancelled) {
            setPageImages(images);
            setPageNaturalSizes(sizes);
            setCurrentPage(0);
          }
        } else {
          setTotalPages(1);
          setPageImages([file.file_url]);
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => {
            if (!cancelled) {
              setPageNaturalSizes([{ w: img.naturalWidth, h: img.naturalHeight }]);
            }
          };
          img.src = file.file_url;
          setCurrentPage(0);
        }
      } catch (e: any) {
        console.error("Content load error:", e);
        toast({ title: "خطأ", description: "فشل في تحميل المحتوى", variant: "destructive" });
      } finally {
        if (!cancelled) setContentLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [file, toast]);

  // Keyboard shortcuts: Ctrl+C / Ctrl+V / Delete
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept when editing inline
      if (inlineEditId) return;

      if ((e.ctrlKey || e.metaKey) && e.key === "c" && selectedFieldId) {
        e.preventDefault();
        const field = overlayFields.find((f) => f.id === selectedFieldId);
        if (field) setClipboardField({ ...field });
        toast({ title: "تم النسخ" });
      }

      if ((e.ctrlKey || e.metaKey) && e.key === "v" && clipboardField) {
        e.preventDefault();
        const newField: OverlayField = {
          ...clipboardField,
          id: `field_${Date.now()}`,
          page: currentPage,
          x: clipboardField.x + 20,
          y: clipboardField.y + 20,
        };
        setOverlayFields((prev) => [...prev, newField]);
        setSelectedFieldId(newField.id);
        toast({ title: "تم اللصق" });
      }

      if (e.key === "Delete" && selectedFieldId && !inlineEditId) {
        removeField(selectedFieldId);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedFieldId, clipboardField, currentPage, overlayFields, inlineEditId]);

  // Click on canvas to place new text
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!addingText || draggingField || resizingField) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const x = (e.clientX - rect.left) / zoom;
      const y = (e.clientY - rect.top) / zoom;

      const newId = `field_${Date.now()}`;
      const newField: OverlayField = {
        id: newId,
        page: currentPage,
        x: Math.round(x),
        y: Math.round(y),
        text: "نص جديد",
        fontSize: 14,
        color: "#000000",
        bold: false,
        underline: false,
      };

      setOverlayFields((prev) => [...prev, newField]);
      setAddingText(false);
      setSelectedFieldId(newId);
      setInlineEditId(newId);
      setInlineEditText("نص جديد");
    },
    [addingText, currentPage, zoom, draggingField, resizingField]
  );

  // Drag start
  const handleDragStart = (e: React.MouseEvent, fieldId: string) => {
    if (inlineEditId === fieldId || resizingField) return;
    e.stopPropagation();
    const field = overlayFields.find((f) => f.id === fieldId);
    if (!field) return;
    const rect = canvasContainerRef.current?.getBoundingClientRect();
    if (!rect) return;

    setDraggingField(fieldId);
    setDragOffset({
      x: e.clientX - rect.left - field.x * zoom,
      y: e.clientY - rect.top - field.y * zoom,
    });
  };

  // Drag move + Resize move
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (resizingField) {
        const dx = (e.clientX - resizeStart.x) / zoom;
        const dy = (e.clientY - resizeStart.y) / zoom;
        setOverlayFields((prev) =>
          prev.map((f) =>
            f.id === resizingField
              ? { ...f, width: Math.max(30, Math.round(resizeStart.w + dx)), height: Math.max(16, Math.round(resizeStart.h + dy)) }
              : f
          )
        );
        return;
      }
      if (!draggingField) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = (e.clientX - rect.left - dragOffset.x) / zoom;
      const y = (e.clientY - rect.top - dragOffset.y) / zoom;

      setOverlayFields((prev) =>
        prev.map((f) =>
          f.id === draggingField
            ? { ...f, x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)) }
            : f
        )
      );
    },
    [draggingField, dragOffset, zoom, resizingField, resizeStart]
  );

  const handleMouseUp = useCallback(() => {
    if (draggingField) setDraggingField(null);
    if (resizingField) setResizingField(null);
  }, [draggingField, resizingField]);

  // Resize start
  const handleResizeStart = (e: React.MouseEvent, field: OverlayField) => {
    e.stopPropagation();
    e.preventDefault();
    setResizingField(field.id);
    setResizeStart({
      x: e.clientX,
      y: e.clientY,
      w: field.width || 100,
      h: field.height || (field.fontSize + 8),
    });
  };

  // Inline edit helpers
  const startInlineEdit = (field: OverlayField) => {
    setInlineEditId(field.id);
    setInlineEditText(field.text);
  };

  const saveInlineEdit = () => {
    if (!inlineEditId) return;
    const trimmed = inlineEditText.trim();
    if (trimmed) {
      setOverlayFields((prev) =>
        prev.map((f) => (f.id === inlineEditId ? { ...f, text: trimmed } : f))
      );
    } else {
      setOverlayFields((prev) => prev.filter((f) => f.id !== inlineEditId));
    }
    setInlineEditId(null);
    setInlineEditText("");
  };

  // Delete field
  const removeField = (fieldId: string) => {
    setOverlayFields((prev) => prev.filter((f) => f.id !== fieldId));
    if (selectedFieldId === fieldId) setSelectedFieldId(null);
    if (inlineEditId === fieldId) { setInlineEditId(null); setInlineEditText(""); }
  };

  // Change font size
  const changeFontSize = (fieldId: string, delta: number) => {
    setOverlayFields((prev) =>
      prev.map((f) =>
        f.id === fieldId ? { ...f, fontSize: Math.max(8, Math.min(72, f.fontSize + delta)) } : f
      )
    );
  };

  // Toggle bold/underline
  const toggleBold = (fieldId: string) => {
    setOverlayFields((prev) =>
      prev.map((f) => (f.id === fieldId ? { ...f, bold: !f.bold } : f))
    );
  };
  const toggleUnderline = (fieldId: string) => {
    setOverlayFields((prev) =>
      prev.map((f) => (f.id === fieldId ? { ...f, underline: !f.underline } : f))
    );
  };
  const changeColor = (fieldId: string, color: string) => {
    setOverlayFields((prev) =>
      prev.map((f) => (f.id === fieldId ? { ...f, color } : f))
    );
  };

  // Save overlay fields
  const handleSave = async () => {
    if (!fileId) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("form_template_files")
        .update({ overlay_fields: JSON.parse(JSON.stringify(overlayFields)) })
        .eq("id", fileId);
      if (error) throw error;
      toast({ title: "تم الحفظ بنجاح" });
    } catch (err: any) {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // Print with percentage-based positioning
  const handlePrint = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const pagesHtml = pageImages
      .map((img, pageIdx) => {
        const fieldsOnPage = overlayFields.filter((f) => f.page === pageIdx);
        const size = pageNaturalSizes[pageIdx];
        const natW = size ? size.w : 800;
        const natH = size ? size.h : 1100;

        const fieldsHtml = fieldsOnPage
          .map((f) => {
            const leftPct = (f.x / natW) * 100;
            const topPct = (f.y / natH) * 100;
            const fontSizePct = (f.fontSize / natW) * 100;
            const fw = f.bold ? "bold" : "normal";
            const td = f.underline ? "underline" : "none";
            const color = f.color || "#000";
            const widthStyle = f.width ? `width:${(f.width / natW) * 100}%;word-wrap:break-word;` : "white-space:nowrap;";
            const heightStyle = f.height ? `height:${(f.height / natH) * 100}%;overflow:hidden;` : "";
            return `<div style="position:absolute;left:${leftPct}%;top:${topPct}%;font-size:${fontSizePct}vw;font-family:Arial,sans-serif;color:${color};font-weight:${fw};text-decoration:${td};direction:rtl;${widthStyle}${heightStyle}">${f.text}</div>`;
          })
          .join("");

        return `<div style="position:relative;width:100%;page-break-after:always;overflow:hidden;">
          <img src="${img}" style="width:100%;display:block;" />
          ${fieldsHtml}
        </div>`;
      })
      .join("");

    printWindow.document.write(`
      <!DOCTYPE html>
      <html dir="rtl">
      <head><title>طباعة - ${file?.name || ""}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        @page { margin: 0; size: auto; }
        body { margin: 0; padding: 0; }
        @media print {
          body { margin: 0; }
          div { page-break-inside: avoid; }
        }
      </style>
      </head>
      <body>${pagesHtml}</body>
      </html>
    `);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 500);
  };

  const handleStartAddText = () => {
    setAddingText(true);
    toast({ title: "انقر على الموقع المطلوب", description: "انقر على المكان الذي تريد وضع النص فيه" });
  };

  const handleGoBack = () => {
    if (file?.folder_id) {
      navigate(`/form-templates?folder=${file.folder_id}`);
    } else {
      navigate("/form-templates");
    }
  };

  if (loading) {
    return (
      <MainLayout>
        <div className="p-6 space-y-4" dir="rtl">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-[600px]" />
        </div>
      </MainLayout>
    );
  }

  if (!file) {
    return (
      <MainLayout>
        <div className="flex flex-col items-center justify-center h-[60vh] gap-4" dir="rtl">
          <FileText className="h-16 w-16 text-muted-foreground" />
          <h2 className="text-xl font-semibold">الملف غير موجود</h2>
          <Button onClick={() => navigate("/form-templates")}>
            <ArrowRight className="h-4 w-4 ml-2" />
            العودة
          </Button>
        </div>
      </MainLayout>
    );
  }

  const currentPageFields = overlayFields.filter((f) => f.page === currentPage);
  const selectedField = overlayFields.find((f) => f.id === selectedFieldId);

  return (
    <MainLayout>
      <div className="h-[calc(100vh-80px)] flex flex-col" dir="rtl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={handleGoBack}>
              <ArrowRight className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-lg font-bold">{file.name}</h1>
              <p className="text-xs text-muted-foreground">
                {file.file_type === "pdf" ? "PDF" : "صورة"} • {overlayFields.length} حقل نصي
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleStartAddText}>
              <Plus className="h-4 w-4 ml-1" />
              إضافة نص
            </Button>
            <Button variant="outline" size="sm" onClick={handlePrint}>
              <Printer className="h-4 w-4 ml-1" />
              طباعة
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : <Save className="h-4 w-4 ml-1" />}
              حفظ
            </Button>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Page Thumbnails (PDF only) */}
          {file.file_type === "pdf" && totalPages > 1 && (
            <div className="w-24 border-l bg-muted/30 flex flex-col">
              <div className="p-2 border-b text-center text-xs font-medium">الصفحات</div>
              <ScrollArea className="flex-1">
                <div className="p-2 space-y-2">
                  {contentLoading
                    ? Array.from({ length: 2 }).map((_, i) => (
                        <Skeleton key={i} className="aspect-[3/4] w-full" />
                      ))
                    : pageImages.map((img, idx) => (
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
                          <div className="text-xs text-center py-1 bg-background">{idx + 1}</div>
                        </div>
                      ))}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* Fields Panel */}
          <div className="w-64 border-l bg-muted/30 flex flex-col">
            <div className="p-3 border-b">
              <h3 className="font-medium text-sm">النصوص المضافة</h3>
              <p className="text-xs text-muted-foreground mt-1">
                {addingText ? "انقر على الصورة لوضع النص" : "انقر مرتين لتعديل • Ctrl+C/V للنسخ"}
              </p>
            </div>

            {/* Formatting toolbar for selected field */}
            {selectedField && (
              <div className="p-3 border-b bg-background space-y-2">
                <p className="text-xs font-medium text-muted-foreground">تنسيق الحقل المحدد</p>
                <div className="flex items-center gap-1 flex-wrap">
                  <Button
                    variant={selectedField.bold ? "default" : "outline"}
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => toggleBold(selectedField.id)}
                    title="عريض"
                  >
                    <Bold className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant={selectedField.underline ? "default" : "outline"}
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => toggleUnderline(selectedField.id)}
                    title="تسطير"
                  >
                    <Underline className="h-3.5 w-3.5" />
                  </Button>
                  <div className="relative">
                    <input
                      type="color"
                      value={selectedField.color || "#000000"}
                      onChange={(e) => changeColor(selectedField.id, e.target.value)}
                      className="w-7 h-7 rounded border cursor-pointer"
                      title="لون النص"
                    />
                  </div>
                  <div className="border-r mx-1 h-5" />
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => changeFontSize(selectedField.id, -2)}
                  >
                    <span className="text-xs">A-</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => changeFontSize(selectedField.id, 2)}
                  >
                    <span className="text-xs">A+</span>
                  </Button>
                  <div className="border-r mx-1 h-5" />
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => {
                      setClipboardField({ ...selectedField });
                      toast({ title: "تم النسخ" });
                    }}
                    title="نسخ"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 hover:text-destructive"
                    onClick={() => removeField(selectedField.id)}
                    title="حذف"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="text-xs text-muted-foreground">
                  {selectedField.fontSize}px • ص{selectedField.page + 1}
                  {selectedField.width ? ` • ${selectedField.width}×${selectedField.height || "auto"}` : ""}
                </div>
              </div>
            )}

            <ScrollArea className="flex-1 p-2">
              <div className="space-y-1">
                {overlayFields.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-6">
                    لا توجد نصوص. اضغط "إضافة نص" للبدء.
                  </p>
                ) : (
                  overlayFields.map((field) => (
                    <div
                      key={field.id}
                      onClick={() => {
                        setSelectedFieldId(field.id);
                        setCurrentPage(field.page);
                      }}
                      className={`flex items-center justify-between p-2 rounded-lg text-sm cursor-pointer transition-colors ${
                        selectedFieldId === field.id
                          ? "bg-primary/10 border border-primary/30"
                          : "bg-background hover:bg-muted"
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="truncate font-medium" style={{
                          fontWeight: field.bold ? "bold" : "normal",
                          textDecoration: field.underline ? "underline" : "none",
                          color: field.color || undefined,
                        }}>{field.text}</p>
                        <p className="text-xs text-muted-foreground">
                          ص{field.page + 1} • {field.fontSize}px
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>

          {/* Canvas Area */}
          <div className="flex-1 flex flex-col bg-muted/50">
            {/* Zoom toolbar */}
            <div className="flex items-center justify-between p-3 border-b bg-background">
              <span className="text-sm">
                صفحة {currentPage + 1} / {totalPages || 1}
              </span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" onClick={() => setZoom((z) => Math.max(0.3, z - 0.25))}>
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <span className="text-sm min-w-[50px] text-center">{Math.round(zoom * 100)}%</span>
                <Button variant="outline" size="icon" onClick={() => setZoom((z) => Math.min(3, z + 0.25))}>
                  <ZoomIn className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-4 flex items-start justify-center">
              {contentLoading ? (
                <Skeleton className="w-[600px] h-[800px]" />
              ) : pageImages[currentPage] ? (
                <div
                  ref={canvasContainerRef}
                  className={`relative bg-white shadow-lg ${addingText ? "cursor-crosshair" : "cursor-default"}`}
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

                  {/* Overlay fields on current page */}
                  {currentPageFields.map((field) => (
                    <div
                      key={field.id}
                      className={`absolute group select-none transition-shadow ${
                        inlineEditId === field.id
                          ? "ring-2 ring-primary shadow-md bg-white/90"
                          : selectedFieldId === field.id
                          ? "ring-2 ring-primary shadow-md cursor-move"
                          : "hover:ring-1 hover:ring-primary/50 cursor-move"
                      } ${draggingField === field.id ? "opacity-60" : ""}`}
                      style={{
                        left: field.x,
                        top: field.y,
                        fontSize: field.fontSize,
                        color: field.color || "#000",
                        fontWeight: field.bold ? "bold" : "normal",
                        textDecoration: field.underline ? "underline" : "none",
                        width: field.width ? field.width : undefined,
                        height: field.height ? field.height : undefined,
                        overflow: field.width ? "hidden" : undefined,
                        wordWrap: field.width ? "break-word" : undefined,
                        minWidth: 20,
                      }}
                      onMouseDown={(e) => handleDragStart(e, field.id)}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        startInlineEdit(field);
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedFieldId(field.id);
                      }}
                    >
                      {inlineEditId === field.id ? (
                        field.width ? (
                          <textarea
                            className="bg-transparent border-none outline-none resize-none w-full h-full"
                            style={{
                              fontSize: field.fontSize,
                              color: field.color || "#000",
                              fontWeight: field.bold ? "bold" : "normal",
                              textDecoration: field.underline ? "underline" : "none",
                            }}
                            value={inlineEditText}
                            onChange={(e) => setInlineEditText(e.target.value)}
                            onBlur={saveInlineEdit}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") { setInlineEditId(null); setInlineEditText(""); }
                            }}
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <input
                            className="bg-transparent border-none outline-none min-w-[60px]"
                            style={{
                              fontSize: field.fontSize,
                              color: field.color || "#000",
                              fontWeight: field.bold ? "bold" : "normal",
                              textDecoration: field.underline ? "underline" : "none",
                            }}
                            value={inlineEditText}
                            onChange={(e) => setInlineEditText(e.target.value)}
                            onBlur={saveInlineEdit}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveInlineEdit();
                              if (e.key === "Escape") { setInlineEditId(null); setInlineEditText(""); }
                            }}
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                          />
                        )
                      ) : (
                        <>
                          <GripVertical className="h-3 w-3 opacity-0 group-hover:opacity-60 absolute -right-4 top-0" />
                          <span style={{ whiteSpace: field.width ? "normal" : "nowrap" }}>{field.text}</span>
                        </>
                      )}

                      {/* Resize handle */}
                      {selectedFieldId === field.id && !inlineEditId && (
                        <div
                          className="absolute -bottom-1 -left-1 w-3 h-3 bg-primary rounded-sm cursor-nwse-resize border border-primary-foreground"
                          onMouseDown={(e) => handleResizeStart(e, field)}
                        />
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-[400px] gap-3">
                  <FileText className="h-12 w-12 text-muted-foreground" />
                  <p className="text-muted-foreground">لا توجد محتويات</p>
                </div>
              )}
            </div>

            {/* Status bar */}
            {addingText && (
              <div className="p-3 border-t bg-primary/10 text-sm text-center">
                <Type className="h-4 w-4 inline ml-2" />
                انقر على الصورة لوضع النص
                <Button variant="ghost" size="sm" className="mr-4" onClick={() => setAddingText(false)}>
                  إلغاء
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
