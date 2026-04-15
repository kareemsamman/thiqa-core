import { useState, useEffect, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { 
  ImageIcon, Plus, Trash2, Download, X, Loader2, FileText, FolderOpen, 
  Save, Hash, CheckCircle2, Send, AlertTriangle, Printer, ChevronLeft, ChevronRight,
  ExternalLink
} from "lucide-react";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
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

interface PolicyFilesSectionProps {
  policyId: string;
  policyNumber?: string | null;
  clientId?: string;
  clientPhoneNumber?: string | null;
  clientName?: string;
  onPolicyNumberSaved?: (policyNumber: string) => void;
  // Package support - array of all policy IDs in package for unified file view
  packagePolicyIds?: string[];
}

export function PolicyFilesSection({ 
  policyId, 
  policyNumber: initialPolicyNumber, 
  clientId,
  clientPhoneNumber,
  clientName,
  onPolicyNumberSaved,
  packagePolicyIds 
}: PolicyFilesSectionProps) {
  const { toast } = useToast();
  const [insuranceFiles, setInsuranceFiles] = useState<MediaFile[]>([]);
  const [crmFiles, setCrmFiles] = useState<MediaFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<MediaFile | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingImage, setDeletingImage] = useState<MediaFile | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [activeTab, setActiveTab] = useState("insurance");
  
  // Policy number state
  const [policyNumber, setPolicyNumber] = useState(initialPolicyNumber || "");
  const [savingPolicyNumber, setSavingPolicyNumber] = useState(false);
  const [policyNumberSaved, setPolicyNumberSaved] = useState(!!initialPolicyNumber);

  // Auto-send popup state
  const [showSendPopup, setShowSendPopup] = useState(false);
  const [sendingToClient, setSendingToClient] = useState(false);
  const [countdown, setCountdown] = useState(5);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);
  const autoSendRef = useRef<NodeJS.Timeout | null>(null);

  // Scanner state
  const [scanning, setScanning] = useState<'insurance' | 'crm' | null>(null);

  useEffect(() => {
    setPolicyNumber(initialPolicyNumber || "");
    setPolicyNumberSaved(!!initialPolicyNumber);
  }, [initialPolicyNumber]);

  const fetchFiles = async () => {
    setLoading(true);
    try {
      // Use package policy IDs if provided (unified package view), otherwise single policy
      const targetPolicyIds = packagePolicyIds && packagePolicyIds.length > 0 
        ? packagePolicyIds 
        : [policyId];
      
      // Fetch insurance files (policy files from insurance company)
      const { data: insuranceData, error: insuranceError } = await supabase
        .from('media_files')
        .select('*')
        .in('entity_id', targetPolicyIds)
        .in('entity_type', ['policy', 'policy_insurance'])
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (insuranceError) throw insuranceError;
      setInsuranceFiles(insuranceData || []);

      // Fetch CRM files (internal docs)
      const { data: crmData, error: crmError } = await supabase
        .from('media_files')
        .select('*')
        .in('entity_id', targetPolicyIds)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policyId, packagePolicyIds?.join(',')]);

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

      // Show auto-send popup only for insurance files and if client has phone
      if (fileType === 'insurance' && clientPhoneNumber) {
        setCountdown(5);
        setShowSendPopup(true);
        // Start countdown
        countdownRef.current = setInterval(() => {
          setCountdown(prev => {
            if (prev <= 1) {
              clearInterval(countdownRef.current!);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
        // Auto-send after 5 seconds
        autoSendRef.current = setTimeout(() => {
          handleSendToClient();
        }, 5000);
      }
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

  const handleSendToClient = async () => {
    // Cancel auto-send timer
    if (autoSendRef.current) clearTimeout(autoSendRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    
    setSendingToClient(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-package-invoice-sms', {
        body: { policy_ids: [policyId] }
      });
      
      // Parse edge function error response
      if (error) {
        // Try to get detailed error from response
        let errorMessage = "فشل في الإرسال";
        try {
          const errorBody = typeof error.message === 'string' && error.message.includes('{') 
            ? JSON.parse(error.message) 
            : null;
          if (errorBody?.error) {
            errorMessage = getArabicErrorMessage(errorBody.error);
          }
        } catch {
          // Check if error.context has the response
          if (error.context?.body) {
            try {
              const body = typeof error.context.body === 'string' 
                ? JSON.parse(error.context.body) 
                : error.context.body;
              if (body?.error) {
                errorMessage = getArabicErrorMessage(body.error);
              }
            } catch {}
          }
        }
        throw new Error(errorMessage);
      }
      
      // Check if response indicates failure
      if (data && data.success === false) {
        toast({ 
          title: "تنبيه", 
          description: data.message || "تم إرسال الفواتير مسبقاً",
        });
      } else {
        toast({ title: "تم الإرسال", description: "تم إرسال الملفات للعميل بنجاح" });
      }
    } catch (err: any) {
      console.error('Error sending to client:', err);
      toast({ title: "خطأ", description: err.message || "فشل في الإرسال", variant: "destructive" });
    } finally {
      setSendingToClient(false);
      setShowSendPopup(false);
    }
  };

  // Helper to translate common edge function errors to Arabic
  const getArabicErrorMessage = (englishError: string): string => {
    const errorMap: Record<string, string> = {
      "Policy number is required before sending invoices": "يجب إدخال رقم البوليصة قبل الإرسال",
      "At least one policy file must be uploaded before sending invoices": "يجب رفع ملف بوليصة واحد على الأقل قبل الإرسال",
      "Client phone number is required": "رقم هاتف العميل مطلوب",
      "SMS service is not enabled": "خدمة الرسائل غير مفعلة",
      "Policy not found": "الوثيقة غير موجودة",
      "Client not found": "العميل غير موجود",
      "Client already has a signature": "العميل لديه توقيع مسبق",
      "Failed to fetch SMS settings": "فشل في جلب إعدادات الرسائل",
      "Failed to create signature request": "فشل في إنشاء طلب التوقيع",
      "Missing authorization header": "خطأ في المصادقة",
      "Invalid authentication": "جلسة غير صالحة",
    };
    return errorMap[englishError] || englishError;
  };

  const handleCancelSend = () => {
    if (autoSendRef.current) clearTimeout(autoSendRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    setShowSendPopup(false);
  };

  // Convert base64 to Blob
  const base64ToBlob = (base64: string): Blob => {
    // Remove data URL prefix if present
    const base64Data = base64.includes(',') ? base64.split(',')[1] : base64;
    const byteCharacters = atob(base64Data);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: 'image/jpeg' });
  };

  // Direct scan function - no dialog, auto-upload
  const handleDirectScan = async (fileType: 'insurance' | 'crm') => {
    if (!window.scanner) {
      toast({ 
        title: "خطأ", 
        description: "مكتبة السكانر غير محملة. يرجى تحديث الصفحة.", 
        variant: "destructive" 
      });
      return;
    }

    setScanning(fileType);

    // Get saved scanner from localStorage (skip selection dialog if already saved)
    const savedScanner = localStorage.getItem('preferred_scanner');

    const scanRequest = {
      use_asprise_dialog: false,
      show_scanner_ui: false,
      // Scanner.js uses `source_name` (docs). Keep `scanner_name` as fallback for compatibility.
      source_name: savedScanner || 'select',
      scanner_name: savedScanner || 'select',
      prompt_scan_more: false, // Don't ask to scan more pages
      twain_cap_setting: {
        ICAP_PIXELTYPE: 'TWPT_RGB',
        ICAP_XRESOLUTION: '200',
        ICAP_YRESOLUTION: '200',
      },
      output_settings: [{
        type: 'return-base64',
        format: 'jpg',
        jpeg_quality: 85,
      }],
    };

    window.scanner.scan(
      async (successful, mesg, response) => {
        if (!successful) {
          setScanning(null);
          // Don't show error for user cancellation
          if (mesg && !mesg.toLowerCase().includes('cancel')) {
            // Check if ScanApp not installed
            if (mesg.includes('Scanner.js') || mesg.includes('localhost')) {
              toast({ 
                title: "تثبيت مطلوب", 
                description: "يرجى تثبيت برنامج ScanApp من asprise.com",
                variant: "destructive" 
              });
            } else {
              toast({ title: "خطأ في المسح", description: mesg, variant: "destructive" });
            }
          }
          return;
        }

        // Save the used scanner name for next time (skip dialog on future scans)
        let responseObj: any = null;
        try {
          responseObj = typeof response === 'string' ? JSON.parse(response) : response;
        } catch {
          responseObj = null;
        }

        const usedScanner =
          responseObj?.source_name ??
          responseObj?.sourceName ??
          responseObj?.source ??
          responseObj?.scanner_name ??
          responseObj?.scanner ??
          null;

        const normalizedUsedScanner = typeof usedScanner === 'string' ? usedScanner.trim() : '';
        if (normalizedUsedScanner && normalizedUsedScanner !== 'select') {
          localStorage.setItem('preferred_scanner', normalizedUsedScanner);
        } else if (!savedScanner) {
          // Fallback: at least avoid showing selection dialogs next time
          localStorage.setItem('preferred_scanner', 'default');
        }

        const scannedImages = window.scanner.getScannedImages(response, true, false);
        if (!scannedImages || scannedImages.length === 0) {
          setScanning(null);
          toast({ title: "تنبيه", description: "لم يتم العثور على صور ممسوحة" });
          return;
        }

        // Auto-upload all scanned images
        setUploading(fileType);
        try {
          const { data: { session } } = await supabase.auth.getSession();
          
          for (let i = 0; i < scannedImages.length; i++) {
            const img = scannedImages[i];
            const blob = base64ToBlob(img.src);
            const file = new File([blob], `scan_${Date.now()}_${i}.jpg`, { type: 'image/jpeg' });
            
            const formData = new FormData();
            formData.append('file', file);
            formData.append('entity_type', fileType === 'insurance' ? 'policy_insurance' : 'policy_crm');
            formData.append('entity_id', policyId);

            const uploadResponse = await fetch(
              `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-media`,
              {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${session?.access_token}`,
                },
                body: formData,
              }
            );

            if (!uploadResponse.ok) {
              const err = await uploadResponse.json();
              throw new Error(err.error || 'Upload failed');
            }
          }

          toast({ title: "تم", description: `تم مسح ورفع ${scannedImages.length} صورة بنجاح` });
          fetchFiles();

          // Show auto-send popup only for insurance files and if client has phone
          if (fileType === 'insurance' && clientPhoneNumber) {
            setCountdown(5);
            setShowSendPopup(true);
            countdownRef.current = setInterval(() => {
              setCountdown(prev => {
                if (prev <= 1) {
                  clearInterval(countdownRef.current!);
                  return 0;
                }
                return prev - 1;
              });
            }, 1000);
            autoSendRef.current = setTimeout(() => {
              handleSendToClient();
            }, 5000);
          }
        } catch (error: any) {
          console.error('Error uploading scanned images:', error);
          toast({ 
            title: "خطأ", 
            description: error.message || "فشل في رفع الصور الممسوحة", 
            variant: "destructive" 
          });
        } finally {
          setUploading(null);
          setScanning(null);
        }
      },
      scanRequest
    );
  };

  const handleSavePolicyNumber = async () => {
    if (!policyNumber.trim()) {
      toast({ title: "خطأ", description: "يرجى إدخال رقم البوليصة", variant: "destructive" });
      return;
    }

    setSavingPolicyNumber(true);
    try {
      const { error } = await supabase
        .from('policies')
        .update({ policy_number: policyNumber.trim() })
        .eq('id', policyId);

      if (error) throw error;

      toast({ title: "تم الحفظ", description: "تم حفظ رقم البوليصة بنجاح" });
      setPolicyNumberSaved(true);
      onPolicyNumberSaved?.(policyNumber.trim());
    } catch (error: any) {
      console.error('Error saving policy number:', error);
      toast({ 
        title: "خطأ", 
        description: error.message || "فشل في حفظ رقم البوليصة", 
        variant: "destructive" 
      });
    } finally {
      setSavingPolicyNumber(false);
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

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const isImage = (mimeType: string) => mimeType.startsWith('image/');
  const isPdf = (mimeType: string) => mimeType === 'application/pdf';
  const isExternalLink = (file: MediaFile) => !file.storage_path && file.size === 0;

  const renderFileGrid = (files: MediaFile[]) => {
    if (files.length === 0) {
      return <p className="text-center text-muted-foreground py-6">لا توجد ملفات</p>;
    }

    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {files.map((file) => (
          <div
            key={file.id}
            className="relative group rounded-lg border overflow-hidden bg-muted/30 aspect-square"
          >
            {isExternalLink(file) ? (
              <div 
                className="w-full h-full flex flex-col items-center justify-center cursor-pointer bg-gradient-to-br from-blue-500 to-blue-600 text-white"
                onClick={() => window.open(file.cdn_url, '_blank')}
              >
                <ExternalLink className="h-10 w-10" />
                <span className="text-sm font-bold mt-2">X-Service</span>
                <p className="text-[10px] mt-1 px-2 truncate w-full text-center opacity-80">
                  {file.original_name}
                </p>
              </div>
            ) : isImage(file.mime_type) ? (
              <img
                src={file.cdn_url}
                alt={file.original_name}
                className="w-full h-full object-cover cursor-pointer"
                onClick={() => setSelectedFile(file)}
              />
            ) : isPdf(file.mime_type) ? (
              <div 
                className="w-full h-full flex flex-col items-center justify-center cursor-pointer bg-gradient-to-br from-red-500 to-red-600 text-white"
                onClick={() => setSelectedFile(file)}
              >
                <FileText className="h-10 w-10" />
                <span className="text-sm font-bold mt-2">PDF</span>
                <p className="text-[10px] mt-1 px-2 truncate w-full text-center opacity-80">
                  {file.original_name}
                </p>
              </div>
            ) : (
              <div 
                className="w-full h-full flex flex-col items-center justify-center cursor-pointer"
                onClick={() => window.open(file.cdn_url, '_blank')}
              >
                <FileText className="h-8 w-8 text-muted-foreground" />
                <p className="text-xs text-muted-foreground mt-2 px-2 truncate w-full text-center">
                  {file.original_name}
                </p>
              </div>
            )}
            
            {/* Overlay actions - pointer-events-none on overlay, enabled on buttons */}
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 pointer-events-none">
              {/* Download using native anchor to avoid ad blocker issues */}
              <a
                href={file.cdn_url}
                target="_blank"
                rel="noopener noreferrer"
                download={file.original_name}
                className="pointer-events-auto inline-flex items-center justify-center h-8 w-8 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 z-10"
                onClick={(e) => e.stopPropagation()}
              >
                <Download className="h-4 w-4" />
              </a>
              <Button
                size="icon"
                variant="destructive"
                className="h-8 w-8 pointer-events-auto z-10"
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
    <div className="flex items-center gap-2">
      {/* Direct Scan button - no dialog */}
      <Button 
        size="sm" 
        variant="outline" 
        disabled={uploading !== null || scanning !== null}
        onClick={() => handleDirectScan(fileType)}
        className="gap-1"
      >
        {scanning === fileType ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Printer className="h-4 w-4" />
        )}
        {scanning === fileType ? 'جاري المسح...' : 'مسح'}
      </Button>
      
      {/* Upload button */}
      <div className="relative">
        <input
          type="file"
          multiple
          accept="image/*,.pdf,video/*"
          onChange={(e) => handleUpload(e, fileType)}
          className="absolute inset-0 opacity-0 cursor-pointer"
          disabled={uploading !== null || scanning !== null}
        />
        <Button size="sm" variant="outline" disabled={uploading !== null || scanning !== null}>
          {uploading === fileType ? (
            <Loader2 className="h-4 w-4 ml-1 animate-spin" />
          ) : (
            <Plus className="h-4 w-4 ml-1" />
          )}
          رفع ملف
        </Button>
      </div>
    </div>
  );

  return (
    <>
      {/* Policy Number Section - Always visible at top */}
      <Card className="p-4 mb-4 border-2 border-primary/20">
        <div className="flex items-center gap-2 mb-3">
          <Hash className="h-4 w-4 text-primary" />
          <Label className="font-semibold text-primary">رقم البوليصة</Label>
          {policyNumberSaved && (
            <Badge variant="success" className="gap-1">
              <CheckCircle2 className="h-3 w-3" />
              محفوظ
            </Badge>
          )}
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="أدخل رقم البوليصة..."
            value={policyNumber}
            onChange={(e) => {
              setPolicyNumber(e.target.value);
              setPolicyNumberSaved(false);
            }}
            className="flex-1 ltr-input"
          />
          <Button 
            onClick={handleSavePolicyNumber}
            disabled={savingPolicyNumber || !policyNumber.trim() || policyNumberSaved}
            size="sm"
          >
            {savingPolicyNumber ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Save className="h-4 w-4 ml-1" />
                حفظ
              </>
            )}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          هذا الرقم يستخدم للبحث السريع عن الوثيقة
        </p>
      </Card>

      {/* Files Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} dir="rtl" className="space-y-4">
        <TabsList className="grid grid-cols-2 w-full" dir="rtl">
          <TabsTrigger value="insurance" className="text-xs gap-1">
            <ImageIcon className="h-3 w-3" />
            ملفات العميل ({insuranceFiles.length})
          </TabsTrigger>
          <TabsTrigger value="crm" className="text-xs gap-1">
            <FolderOpen className="h-3 w-3" />
            ملفات داخلية ({crmFiles.length})
          </TabsTrigger>
        </TabsList>

        {/* Insurance Files Tab */}
        <TabsContent value="insurance" className="m-0">
          <Card className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-primary font-semibold">
                <ImageIcon className="h-4 w-4" />
                <span>ملفات البوليصة</span>
              </div>
              {renderUploadButton('insurance')}
            </div>
            <p className="text-xs text-muted-foreground">
              البوليصة من شركة التأمين - يمكنك رفع صور متعددة أو PDF
            </p>
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
                <span>ملفات داخلية</span>
              </div>
              {renderUploadButton('crm')}
            </div>
            <p className="text-xs text-muted-foreground">هوية، رخصة، صور سيارة - ملفات للاستخدام الداخلي فقط</p>
            {loading ? (
              <div className="text-center py-4 text-muted-foreground">جاري التحميل...</div>
            ) : (
              renderFileGrid(crmFiles)
            )}
          </Card>
        </TabsContent>
      </Tabs>

      {/* File Preview Dialog - Gallery for images, PDF viewer for PDFs */}
      <FilePreviewGallery 
        file={selectedFile}
        allFiles={activeTab === 'insurance' ? insuranceFiles : crmFiles}
        onClose={() => setSelectedFile(null)}
        onNavigate={(file) => setSelectedFile(file)}
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

      {/* Auto-Send Popup */}
      <Dialog open={showSendPopup} onOpenChange={(open) => !open && handleCancelSend()}>
        <DialogContent dir="rtl" className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5 text-primary" />
              إرسال للعميل
            </DialogTitle>
            <DialogDescription>
              هل تريد إرسال ملفات البوليصة والفواتير للعميل {clientName}؟
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4">
            <div className="flex items-center justify-center gap-2 text-muted-foreground mb-2">
              <AlertTriangle className="h-4 w-4" />
              <span>سيتم الإرسال تلقائياً خلال {countdown} ثوانٍ</span>
            </div>
            <Progress value={(5 - countdown) * 20} className="h-2" />
          </div>

          <DialogFooter className="flex-row-reverse gap-2 sm:gap-2">
            <Button onClick={handleSendToClient} disabled={sendingToClient}>
              {sendingToClient ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <Send className="h-4 w-4 ml-2" />}
              إرسال الآن
            </Button>
            <Button variant="outline" onClick={handleCancelSend} disabled={sendingToClient}>
              إلغاء
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </>
  );
}
