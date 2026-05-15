import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  ImageIcon, Plus, Trash2, Download, X, Loader2, FileText, FolderOpen,
  Printer, ChevronLeft, ChevronRight,
  ExternalLink, Play, Upload
} from "lucide-react";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";
import { Progress } from "@/components/ui/progress";
import { FilePreviewGallery } from "./FilePreviewGallery";
import * as tus from "tus-js-client";

interface MediaFile {
  id: string;
  original_name: string;
  cdn_url: string;
  mime_type: string;
  size: number;
  created_at: string;
  entity_type: string | null;
  storage_path?: string | null;
  stream_video_guid?: string | null;
  stream_library_id?: string | null;
}

interface PolicyFilesSectionProps {
  policyId: string;
  clientId?: string;
  clientPhoneNumber?: string | null;
  clientName?: string;
  // Package support - array of all policy IDs in package for unified file view
  packagePolicyIds?: string[];
  // Lets the parent drawer keep its "ملفات (N)" badge in sync with
  // uploads/deletes without remounting. Reports the insurance count
  // (the same set the SMS button and badge care about).
  onFilesCountChanged?: (count: number) => void;
}

export function PolicyFilesSection({
  policyId,
  clientId,
  clientPhoneNumber,
  clientName,
  packagePolicyIds,
  onFilesCountChanged
}: PolicyFilesSectionProps) {
  const { toast } = useToast();
  const [insuranceFiles, setInsuranceFiles] = useState<MediaFile[]>([]);
  const [crmFiles, setCrmFiles] = useState<MediaFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{
    name: string;
    pct: number;
    current: number;
    total: number;
  } | null>(null);
  const [selectedFile, setSelectedFile] = useState<MediaFile | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingImage, setDeletingImage] = useState<MediaFile | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Mirrors the uploadProgress shape so the delete banner uses the same
  // visual treatment as the upload banner at the top of the page.
  const [deleteProgress, setDeleteProgress] = useState<{ name: string; pct: number } | null>(null);
  const [activeTab, setActiveTab] = useState("insurance");

  // Scanner state
  const [scanning, setScanning] = useState<'insurance' | 'crm' | null>(null);

  // Drag-and-drop state — tracks which tab card is currently being
  // dragged over so we can show the drop ring + overlay.
  const [isDragging, setIsDragging] = useState<'insurance' | 'crm' | null>(null);

  const fetchFiles = async () => {
    setLoading(true);
    try {
      // Use package policy IDs if provided (unified package view), otherwise single policy
      const targetPolicyIds = packagePolicyIds && packagePolicyIds.length > 0 
        ? packagePolicyIds 
        : [policyId];
      
      // Fetch insurance files (policy files from insurance company)
      const { data: insuranceData, error: insuranceError } = await supabase
        .from('media_files')
        .select('*')
        .in('entity_id', targetPolicyIds)
        .in('entity_type', ['policy', 'policy_insurance'])
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (insuranceError) throw insuranceError;
      setInsuranceFiles(insuranceData || []);
      onFilesCountChanged?.(insuranceData?.length || 0);

      // Fetch CRM files (internal docs)
      const { data: crmData, error: crmError } = await supabase
        .from('media_files')
        .select('*')
        .in('entity_id', targetPolicyIds)
        .eq('entity_type', 'policy_crm')
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (crmError) throw crmError;
      setCrmFiles(crmData || []);
    } catch (error) {
      console.error('Error fetching files:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policyId, packagePolicyIds?.join(',')]);

  const uploadFileWithXhr = (
    file: File,
    entityType: string,
    accessToken: string | undefined,
    onPct: (pct: number) => void
  ): Promise<void> => {
    return new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('entity_type', entityType);
      formData.append('entity_id', policyId);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-media`);
      xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onPct(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          onPct(100);
          resolve();
        } else {
          let msg = 'Upload failed';
          try {
            const parsed = JSON.parse(xhr.responseText);
            if (parsed?.error) msg = parsed.error;
          } catch {}
          reject(new Error(msg));
        }
      };
      xhr.onerror = () => reject(new Error('Upload failed'));
      xhr.send(formData);
    });
  };

  /** Filter to the file types we actually support: images, PDFs,
   *  videos. Falls back to filename extension when MIME is empty —
   *  some browsers omit the MIME type when files come from a
   *  folder drop. */
  const isAcceptedFile = (file: File): boolean => {
    if (file.type.startsWith('image/')) return true;
    if (file.type === 'application/pdf') return true;
    if (file.type.startsWith('video/')) return true;
    return /\.(jpe?g|png|gif|webp|bmp|svg|heic|heif|pdf|mp4|mov|avi|webm|mkv|m4v|3gp)$/i.test(file.name);
  };

  /** Walk a DataTransfer that may contain folders. Uses
   *  webkitGetAsEntry / FileSystemDirectoryReader, which is widely
   *  supported across modern browsers despite the "webkit" prefix.
   *  Falls back to dt.files when items aren't available. */
  const gatherFilesFromDataTransfer = async (dt: DataTransfer): Promise<File[]> => {
    const out: File[] = [];
    const items = dt.items ? Array.from(dt.items) : [];
    if (items.length === 0) return Array.from(dt.files ?? []);

    const traverse = async (entry: any): Promise<void> => {
      if (entry.isFile) {
        const file: File = await new Promise((resolve, reject) =>
          entry.file(resolve, reject)
        );
        out.push(file);
        return;
      }
      if (entry.isDirectory) {
        const reader = entry.createReader();
        const readBatch = (): Promise<any[]> =>
          new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        let batch = await readBatch();
        while (batch.length > 0) {
          for (const child of batch) await traverse(child);
          batch = await readBatch();
        }
      }
    };

    for (const item of items) {
      if (item.kind !== 'file') continue;
      // @ts-ignore — webkitGetAsEntry is widely supported
      const entry = item.webkitGetAsEntry?.();
      if (entry) {
        await traverse(entry);
      } else {
        const file = item.getAsFile();
        if (file) out.push(file);
      }
    }
    return out;
  };

  /** Shared upload pipeline used by both the file-input button and
   *  the drag-drop drop zone. Videos route through Bunny Stream
   *  (resumable tus upload), everything else hits upload-media. */
  const uploadFiles = async (files: File[], fileType: 'insurance' | 'crm') => {
    if (files.length === 0) return;

    setUploading(fileType);
    try {
      const { data: { session } } = await supabase.auth.getSession();

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const entityType = fileType === 'insurance' ? 'policy_insurance' : 'policy_crm';
        setUploadProgress({ name: file.name, pct: 0, current: i + 1, total: files.length });

        const looksLikeVideo =
          file.type.startsWith('video/') ||
          /\.(mp4|mov|avi|webm|mkv|m4v|3gp)$/i.test(file.name);

        if (looksLikeVideo) {
          await uploadVideoToStream(file, entityType, i + 1, files.length);
        } else {
          await uploadFileWithXhr(file, entityType, session?.access_token, (pct) => {
            setUploadProgress((prev) => (prev ? { ...prev, pct } : prev));
          });
        }
      }

      toast({ title: "تم الرفع", description: "تم رفع الملفات بنجاح" });
      fetchFiles();
    } catch (error: any) {
      console.error('Error uploading:', error);
      toast({
        title: "خطأ",
        description: error.message || "فشل في رفع الملفات",
        variant: "destructive"
      });
    } finally {
      setUploading(null);
      setUploadProgress(null);
    }
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>, fileType: 'insurance' | 'crm') => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    await uploadFiles(Array.from(files), fileType);
    event.target.value = '';
  };

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>, fileType: 'insurance' | 'crm') => {
    event.preventDefault();
    setIsDragging(null);
    if (uploading || scanning) return;

    const collected = await gatherFilesFromDataTransfer(event.dataTransfer);
    const accepted = collected.filter(isAcceptedFile);
    const rejectedCount = collected.length - accepted.length;

    if (accepted.length === 0) {
      toast({
        title: "لا توجد ملفات مدعومة",
        description: "ادعم الصور و PDF والفيديو فقط.",
        variant: "destructive",
      });
      return;
    }
    if (rejectedCount > 0) {
      toast({
        title: `تم تجاهل ${rejectedCount} ملف غير مدعوم`,
        description: "تم قبول الصور و PDF والفيديو فقط.",
      });
    }
    await uploadFiles(accepted, fileType);
  };

  const uploadVideoToStream = async (file: File, entityType: string, current: number, total: number) => {
    if (file.size > 1024 * 1024 * 1024) {
      throw new Error('الفيديو أكبر من 1GB');
    }
    const { data, error } = await supabase.functions.invoke('create-stream-video', {
      body: {
        title: file.name,
        file_size: file.size,
        mime_type: file.type,
        entity_type: entityType,
        entity_id: policyId,
      },
    });
    if (error || !data?.video_guid) {
      throw new Error(error?.message || 'فشل في تجهيز رفع الفيديو');
    }

    await new Promise<void>((resolve, reject) => {
      const upload = new tus.Upload(file, {
        endpoint: data.endpoint,
        retryDelays: [0, 2000, 5000, 10000, 20000, 30000],
        chunkSize: 50 * 1024 * 1024,
        headers: {
          AuthorizationSignature: data.authorization_signature,
          AuthorizationExpire: String(data.authorization_expire),
          VideoId: data.video_guid,
          LibraryId: String(data.library_id),
        },
        metadata: { filetype: file.type, title: file.name },
        onError: (err) => reject(err),
        onProgress: (sent, totalBytes) => {
          setUploadProgress({
            name: file.name,
            pct: Math.round((sent / totalBytes) * 100),
            current,
            total,
          });
        },
        onSuccess: () => resolve(),
      });
      upload.start();
    });
  };

  // Convert base64 to Blob
  const base64ToBlob = (base64: string): Blob => {
    // Remove data URL prefix if present
    const base64Data = base64.includes(',') ? base64.split(',')[1] : base64;
    const byteCharacters = atob(base64Data);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: 'image/jpeg' });
  };

  // Direct scan function - no dialog, auto-upload
  const handleDirectScan = async (fileType: 'insurance' | 'crm') => {
    if (!window.scanner) {
      toast({ 
        title: "خطأ", 
        description: "مكتبة السكانر غير محملة. يرجى تحديث الصفحة.", 
        variant: "destructive" 
      });
      return;
    }

    setScanning(fileType);

    // Safety timeout: when ScanApp isn't installed Asprise pops its
    // "complete one-time setup" overlay and never invokes the
    // callback if the user dismisses it. Without this guard the
    // مسح button would spin forever. 30s is well past any real
    // scan, so a live device won't be cut short.
    let settled = false;
    const safetyTimer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      setScanning(null);
      toast({
        title: "تثبيت مطلوب",
        description: "ScanApp مش مثبت أو ما استجاب. نزّله من asprise.com وحاول تاني.",
        variant: "destructive",
      });
    }, 30000);

    // Always let the user pick a scanner — caching a "preferred"
    // scanner caused the button to spin forever when the saved
    // device was unplugged or renamed.
    const scanRequest = {
      use_asprise_dialog: false,
      show_scanner_ui: false,
      source_name: 'select',
      scanner_name: 'select',
      prompt_scan_more: false,
      twain_cap_setting: {
        ICAP_PIXELTYPE: 'TWPT_RGB',
        ICAP_XRESOLUTION: '200',
        ICAP_YRESOLUTION: '200',
      },
      output_settings: [{
        type: 'return-base64',
        format: 'jpg',
        jpeg_quality: 85,
      }],
    };

    window.scanner.scan(
      async (successful, mesg, response) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(safetyTimer);
        if (!successful) {
          setScanning(null);
          // Don't show error for user cancellation
          if (mesg && !mesg.toLowerCase().includes('cancel')) {
            // Check if ScanApp not installed
            if (mesg.includes('Scanner.js') || mesg.includes('localhost')) {
              toast({
                title: "تثبيت مطلوب",
                description: "يرجى تثبيت برنامج ScanApp من asprise.com",
                variant: "destructive"
              });
            } else {
              toast({ title: "خطأ في المسح", description: mesg, variant: "destructive" });
            }
          }
          return;
        }

        const scannedImages = window.scanner.getScannedImages(response, true, false);
        if (!scannedImages || scannedImages.length === 0) {
          setScanning(null);
          toast({ title: "تنبيه", description: "لم يتم العثور على صور ممسوحة" });
          return;
        }

        // Auto-upload all scanned images
        setUploading(fileType);
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const entityType = fileType === 'insurance' ? 'policy_insurance' : 'policy_crm';

          for (let i = 0; i < scannedImages.length; i++) {
            const img = scannedImages[i];
            const blob = base64ToBlob(img.src);
            const file = new File([blob], `scan_${Date.now()}_${i}.jpg`, { type: 'image/jpeg' });

            setUploadProgress({ name: file.name, pct: 0, current: i + 1, total: scannedImages.length });
            await uploadFileWithXhr(file, entityType, session?.access_token, (pct) => {
              setUploadProgress((prev) => (prev ? { ...prev, pct } : prev));
            });
          }

          toast({ title: "تم", description: `تم مسح ورفع ${scannedImages.length} صورة بنجاح` });
          fetchFiles();
        } catch (error: any) {
          console.error('Error uploading scanned images:', error);
          toast({ 
            title: "خطأ", 
            description: error.message || "فشل في رفع الصور الممسوحة", 
            variant: "destructive" 
          });
        } finally {
          setUploading(null);
          setScanning(null);
          setUploadProgress(null);
        }
      },
      scanRequest
    );
  };

  const handleDelete = async () => {
    if (!deletingImage) return;

    // Close the confirm dialog right away and switch to the top
    // progress banner — mirrors the upload UX so the user sees a
    // consistent "operation in progress" indicator rather than a
    // spinner stuck inside the AlertDialog.
    const fileToDelete = deletingImage;
    setDeleteDialogOpen(false);
    setDeletingImage(null);
    setDeleting(true);
    setDeleteProgress({ name: fileToDelete.original_name, pct: 0 });

    // Simulate smooth progress while delete-media is in flight. The
    // server call is a single round-trip, but Bunny Stream cleanup +
    // DB row delete can take a couple of seconds for videos. Climbs
    // to 90% during the request, then snaps to 100% on success.
    const interval = setInterval(() => {
      setDeleteProgress((prev) => prev ? { ...prev, pct: Math.min(prev.pct + 5, 90) } : prev);
    }, 100);

    try {
      const { error } = await supabase.functions.invoke('delete-media', {
        body: { fileIds: [fileToDelete.id] },
      });

      if (error) {
        throw new Error(error.message || 'Delete failed');
      }

      clearInterval(interval);
      setDeleteProgress((prev) => prev ? { ...prev, pct: 100 } : prev);
      // Brief pause so the 100% state is actually visible.
      await new Promise((r) => setTimeout(r, 300));

      toast({ title: "تم الحذف", description: "تم حذف الملف بنجاح" });
      // Optimistically drop the row from local state so the badge on the
      // parent drawer ticks down immediately instead of waiting for the
      // refetch round-trip. fetchFiles below reconciles any drift.
      const wasInsurance =
        fileToDelete.entity_type === 'policy' ||
        fileToDelete.entity_type === 'policy_insurance';
      if (wasInsurance) {
        setInsuranceFiles((prev) => {
          const next = prev.filter((f) => f.id !== fileToDelete.id);
          onFilesCountChanged?.(next.length);
          return next;
        });
      } else {
        setCrmFiles((prev) => prev.filter((f) => f.id !== fileToDelete.id));
      }
      fetchFiles();
    } catch (error: any) {
      clearInterval(interval);
      console.error('Error deleting:', error);
      toast({
        title: "خطأ",
        description: error.message || "فشل في حذف الملف",
        variant: "destructive"
      });
    } finally {
      clearInterval(interval);
      setDeleting(false);
      setDeleteProgress(null);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const isImage = (mimeType: string) => mimeType.startsWith('image/');
  const isPdf = (mimeType: string) => mimeType === 'application/pdf';
  const isVideo = (mimeType: string) => mimeType.startsWith('video/');
  const isExternalLink = (file: MediaFile) => !file.storage_path && file.size === 0;

  const renderFileGrid = (files: MediaFile[]) => {
    if (files.length === 0) {
      return <p className="text-center text-muted-foreground py-6">لا توجد ملفات</p>;
    }

    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {files.map((file) => (
          <div
            key={file.id}
            className="relative group rounded-lg border overflow-hidden bg-muted/30 aspect-square"
          >
            {isExternalLink(file) ? (
              <div 
                className="w-full h-full flex flex-col items-center justify-center cursor-pointer bg-gradient-to-br from-blue-500 to-blue-600 text-white"
                onClick={() => window.open(file.cdn_url, '_blank')}
              >
                <ExternalLink className="h-10 w-10" />
                <span className="text-sm font-bold mt-2">X-Service</span>
                <p className="text-[10px] mt-1 px-2 truncate w-full text-center opacity-80">
                  {file.original_name}
                </p>
              </div>
            ) : isImage(file.mime_type) ? (
              <img
                src={file.cdn_url}
                alt={file.original_name}
                className="w-full h-full object-cover cursor-pointer"
                onClick={() => setSelectedFile(file)}
              />
            ) : isPdf(file.mime_type) ? (
              <div 
                className="w-full h-full flex flex-col items-center justify-center cursor-pointer bg-gradient-to-br from-red-500 to-red-600 text-white"
                onClick={() => setSelectedFile(file)}
              >
                <FileText className="h-10 w-10" />
                <span className="text-sm font-bold mt-2">PDF</span>
                <p className="text-[10px] mt-1 px-2 truncate w-full text-center opacity-80">
                  {file.original_name}
                </p>
              </div>
            ) : isVideo(file.mime_type) ? (
              <div
                className="relative w-full h-full bg-black cursor-pointer"
                onClick={() => setSelectedFile(file)}
              >
                {file.stream_video_guid && file.stream_library_id ? (
                  <img
                    src={`https://vz-${file.stream_library_id}.b-cdn.net/${file.stream_video_guid}/thumbnail.jpg`}
                    alt={file.original_name}
                    className="w-full h-full object-cover"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                  />
                ) : (
                  <video
                    src={file.cdn_url}
                    className="w-full h-full object-cover"
                    muted
                    preload="metadata"
                  />
                )}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="bg-black/60 rounded-full p-2">
                    <Play className="h-6 w-6 text-white fill-white" />
                  </div>
                </div>
              </div>
            ) : (
              <div 
                className="w-full h-full flex flex-col items-center justify-center cursor-pointer"
                onClick={() => window.open(file.cdn_url, '_blank')}
              >
                <FileText className="h-8 w-8 text-muted-foreground" />
                <p className="text-xs text-muted-foreground mt-2 px-2 truncate w-full text-center">
                  {file.original_name}
                </p>
              </div>
            )}
            
            {/* Overlay actions - pointer-events-none on overlay, enabled on buttons */}
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 pointer-events-none">
              {/* Download using native anchor to avoid ad blocker issues */}
              <a
                href={file.cdn_url}
                target="_blank"
                rel="noopener noreferrer"
                download={file.original_name}
                className="pointer-events-auto inline-flex items-center justify-center h-8 w-8 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 z-10"
                onClick={(e) => e.stopPropagation()}
              >
                <Download className="h-4 w-4" />
              </a>
              <Button
                size="icon"
                variant="destructive"
                className="h-8 w-8 pointer-events-auto z-10"
                onClick={(e) => {
                  e.stopPropagation();
                  setDeletingImage(file);
                  setDeleteDialogOpen(true);
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            
            {/* Size badge */}
            <div className="absolute bottom-1 right-1 text-xs bg-black/60 text-white px-1.5 py-0.5 rounded">
              {formatSize(file.size)}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderUploadButton = (fileType: 'insurance' | 'crm') => (
    <div className="flex items-center gap-2">
      {/* Direct Scan button - no dialog */}
      <Button 
        size="sm" 
        variant="outline" 
        disabled={uploading !== null || scanning !== null}
        onClick={() => handleDirectScan(fileType)}
        className="gap-1"
      >
        {scanning === fileType ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Printer className="h-4 w-4" />
        )}
        {scanning === fileType ? 'جاري المسح...' : 'مسح'}
      </Button>
      
      {/* Upload button */}
      <div className="relative">
        <input
          type="file"
          multiple
          accept="image/*,.pdf,video/*"
          onChange={(e) => handleUpload(e, fileType)}
          className="absolute inset-0 opacity-0 cursor-pointer"
          disabled={uploading !== null || scanning !== null}
        />
        <Button size="sm" variant="outline" disabled={uploading !== null || scanning !== null}>
          {uploading === fileType ? (
            <Loader2 className="h-4 w-4 ml-1 animate-spin" />
          ) : (
            <Plus className="h-4 w-4 ml-1" />
          )}
          رفع ملف
        </Button>
      </div>
    </div>
  );

  return (
    <>
      {uploadProgress && (
        <Card className="p-3 mb-3 space-y-2 border-primary/40">
          <div className="flex items-center justify-between text-xs">
            <span className="truncate max-w-[70%]">جاري رفع: {uploadProgress.name}</span>
            <span className="font-mono">{uploadProgress.pct}%</span>
          </div>
          <Progress value={uploadProgress.pct} className="h-2" />
        </Card>
      )}
      {deleteProgress && (
        <Card className="p-3 mb-3 space-y-2 border-destructive/40 bg-destructive/5">
          <div className="flex items-center justify-between text-xs">
            <span className="truncate max-w-[70%] text-destructive">
              جاري الحذف: {deleteProgress.name}
            </span>
            <span className="font-mono text-destructive">{deleteProgress.pct}%</span>
          </div>
          <Progress value={deleteProgress.pct} className="h-2" />
        </Card>
      )}
      {/* Files Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} dir="rtl" className="space-y-4">
        <TabsList className="grid grid-cols-2 w-full" dir="rtl">
          <TabsTrigger value="insurance" className="text-xs gap-1">
            <ImageIcon className="h-3 w-3" />
            ملفات العميل ({insuranceFiles.length})
          </TabsTrigger>
          <TabsTrigger value="crm" className="text-xs gap-1">
            <FolderOpen className="h-3 w-3" />
            ملفات داخلية ({crmFiles.length})
          </TabsTrigger>
        </TabsList>

        {/* Insurance Files Tab */}
        <TabsContent value="insurance" className="m-0">
          <Card
            className={`relative p-4 space-y-4 transition-colors ${
              isDragging === 'insurance' ? 'ring-2 ring-primary ring-offset-2 bg-primary/5' : ''
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              if (!uploading && !scanning) setIsDragging('insurance');
            }}
            onDragLeave={(e) => {
              // Only clear when actually leaving the card, not when crossing children
              if (e.currentTarget.contains(e.relatedTarget as Node)) return;
              setIsDragging(null);
            }}
            onDrop={(e) => handleDrop(e, 'insurance')}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-primary font-semibold">
                <ImageIcon className="h-4 w-4" />
                <span>ملفات البوليصة</span>
              </div>
              {renderUploadButton('insurance')}
            </div>
            <p className="text-xs text-muted-foreground">
              البوليصة من شركة التأمين - يمكنك رفع صور متعددة، PDF أو فيديو. اسحب وأفلت ملفات أو مجلد كامل هنا.
            </p>
            {loading ? (
              <div className="text-center py-4 text-muted-foreground">جاري التحميل...</div>
            ) : (
              renderFileGrid(insuranceFiles)
            )}
            {isDragging === 'insurance' && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center bg-primary/10 border-2 border-dashed border-primary rounded-lg">
                <div className="bg-background/95 px-4 py-2 rounded-md shadow-md text-sm font-semibold text-primary flex items-center gap-2">
                  <Upload className="h-4 w-4" />
                  أفلت الملفات أو المجلد للرفع
                </div>
              </div>
            )}
          </Card>
        </TabsContent>

        {/* CRM Files Tab */}
        <TabsContent value="crm" className="m-0">
          <Card
            className={`relative p-4 space-y-4 transition-colors ${
              isDragging === 'crm' ? 'ring-2 ring-primary ring-offset-2 bg-primary/5' : ''
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              if (!uploading && !scanning) setIsDragging('crm');
            }}
            onDragLeave={(e) => {
              if (e.currentTarget.contains(e.relatedTarget as Node)) return;
              setIsDragging(null);
            }}
            onDrop={(e) => handleDrop(e, 'crm')}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-secondary-foreground font-semibold">
                <FolderOpen className="h-4 w-4" />
                <span>ملفات داخلية</span>
              </div>
              {renderUploadButton('crm')}
            </div>
            <p className="text-xs text-muted-foreground">
              هوية، رخصة، صور سيارة، فيديو - ملفات للاستخدام الداخلي فقط. اسحب وأفلت ملفات أو مجلد كامل هنا.
            </p>
            {loading ? (
              <div className="text-center py-4 text-muted-foreground">جاري التحميل...</div>
            ) : (
              renderFileGrid(crmFiles)
            )}
            {isDragging === 'crm' && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center bg-primary/10 border-2 border-dashed border-primary rounded-lg">
                <div className="bg-background/95 px-4 py-2 rounded-md shadow-md text-sm font-semibold text-primary flex items-center gap-2">
                  <Upload className="h-4 w-4" />
                  أفلت الملفات أو المجلد للرفع
                </div>
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      {/* File Preview Dialog - Gallery for images, PDF viewer for PDFs */}
      <FilePreviewGallery 
        file={selectedFile}
        allFiles={activeTab === 'insurance' ? insuranceFiles : crmFiles}
        onClose={() => setSelectedFile(null)}
        onNavigate={(file) => setSelectedFile(file)}
      />

      {/* Delete Confirm Dialog. Closes immediately on confirm — the
          progress is shown in the top banner like the upload flow. */}
      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={handleDelete}
        title="حذف الملف"
        description={`هل أنت متأكد من حذف "${deletingImage?.original_name}"؟`}
        loading={false}
      />

      {/* Upload progress toast — fixed bottom-right while uploading */}
      {uploadProgress && (
        <div
          dir="rtl"
          className="fixed bottom-4 right-4 z-50 w-80 max-w-[90vw] rounded-lg border bg-background shadow-lg p-3 space-y-2"
        >
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span>
              جاري رفع{' '}
              {String(uploadProgress.current).padStart(2, '0')} من{' '}
              {String(uploadProgress.total).padStart(2, '0')}
            </span>
            <span className="ms-auto text-muted-foreground">{uploadProgress.pct}%</span>
          </div>
          <p className="text-xs text-muted-foreground truncate" title={uploadProgress.name}>
            {uploadProgress.name}
          </p>
          <Progress value={uploadProgress.pct} className="h-2" />
        </div>
      )}

    </>
  );
}
