import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { ImageIcon, Plus, Trash2, Download, Loader2, FileText, FolderOpen } from "lucide-react";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";
import { FilePreviewGallery } from "./FilePreviewGallery";
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

interface PolicyImagesSectionProps {
  policyId: string;
}

export function PolicyImagesSection({ policyId }: PolicyImagesSectionProps) {
  const { toast } = useToast();
  const [insuranceFiles, setInsuranceFiles] = useState<MediaFile[]>([]);
  const [crmFiles, setCrmFiles] = useState<MediaFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<MediaFile | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingImage, setDeletingImage] = useState<MediaFile | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [activeTab, setActiveTab] = useState("insurance");

  const fetchFiles = async () => {
    setLoading(true);
    try {
      // Fetch insurance files
      const { data: insuranceData, error: insuranceError } = await supabase
        .from('media_files')
        .select('*')
        .eq('entity_id', policyId)
        .in('entity_type', ['policy', 'policy_insurance'])
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (insuranceError) throw insuranceError;
      setInsuranceFiles(insuranceData || []);

      // Fetch CRM files
      const { data: crmData, error: crmError } = await supabase
        .from('media_files')
        .select('*')
        .eq('entity_id', policyId)
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
  }, [policyId]);

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>, fileType: 'insurance' | 'crm') => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setUploading(fileType);
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('entity_type', fileType === 'insurance' ? 'policy_insurance' : 'policy_crm');
        formData.append('entity_id', policyId);

        const { data: { session } } = await supabase.auth.getSession();
        
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-media`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${session?.access_token}`,
            },
            body: formData,
          }
        );

        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.error || 'Upload failed');
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
      event.target.value = '';
    }
  };

  const handleDelete = async () => {
    if (!deletingImage) return;

    setDeleting(true);
    try {
      const { error } = await supabase.functions.invoke('delete-media', {
        body: { fileIds: [deletingImage.id] },
      });

      if (error) {
        throw new Error(error.message || 'Delete failed');
      }

      toast({ title: "تم الحذف", description: "تم حذف الملف بنجاح" });
      fetchFiles();
    } catch (error: any) {
      console.error('Error deleting:', error);
      toast({ 
        title: "خطأ", 
        description: error.message || "فشل في حذف الملف", 
        variant: "destructive" 
      });
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
      setDeletingImage(null);
    }
  };

  const isViewable = (mimeType: string) => 
    mimeType.startsWith('image/') || mimeType === 'application/pdf';

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const isImage = (mimeType: string) => mimeType.startsWith('image/');

  const renderFileGrid = (files: MediaFile[]) => {
    if (files.length === 0) {
      return <p className="text-center text-muted-foreground py-6">لا توجد ملفات</p>;
    }

    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {files.map((file) => (
          <div
            key={file.id}
            className="relative group rounded-lg border overflow-hidden bg-muted/30 aspect-square cursor-pointer"
            onClick={() => {
              if (isViewable(file.mime_type)) {
                setSelectedImage(file);
              }
            }}
          >
            {isImage(file.mime_type) ? (
              <img
                src={file.cdn_url}
                alt={file.original_name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center">
                <FileText className="h-8 w-8 text-muted-foreground" />
                <p className="text-xs text-muted-foreground mt-2 px-2 truncate w-full text-center">
                  {file.original_name}
                </p>
              </div>
            )}
            
            {/* Overlay actions */}
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 pointer-events-none">
              <a
                href={file.cdn_url}
                target="_blank"
                rel="noopener noreferrer"
                download={file.original_name}
                onClick={(e) => e.stopPropagation()}
                className="pointer-events-auto inline-flex items-center justify-center h-8 w-8 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80"
              >
                <Download className="h-4 w-4" />
              </a>
              <Button
                size="icon"
                variant="destructive"
                className="h-8 w-8 pointer-events-auto"
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
    <div className="relative">
      <input
        type="file"
        multiple
        accept="image/*,.pdf,video/*"
        onChange={(e) => handleUpload(e, fileType)}
        className="absolute inset-0 opacity-0 cursor-pointer"
        disabled={uploading !== null}
      />
      <Button size="sm" variant="outline" disabled={uploading !== null}>
        {uploading === fileType ? (
          <Loader2 className="h-4 w-4 ml-1 animate-spin" />
        ) : (
          <Plus className="h-4 w-4 ml-1" />
        )}
        رفع ملف
      </Button>
    </div>
  );

  return (
    <>
      <Tabs value={activeTab} onValueChange={setActiveTab} dir="rtl" className="space-y-4">
        <TabsList className="grid grid-cols-2 w-full" dir="rtl">
          <TabsTrigger value="insurance" className="text-xs gap-1">
            <ImageIcon className="h-3 w-3" />
            ملفات التأمين ({insuranceFiles.length})
          </TabsTrigger>
          <TabsTrigger value="crm" className="text-xs gap-1">
            <FolderOpen className="h-3 w-3" />
            ملفات النظام ({crmFiles.length})
          </TabsTrigger>
        </TabsList>

        {/* Insurance Files Tab */}
        <TabsContent value="insurance" className="m-0">
          <Card className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-primary font-semibold">
                <ImageIcon className="h-4 w-4" />
                <span>ملفات التأمين</span>
              </div>
              {renderUploadButton('insurance')}
            </div>
            <p className="text-xs text-muted-foreground">فواتير، إيصالات، وثائق ترسل للعميل</p>
            {loading ? (
              <div className="text-center py-4 text-muted-foreground">جاري التحميل...</div>
            ) : (
              renderFileGrid(insuranceFiles)
            )}
          </Card>
        </TabsContent>

        {/* CRM Files Tab */}
        <TabsContent value="crm" className="m-0">
          <Card className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-secondary-foreground font-semibold">
                <FolderOpen className="h-4 w-4" />
                <span>ملفات النظام</span>
              </div>
              {renderUploadButton('crm')}
            </div>
            <p className="text-xs text-muted-foreground">هوية، رخصة، صور سيارة - ملفات داخلية للنظام</p>
            {loading ? (
              <div className="text-center py-4 text-muted-foreground">جاري التحميل...</div>
            ) : (
              renderFileGrid(crmFiles)
            )}
          </Card>
        </TabsContent>
      </Tabs>

      {/* File Preview Gallery */}
      <FilePreviewGallery
        file={selectedImage}
        allFiles={[...insuranceFiles, ...crmFiles]}
        onClose={() => setSelectedImage(null)}
        onNavigate={(file) => setSelectedImage(file)}
      />

      {/* Delete Confirm Dialog */}
      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={handleDelete}
        title="حذف الملف"
        description={`هل أنت متأكد من حذف "${deletingImage?.original_name}"؟`}
        loading={deleting}
      />
    </>
  );
}
