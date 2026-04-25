import { useId, useRef, useState } from 'react';
import { Image as ImageIcon, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Props {
  value?: string | null;
  onChange: (url: string | null) => void;
  /** entity_type passed to the upload-media function (governs storage path). */
  entityType?: string;
  entityId?: string;
  className?: string;
  /** Tooltip + aria-label for the trigger when empty. */
  label?: string;
}

/**
 * Tiny one-shot image picker for places where the full FileUploader's
 * drop-zone is overkill — cheque images, receipt thumbnails. Shows
 * either a 40x40 thumb (with hover-to-remove) or a small camera button.
 *
 * Hits the same `upload-media` edge function the FileUploader uses, so
 * uploads are stored and routed identically.
 */
export function CompactImagePicker({
  value,
  onChange,
  entityType,
  entityId,
  className,
  label = 'صورة',
}: Props) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const onFile = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('غير مصرح');
      const fd = new FormData();
      fd.append('file', file);
      if (entityType) fd.append('entity_type', entityType);
      if (entityId) fd.append('entity_id', entityId);
      const { data, error } = await supabase.functions.invoke('upload-media', { body: fd });
      if (error) throw error;
      const url = data?.file?.cdn_url || data?.file?.url;
      if (!url) throw new Error('لم يُرجع الخادم رابطاً للصورة');
      onChange(url);
      toast.success('تم رفع الصورة');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'فشل رفع الصورة';
      toast.error(message);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  if (value) {
    return (
      <div className={cn('relative inline-block group', className)}>
        <a href={value} target="_blank" rel="noreferrer">
          <img
            src={value}
            alt={label}
            className="h-10 w-10 rounded border object-cover"
          />
        </a>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition shadow"
          aria-label="إزالة الصورة"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        className={cn('h-10 w-10 shrink-0', className)}
        title={label}
        aria-label={label}
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <ImageIcon className="h-4 w-4 text-muted-foreground" />
        )}
      </Button>
    </>
  );
}
