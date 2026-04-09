import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, FileImage, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface ChequeImageGalleryProps {
  /** The primary cheque_image_url from the payment */
  primaryImageUrl: string | null;
  /** Payment ID to fetch additional images from payment_images */
  paymentId: string;
  /** If batched, all payment IDs in the batch */
  batchPaymentIds?: string[];
}

export function ChequeImageGallery({ primaryImageUrl, paymentId, batchPaymentIds }: ChequeImageGalleryProps) {
  const [open, setOpen] = useState(false);
  const [images, setImages] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    
    const fetchImages = async () => {
      setLoading(true);
      try {
        const ids = batchPaymentIds?.length ? batchPaymentIds : [paymentId];
        const { data } = await supabase
          .from('payment_images')
          .select('image_url, sort_order')
          .in('payment_id', ids)
          .order('sort_order');

        const allUrls = new Set<string>();
        if (primaryImageUrl) allUrls.add(primaryImageUrl);
        (data || []).forEach(row => allUrls.add(row.image_url));
        
        setImages(Array.from(allUrls));
        setCurrentIndex(0);
      } catch (err) {
        console.error('Error fetching payment images:', err);
        if (primaryImageUrl) setImages([primaryImageUrl]);
      } finally {
        setLoading(false);
      }
    };

    fetchImages();
  }, [open, paymentId, primaryImageUrl, batchPaymentIds]);

  if (!primaryImageUrl) {
    return <span className="text-muted-foreground">-</span>;
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 text-primary hover:underline cursor-pointer"
      >
        <FileImage className="h-4 w-4" />
        <span className="text-xs">عرض</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh]" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileImage className="h-5 w-5 text-primary" />
              صور الشيك
              {images.length > 1 && (
                <span className="text-sm font-normal text-muted-foreground">
                  ({currentIndex + 1} / {images.length})
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : images.length > 0 ? (
            <div className="relative">
              <div className="rounded-lg overflow-hidden border bg-muted/30">
                <img
                  src={images[currentIndex]}
                  alt={`صورة الشيك ${currentIndex + 1}`}
                  className="w-full max-h-[60vh] object-contain"
                />
              </div>

              {images.length > 1 && (
                <div className="flex items-center justify-center gap-4 mt-3">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setCurrentIndex(i => Math.max(0, i - 1))}
                    disabled={currentIndex === 0}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    {currentIndex + 1} / {images.length}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setCurrentIndex(i => Math.min(images.length - 1, i + 1))}
                    disabled={currentIndex === images.length - 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                </div>
              )}

              {/* Thumbnails strip */}
              {images.length > 1 && (
                <div className="flex gap-2 mt-3 overflow-x-auto pb-2">
                  {images.map((url, idx) => (
                    <button
                      key={idx}
                      onClick={() => setCurrentIndex(idx)}
                      className={`shrink-0 w-16 h-12 rounded border overflow-hidden ${
                        idx === currentIndex ? 'ring-2 ring-primary' : 'opacity-60 hover:opacity-100'
                      }`}
                    >
                      <img src={url} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-center text-muted-foreground py-8">لا توجد صور</p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
