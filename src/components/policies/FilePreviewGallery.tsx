import { useState, useEffect, useCallback, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { X, Download, ChevronLeft, ChevronRight, FileText, ZoomIn, ZoomOut, Loader2 } from "lucide-react";
import { PdfJsViewer } from "./PdfJsViewer";
import { toast } from "sonner";

interface MediaFile {
  id: string;
  original_name: string;
  cdn_url: string;
  mime_type: string;
  size: number;
  created_at: string;
  entity_type: string | null;
  storage_path?: string | null;
}

interface FilePreviewGalleryProps {
  file: MediaFile | null;
  allFiles: MediaFile[];
  onClose: () => void;
  onNavigate: (file: MediaFile) => void;
}

const isImage = (mimeType: string) => mimeType?.startsWith('image/');
const isPdf = (mimeType: string) => mimeType === 'application/pdf';

export function FilePreviewGallery({ file, allFiles, onClose, onNavigate }: FilePreviewGalleryProps) {
  const [zoom, setZoom] = useState(1);
  const [downloading, setDownloading] = useState(false);

  const handleDownload = useCallback(async () => {
    if (!file || downloading) return;
    setDownloading(true);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/proxy-cdn-file`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`
          },
          body: JSON.stringify({ url: file.cdn_url })
        }
      );
      if (!response.ok) throw new Error('Download failed');
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = file.original_name || 'file';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      toast.error('فشل تحميل الملف');
    } finally {
      setDownloading(false);
    }
  }, [file, downloading]);
  
  // Get viewable files (images and PDFs only)
  const viewableFiles = useMemo(() => 
    allFiles.filter(f => isImage(f.mime_type) || isPdf(f.mime_type)), 
    [allFiles]
  );
  
  const currentIndex = useMemo(() => 
    file ? viewableFiles.findIndex(f => f.id === file.id) : -1, 
    [file, viewableFiles]
  );

  const hasNext = currentIndex < viewableFiles.length - 1;
  const hasPrev = currentIndex > 0;

  const goNext = useCallback(() => {
    if (hasNext) {
      setZoom(1);
      onNavigate(viewableFiles[currentIndex + 1]);
    }
  }, [hasNext, currentIndex, viewableFiles, onNavigate]);

  const goPrev = useCallback(() => {
    if (hasPrev) {
      setZoom(1);
      onNavigate(viewableFiles[currentIndex - 1]);
    }
  }, [hasPrev, currentIndex, viewableFiles, onNavigate]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!file) return;
      if (e.key === 'ArrowRight') goPrev(); // RTL: right goes prev
      if (e.key === 'ArrowLeft') goNext();  // RTL: left goes next
      if (e.key === 'Escape') onClose();
    };
    
    window.addEventListener('keydown', handleKeyDown);

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [file, goNext, goPrev, onClose]);

  if (!file) return null;

  const fileIsImage = isImage(file.mime_type);
  const fileIsPdf = isPdf(file.mime_type);

  return (
    <Dialog open={!!file} onOpenChange={() => onClose()}>
      <DialogContent 
        className="p-0 max-w-[95vw] max-h-[95vh] h-[95vh] sm:max-w-6xl bg-black/95 border-none overflow-hidden [&>button]:hidden"
        dir="rtl"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>معاينة الملف</DialogTitle>
        </DialogHeader>

        {/* Top toolbar */}
        <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/80 to-transparent">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/20"
              onClick={onClose}
            >
              <X className="h-5 w-5" />
            </Button>
            <span className="text-white text-sm opacity-80">
              {currentIndex + 1} / {viewableFiles.length}
            </span>
          </div>
          
          <p className="text-white text-sm truncate max-w-[50%] opacity-80">
            {file.original_name}
          </p>

          <div className="flex items-center gap-1">
            {fileIsImage && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-white hover:bg-white/20"
                  onClick={() => setZoom(z => Math.max(0.5, z - 0.25))}
                  disabled={zoom <= 0.5}
                >
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <span className="text-white text-xs min-w-[40px] text-center">{Math.round(zoom * 100)}%</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-white hover:bg-white/20"
                  onClick={() => setZoom(z => Math.min(3, z + 0.25))}
                  disabled={zoom >= 3}
                >
                  <ZoomIn className="h-4 w-4" />
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="text-white hover:bg-white/20 gap-1"
              onClick={handleDownload}
              disabled={downloading}
            >
              {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              تحميل
            </Button>
          </div>
        </div>

        {/* Navigation arrows */}
        {viewableFiles.length > 1 && (
          <>
            {hasPrev && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-2 top-1/2 -translate-y-1/2 z-20 h-12 w-12 rounded-full bg-black/50 text-white hover:bg-black/70"
                onClick={goPrev}
              >
                <ChevronRight className="h-8 w-8" />
              </Button>
            )}
            {hasNext && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute left-2 top-1/2 -translate-y-1/2 z-20 h-12 w-12 rounded-full bg-black/50 text-white hover:bg-black/70"
                onClick={goNext}
              >
                <ChevronLeft className="h-8 w-8" />
              </Button>
            )}
          </>
        )}

        {/* Main content area */}
        <div className="w-full h-full flex items-center justify-center overflow-auto pt-14 pb-20">
          {fileIsImage && (
            <img
              src={file.cdn_url}
              alt={file.original_name}
              className="max-w-full max-h-full object-contain transition-transform duration-200"
              style={{ transform: `scale(${zoom})` }}
              draggable={false}
            />
          )}
          
          {fileIsPdf && (
            <PdfJsViewer 
              url={file.cdn_url} 
              className="w-full h-full"
            />
          )}
        </div>

        {/* Bottom thumbnails strip */}
        {viewableFiles.length > 1 && (
          <div className="absolute bottom-0 left-0 right-0 z-20 flex items-center justify-center gap-2 p-3 bg-gradient-to-t from-black/80 to-transparent overflow-x-auto">
            {viewableFiles.map((f, idx) => (
              <button
                key={f.id}
                onClick={() => {
                  setZoom(1);
                  onNavigate(f);
                }}
                className={`flex-shrink-0 w-14 h-14 rounded-md overflow-hidden border-2 transition-all ${
                  f.id === file.id 
                    ? 'border-primary ring-2 ring-primary/50 scale-105' 
                    : 'border-transparent opacity-60 hover:opacity-100'
                }`}
              >
                {isImage(f.mime_type) ? (
                  <img
                    src={f.cdn_url}
                    alt={f.original_name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-destructive flex items-center justify-center">
                    <FileText className="h-6 w-6 text-white" />
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
