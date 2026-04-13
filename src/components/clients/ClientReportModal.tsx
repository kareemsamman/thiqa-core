import { useState, useRef, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Printer, 
  MessageSquare, 
  User, 
  Car, 
  FileText, 
  Phone, 
  Calendar,
  Building2,
  Wallet,
  CheckCircle,
  AlertCircle,
  Clock,
  XCircle,
  ArrowRightLeft,
  Loader2,
  Image as ImageIcon,
  File,
  CreditCard,
  ChevronDown,
  ChevronUp,
  Paperclip,
  Download,
  X,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { extractFunctionErrorMessage } from '@/lib/functionError';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { getInsuranceTypeLabel } from '@/lib/insuranceTypes';
import { useSiteSettings } from '@/hooks/useSiteSettings';

interface PolicyFile {
  id: string;
  cdn_url: string;
  original_name: string;
  mime_type: string;
}

interface PolicyPayment {
  id: string;
  amount: number;
  payment_type: string;
  payment_date: string;
  refused: boolean | null;
}

interface ClientReportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: {
    id: string;
    full_name: string;
    id_number: string;
    file_number: string | null;
    phone_number: string | null;
    phone_number_2: string | null;
    birth_date: string | null;
    date_joined: string | null;
    branch_id: string | null;
    broker_id: string | null;
    signature_url: string | null;
  };
  cars: Array<{
    id: string;
    car_number: string;
    manufacturer_name: string | null;
    model: string | null;
    year: number | null;
    color: string | null;
    car_type: string | null;
  }>;
  policies: Array<{
    id: string;
    policy_number: string | null;
    policy_type_parent: string;
    policy_type_child: string | null;
    start_date: string;
    end_date: string;
    insurance_price: number;
    profit: number | null;
    cancelled: boolean | null;
    transferred: boolean | null;
    group_id: string | null;
    company: { name: string; name_ar: string | null } | null;
    car: { id: string; car_number: string } | null;
  }>;
  paymentSummary: {
    total_paid: number;
    total_remaining: number;
    total_profit: number;
  };
  walletBalance: {
    total_refunds: number;
    transaction_count: number;
  };
  broker: { id: string; name: string; phone: string | null } | null;
  branchName: string | null;
}

const policyTypeLabels: Record<string, string> = {
  ELZAMI: 'إلزامي',
  THIRD_FULL: 'ثالث/شامل',
  ROAD_SERVICE: 'خدمات طريق',
  ACCIDENT_FEE_EXEMPTION: 'إعفاء رسوم',
  HEALTH: 'صحي',
  LIFE: 'حياة',
  PROPERTY: 'ممتلكات',
  TRAVEL: 'سفر',
  BUSINESS: 'أعمال',
  OTHER: 'أخرى',
};

const carTypeLabels: Record<string, string> = {
  car: 'خصوصي',
  cargo: 'شحن',
  small: 'اوتوبس زعير',
  taxi: 'تاكسي',
  tjeradown4: 'تجاري (<4 طن)',
  tjeraup4: 'تجاري (>4 طن)',
};

const paymentTypeLabels: Record<string, string> = {
  cash: 'نقدي',
  cheque: 'شيك',
  credit_card: 'بطاقة',
  bank_transfer: 'تحويل',
};

// File gallery popup for mobile
interface FileGalleryPopupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  files: PolicyFile[];
  policyNumber: string | null;
  policyType: string;
}

