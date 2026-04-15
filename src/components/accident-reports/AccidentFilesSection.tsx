import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { FileUploader } from "@/components/media/FileUploader";
import { PdfJsViewer } from "@/components/policies/PdfJsViewer";
import {
  Trash2,
  FileImage,
  FileText,
  Eye,
  Loader2,
  Download,
  X,
  Printer,
  Video,
} from "lucide-react";
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

interface AccidentFile {
  id: string;
  file_url: string;
  file_name: string | null;
  file_type: string | null;
  created_at: string;
}

interface AccidentFilesSectionProps {
  accidentReportId: string;
  onFilesChange?: (count: number) => void;
  policyNumber?: string | null;
  accidentDate?: string | null;
  clientName?: string | null;
  carNumber?: string | null;
  companyName?: string | null;
  reportNumber?: number | null;
}

const isImage = (file: AccidentFile) =>
  file.file_type?.startsWith("image/") || /\.(jpg|jpeg|png|webp|gif)$/i.test(file.file_url);

const isPdf = (file: AccidentFile) =>
  file.file_type?.includes("pdf") || file.file_url.toLowerCase().endsWith(".pdf");

const isVideo = (file: AccidentFile) =>
  file.file_type?.startsWith("video/") || /\.(mp4|webm|mov|avi)$/i.test(file.file_url);

