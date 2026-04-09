import React, { useState, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Printer, Loader2, X, Plus, Download, AlertCircle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import '@/types/scanner.d.ts';

interface ScannedImage {
  id: string;
  src: string;
  blob?: Blob;
}

interface ScannerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (images: Blob[]) => Promise<void>;
  title?: string;
}

export function ScannerDialog({
  open,
  onOpenChange,
  onSave,
  title = 'مسح من السكانر',
}: ScannerDialogProps) {
  const [isScanning, setIsScanning] = useState(false);
  const [scannedImages, setScannedImages] = useState<ScannedImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const checkScannerReady = useCallback((): boolean => {
    if (!window.scanner) {
      setError('مكتبة السكانر غير محملة. يرجى تحديث الصفحة.');
      return false;
    }
    return true;
  }, []);

  const base64ToBlob = useCallback((base64: string, mimeType: string = 'image/jpeg'): Blob => {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
  }, []);

  const handleScan = useCallback(() => {
    if (!checkScannerReady()) return;

    setIsScanning(true);
    setError(null);

    const scanRequest = {
      use_asprise_dialog: true,
      show_scanner_ui: false,
      twain_cap_setting: {
        ICAP_PIXELTYPE: 'TWPT_RGB',
        ICAP_XRESOLUTION: '200',
        ICAP_YRESOLUTION: '200',
      },
      output_settings: [
        {
          type: 'return-base64',
          format: 'jpg',
          jpeg_quality: 90,
        },
      ],
    };

    try {
      window.scanner.scan(
        (successful: boolean, mesg: string, response: string) => {
          setIsScanning(false);

          if (!successful) {
            if (mesg && mesg.includes('cancel')) {
              // User cancelled - no error
              return;
            }
            setError(mesg || 'فشل في المسح. تأكد من تثبيت ScanApp وتوصيل السكانر.');
            return;
          }

          try {
            const images = window.scanner.getScannedImages(response, true, false);
            
            if (!images || images.length === 0) {
              setError('لم يتم العثور على صور ممسوحة.');
              return;
            }

            const newImages: ScannedImage[] = images.map((img, index) => {
              // Remove data URL prefix if present
              let base64Data = img.src;
              if (base64Data.startsWith('data:')) {
                base64Data = base64Data.split(',')[1];
              }
              
              const blob = base64ToBlob(base64Data);
              
              return {
                id: `scan_${Date.now()}_${index}`,
                src: img.src.startsWith('data:') ? img.src : `data:image/jpeg;base64,${img.src}`,
                blob,
              };
            });

            setScannedImages(prev => [...prev, ...newImages]);
            toast.success(`تم مسح ${newImages.length} صورة بنجاح`);
          } catch (parseError) {
            console.error('Error parsing scanned images:', parseError);
            setError('خطأ في معالجة الصور الممسوحة.');
          }
        },
        scanRequest
      );
    } catch (err) {
      setIsScanning(false);
      console.error('Scanner error:', err);
      setError('خطأ في الاتصال بالسكانر. تأكد من تثبيت ScanApp.');
    }
  }, [checkScannerReady, base64ToBlob]);

  const handleRemoveImage = useCallback((id: string) => {
    setScannedImages(prev => prev.filter(img => img.id !== id));
  }, []);

  const handleSave = useCallback(async () => {
    if (scannedImages.length === 0) {
      toast.error('لا توجد صور للحفظ');
      return;
    }

    setIsSaving(true);
    try {
      const blobs = scannedImages
        .filter(img => img.blob)
        .map(img => img.blob as Blob);
      
      await onSave(blobs);
      setScannedImages([]);
      onOpenChange(false);
    } catch (err) {
      console.error('Error saving scanned images:', err);
      toast.error('خطأ في حفظ الصور');
    } finally {
      setIsSaving(false);
    }
  }, [scannedImages, onSave, onOpenChange]);

  const handleClose = useCallback(() => {
    if (isScanning || isSaving) return;
    setScannedImages([]);
    setError(null);
    onOpenChange(false);
  }, [isScanning, isSaving, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="h-5 w-5" />
            {title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Error Message */}
          {error && (
            <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3 flex items-start gap-2">
              <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="text-destructive font-medium">{error}</p>
                <a 
                  href="https://asprise.com/document-scan-upload-image-browser/html-web-scanner-download.html"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline text-xs mt-1 block"
                >
                  تحميل ScanApp
                </a>
              </div>
            </div>
          )}

          {/* Scan Button */}
          <div className="flex justify-center">
            <Button
              onClick={handleScan}
              disabled={isScanning}
              size="lg"
              className="gap-2"
            >
              {isScanning ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  جاري المسح...
                </>
              ) : (
                <>
                  <Printer className="h-5 w-5" />
                  {scannedImages.length > 0 ? 'مسح صفحة إضافية' : 'بدء المسح'}
                </>
              )}
            </Button>
          </div>

          {/* Scanned Images Gallery */}
          {scannedImages.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  الصور الممسوحة ({scannedImages.length})
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setScannedImages([])}
                  className="text-destructive hover:text-destructive"
                >
                  <RefreshCw className="h-4 w-4 ml-1" />
                  مسح الكل
                </Button>
              </div>
              
              <div className="grid grid-cols-3 gap-2 max-h-[300px] overflow-y-auto p-1">
                {scannedImages.map((img) => (
                  <div
                    key={img.id}
                    className="relative aspect-[3/4] rounded-lg overflow-hidden border bg-muted group"
                  >
                    <img
                      src={img.src}
                      alt="Scanned document"
                      className="w-full h-full object-cover"
                    />
                    <button
                      onClick={() => handleRemoveImage(img.id)}
                      className="absolute top-1 left-1 p-1 bg-destructive text-destructive-foreground rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                
                {/* Add More Button */}
                <button
                  onClick={handleScan}
                  disabled={isScanning}
                  className="aspect-[3/4] rounded-lg border-2 border-dashed border-muted-foreground/30 flex items-center justify-center hover:border-primary hover:bg-primary/5 transition-colors disabled:opacity-50"
                >
                  <Plus className="h-8 w-8 text-muted-foreground" />
                </button>
              </div>
            </div>
          )}

          {/* Instructions */}
          {scannedImages.length === 0 && !error && (
            <div className="text-center text-sm text-muted-foreground space-y-1">
              <p>اضغط على "بدء المسح" لبدء المسح من السكانر</p>
              <p className="text-xs">تأكد من تثبيت ScanApp وتوصيل السكانر</p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={isScanning || isSaving}
          >
            إلغاء
          </Button>
          <Button
            onClick={handleSave}
            disabled={scannedImages.length === 0 || isScanning || isSaving}
            className="gap-2"
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            حفظ الصور ({scannedImages.length})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
