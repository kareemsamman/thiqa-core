import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, FileText, ExternalLink, FolderOpen, ImageIcon } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { FilePreviewGallery } from '@/components/policies/FilePreviewGallery';

interface MediaFile {
  id: string;
  original_name: string;
  cdn_url: string;
  mime_type: string;
  size: number;
  created_at: string;
  entity_type: string | null;
  entity_id: string | null;
  storage_path?: string | null;
}

export interface ClientFilesPolicyRef {
  id: string;
  label: string;
  car_number?: string | null;
  policy_number?: string | null;
}

interface ClientFilesTabProps {
  policies: ClientFilesPolicyRef[];
  kind: 'system' | 'client';
  onCountChange?: (count: number) => void;
}

const ENTITY_TYPES: Record<ClientFilesTabProps['kind'], string[]> = {
  // ملفات النظام = internal/CRM docs (matches policy_crm in PolicyFilesSection)
  system: ['policy_crm'],
  // ملفات العميل = insurance/policy docs (matches policy/policy_insurance in PolicyFilesSection)
  client: ['policy', 'policy_insurance'],
};

const isImage = (mime: string) => mime?.startsWith('image/');
const isPdf = (mime: string) => mime === 'application/pdf';

const formatSize = (bytes: number) => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export function ClientFilesTab({ policies, kind, onCountChange }: ClientFilesTabProps) {
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState<MediaFile | null>(null);

  const policyIds = useMemo(() => policies.map((p) => p.id), [policies]);
  const policyMap = useMemo(() => {
    const m = new Map<string, ClientFilesPolicyRef>();
    policies.forEach((p) => m.set(p.id, p));
    return m;
  }, [policies]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      if (policyIds.length === 0) {
        setFiles([]);
        setLoading(false);
        onCountChange?.(0);
        return;
      }
      const { data, error } = await supabase
        .from('media_files')
        .select('id, original_name, cdn_url, mime_type, size, created_at, entity_type, entity_id, storage_path')
        .in('entity_id', policyIds)
        .in('entity_type', ENTITY_TYPES[kind])
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (cancelled) return;
      if (error) {
        console.error('Error fetching client files:', error);
        setFiles([]);
        onCountChange?.(0);
      } else {
        setFiles(data || []);
        onCountChange?.((data || []).length);
      }
      setLoading(false);
    };
    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policyIds.join(','), kind]);

  const isExternalLink = (file: MediaFile) => !file.storage_path && file.size === 0;

  const heading = kind === 'system' ? 'ملفات النظام' : 'ملفات العميل';
  const HeadingIcon = kind === 'system' ? FolderOpen : ImageIcon;
  const description =
    kind === 'system'
      ? 'مستندات داخلية مرتبطة بالمعاملات (هوية، رخصة، صور سيارة...)'
      : 'ملفات البوليصة من شركة التأمين لكل معاملة';

  return (
    <>
      <Card className="p-4 space-y-4">
        <div className="flex items-center gap-2 text-primary font-semibold">
          <HeadingIcon className="h-4 w-4" />
          <span>{heading}</span>
          <Badge variant="secondary" className="ml-auto">{files.length}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">{description}</p>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin ml-2" />
            جاري التحميل...
          </div>
        ) : files.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">لا توجد ملفات</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {files.map((file) => {
              const policy = file.entity_id ? policyMap.get(file.entity_id) : null;
              const policyLabel = policy?.label ?? 'معاملة';
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
                  className="group rounded-lg border overflow-hidden bg-muted/30 cursor-pointer hover:border-primary/50 transition-colors flex flex-col"
                  onClick={onClick}
                >
                  <div className="relative aspect-square bg-muted/40">
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
                    <Badge variant="outline" className="text-[10px] w-full justify-center truncate">
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
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <FilePreviewGallery
        file={selectedFile}
        allFiles={files}
        onClose={() => setSelectedFile(null)}
        onNavigate={(f) => setSelectedFile(f)}
      />
    </>
  );
}