export function AccidentFilesSection({ accidentReportId, onFilesChange, policyNumber, accidentDate, clientName, carNumber, companyName, reportNumber }: AccidentFilesSectionProps) {
  const { toast } = useToast();
  // Pull the current agent's branding (site title + logo) so the
  // "طباعة الكل" cover page wears the agent's identity instead of
  // the hardcoded "Thiqa Insurance" fallback.
  const { data: siteSettings } = useSiteSettings();
  const [files, setFiles] = useState<AccidentFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewType, setPreviewType] = useState<"image" | "pdf" | "video" | null>(null);

  const fetchFiles = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("accident_report_files")
        .select("*")
        .eq("accident_report_id", accidentReportId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setFiles(data || []);
      onFilesChange?.(data?.length || 0);
    } catch (error) {
      console.error("Error fetching files:", error);
      toast({ title: "خطأ", description: "فشل في تحميل الملفات", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (accidentReportId) fetchFiles();
  }, [accidentReportId]);

  const handleUploadComplete = async (uploadedFiles: any[]) => {
    try {
      const inserts = uploadedFiles.map((file) => ({
        accident_report_id: accidentReportId,
        file_url: file.cdn_url,
        file_name: file.original_name,
        file_type: file.mime_type,
      }));

      const { error } = await supabase.from("accident_report_files").insert(inserts);
      if (error) throw error;

      toast({ title: "تم الرفع", description: `تم رفع ${uploadedFiles.length} ملف بنجاح` });
      fetchFiles();
    } catch (error: any) {
      console.error("Error saving files:", error);
      toast({ title: "خطأ", description: error.message || "فشل في حفظ الملفات", variant: "destructive" });
    }
  };

  const handleDelete = async (fileId: string) => {
    setDeletingId(fileId);
    try {
      const { error } = await supabase.from("accident_report_files").delete().eq("id", fileId);
      if (error) throw error;

      toast({ title: "تم الحذف", description: "تم حذف الملف بنجاح" });
      setFiles((prev) => prev.filter((f) => f.id !== fileId));
      onFilesChange?.(files.length - 1);
    } catch (error: any) {
      console.error("Error deleting file:", error);
      toast({ title: "خطأ", description: error.message || "فشل في حذف الملف", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  };

  const openPreview = (file: AccidentFile) => {
    if (isPdf(file)) {
      setPreviewType("pdf");
      setPreviewUrl(file.file_url);
    } else if (isImage(file)) {
      setPreviewType("image");
      setPreviewUrl(file.file_url);
    } else if (isVideo(file)) {
      setPreviewType("video");
      setPreviewUrl(file.file_url);
    } else {
      window.open(file.file_url, "_blank");
    }
  };

  const getFileIcon = (file: AccidentFile) => {
    if (isPdf(file)) return <FileText className="h-8 w-8 text-red-500" />;
    if (isVideo(file)) return <Video className="h-8 w-8 text-purple-500" />;
    return <FileImage className="h-8 w-8 text-blue-500" />;
  };

  const handlePrintAll = async () => {
    const printableFiles = files.filter((f) => isImage(f) || isPdf(f));
    if (printableFiles.length === 0) {
      toast({ title: "لا توجد ملفات للطباعة", description: "لا توجد صور أو ملفات PDF للطباعة", variant: "destructive" });
      return;
    }

    // Show loading toast
    toast({ title: "جاري التحضير...", description: "يتم تحويل الملفات للطباعة" });

    const formattedDate = accidentDate
      ? new Date(accidentDate).toLocaleDateString("en-GB")
      : "-";

    const infoRows = [
      reportNumber ? { label: "رقم البلاغ", value: String(reportNumber) } : null,
      { label: "رقم البوليصة", value: policyNumber || "-" },
      { label: "تاريخ الحادث", value: formattedDate },
      clientName ? { label: "العميل", value: clientName } : null,
      carNumber ? { label: "المركبة", value: carNumber } : null,
      companyName ? { label: "شركة التأمين", value: companyName } : null,
    ].filter(Boolean) as { label: string; value: string }[];

    // Agent-branded header: logo + name come from site_settings.
    // Falls back to a generic label when the agent hasn't set one
    // up yet, but never to "Thiqa Insurance".
    const brandName = siteSettings?.site_title?.trim() || "وكالة التأمين";
    const escapeAttr = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const brandLogoHtml = siteSettings?.logo_url
      ? `<img class="brand-logo" src="${escapeAttr(siteSettings.logo_url)}" alt="${escapeAttr(brandName)}" />`
      : "";
    const ownerLine = siteSettings?.owner_name && siteSettings.owner_name.trim() !== brandName
      ? `<div class="owner">${escapeAttr(siteSettings.owner_name)}</div>`
      : "";

    const headerHtml = `
      <div class="header-page">
        <div class="header-card">
          <div class="header-band">
            ${brandLogoHtml}
            <h1>بلاغ حادث</h1>
            <span class="brand">${escapeAttr(brandName)}</span>
            ${ownerLine}
          </div>
          <table class="info-table">
            ${infoRows.map((r, i) => `<tr class="${i % 2 === 0 ? 'even' : 'odd'}"><td class="label">${r.label}</td><td class="value">${r.value}</td></tr>`).join("")}
          </table>
        </div>
      </div>
    `;

    // Process files: images stay as-is, PDFs get extracted to page images
    let pagesHtml = "";

    for (const file of printableFiles) {
      if (isImage(file)) {
        pagesHtml += `<div class="print-page"><img src="${file.file_url}" alt="${file.file_name || ''}" /></div>`;
      } else if (isPdf(file)) {
        try {
          const response = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/proxy-cdn-file`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`
              },
              body: JSON.stringify({ url: file.file_url })
            }
          );
          if (!response.ok) throw new Error('Failed to fetch PDF');
          const blob = await response.blob();
          const arrayBuffer = await blob.arrayBuffer();

          const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
          
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const scale = 2.0;
            const viewport = page.getViewport({ scale });
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) continue;
            
            const renderTask = page.render({ canvasContext: ctx, viewport, canvas } as any);
            await renderTask.promise;
            const imgDataUrl = canvas.toDataURL('image/png');
            pagesHtml += `<div class="print-page"><img src="${imgDataUrl}" alt="${file.file_name || 'PDF'} - صفحة ${i}" /></div>`;
          }
        } catch (err) {
          console.error("Error extracting PDF pages:", err);
          pagesHtml += `<div class="print-page"><p class="pdf-fallback">تعذر استخراج صفحات PDF: ${file.file_name || 'مستند'}<br/><a href="${file.file_url}" target="_blank">فتح الملف الأصلي</a></p></div>`;
        }
      }
    }

    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head>
        <title>طباعة ملفات الحادث</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; direction: rtl; background: #f5f5f5; }
          .header-page {
            page-break-after: always;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            padding: 40px;
          }
          .header-card {
            border: 2px solid #1a365d;
            border-radius: 12px;
            overflow: hidden;
            width: 520px;
            box-shadow: 0 4px 24px rgba(0,0,0,0.12);
            background: #fff;
          }
          .header-band {
            background: linear-gradient(135deg, #1a365d 0%, #2a4a7f 100%);
            color: #fff;
            padding: 28px 32px 20px;
            text-align: center;
          }
          .header-band .brand-logo {
            display: block;
            margin: 0 auto 12px;
            max-height: 80px;
            max-width: 220px;
            object-fit: contain;
          }
          .header-band h1 {
            font-size: 26px;
            font-weight: 700;
            margin: 0 0 6px;
          }
          .header-band .brand {
            font-size: 15px;
            opacity: 0.92;
            font-weight: 600;
          }
          .header-band .owner {
            font-size: 12px;
            opacity: 0.75;
            margin-top: 4px;
          }
          .info-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 16px;
          }
          .info-table tr.even { background: #f8fafc; }
          .info-table tr.odd { background: #fff; }
          .info-table td {
            padding: 14px 24px;
            border-bottom: 1px solid #e2e8f0;
          }
          .info-table tr:last-child td { border-bottom: none; }
          .info-table .label {
            font-weight: 600;
            color: #1a365d;
            white-space: nowrap;
            width: 40%;
          }
          .info-table .value {
            color: #2d3748;
            font-weight: 500;
          }
          .print-page {
            page-break-after: always;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            padding: 20px;
          }
          .print-page:last-child { page-break-after: auto; }
          .print-page img {
            max-width: 100%;
            max-height: 90vh;
            object-fit: contain;
          }
          .pdf-fallback {
            text-align: center;
            color: #c53030;
            font-size: 16px;
            line-height: 2;
          }
          .pdf-fallback a {
            color: #2b6cb0;
            text-decoration: underline;
          }
          @media print {
            body { background: #fff; }
            .header-card { box-shadow: none; border: 2px solid #1a365d; }
            .print-page { padding: 0; }
            .print-page img { max-height: 95vh; }
          }
        </style>
      </head>
      <body>${headerHtml}${pagesHtml}</body>
      </html>
    `);
    printWindow.document.close();

    printWindow.onafterprint = () => {
      printWindow.close();
    };
    printWindow.onload = () => {
      setTimeout(() => printWindow.print(), 500);
    };
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <FileImage className="h-5 w-5" />
            ملفات وصور الحادث
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-32 w-full rounded-lg" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <FileImage className="h-5 w-5" />
              ملفات وصور الحادث
              {files.length > 0 && (
                <Badge variant="secondary">{files.length}</Badge>
              )}
            </CardTitle>
            {files.length > 0 && (
              <Button variant="outline" size="sm" onClick={handlePrintAll}>
                <Printer className="h-4 w-4 ml-1" />
                طباعة الكل
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* File Uploader */}
          <FileUploader
            entityType="accident_report"
            entityId={accidentReportId}
            onUploadComplete={handleUploadComplete}
            accept="image/*,application/pdf,video/mp4,video/webm,video/quicktime"
            maxFiles={20}
          />

          {/* Files Grid */}
          {files.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {files.map((file) => (
                <div
                  key={file.id}
                  className="group relative border rounded-lg overflow-hidden bg-muted/30 hover:bg-muted/50 transition-all"
                >
                  {/* Thumbnail or Icon */}
                  <div className="aspect-square flex items-center justify-center p-2">
                    {isImage(file) ? (
                      <img
                        src={file.file_url}
                        alt={file.file_name || "صورة"}
                        className="w-full h-full object-cover rounded"
                      />
                    ) : isVideo(file) ? (
                      <div className="flex flex-col items-center gap-1">
                        <Video className="h-10 w-10 text-purple-500" />
                        <span className="text-[10px] text-muted-foreground">فيديو</span>
                      </div>
                    ) : (
                      getFileIcon(file)
                    )}
                  </div>

                  {/* File name */}
                  <div className="p-2 border-t bg-background/80">
                    <p className="text-xs truncate text-muted-foreground">
                      {file.file_name || "ملف"}
                    </p>
                  </div>

                  {/* Overlay actions */}
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <Button
                      size="icon"
                      variant="secondary"
                      className="h-8 w-8"
                      onClick={() => openPreview(file)}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="secondary"
                      className="h-8 w-8"
                      onClick={() => window.open(file.file_url, "_blank")}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="destructive"
                      className="h-8 w-8"
                      onClick={() => handleDelete(file.id)}
                      disabled={deletingId === file.id}
                    >
                      {deletingId === file.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {files.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <FileImage className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>لا توجد ملفات مرفقة</p>
              <p className="text-sm">قم برفع صور الحادث، محاضر الشرطة، فيديوهات أو أي مستندات أخرى</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Preview Dialog */}
      <Dialog open={!!previewUrl} onOpenChange={() => { setPreviewUrl(null); setPreviewType(null); }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              معاينة الملف
              <Button
                variant="ghost"
                size="icon"
                onClick={() => { setPreviewUrl(null); setPreviewType(null); }}
              >
                <X className="h-4 w-4" />
              </Button>
            </DialogTitle>
          </DialogHeader>
          <div className="mt-4">
            {previewType === "image" && previewUrl && (
              <img
                src={previewUrl}
                alt="Preview"
                className="max-w-full max-h-[70vh] mx-auto rounded-lg"
              />
            )}
            {previewType === "pdf" && previewUrl && (
              <div className="h-[70vh]">
                <PdfJsViewer url={previewUrl} className="h-full" />
              </div>
            )}
            {previewType === "video" && previewUrl && (
              <video
                src={previewUrl}
                controls
                className="max-w-full max-h-[70vh] mx-auto rounded-lg"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
