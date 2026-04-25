import { useId, useRef, useState } from 'react';
import { Image as ImageIcon, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Props {
  value: string[];
  onChange: (urls: string[]) => void;
  entityType?: string;
  entityId?: string;
  className?: string;
  label?: string;
  /** Hard cap on attachments — protects the storage bucket from abuse. */
  max?: number;
}

/**
 * Multi-image variant of CompactImagePicker for cheque attachments.
 * Shows a row of 40x40 thumbnails (each clickable to open + hover to
 * remove) followed by a small camera button that supports multi-select
 * file pickers. All uploads hit the same `upload-media` edge function
 * the single-image picker uses, so storage paths line up.
 */
export function MultiImagePicker({
  value,
  onChange,
  entityType,
  entityId,
  className,
  label = 'صور',
  max = 10,
}: Props) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const onFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    const remaining = Math.max(0, max - value.length);
    if (remaining <= 0) {
      toast.error(`الحد الأقصى ${max} صور`);
      return;
    }
    const list = Array.from(files).slice(0, remaining);
    setUploading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('غير مصرح');
      const uploaded: string[] = [];
      for (const file of list) {
        const fd = new FormData();
        fd.append('file', file);
        if (entityType) fd.append('entity_type', entityType);
        if (entityId) fd.append('entity_id', entityId);
        const { data, error } = await supabase.functions.invoke('upload-media', { body: fd });
        if (error) throw error;
        const url = data?.file?.cdn_url || data?.file?.url;
        if (url) uploaded.push(url);
      }
      if (uploaded.length) {
        onChange([...value, ...uploaded]);
        toast.success(
          uploaded.length === 1 ? 'تم رفع الصورة' : `تم رفع ${uploaded.length} صور`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'فشل رفع الصورة';
      toast.error(message);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const removeAt = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx));
  };

  return (
    <div className={cn('flex items-center flex-wrap gap-2', className)}>
      {value.map((url, idx) => (
        <div key={`${url}-${idx}`} className="relative inline-block group">
          <a href={url} target="_blank" rel="noreferrer" title={`${label} ${idx + 1}`}>
            <img
              src={url}
              alt={`${label} ${idx + 1}`}
              className="h-10 w-10 rounded border object-cover"
            />
          </a>
          <button
            type="button"
            onClick={() => removeAt(idx)}
            className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition shadow"
            aria-label="إزالة الصورة"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}

      {value.length < max && (
        <>
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => onFiles(e.target.files)}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-10 w-10 shrink-0"
            title={`${label} (${value.length}/${max})`}
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
      )}
    </div>
  );
}
