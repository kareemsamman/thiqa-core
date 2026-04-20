import { useState } from 'react';
import { FileImage } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { FilePreviewGallery } from '@/components/policies/FilePreviewGallery';

interface ChequeImageGalleryProps {
  /** The primary cheque_image_url from the payment */
  primaryImageUrl: string | null;
  /** Payment ID to fetch additional images from payment_images */
  paymentId: string;
  /** If batched, all payment IDs in the batch */
  batchPaymentIds?: string[];
  /**
   * True when at least one payment in the batch has a row in
   * `payment_images` (scanned cheque OR uploaded receipt). The legacy
   * cheque_image_url only covers scanned cheques, so relying on it
   * alone hid uploaded attachments from the payments-log row even
   * though the details dialog could see them.
   */
  hasBatchImages?: boolean;
}

interface MediaFile {
  id: string;
  original_name: string;
  cdn_url: string;
  mime_type: string;
  size: number;
  created_at: string;
  entity_type: string | null;
}

// Wrap a URL into the MediaFile shape FilePreviewGallery expects. Same
// helper PaymentGroupDetailsDialog uses internally — duplicated here so
// the outer payments-log row can open the full-featured viewer (zoom,
// download, pagination, filename) instead of the old plain-img dialog.
const toMediaFile = (
  id: string,
  url: string,
): MediaFile => {
  const isPdf = url.toLowerCase().endsWith('.pdf');
  const tail = url.split('/').pop() || (isPdf ? 'ملف.pdf' : 'صورة');
  return {
    id,
    original_name: tail,
    cdn_url: url,
    mime_type: isPdf ? 'application/pdf' : 'image/jpeg',
    size: 0,
    created_at: new Date().toISOString(),
    entity_type: null,
  };
};

export function ChequeImageGallery({ primaryImageUrl, paymentId, batchPaymentIds, hasBatchImages }: ChequeImageGalleryProps) {
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [currentFile, setCurrentFile] = useState<MediaFile | null>(null);

  if (!primaryImageUrl && !hasBatchImages) {
    return <span className="text-muted-foreground">-</span>;
  }

  const handleOpen = async () => {
    const ids = batchPaymentIds?.length ? batchPaymentIds : [paymentId];
    const collected: MediaFile[] = [];
    const seenUrls = new Set<string>();

    try {
      const { data } = await supabase
        .from('payment_images')
        .select('id, image_url, sort_order')
        .in('payment_id', ids)
        .order('sort_order');

      for (const row of data || []) {
        if (seenUrls.has(row.image_url)) continue;
        seenUrls.add(row.image_url);
        collected.push(toMediaFile(row.id, row.image_url));
      }
    } catch (err) {
      console.error('Error fetching payment images:', err);
    }

    // cheque_image_url is the legacy scanned-cheque field; include it
    // when it isn't already covered by a payment_images row.
    if (primaryImageUrl && !seenUrls.has(primaryImageUrl)) {
      collected.push(toMediaFile(`primary-${paymentId}`, primaryImageUrl));
    }

    if (collected.length === 0) return;
    setFiles(collected);
    setCurrentFile(collected[0]);
  };

  return (
    <>
      <button
        onClick={handleOpen}
        className="flex items-center gap-1 text-primary hover:underline cursor-pointer"
      >
        <FileImage className="h-4 w-4" />
        <span className="text-xs">عرض</span>
      </button>

      <FilePreviewGallery
        file={currentFile}
        allFiles={files}
        onClose={() => setCurrentFile(null)}
        onNavigate={setCurrentFile}
      />
    </>
  );
}
