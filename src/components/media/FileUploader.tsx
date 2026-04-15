import { useState, useCallback, useEffect, useId, useRef } from 'react';
import { Upload, X, CheckCircle, AlertCircle, Loader2, RefreshCw, FileImage, FileVideo, FileText, FolderUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

interface UploadFile {
  id: string;
  file: File;
  progress: number;
  status: 'pending' | 'uploading' | 'success' | 'error';
  error?: string;
  result?: any;
}

interface FileUploaderProps {
  entityType?: string;
  entityId?: string;
  onUploadComplete?: (files: any[]) => void;
  accept?: string;
  maxFiles?: number;
  className?: string;
}

const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'pdf', 'doc', 'docx', 'mp4', 'webm'];

const getFileTypeIcon = (file: File) => {
  if (file.type.startsWith('image/')) return FileImage;
  if (file.type.startsWith('video/')) return FileVideo;
  return FileText;
};

export function FileUploader({
  entityType,
  entityId,
  onUploadComplete,
  accept = 'image/*,application/pdf,.doc,.docx,video/*',
  maxFiles = 10,
  className,
}: FileUploaderProps) {
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Separate hidden input for folder upload. `webkitdirectory` makes
  // the OS picker select a directory instead of individual files, and
  // the browser walks the tree and hands us every file inside.
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const validateFile = (file: File): string | null => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!ext || !ALLOWED_EXTENSIONS.includes(ext)) {
      return 'نوع الملف غير مدعوم';
    }
    if (file.size > 50 * 1024 * 1024) {
      return 'حجم الملف يتجاوز 50MB';
    }
    return null;
  };

  const addFiles = useCallback((newFiles: FileList | File[], silentlySkipInvalid = false) => {
    // Folder uploads often include hidden OS files (.DS_Store,
    // Thumbs.db) and unrelated extensions. Silently drop anything
    // that fails validation when the source is a folder instead of
    // surfacing each one as a visible error row.
    const incoming = Array.from(newFiles);
    const filtered = silentlySkipInvalid
      ? incoming.filter((f) => !validateFile(f))
      : incoming;
    const fileArray = filtered.slice(0, Math.max(0, maxFiles - files.length));

    const uploadFiles: UploadFile[] = fileArray.map(file => {
      const error = validateFile(file);
      return {
        id: crypto.randomUUID(),
        file,
        progress: 0,
        status: error ? 'error' : 'pending',
        error,
      };
    });

    setFiles(prev => [...prev, ...uploadFiles]);
  }, [files.length, maxFiles]);

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  const uploadFile = async (uploadFile: UploadFile): Promise<any | null> => {
    setFiles(prev => prev.map(f => 
      f.id === uploadFile.id ? { ...f, status: 'uploading', progress: 10 } : f
    ));

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('غير مصرح');
      }

      const formData = new FormData();
      formData.append('file', uploadFile.file);
      if (entityType) formData.append('entity_type', entityType);
      if (entityId) formData.append('entity_id', entityId);

      const progressInterval = setInterval(() => {
        setFiles(prev => prev.map(f => {
          if (f.id === uploadFile.id && f.status === 'uploading' && f.progress < 90) {
            return { ...f, progress: f.progress + 10 };
          }
          return f;
        }));
      }, 200);

      const response = await supabase.functions.invoke('upload-media', {
        body: formData,
      });

      clearInterval(progressInterval);

      if (response.error) {
        throw new Error(response.error.message || 'فشل الرفع');
      }

      const result = response.data.file;
      
      setFiles(prev => prev.map(f => 
        f.id === uploadFile.id 
          ? { ...f, status: 'success', progress: 100, result } 
          : f
      ));

      return result;

    } catch (error: any) {
      console.error('Upload error:', error);
      setFiles(prev => prev.map(f => 
        f.id === uploadFile.id 
          ? { ...f, status: 'error', error: error.message || 'فشل الرفع', progress: 0 } 
          : f
      ));
      return null;
    }
  };

  const uploadAll = async () => {
    const pendingFiles = files.filter(f => f.status === 'pending');
    if (pendingFiles.length === 0) return;

    setIsUploading(true);
    const uploadedResults: any[] = [];
    
    for (const file of pendingFiles) {
      const result = await uploadFile(file);
      if (result) {
        uploadedResults.push(result);
      }
    }

    setIsUploading(false);

    // If all uploads completed (success or fail), call onUploadComplete with successful files
    if (uploadedResults.length > 0 && onUploadComplete) {
      onUploadComplete(uploadedResults);
    }
  };

  const retryFile = (id: string) => {
    setFiles(prev => prev.map(f => 
      f.id === id ? { ...f, status: 'pending', error: undefined, progress: 0 } : f
    ));
  };

  // Recursively walk a dropped directory tree via webkitGetAsEntry and
  // collect every leaf File. Runs only when the user drops a folder —
  // plain file drops still go straight through e.dataTransfer.files.
  const readDirectory = async (entry: any): Promise<File[]> => {
    const reader = entry.createReader();
    const files: File[] = [];
    const readBatch = (): Promise<any[]> =>
      new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    while (true) {
      const batch = await readBatch();
      if (!batch.length) break;
      for (const child of batch) {
        if (child.isFile) {
          const file = await new Promise<File>((resolve, reject) =>
            child.file(resolve, reject),
          );
          files.push(file);
        } else if (child.isDirectory) {
          const nested = await readDirectory(child);
          files.push(...nested);
        }
      }
    }
    return files;
  };

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    // When anything dropped is a directory, walk the tree. Otherwise
    // fall back to e.dataTransfer.files for the plain case.
    const items = e.dataTransfer.items;
    if (items && items.length > 0) {
      const entries: any[] = [];
      let hasDirectory = false;
      for (let i = 0; i < items.length; i++) {
        const entry = (items[i] as any).webkitGetAsEntry?.();
        if (entry) {
          entries.push(entry);
          if (entry.isDirectory) hasDirectory = true;
        }
      }

      if (hasDirectory) {
        const collected: File[] = [];
        for (const entry of entries) {
          if (entry.isFile) {
            const file = await new Promise<File>((resolve, reject) =>
              entry.file(resolve, reject),
            );
            collected.push(file);
          } else if (entry.isDirectory) {
            const nested = await readDirectory(entry);
            collected.push(...nested);
          }
        }
        if (collected.length > 0) {
          addFiles(collected, true); // silent-skip junk files inside folders
        }
        return;
      }
    }

    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }, [addFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const pendingCount = files.filter(f => f.status === 'pending').length;
  const uploadingCount = files.filter(f => f.status === 'uploading').length;

  return (
    <div className={cn('space-y-4', className)}>
      {/* Drop Zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={cn(
          'relative border-2 border-dashed rounded-xl p-8 text-center transition-all duration-300 cursor-pointer overflow-hidden',
          isDragging 
            ? 'border-primary bg-primary/10 scale-[1.02]' 
            : 'border-border/60 hover:border-primary/60 hover:bg-accent/30'
        )}
        onClick={() => inputRef.current?.click()}
      >
        <div className={cn(
          'absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 transition-opacity',
          isDragging && 'opacity-100'
        )} />
        
        <div className="relative">
          <div className={cn(
            'mx-auto w-14 h-14 rounded-2xl flex items-center justify-center mb-3 transition-all',
            isDragging 
              ? 'bg-primary text-primary-foreground scale-110' 
              : 'bg-muted text-muted-foreground'
          )}>
            <Upload className="h-6 w-6" />
          </div>
          
          <p className="text-sm font-medium mb-1">
            اسحب الملفات هنا أو انقر للاختيار
          </p>
          <p className="text-xs text-muted-foreground">
            صور، PDF، Word، فيديو • حد أقصى 50MB لكل ملف
          </p>

          <div className="mt-3 flex items-center justify-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                folderInputRef.current?.click();
              }}
              className="gap-1.5"
            >
              <FolderUp className="h-4 w-4" />
              رفع مجلد
            </Button>
          </div>
        </div>

        <input
          id={inputId}
          ref={inputRef}
          type="file"
          multiple
          accept={accept}
          className="hidden"
          onChange={(e) => e.target.files && addFiles(e.target.files)}
        />

        {/* Folder picker — `webkitdirectory` makes the OS dialog
            select a directory and deliver every file inside, nested
            subfolders included. We strip anything that fails
            validation silently so junk files like .DS_Store don't
            render as errors. */}
        <input
          ref={folderInputRef}
          type="file"
          multiple
          // @ts-expect-error non-standard but supported on every
          // Chromium-based browser, Firefox 50+, and Safari 11.1+
          webkitdirectory=""
          directory=""
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              addFiles(e.target.files, true);
              // reset so selecting the same folder twice still fires
              e.target.value = '';
            }
          }}
          onClick={(e) => e.stopPropagation()}
        />
      </div>

      {/* File List */}
      {files.length > 0 && (
        <div className="space-y-2 max-h-[250px] overflow-y-auto">
          {files.map(file => {
            const FileIcon = getFileTypeIcon(file.file);
            return (
              <div
                key={file.id}
                className={cn(
                  'flex items-center gap-3 p-2.5 rounded-lg border transition-all',
                  file.status === 'success' && 'bg-green-500/5 border-green-500/30',
                  file.status === 'error' && 'bg-destructive/5 border-destructive/30',
                  file.status === 'uploading' && 'bg-primary/5 border-primary/30',
                  file.status === 'pending' && 'bg-card border-border'
                )}
              >
                {/* File Icon/Preview */}
                <div className={cn(
                  'flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center overflow-hidden',
                  file.status === 'success' && 'bg-green-500/10',
                  file.status === 'error' && 'bg-destructive/10',
                  file.status === 'uploading' && 'bg-primary/10',
                  file.status === 'pending' && 'bg-muted'
                )}>
                  {file.status === 'success' ? (
                    <CheckCircle className="h-5 w-5 text-green-600" />
                  ) : file.status === 'uploading' ? (
                    <Loader2 className="h-5 w-5 text-primary animate-spin" />
                  ) : file.status === 'error' ? (
                    <AlertCircle className="h-5 w-5 text-destructive" />
                  ) : file.file.type.startsWith('image/') ? (
                    <img 
                      src={URL.createObjectURL(file.file)} 
                      alt="" 
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <FileIcon className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>

                {/* File Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{file.file.name}</p>
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-muted-foreground">
                      {(file.file.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                    {file.status === 'success' && (
                      <span className="text-xs text-green-600 font-medium">تم الرفع</span>
                    )}
                  </div>
                  {file.status === 'uploading' && (
                    <Progress value={file.progress} className="h-1 mt-1.5" />
                  )}
                  {file.error && (
                    <p className="text-xs text-destructive mt-0.5">{file.error}</p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex-shrink-0 flex gap-1">
                  {file.status === 'error' && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 hover:bg-destructive/10"
                      onClick={() => retryFile(file.id)}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {file.status !== 'uploading' && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => removeFile(file.id)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Upload Button */}
      {pendingCount > 0 && (
        <Button
          onClick={uploadAll}
          disabled={isUploading}
          size="lg"
          className="w-full"
        >
          {isUploading ? (
            <>
              <Loader2 className="h-4 w-4 ml-2 animate-spin" />
              جاري الرفع...
            </>
          ) : (
            <>
              <Upload className="h-4 w-4 ml-2" />
              رفع {pendingCount} {pendingCount === 1 ? 'ملف' : 'ملفات'}
            </>
          )}
        </Button>
      )}
    </div>
  );
}