function FileGalleryPopup({ open, onOpenChange, files, policyNumber, policyType }: FileGalleryPopupProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const currentFile = files[currentIndex];

  const isImage = (mimeType: string) => mimeType?.startsWith('image/');
  const isPdf = (mimeType: string) => mimeType === 'application/pdf';

  const goNext = () => {
    if (currentIndex < files.length - 1) setCurrentIndex(currentIndex + 1);
  };

  const goPrev = () => {
    if (currentIndex > 0) setCurrentIndex(currentIndex - 1);
  };

  useEffect(() => {
    setCurrentIndex(0);
  }, [files]);

  if (!currentFile) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] p-0 overflow-hidden">
        {/* Header */}
        <div className="bg-primary text-primary-foreground p-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Paperclip className="h-4 w-4" />
            <div>
              <p className="text-sm font-medium">{policyTypeLabels[policyType] || policyType}</p>
              <p className="text-xs opacity-80">{policyNumber || 'ملفات البوليصة'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs bg-white/20 px-2 py-0.5 rounded">
              {currentIndex + 1} / {files.length}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-primary-foreground hover:bg-white/20"
              onClick={() => onOpenChange(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* File Preview */}
        <div className="relative flex-1 min-h-[300px] bg-muted/30 flex items-center justify-center">
          {isImage(currentFile.mime_type) && (
            <img 
              src={currentFile.cdn_url} 
              alt={currentFile.original_name}
              className="max-w-full max-h-[50vh] object-contain"
            />
          )}
          {isPdf(currentFile.mime_type) && (
            <div className="flex flex-col items-center gap-4 p-8">
              <div className="w-20 h-24 bg-red-100 rounded-lg flex items-center justify-center border-2 border-red-200">
                <FileText className="h-10 w-10 text-red-500" />
              </div>
              <p className="text-sm font-medium text-center">{currentFile.original_name}</p>
              <p className="text-xs text-muted-foreground">ملف PDF</p>
            </div>
          )}
          {!isImage(currentFile.mime_type) && !isPdf(currentFile.mime_type) && (
            <div className="flex flex-col items-center gap-4 p-8">
              <div className="w-20 h-24 bg-muted rounded-lg flex items-center justify-center border">
                <File className="h-10 w-10 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-center">{currentFile.original_name}</p>
            </div>
          )}

          {/* Navigation arrows */}
          {files.length > 1 && (
            <>
              {currentIndex > 0 && (
                <Button
                  variant="secondary"
                  size="icon"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full shadow-lg"
                  onClick={goPrev}
                >
                  <ChevronRight className="h-5 w-5" />
                </Button>
              )}
              {currentIndex < files.length - 1 && (
                <Button
                  variant="secondary"
                  size="icon"
                  className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full shadow-lg"
                  onClick={goNext}
                >
                  <ChevronLeft className="h-5 w-5" />
                </Button>
              )}
            </>
          )}
        </div>

        {/* File info and download */}
        <div className="p-3 border-t bg-background">
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{currentFile.original_name}</p>
              <p className="text-xs text-muted-foreground">
                {isImage(currentFile.mime_type) ? 'صورة' : isPdf(currentFile.mime_type) ? 'PDF' : 'ملف'}
              </p>
            </div>
            <a
              href={currentFile.cdn_url}
              download={currentFile.original_name}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0"
            >
              <Button size="sm" className="gap-2">
                <Download className="h-4 w-4" />
                تحميل
              </Button>
            </a>
          </div>

          {/* Thumbnail strip */}
          {files.length > 1 && (
            <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
              {files.map((file, idx) => (
                <button
                  key={file.id}
                  className={cn(
                    "shrink-0 w-12 h-12 rounded-lg border-2 overflow-hidden transition-all",
                    idx === currentIndex ? "border-primary ring-2 ring-primary/30" : "border-transparent opacity-60 hover:opacity-100"
                  )}
                  onClick={() => setCurrentIndex(idx)}
                >
                  {isImage(file.mime_type) ? (
                    <img src={file.cdn_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-muted flex items-center justify-center">
                      <FileText className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ClientReportModal({
  open,
  onOpenChange,
  client,
  cars,
  policies,
  paymentSummary,
  walletBalance,
  broker,
  branchName,
}: ClientReportModalProps) {
  const { data: siteSettings } = useSiteSettings();
  const [sendingSms, setSendingSms] = useState(false);
  const [expandedCars, setExpandedCars] = useState<Set<string>>(new Set());
  const [policyFiles, setPolicyFiles] = useState<Record<string, PolicyFile[]>>({});
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [fileGallery, setFileGallery] = useState<{ open: boolean; files: PolicyFile[]; policyNumber: string | null; policyType: string }>({
    open: false,
    files: [],
    policyNumber: null,
    policyType: '',
  });
  const printRef = useRef<HTMLDivElement>(null);

  // Auto-expand all car accordions when modal opens
  useEffect(() => {
    if (open && cars.length > 0) {
      setExpandedCars(new Set(cars.map(c => c.id)));
    }
  }, [open, cars]);

  // Fetch policy files when modal opens
  useEffect(() => {
    if (open && policies.length > 0) {
      fetchPolicyFiles();
    }
  }, [open, policies]);

  const fetchPolicyFiles = async () => {
    setLoadingFiles(true);
    try {
      const policyIds = policies.map(p => p.id);
      const { data: files, error } = await supabase
        .from('media_files')
        .select('id, cdn_url, original_name, mime_type, entity_id')
        .in('entity_type', ['policy', 'policy_insurance'])
        .in('entity_id', policyIds)
        .is('deleted_at', null);

      if (error) throw error;

      // Group files by policy ID
      const grouped: Record<string, PolicyFile[]> = {};
      files?.forEach(file => {
        if (file.entity_id) {
          if (!grouped[file.entity_id]) grouped[file.entity_id] = [];
          grouped[file.entity_id].push({
            id: file.id,
            cdn_url: file.cdn_url,
            original_name: file.original_name,
            mime_type: file.mime_type,
          });
        }
      });
      setPolicyFiles(grouped);
    } catch (error) {
      console.error('Error fetching policy files:', error);
    } finally {
      setLoadingFiles(false);
    }
  };

  const openFileGallery = (policy: { id: string; policy_number: string | null; policy_type_parent: string }) => {
    const files = policyFiles[policy.id] || [];
    if (files.length > 0) {
      setFileGallery({
        open: true,
        files,
        policyNumber: policy.policy_number,
        policyType: policy.policy_type_parent,
      });
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-GB', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatDateShort = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-GB');
  };

  const getPolicyStatus = (policy: { cancelled: boolean | null; transferred: boolean | null; end_date: string }) => {
    if (policy.cancelled) return { label: 'ملغاة', icon: XCircle, color: 'text-destructive', bg: 'bg-destructive/10' };
    if (policy.transferred) return { label: 'محولة', icon: ArrowRightLeft, color: 'text-amber-600', bg: 'bg-amber-100' };
    const endDate = new Date(policy.end_date);
    const today = new Date();
    if (endDate < today) return { label: 'منتهية', icon: Clock, color: 'text-muted-foreground', bg: 'bg-muted' };
    return { label: 'سارية', icon: CheckCircle, color: 'text-success', bg: 'bg-success/10' };
  };

  const [isPrinting, setIsPrinting] = useState(false);

  const handlePrint = async () => {
    setIsPrinting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error('يرجى تسجيل الدخول');
        return;
      }

      const reportResponse = await supabase.functions.invoke('generate-client-report', {
        body: { client_id: client.id },
      });

      if (reportResponse.error) throw reportResponse.error;
      
      const reportUrl = reportResponse.data?.url;
      if (!reportUrl) throw new Error('Failed to generate report URL');

      // Open the HTML report in a new tab for printing
      const printWindow = window.open(reportUrl, '_blank');
      if (printWindow) {
        // Wait for page to load then trigger print
        printWindow.addEventListener('load', () => {
          setTimeout(() => printWindow.print(), 500);
        });
      }
    } catch (error) {
      console.error('Error generating print report:', error);
      toast.error('فشل في تحضير التقرير للطباعة');
    } finally {
      setIsPrinting(false);
    }
  };

  const handleSendSms = async () => {
    if (!client.phone_number) {
      toast.error('لا يوجد رقم هاتف للعميل');
      return;
    }

    setSendingSms(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error('يرجى تسجيل الدخول');
        return;
      }

      const reportResponse = await supabase.functions.invoke('generate-client-report', {
        body: { client_id: client.id },
      });

      if (reportResponse.error) throw reportResponse.error;
      
      const reportUrl = reportResponse.data?.url;
      if (!reportUrl) throw new Error('Failed to generate report URL');

      const companyName = siteSettings?.site_title || 'وكالة التأمين';
      const message = `${client.full_name} عزيزنا/ي\n` +
        `يمكنك مشاهدة تقرير تأميناتك الكامل عبر الرابط:\n${reportUrl}\n\n` +
        `${companyName} 🚗`;

      const smsResponse = await supabase.functions.invoke('send-sms', {
        body: {
          phone: client.phone_number,
          message,
        },
      });

      if (smsResponse.error) throw smsResponse.error;

      await supabase.from('sms_logs').insert([{
        phone_number: client.phone_number,
        message,
        client_id: client.id,
        sms_type: 'manual' as const,
        status: 'sent',
        sent_at: new Date().toISOString(),
      }]);

      toast.success('تم إرسال رابط التقرير عبر SMS بنجاح');
    } catch (error) {
      console.error('Error sending SMS:', error);
      const msg = await extractFunctionErrorMessage(error);
      toast.error(msg || 'فشل في إرسال الرسالة');
    } finally {
      setSendingSms(false);
    }
  };

  const totalInsurance = policies.reduce((sum, p) => sum + p.insurance_price, 0);
  const activePolicies = policies.filter(p => {
    const endDate = new Date(p.end_date);
    return !p.cancelled && !p.transferred && endDate >= new Date();
  });

  // Group policies by car
  const policiesByCar = cars.map(car => ({
    car,
    policies: policies.filter(p => p.car?.id === car.id),
  }));

  // Policies without car
  const policiesNoCar = policies.filter(p => !p.car);

  const toggleCarExpand = (carId: string) => {
    setExpandedCars(prev => {
      const next = new Set(prev);
      if (next.has(carId)) next.delete(carId);
      else next.add(carId);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[95vw] max-h-[90vh] overflow-y-auto p-0">
        {/* Header */}
        <div
          className="sticky top-0 z-10 text-white p-4 rounded-t-lg"
          style={{ background: 'linear-gradient(135deg, #122143 0%, #1a3260 100%)' }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
                <FileText className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-bold text-lg">تقرير العميل الشامل</h2>
                <p className="text-xs text-white/70">{formatDate(new Date().toISOString())}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleSendSms}
                disabled={sendingSms || !client.phone_number}
                className="gap-1.5 bg-white/20 hover:bg-white/30 text-white border-0"
              >
                {sendingSms ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <MessageSquare className="h-4 w-4" />
                )}
                <span className="hidden sm:inline">SMS</span>
              </Button>
              <Button
                size="sm"
                onClick={handlePrint}
                disabled={isPrinting}
                className="gap-1.5 bg-white/20 hover:bg-white/30 text-white border-0"
              >
                {isPrinting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Printer className="h-4 w-4" />
                )}
                <span className="hidden sm:inline">طباعة</span>
              </Button>
            </div>
          </div>
        </div>

        <div ref={printRef} className="p-4 space-y-4">
          {/* Client Info Card */}
          <div className="bg-muted/30 rounded-xl p-4 border">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                <User className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h3 className="font-bold text-lg">{client.full_name}</h3>
                <p className="text-sm text-muted-foreground ltr-nums">{client.id_number}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
              <div className="bg-background rounded-lg p-2 border">
                <p className="text-[10px] text-muted-foreground">الهاتف</p>
                <p className="font-semibold ltr-nums">{client.phone_number || '-'}</p>
              </div>
              <div className="bg-background rounded-lg p-2 border">
                <p className="text-[10px] text-muted-foreground">رقم الملف</p>
                <p className="font-semibold">{client.file_number || '-'}</p>
              </div>
              <div className="bg-background rounded-lg p-2 border">
                <p className="text-[10px] text-muted-foreground">تاريخ الانضمام</p>
                <p className="font-semibold">{formatDate(client.date_joined)}</p>
              </div>
              {branchName && (
                <div className="bg-background rounded-lg p-2 border">
                  <p className="text-[10px] text-muted-foreground">الفرع</p>
                  <p className="font-semibold">{branchName}</p>
                </div>
              )}
            </div>
          </div>

          {/* Financial Summary - Compact */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-primary/5 rounded-xl p-3 border border-primary/20 text-center">
              <p className="text-[10px] text-muted-foreground mb-0.5">إجمالي التأمينات</p>
              <p className="text-lg font-bold text-primary ltr-nums">₪{totalInsurance.toLocaleString()}</p>
            </div>
            <div className="bg-success/5 rounded-xl p-3 border border-success/20 text-center">
              <p className="text-[10px] text-muted-foreground mb-0.5">المدفوع</p>
              <p className="text-lg font-bold text-success ltr-nums">₪{paymentSummary.total_paid.toLocaleString()}</p>
            </div>
            <div className={cn(
              "rounded-xl p-3 border text-center",
              paymentSummary.total_remaining > 0 
                ? "bg-destructive/5 border-destructive/20" 
                : "bg-success/5 border-success/20"
            )}>
              <p className="text-[10px] text-muted-foreground mb-0.5">المتبقي</p>
              <p className={cn(
                "text-lg font-bold ltr-nums",
                paymentSummary.total_remaining > 0 ? "text-destructive" : "text-success"
              )}>
                ₪{paymentSummary.total_remaining.toLocaleString()}
              </p>
            </div>
          </div>

          {walletBalance.total_refunds > 0 && (
            <div className="bg-amber-50 rounded-xl p-3 border border-amber-200 text-center">
              <div className="flex items-center justify-center gap-2">
                <Wallet className="h-4 w-4 text-amber-600" />
                <span className="text-sm text-amber-700">رصيد للعميل:</span>
                <span className="font-bold text-amber-600 ltr-nums">₪{walletBalance.total_refunds.toLocaleString()}</span>
              </div>
            </div>
          )}

          {/* Active Policies Count */}
          <div className="flex items-center justify-center gap-4 py-3 bg-gradient-to-l from-success/10 to-success/5 rounded-xl border border-success/20">
            <div className="text-center">
              <p className="text-3xl font-bold text-success">{activePolicies.length}</p>
              <p className="text-xs text-success/80">وثائق سارية</p>
            </div>
            <div className="w-px h-10 bg-success/20" />
            <div className="text-center">
              <p className="text-3xl font-bold text-muted-foreground">{cars.length}</p>
              <p className="text-xs text-muted-foreground">سيارات</p>
            </div>
          </div>

          {/* Policies by Car */}
          <div className="space-y-3">
            <h3 className="font-bold text-base flex items-center gap-2 text-primary">
              <Car className="h-4 w-4" />
              السيارات والوثائق
            </h3>

            {policiesByCar.map(({ car, policies: carPolicies }) => {
              const isExpanded = expandedCars.has(car.id);
              const carTotalPrice = carPolicies.reduce((s, p) => s + p.insurance_price, 0);
              const activeCount = carPolicies.filter(p => !p.cancelled && !p.transferred && new Date(p.end_date) >= new Date()).length;
              
              return (
                <div key={car.id} className="border rounded-xl overflow-hidden">
                  {/* Car Header */}
                  <div 
                    className="bg-muted/30 p-3 flex items-center gap-3 cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => toggleCarExpand(car.id)}
                  >
                    <div className="bg-yellow-200 border-2 border-foreground rounded px-2 py-0.5">
                      <span className="font-mono font-bold text-sm">{car.car_number}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">
                        {car.manufacturer_name} {car.model} {car.year}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{carPolicies.length} وثائق</span>
                        {activeCount > 0 && (
                          <Badge variant="success" className="h-5 text-[10px]">{activeCount} سارية</Badge>
                        )}
                      </div>
                    </div>
                    <div className="text-left">
                      <p className="font-bold text-primary ltr-nums">₪{carTotalPrice.toLocaleString()}</p>
                    </div>
                    {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                  </div>

                  {/* Policies */}
                  {isExpanded && carPolicies.length > 0 && (
                    <div className="divide-y">
                      {carPolicies.map(policy => {
                        const status = getPolicyStatus(policy);
                        const StatusIcon = status.icon;
                        const files = policyFiles[policy.id] || [];
                        return (
                          <div key={policy.id} className="p-3 bg-background">
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <Badge variant="outline" className="text-xs">
                                  {getInsuranceTypeLabel(policy.policy_type_parent as any, policy.policy_type_child as any)}
                                </Badge>
                                <Badge className={cn("gap-1 text-[10px]", status.bg, status.color, "border-0")}>
                                  <StatusIcon className="h-3 w-3" />
                                  {status.label}
                                </Badge>
                                {files.length > 0 && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openFileGallery(policy);
                                    }}
                                    className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors bg-primary/10 hover:bg-primary/20 px-2 py-0.5 rounded-full"
                                  >
                                    <Paperclip className="h-3 w-3" />
                                    <span>{files.length} ملفات</span>
                                  </button>
                                )}
                              </div>
                              <p className="font-bold text-primary ltr-nums shrink-0">₪{policy.insurance_price.toLocaleString()}</p>
                            </div>
                            <div className="flex items-center gap-4 text-xs text-muted-foreground">
                              <span>{policy.company?.name_ar || policy.company?.name || '-'}</span>
                              <span className="ltr-nums">{formatDateShort(policy.start_date)} - {formatDateShort(policy.end_date)}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {isExpanded && carPolicies.length === 0 && (
                    <div className="p-4 text-center text-sm text-muted-foreground">
                      لا توجد وثائق لهذه السيارة
                    </div>
                  )}
                </div>
              );
            })}

            {/* Policies without car */}
            {policiesNoCar.length > 0 && (
              <div className="border rounded-xl overflow-hidden">
                <div className="bg-muted/30 p-3">
                  <p className="font-medium text-sm text-muted-foreground">وثائق أخرى (بدون سيارة)</p>
                </div>
                <div className="divide-y">
                  {policiesNoCar.map(policy => {
                    const status = getPolicyStatus(policy);
                    const StatusIcon = status.icon;
                    const files = policyFiles[policy.id] || [];
                    return (
                      <div key={policy.id} className="p-3 bg-background">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className="text-xs">
                              {getInsuranceTypeLabel(policy.policy_type_parent as any, policy.policy_type_child as any)}
                            </Badge>
                            <Badge className={cn("gap-1 text-[10px]", status.bg, status.color, "border-0")}>
                              <StatusIcon className="h-3 w-3" />
                              {status.label}
                            </Badge>
                            {files.length > 0 && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openFileGallery(policy);
                                }}
                                className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors bg-primary/10 hover:bg-primary/20 px-2 py-0.5 rounded-full"
                              >
                                <Paperclip className="h-3 w-3" />
                                <span>{files.length} ملفات</span>
                              </button>
                            )}
                          </div>
                          <p className="font-bold text-primary ltr-nums shrink-0">₪{policy.insurance_price.toLocaleString()}</p>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span>{policy.company?.name_ar || policy.company?.name || '-'}</span>
                          <span className="ltr-nums">{formatDateShort(policy.start_date)} - {formatDateShort(policy.end_date)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
           <div className="flex items-center justify-between pt-4 border-t text-xs text-muted-foreground">
            <div className="text-center">
              <p className="font-bold text-primary text-sm">{siteSettings?.site_title || 'وكالة التأمين'}</p>
            </div>
            <p className="ltr-nums">{new Date().toLocaleDateString('en-GB')}</p>
          </div>
        </div>
      </DialogContent>

      {/* File Gallery Popup for viewing/downloading files */}
      <FileGalleryPopup
        open={fileGallery.open}
        onOpenChange={(open) => setFileGallery(prev => ({ ...prev, open }))}
        files={fileGallery.files}
        policyNumber={fileGallery.policyNumber}
        policyType={fileGallery.policyType}
      />
    </Dialog>
  );
}
