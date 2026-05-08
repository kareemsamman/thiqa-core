import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import {
  Loader2, FileText, ExternalLink, FolderOpen, ImageIcon, Search, Play,
  Plus, Trash2, Download, Upload,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { FilePreviewGallery } from '@/components/policies/FilePreviewGallery';
import { DeleteConfirmDialog } from '@/components/shared/DeleteConfirmDialog';
import * as tus from 'tus-js-client';

interface MediaFile {
  id: string;
  original_name: string;
  cdn_url: string;
  mime_type: string;
  size: number;
  created_at: string;
  entity_type: string | null;
  entity_id?: string | null;
  storage_path?: string | null;
  stream_video_guid?: string | null;
  stream_library_id?: string | null;
}

export interface ClientFilesPolicyRef {
  id: string;
  label: string;
  car_number?: string | null;
  policy_number?: string | null;
  document_number?: string | null;
}

interface ClientFilesTabProps {
  policies: ClientFilesPolicyRef[];
  kind: 'system' | 'client';
  clientId?: string;
  onCountChange?: (count: number) => void;
}

const CLIENT_SYSTEM_ENTITY_TYPE = 'client_system';

const ENTITY_TYPES: Record<ClientFilesTabProps['kind'], string[]> = {
  // ملفات النظام = internal/CRM docs (matches policy_crm in PolicyFilesSection)
  system: ['policy_crm'],
  // ملفات العميل = insurance/policy docs (matches policy/policy_insurance in PolicyFilesSection)
  client: ['policy', 'policy_insurance'],
};

const isImage = (mime: string) => mime?.startsWith('image/');
const isPdf = (mime: string) => mime === 'application/pdf';
const isVideo = (mime: string) => mime?.startsWith('video/');

const formatSize = (bytes: number) => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export function ClientFilesTab({ policies, kind, clientId, onCountChange }: ClientFilesTabProps) {
  const { toast } = useToast();
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState<MediaFile | null>(null);
  const [search, setSearch] = useState('');

  const showManualUpload = kind === 'system' && !!clientId;
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    name: string;
    pct: number;
    current: number;
    total: number;
  } | null>(null);
  const [deletingFile, setDeletingFile] = useState<MediaFile | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const policyIds = useMemo(() => policies.map((p) => p.id), [policies]);
  const policyMap = useMemo(() => {
    const m = new Map<string, ClientFilesPolicyRef>();
    policies.forEach((p) => m.set(p.id, p));
    return m;
  }, [policies]);

  const fetchAll = useCallback(async () => {
    setLoading(true);

    const queries: Promise<{ data: MediaFile[] | null; error: any }>[] = [];

    if (policyIds.length > 0) {
      queries.push(
        supabase
          .from('media_files')
          .select('id, original_name, cdn_url, mime_type, size, created_at, entity_type, entity_id, storage_path, stream_video_guid, stream_library_id')
          .in('entity_id', policyIds)
          .in('entity_type', ENTITY_TYPES[kind])
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .then((r) => ({ data: r.data as MediaFile[] | null, error: r.error })),
      );
    }

    if (showManualUpload && clientId) {
      queries.push(
        supabase
          .from('media_files')
          .select('id, original_name, cdn_url, mime_type, size, created_at, entity_type, entity_id, storage_path, stream_video_guid, stream_library_id')
          .eq('entity_id', clientId)
          .eq('entity_type', CLIENT_SYSTEM_ENTITY_TYPE)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .then((r) => ({ data: r.data as MediaFile[] | null, error: r.error })),
      );
    }

    if (queries.length === 0) {
      setFiles([]);
      setLoading(false);
      onCountChange?.(0);
      return;
    }

    const results = await Promise.all(queries);
    const firstError = results.find((r) => r.error)?.error;
    if (firstError) {
      console.error('Error fetching client files:', firstError);
      setFiles([]);
      onCountChange?.(0);
    } else {
      const merged = results
        .flatMap((r) => r.data || [])
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setFiles(merged);
      onCountChange?.(merged.length);
    }
    setLoading(false);
  }, [policyIds.join(','), kind, clientId, showManualUpload, onCountChange]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const filteredFiles = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return files;
    return files.filter((file) => {
      const policy = file.entity_id ? policyMap.get(file.entity_id) : null;
      const haystack = [
        file.original_name,
        policy?.car_number,
        policy?.policy_number,
        policy?.document_number,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [files, search, policyMap]);

  const isExternalLink = (file: MediaFile) => !file.storage_path && file.size === 0;
  const isManualFile = (file: MediaFile) => file.entity_type === CLIENT_SYSTEM_ENTITY_TYPE;

  const uploadOne = (file: File, accessToken: string | undefined): Promise<void> => {
    return new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('entity_type', CLIENT_SYSTEM_ENTITY_TYPE);
      formData.append('entity_id', clientId!);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-media`);
      xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          setUploadProgress((prev) => (prev ? { ...prev, pct } : prev));
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
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

  const uploadVideo = async (file: File, current: number, total: number) => {
    if (file.size > 1024 * 1024 * 1024) {
      throw new Error('الفيديو أكبر من 1GB');
    }
    const { data, error } = await supabase.functions.invoke('create-stream-video', {
      body: {
        title: file.name,
        file_size: file.size,
        mime_type: file.type,
        entity_type: CLIENT_SYSTEM_ENTITY_TYPE,
        entity_id: clientId!,
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

  const uploadFiles = async (toUpload: File[]) => {
    if (!showManualUpload || toUpload.length === 0) return;
    setUploading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      for (let i = 0; i < toUpload.length; i++) {
        const f = toUpload[i];
        setUploadProgress({ name: f.name, pct: 0, current: i + 1, total: toUpload.length });

        const looksLikeVideo =
          f.type.startsWith('video/') ||
          /\.(mp4|mov|avi|webm|mkv|m4v|3gp)$/i.test(f.name);

        if (looksLikeVideo) {
          await uploadVideo(f, i + 1, toUpload.length);
        } else {
          await uploadOne(f, session?.access_token);
        }
      }
      toast({ title: 'تم الرفع', description: 'تم رفع الملفات بنجاح' });
      await fetchAll();
    } catch (error: any) {
      console.error('Error uploading:', error);
      toast({
        title: 'خطأ',
        description: error.message || 'فشل في رفع الملفات',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  const handleUploadInput = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const list = event.target.files;
    if (!list || list.length === 0) return;
    await uploadFiles(Array.from(list));
    event.target.value = '';
  };

  const isAcceptedFile = (file: File): boolean => {
    if (file.type.startsWith('image/')) return true;
    if (file.type === 'application/pdf') return true;
    if (file.type.startsWith('video/')) return true;
    return /\.(jpe?g|png|gif|webp|bmp|svg|heic|heif|pdf|mp4|mov|avi|webm|mkv|m4v|3gp)$/i.test(file.name);
  };

  /** Walk a DataTransfer that may contain folders. Falls back to
   *  dt.files when items aren't available — covers Windows Explorer
   *  folder drops where dataTransfer.files is empty / unhelpful. */
  const gatherFilesFromDataTransfer = async (dt: DataTransfer): Promise<File[]> => {
    const out: File[] = [];
    const items = dt.items ? Array.from(dt.items) : [];
    if (items.length === 0) return Array.from(dt.files ?? []);

    const traverse = async (entry: any): Promise<void> => {
      if (entry.isFile) {
        const file: File = await new Promise((resolve, reject) =>
          entry.file(resolve, reject),
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

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    if (!showManualUpload || uploading) return;
    const collected = await gatherFilesFromDataTransfer(event.dataTransfer);
    const accepted = collected.filter(isAcceptedFile);
    const rejectedCount = collected.length - accepted.length;
    if (accepted.length === 0) {
      toast({
        title: 'لا توجد ملفات مدعومة',
        description: 'ادعم الصور و PDF والفيديو فقط.',
        variant: 'destructive',
      });
      return;
    }
    if (rejectedCount > 0) {
      toast({
        title: `تم تجاهل ${rejectedCount} ملف غير مدعوم`,
        description: 'تم قبول الصور و PDF والفيديو فقط.',
      });
    }
    await uploadFiles(accepted);
  };

  const handleDelete = async () => {
    if (!deletingFile) return;
    setDeleting(true);
    try {
      const { error } = await supabase.functions.invoke('delete-media', {
        body: { fileIds: [deletingFile.id] },
      });
      if (error) throw new Error(error.message || 'Delete failed');
      await fetchAll();
    } catch (error: any) {
      console.error('Error deleting:', error);
      toast({
        title: 'خطأ',
        description: error.message || 'فشل في حذف الملف',
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
      setDeletingFile(null);
    }
  };

  const heading = kind === 'system' ? 'ملفات النظام' : 'ملفات العميل';
  const HeadingIcon = kind === 'system' ? FolderOpen : ImageIcon;
  const description =
    kind === 'system'
      ? 'مستندات داخلية مرتبطة بالمعاملات (هوية، رخصة، صور سيارة...)'
      : 'ملفات البوليصة من شركة التأمين لكل معاملة';

  return (
    <>
      <Card
        className={`relative p-4 space-y-4 transition-colors ${
          isDragging ? 'ring-2 ring-primary ring-offset-2 bg-primary/5' : ''
        }`}
        onDragOver={(e) => {
          if (!showManualUpload) return;
          e.preventDefault();
          if (!uploading) setIsDragging(true);
        }}
        onDragLeave={(e) => {
          if (!showManualUpload) return;
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setIsDragging(false);
        }}
        onDrop={(e) => {
          if (!showManualUpload) return;
          handleDrop(e);
        }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 text-primary font-semibold">
            <HeadingIcon className="h-4 w-4" />
            <span>{heading}</span>
            <Badge variant="secondary">
              {search.trim() ? `${filteredFiles.length} / ${files.length}` : files.length}
            </Badge>
          </div>
          {showManualUpload && (
            <div className="ms-auto relative">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,.pdf,video/*"
                onChange={handleUploadInput}
                className="absolute inset-0 opacity-0 cursor-pointer"
                disabled={uploading}
              />
              <Button size="sm" variant="outline" disabled={uploading}>
                {uploading ? (
                  <Loader2 className="h-4 w-4 ml-1 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4 ml-1" />
                )}
                رفع ملف
              </Button>
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {description}
          {showManualUpload ? ' — يمكنك رفع ملفات يدوياً هنا أيضاً (اسحب وأفلت).' : ''}
        </p>

        {!loading && files.length > 0 && (
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث برقم السيارة، اسم الملف، رقم البوليصة، أو رقم المعاملة..."
              className="pr-9"
            />
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin ml-2" />
            جاري التحميل...
          </div>
        ) : files.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">لا توجد ملفات</p>
        ) : filteredFiles.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">لا نتائج مطابقة للبحث</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {filteredFiles.map((file) => {
              const manual = isManualFile(file);
              const policy = file.entity_id && !manual ? policyMap.get(file.entity_id) : null;
              const policyLabel = policy?.label ?? (manual ? 'يدوي' : 'معاملة');
              const carNumber = policy?.car_number;
              const onClick = () => {
                if (isExternalLink(file)) {
                  window.open(file.cdn_url, '_blank');
                } else {
                  setSelectedFile(file);
                }
              };
              return (
                <div
                  key={file.id}
                  className="group relative rounded-lg border overflow-hidden bg-muted/30 cursor-pointer hover:border-primary/50 transition-colors flex flex-col"
                  onClick={onClick}
                >
                  <div className="relative h-64 bg-muted/40">
                    {isExternalLink(file) ? (
                      <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-blue-500 to-blue-600 text-white">
                        <ExternalLink className="h-10 w-10" />
                        <span className="text-sm font-bold mt-2">X-Service</span>
                      </div>
                    ) : isImage(file.mime_type) ? (
                      <img
                        src={file.cdn_url}
                        alt={file.original_name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : isPdf(file.mime_type) ? (
                      <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-red-500 to-red-600 text-white">
                        <FileText className="h-10 w-10" />
                        <span className="text-sm font-bold mt-2">PDF</span>
                      </div>
                    ) : isVideo(file.mime_type) ? (
                      <div className="relative w-full h-full bg-black">
                        {file.stream_video_guid && file.stream_library_id ? (
                          <img
                            src={`https://vz-${file.stream_library_id}.b-cdn.net/${file.stream_video_guid}/thumbnail.jpg`}
                            alt={file.original_name}
                            className="w-full h-full object-cover"
                            loading="lazy"
                            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                          />
                        ) : (
                          <video src={file.cdn_url} className="w-full h-full object-cover" muted preload="metadata" />
                        )}
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <div className="bg-black/60 rounded-full p-2">
                            <Play className="h-6 w-6 text-white fill-white" />
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground">
                        <FileText className="h-8 w-8" />
                      </div>
                    )}
                    {file.size > 0 && (
                      <div className="absolute bottom-1 right-1 text-[10px] bg-black/60 text-white px-1.5 py-0.5 rounded">
                        {formatSize(file.size)}
                      </div>
                    )}
                  </div>
                  <div className="p-2 space-y-1 border-t bg-background">
                    <Badge
                      variant={manual ? 'secondary' : 'outline'}
                      className="text-[10px] w-full justify-center truncate"
                    >
                      {policyLabel}
                      {carNumber ? ` · ${carNumber}` : ''}
                    </Badge>
                    <p
                      className="text-[10px] text-muted-foreground truncate text-center"
                      title={file.original_name}
                    >
                      {file.original_name}
                    </p>
                  </div>
                  <div className="absolute inset-x-0 top-0 h-10 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-b from-black/50 to-transparent pointer-events-none flex items-start justify-end gap-1 p-1">
                    <a
                      href={file.cdn_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      download={file.original_name}
                      className="pointer-events-auto inline-flex items-center justify-center h-7 w-7 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Download className="h-3.5 w-3.5" />
                    </a>
                    <Button
                      size="icon"
                      variant="destructive"
                      className="h-7 w-7 pointer-events-auto"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeletingFile(file);
                        setDeleteOpen(true);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {showManualUpload && isDragging && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center bg-primary/10 border-2 border-dashed border-primary rounded-lg">
            <div className="bg-background/95 px-4 py-2 rounded-md shadow-md text-sm font-semibold text-primary flex items-center gap-2">
              <Upload className="h-4 w-4" />
              أفلت الملفات للرفع
            </div>
          </div>
        )}
      </Card>

      <FilePreviewGallery
        file={selectedFile}
        allFiles={filteredFiles}
        onClose={() => setSelectedFile(null)}
        onNavigate={(f) => setSelectedFile(f)}
      />

      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={handleDelete}
        title="حذف الملف"
        description={`هل أنت متأكد من حذف "${deletingFile?.original_name}"؟`}
        loading={deleting}
      />

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
