import { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Printer,
  MessageSquare,
  User,
  Car,
  FileText,
  Wallet,
  CheckCircle,
  AlertTriangle,
  Clock,
  XCircle,
  ArrowRightLeft,
  Loader2,
  File,
  CreditCard,
  Paperclip,
  Download,
  X,
  ChevronLeft,
  ChevronRight,
  Users,
  Layers,
  StickyNote,
  Banknote,
  Receipt,
  Building2,
  Calendar,
  Phone,
  IdCard,
  Palette,
  ShieldAlert,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { extractFunctionErrorMessage } from '@/lib/functionError';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { getInsuranceTypeLabel } from '@/lib/insuranceTypes';
import { useSiteSettings } from '@/hooks/useSiteSettings';

// ---------- Types ----------

interface PolicyFile {
  id: string;
  cdn_url: string;
  original_name: string;
  mime_type: string;
}

interface ExtraDriver {
  child_id: string;
  full_name: string;
  id_number: string | null;
  relation: string | null;
  phone: string | null;
  birth_date: string | null;
}

interface PaymentRow {
  id: string;
  policy_id: string;
  amount: number;
  payment_date: string;
  payment_type: string;
  cheque_number: string | null;
  cheque_status: string | null;
  card_last_four: string | null;
  refused: boolean | null;
  notes: string | null;
  batch_id: string | null;
}

interface AccidentRow {
  id: string;
  accident_date: string;
  status: string;
  report_number: number;
  car: { car_number: string } | null;
  company: { name: string; name_ar: string | null } | null;
}

interface RefundRow {
  id: string;
  amount: number;
  transaction_type: string;
  description: string | null;
  refund_date: string | null;
  payment_method: string | null;
  car: { car_number: string } | null;
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
    notes?: string | null;
    accident_notes?: string | null;
    under24_type?: 'none' | 'client' | 'additional_driver' | null;
    under24_driver_name?: string | null;
    under24_driver_id?: string | null;
  };
  cars: Array<{
    id: string;
    car_number: string;
    manufacturer_name: string | null;
    model: string | null;
    year: number | null;
    color: string | null;
    car_type: string | null;
    car_value?: number | null;
    license_type?: string | null;
    license_expiry?: string | null;
  }>;
  policies: Array<{
    id: string;
    policy_number: string | null;
    policy_type_parent: string;
    policy_type_child: string | null;
    start_date: string;
    end_date: string;
    insurance_price: number;
    office_commission?: number | null;
    profit: number | null;
    cancelled: boolean | null;
    transferred: boolean | null;
    group_id: string | null;
    notes?: string | null;
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

// ---------- Static labels ----------

const carTypeLabels: Record<string, string> = {
  car: 'خصوصي',
  cargo: 'شحن',
  small: 'اوتوبس زغير',
  taxi: 'تاكسي',
  tjeradown4: 'تجاري (<4 طن)',
  tjeraup4: 'تجاري (>4 طن)',
};

const paymentTypeLabels: Record<string, string> = {
  cash: 'نقدي',
  cheque: 'شيك',
  transfer: 'تحويل',
  visa: 'بطاقة',
  credit_card: 'بطاقة',
};

const accidentStatusLabels: Record<string, { label: string; variant: 'default' | 'destructive' | 'success' | 'warning' | 'secondary' }> = {
  open: { label: 'مفتوح', variant: 'destructive' },
  under_review: { label: 'قيد المراجعة', variant: 'warning' },
  closed: { label: 'مغلق', variant: 'secondary' },
};

const refundTypeLabels: Record<string, string> = {
  refund: 'إلغاء تأمين',
  transfer_refund_owed: 'تحويل تأمين',
  manual_refund: 'مرتجع يدوي',
};

// ---------- File gallery sub-component ----------

interface FileGalleryPopupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  files: PolicyFile[];
  title: string;
}

function FileGalleryPopup({ open, onOpenChange, files, title }: FileGalleryPopupProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const currentFile = files[currentIndex];

  const isImage = (mime: string) => mime?.startsWith('image/');
  const isPdf = (mime: string) => mime === 'application/pdf';

  useEffect(() => {
    setCurrentIndex(0);
  }, [files]);

  if (!currentFile) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] p-0 overflow-hidden" hideCloseButton>
        <div className="bg-primary text-primary-foreground p-3 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <Paperclip className="h-4 w-4 shrink-0" />
            <p className="text-sm font-medium truncate">{title}</p>
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

        <div className="relative flex-1 min-h-[300px] bg-muted/30 flex items-center justify-center">
          {isImage(currentFile.mime_type) ? (
            <img
              src={currentFile.cdn_url}
              alt={currentFile.original_name}
              className="max-w-full max-h-[50vh] object-contain"
            />
          ) : isPdf(currentFile.mime_type) ? (
            <div className="flex flex-col items-center gap-4 p-8">
              <div className="w-20 h-24 bg-red-100 rounded-lg flex items-center justify-center border-2 border-red-200">
                <FileText className="h-10 w-10 text-red-500" />
              </div>
              <p className="text-sm font-medium text-center">{currentFile.original_name}</p>
              <p className="text-xs text-muted-foreground">ملف PDF</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4 p-8">
              <div className="w-20 h-24 bg-muted rounded-lg flex items-center justify-center border">
                <File className="h-10 w-10 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-center">{currentFile.original_name}</p>
            </div>
          )}

          {files.length > 1 && (
            <>
              {currentIndex > 0 && (
                <Button
                  variant="secondary"
                  size="icon"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full shadow-lg"
                  onClick={() => setCurrentIndex(currentIndex - 1)}
                >
                  <ChevronRight className="h-5 w-5" />
                </Button>
              )}
              {currentIndex < files.length - 1 && (
                <Button
                  variant="secondary"
                  size="icon"
                  className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full shadow-lg"
                  onClick={() => setCurrentIndex(currentIndex + 1)}
                >
                  <ChevronLeft className="h-5 w-5" />
                </Button>
              )}
            </>
          )}
        </div>

        <div className="p-3 border-t bg-background">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium truncate flex-1">{currentFile.original_name}</p>
            <a
              href={currentFile.cdn_url}
              download={currentFile.original_name}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button size="sm" className="gap-2">
                <Download className="h-4 w-4" />
                تحميل
              </Button>
            </a>
          </div>

          {files.length > 1 && (
            <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
              {files.map((file, idx) => (
                <button
                  key={file.id}
                  className={cn(
                    'shrink-0 w-12 h-12 rounded-lg border-2 overflow-hidden transition-all',
                    idx === currentIndex
                      ? 'border-primary ring-2 ring-primary/30'
                      : 'border-transparent opacity-60 hover:opacity-100'
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

// ---------- Helpers ----------

const formatDate = (dateStr: string | null | undefined) => {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('en-GB');
};

const calcAge = (birthDate: string | null | undefined) => {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  if (isNaN(b.getTime())) return null;
  const diff = Date.now() - b.getTime();
  return Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
};

// ---------- Main component ----------

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
  const [isPrinting, setIsPrinting] = useState(false);

  // Data fetched on open
  const [policyFiles, setPolicyFiles] = useState<Record<string, PolicyFile[]>>({});
  const [extraDriversByPolicy, setExtraDriversByPolicy] = useState<Record<string, ExtraDriver[]>>({});
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [accidents, setAccidents] = useState<AccidentRow[]>([]);
  const [refunds, setRefunds] = useState<RefundRow[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // File gallery
  const [fileGallery, setFileGallery] = useState<{
    open: boolean;
    files: PolicyFile[];
    title: string;
  }>({ open: false, files: [], title: '' });

  // Load everything the modal needs when it opens. Parent already provides
  // policies/cars/summary — we additionally fetch files, extra drivers,
  // payments (for the history table), accidents, and refunds so the modal
  // is self-contained and the parent stays uncoupled.
  useEffect(() => {
    if (!open || !client.id) return;
    loadDetails();
  }, [open, client.id]);

  const loadDetails = async () => {
    setLoadingDetails(true);
    try {
      const policyIds = policies.map(p => p.id);

      const [filesRes, driversRes, paymentsRes, accidentsRes, refundsRes] = await Promise.all([
        policyIds.length
          ? supabase
              .from('media_files')
              .select('id, cdn_url, original_name, mime_type, entity_id')
              .in('entity_type', ['policy', 'policy_insurance'])
              .in('entity_id', policyIds)
              .is('deleted_at', null)
          : Promise.resolve({ data: [], error: null }),
        policyIds.length
          ? supabase
              .from('policy_children')
              .select(`
                policy_id,
                child:client_children(id, full_name, id_number, relation, phone, birth_date)
              `)
              .in('policy_id', policyIds)
          : Promise.resolve({ data: [], error: null }),
        policyIds.length
          ? supabase
              .from('policy_payments')
              .select('id, policy_id, amount, payment_date, payment_type, cheque_number, cheque_status, card_last_four, refused, notes, batch_id')
              .in('policy_id', policyIds)
              .order('payment_date', { ascending: false })
          : Promise.resolve({ data: [], error: null }),
        supabase
          .from('accident_reports')
          .select(`
            id, accident_date, status, report_number,
            car:cars(car_number),
            company:insurance_companies(name, name_ar)
          `)
          .eq('client_id', client.id)
          .order('accident_date', { ascending: false }),
        supabase
          .from('customer_wallet_transactions')
          .select(`
            id, amount, transaction_type, description, refund_date, payment_method,
            car:cars(car_number)
          `)
          .eq('client_id', client.id)
          .in('transaction_type', ['refund', 'transfer_refund_owed', 'manual_refund'])
          .order('refund_date', { ascending: false, nullsFirst: false }),
      ]);

      // Files per policy
      const filesGrouped: Record<string, PolicyFile[]> = {};
      (filesRes.data || []).forEach((f: any) => {
        if (!f.entity_id) return;
        if (!filesGrouped[f.entity_id]) filesGrouped[f.entity_id] = [];
        filesGrouped[f.entity_id].push({
          id: f.id,
          cdn_url: f.cdn_url,
          original_name: f.original_name,
          mime_type: f.mime_type,
        });
      });
      setPolicyFiles(filesGrouped);

      // Extra drivers per policy
      const driversGrouped: Record<string, ExtraDriver[]> = {};
      (driversRes.data || []).forEach((row: any) => {
        if (!row.child) return;
        if (!driversGrouped[row.policy_id]) driversGrouped[row.policy_id] = [];
        driversGrouped[row.policy_id].push({
          child_id: row.child.id,
          full_name: row.child.full_name,
          id_number: row.child.id_number,
          relation: row.child.relation,
          phone: row.child.phone,
          birth_date: row.child.birth_date,
        });
      });
      setExtraDriversByPolicy(driversGrouped);

      setPayments((paymentsRes.data || []) as PaymentRow[]);
      setAccidents((accidentsRes.data || []) as unknown as AccidentRow[]);
      setRefunds((refundsRes.data || []) as unknown as RefundRow[]);
    } catch (error) {
      console.error('Error loading report details:', error);
      toast.error('فشل في تحميل بيانات التقرير');
    } finally {
      setLoadingDetails(false);
    }
  };

  const openFileGallery = (files: PolicyFile[], title: string) => {
    if (files.length === 0) return;
    setFileGallery({ open: true, files, title });
  };

  // ---------- Derived data ----------

  // Total insurance = insurance_price + office_commission across all policies.
  const totalInsurance = useMemo(
    () => policies.reduce((s, p) => s + p.insurance_price + (p.office_commission || 0), 0),
    [policies]
  );

  const isActivePolicy = (p: { cancelled: boolean | null; transferred: boolean | null; end_date: string }) =>
    !p.cancelled && !p.transferred && new Date(p.end_date) >= new Date();

  const activePoliciesCount = useMemo(() => policies.filter(isActivePolicy).length, [policies]);

  // Per-policy payment totals (non-refused only).
  const paidByPolicy = useMemo(() => {
    const map: Record<string, number> = {};
    for (const pay of payments) {
      if (pay.refused) continue;
      map[pay.policy_id] = (map[pay.policy_id] || 0) + pay.amount;
    }
    return map;
  }, [payments]);

  // Group the policies into packages (same group_id) or singles, then bucket
  // by car. Packages containing a THIRD_FULL or ELZAMI are treated as the
  // main vehicle package; addons (ROAD_SERVICE, ACCIDENT_FEE_EXEMPTION) are
  // nested underneath.
  type PackageItem = {
    kind: 'package';
    groupId: string;
    policies: ClientReportModalProps['policies'];
  };
  type SingleItem = {
    kind: 'single';
    policy: ClientReportModalProps['policies'][number];
  };
  type Item = PackageItem | SingleItem;

  const itemsByCar = useMemo(() => {
    const byCar: Record<string, Item[]> = {};
    const noCar: Item[] = [];
    const seenGroups = new Set<string>();

    for (const p of policies) {
      // Build the package once (when we hit the first policy with that
      // group_id), then skip the rest of the package members — the <Item>
      // carries all of them.
      if (p.group_id) {
        if (seenGroups.has(p.group_id)) continue;
        seenGroups.add(p.group_id);
        const groupPolicies = policies.filter(x => x.group_id === p.group_id);
        const item: Item = { kind: 'package', groupId: p.group_id, policies: groupPolicies };
        const carKey = p.car?.id || '__nocar__';
        if (carKey === '__nocar__') noCar.push(item);
        else (byCar[carKey] ||= []).push(item);
      } else {
        const item: Item = { kind: 'single', policy: p };
        const carKey = p.car?.id || '__nocar__';
        if (carKey === '__nocar__') noCar.push(item);
        else (byCar[carKey] ||= []).push(item);
      }
    }

    return { byCar, noCar };
  }, [policies]);

  // Payments grouped by batch_id (falls back to payment.id when no batch).
  // A single visible row can therefore be "2 دفعات" when staff paid two
  // policies in a package together.
  type PaymentGroup = {
    id: string;
    totalAmount: number;
    payment_date: string;
    types: string[];
    statuses: ('refused' | 'ok')[];
    items: PaymentRow[];
    chequeNumbers: string[];
  };

  const paymentGroups = useMemo<PaymentGroup[]>(() => {
    const groups = new Map<string, PaymentGroup>();
    for (const p of payments) {
      const key = p.batch_id || p.id;
      let g = groups.get(key);
      if (!g) {
        g = {
          id: key,
          totalAmount: 0,
          payment_date: p.payment_date,
          types: [],
          statuses: [],
          items: [],
          chequeNumbers: [],
        };
        groups.set(key, g);
      }
      g.items.push(p);
      g.totalAmount += p.amount;
      if (!g.types.includes(p.payment_type)) g.types.push(p.payment_type);
      g.statuses.push(p.refused ? 'refused' : 'ok');
      if (p.cheque_number && !g.chequeNumbers.includes(p.cheque_number)) {
        g.chequeNumbers.push(p.cheque_number);
      }
    }
    return Array.from(groups.values()).sort(
      (a, b) => new Date(b.payment_date).getTime() - new Date(a.payment_date).getTime()
    );
  }, [payments]);

  // ---------- Actions ----------

  const handlePrint = async () => {
    setIsPrinting(true);
    try {
      const reportResponse = await supabase.functions.invoke('generate-client-report', {
        body: { client_id: client.id },
      });
      if (reportResponse.error) throw reportResponse.error;
      const reportUrl = reportResponse.data?.url;
      if (!reportUrl) throw new Error('Failed to generate report URL');
      const w = window.open(reportUrl, '_blank');
      if (w) {
        w.addEventListener('load', () => {
          setTimeout(() => w.print(), 500);
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
      const reportResponse = await supabase.functions.invoke('generate-client-report', {
        body: { client_id: client.id },
      });
      if (reportResponse.error) throw reportResponse.error;
      const reportUrl = reportResponse.data?.url;
      if (!reportUrl) throw new Error('Failed to generate report URL');

      const companyName = siteSettings?.site_title || 'وكالة التأمين';
      const message =
        `${client.full_name} عزيزنا/ي\n` +
        `يمكنك مشاهدة تقرير تأميناتك الكامل عبر الرابط:\n${reportUrl}\n\n` +
        `${companyName} 🚗`;

      const smsResponse = await supabase.functions.invoke('send-sms', {
        body: { phone: client.phone_number, message },
      });
      if (smsResponse.error) throw smsResponse.error;

      await supabase.from('sms_logs').insert([
        {
          phone_number: client.phone_number,
          message,
          client_id: client.id,
          sms_type: 'manual' as const,
          status: 'sent',
          sent_at: new Date().toISOString(),
        },
      ]);
      toast.success('تم إرسال رابط التقرير عبر SMS بنجاح');
    } catch (error) {
      console.error('Error sending SMS:', error);
      const msg = await extractFunctionErrorMessage(error);
      toast.error(msg || 'فشل في إرسال الرسالة');
    } finally {
      setSendingSms(false);
    }
  };

  const age = calcAge(client.birth_date);
  const netRemaining = Math.max(0, paymentSummary.total_remaining - walletBalance.total_refunds);

  // ---------- Render helpers ----------

  const Section = ({
    id,
    icon: Icon,
    title,
    count,
    children,
  }: {
    id: string;
    icon: React.ElementType;
    title: string;
    count?: number | string;
    children: React.ReactNode;
  }) => (
    <section id={id} className="scroll-mt-20">
      <div className="flex items-center gap-2 mb-3">
        <div className="h-7 w-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
          <Icon className="h-4 w-4" />
        </div>
        <h3 className="font-bold text-base text-foreground">{title}</h3>
        {count !== undefined && count !== 0 && (
          <Badge variant="secondary" className="text-[11px]">{count}</Badge>
        )}
        <div className="flex-1 h-px bg-border" />
      </div>
      {children}
    </section>
  );

  const renderPolicyLine = (policy: ClientReportModalProps['policies'][number], showType = true) => {
    const paid = paidByPolicy[policy.id] || 0;
    const full = policy.insurance_price + (policy.office_commission || 0);
    const remaining = Math.max(0, full - paid);
    const files = policyFiles[policy.id] || [];
    const drivers = extraDriversByPolicy[policy.id] || [];

    const status = policy.cancelled
      ? { label: 'ملغاة', color: 'bg-destructive/10 text-destructive border-destructive/20', icon: XCircle }
      : policy.transferred
      ? { label: 'محولة', color: 'bg-amber-500/10 text-amber-600 border-amber-500/20', icon: ArrowRightLeft }
      : new Date(policy.end_date) < new Date()
      ? { label: 'منتهية', color: 'bg-muted text-muted-foreground border-border', icon: Clock }
      : { label: 'سارية', color: 'bg-success/10 text-success border-success/20', icon: CheckCircle };
    const StatusIcon = status.icon;

    return (
      <div className="rounded-lg border bg-background p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            {showType && (
              <Badge variant="outline" className="text-xs">
                {getInsuranceTypeLabel(policy.policy_type_parent as any, policy.policy_type_child as any)}
              </Badge>
            )}
            <Badge className={cn('gap-1 text-[10px] border', status.color)}>
              <StatusIcon className="h-3 w-3" />
              {status.label}
            </Badge>
            {policy.policy_number && (
              <span className="text-[11px] font-mono text-muted-foreground ltr-nums">#{policy.policy_number}</span>
            )}
          </div>
          <div className="text-left shrink-0">
            <p className="font-bold text-primary ltr-nums">₪{full.toLocaleString()}</p>
            {full > 0 && (
              <div className="flex items-center gap-1 justify-end text-[10px] ltr-nums">
                <span className="text-success">مدفوع {paid.toLocaleString()}</span>
                <span className="text-muted-foreground">/</span>
                <span className={remaining > 0 ? 'text-destructive' : 'text-muted-foreground'}>
                  متبقي {remaining.toLocaleString()}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
          <span className="flex items-center gap-1">
            <Building2 className="h-3 w-3" />
            {policy.company?.name_ar || policy.company?.name || '-'}
          </span>
          <span className="flex items-center gap-1 ltr-nums">
            <Calendar className="h-3 w-3" />
            {formatDate(policy.start_date)} - {formatDate(policy.end_date)}
          </span>
          {files.length > 0 && (
            <button
              type="button"
              onClick={() => openFileGallery(files, `${getInsuranceTypeLabel(policy.policy_type_parent as any, policy.policy_type_child as any)} ${policy.policy_number || ''}`.trim())}
              className="flex items-center gap-1 text-primary hover:text-primary/80 bg-primary/10 hover:bg-primary/20 px-2 py-0.5 rounded-full transition-colors"
            >
              <Paperclip className="h-3 w-3" />
              {files.length} ملف
            </button>
          )}
        </div>

        {drivers.length > 0 && (
          <div className="pt-2 border-t flex items-start gap-2">
            <Users className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
            <div className="flex flex-wrap gap-1">
              {drivers.map(d => (
                <Badge key={d.child_id} variant="secondary" className="text-[10px] font-normal">
                  {d.full_name}
                  {d.relation ? ` • ${d.relation}` : ''}
                  {d.birth_date ? ` • ${formatDate(d.birth_date)}` : ''}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {policy.notes && (
          <div className="pt-2 border-t flex items-start gap-2 text-xs text-muted-foreground">
            <StickyNote className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <p className="whitespace-pre-wrap">{policy.notes}</p>
          </div>
        )}
      </div>
    );
  };

  const renderItem = (item: Item) => {
    if (item.kind === 'single') {
      return <div key={`single-${item.policy.id}`}>{renderPolicyLine(item.policy)}</div>;
    }

    const pkg = item;
    const totalPrice = pkg.policies.reduce(
      (s, p) => s + p.insurance_price + (p.office_commission || 0),
      0
    );
    const totalPaid = pkg.policies.reduce((s, p) => s + (paidByPolicy[p.id] || 0), 0);
    const totalRemaining = Math.max(0, totalPrice - totalPaid);
    const activeCount = pkg.policies.filter(isActivePolicy).length;

    return (
      <div key={`pkg-${pkg.groupId}`} className="rounded-xl border-2 border-primary/20 bg-primary/[0.02] overflow-hidden">
        <div className="bg-primary/5 px-3 py-2 flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-primary/15 text-primary flex items-center justify-center">
              <Layers className="h-3.5 w-3.5" />
            </div>
            <span className="font-bold text-sm">باقة تأمين</span>
          </div>
          <Badge variant="secondary" className="text-[10px]">
            {pkg.policies.length} وثائق
          </Badge>
          {activeCount > 0 && (
            <Badge className="bg-success/10 text-success border-success/20 text-[10px]">
              {activeCount} سارية
            </Badge>
          )}
          <div className="flex-1" />
          <div className="text-left">
            <p className="font-bold text-primary ltr-nums text-sm">₪{totalPrice.toLocaleString()}</p>
            <div className="flex items-center gap-1 justify-end text-[10px] ltr-nums">
              <span className="text-success">مدفوع {totalPaid.toLocaleString()}</span>
              <span className="text-muted-foreground">/</span>
              <span className={totalRemaining > 0 ? 'text-destructive' : 'text-muted-foreground'}>
                متبقي {totalRemaining.toLocaleString()}
              </span>
            </div>
          </div>
        </div>
        <div className="p-2 space-y-2">
          {pkg.policies.map(p => (
            <div key={p.id}>{renderPolicyLine(p)}</div>
          ))}
        </div>
      </div>
    );
  };

  // ---------- Render ----------

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-6xl w-[97vw] max-h-[95vh] p-0 overflow-hidden flex flex-col"
        hideCloseButton
      >
        {/* Hero header */}
        <div
          className="relative overflow-hidden shrink-0"
          style={{ background: 'linear-gradient(135deg, #122143 0%, #1a3260 100%)' }}
        >
          <div className="absolute inset-0 opacity-10 pointer-events-none">
            <div className="absolute top-0 left-0 w-32 h-32 bg-white rounded-full -translate-x-1/2 -translate-y-1/2" />
            <div className="absolute bottom-0 right-0 w-48 h-48 bg-white rounded-full translate-x-1/4 translate-y-1/4" />
          </div>

          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="إغلاق"
            className="absolute left-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-md text-white/80 hover:text-white hover:bg-white/10 transition focus:outline-none focus:ring-2 focus:ring-white/40"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="relative px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-4 min-w-0">
                <div className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
                  <User className="h-7 w-7 text-white" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h1 className="text-xl font-bold text-white truncate">{client.full_name}</h1>
                    <Badge className="bg-white/20 border-white/30 text-white font-medium">
                      <IdCard className="h-3 w-3 ml-1" />
                      <span className="ltr-nums">{client.id_number}</span>
                    </Badge>
                    {age !== null && (
                      <Badge className="bg-white/20 border-white/30 text-white font-medium">
                        {age} سنة
                      </Badge>
                    )}
                    {walletBalance.total_refunds > 0 && (
                      <Badge className="bg-amber-100 text-amber-900 border-amber-200 font-bold ltr-nums">
                        رصيد للعميل: ₪{walletBalance.total_refunds.toLocaleString()}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-4 mt-2 text-white/80 text-sm flex-wrap">
                    {client.phone_number && (
                      <div className="flex items-center gap-1">
                        <Phone className="h-3.5 w-3.5" />
                        <span className="ltr-nums">{client.phone_number}</span>
                      </div>
                    )}
                    {client.file_number && (
                      <div className="flex items-center gap-1">
                        <FileText className="h-3.5 w-3.5" />
                        <span>ملف #{client.file_number}</span>
                      </div>
                    )}
                    {branchName && (
                      <div className="flex items-center gap-1">
                        <Building2 className="h-3.5 w-3.5" />
                        <span>{branchName}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex gap-2 ml-14 shrink-0">
                <Button
                  size="sm"
                  onClick={handleSendSms}
                  disabled={sendingSms || !client.phone_number}
                  className="gap-1.5 bg-white/20 hover:bg-white/30 text-white border-0"
                  title={!client.phone_number ? 'لا يوجد رقم هاتف' : 'إرسال رابط التقرير للعميل'}
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

            {/* Stats row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-5">
              <div className="rounded-lg bg-white/10 backdrop-blur-sm border border-white/10 px-3 py-2">
                <p className="text-[10px] text-white/70">وثائق سارية</p>
                <p className="text-lg font-bold text-white ltr-nums">
                  {activePoliciesCount}
                  <span className="text-xs text-white/60 mr-1">/ {policies.length}</span>
                </p>
              </div>
              <div className="rounded-lg bg-white/10 backdrop-blur-sm border border-white/10 px-3 py-2">
                <p className="text-[10px] text-white/70">السيارات</p>
                <p className="text-lg font-bold text-white ltr-nums">{cars.length}</p>
              </div>
              <div className="rounded-lg bg-white/10 backdrop-blur-sm border border-white/10 px-3 py-2">
                <p className="text-[10px] text-white/70">الدفعات</p>
                <p className="text-lg font-bold text-white ltr-nums">{paymentGroups.length}</p>
              </div>
              <div className="rounded-lg bg-white/10 backdrop-blur-sm border border-white/10 px-3 py-2">
                <p className="text-[10px] text-white/70">بلاغات حوادث</p>
                <p className="text-lg font-bold text-white ltr-nums">{accidents.length}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Quick nav */}
        <div className="border-b bg-muted/30 px-4 py-2 overflow-x-auto">
          <nav className="flex gap-1 text-xs">
            {[
              { id: 'sec-info', label: 'معلومات العميل', icon: User },
              { id: 'sec-money', label: 'الملخص المالي', icon: Wallet },
              { id: 'sec-policies', label: 'السيارات والوثائق', icon: Car },
              { id: 'sec-payments', label: 'سجل الدفعات', icon: CreditCard },
              { id: 'sec-accidents', label: 'بلاغات الحوادث', icon: ShieldAlert },
              { id: 'sec-refunds', label: 'المرتجعات', icon: Banknote },
              { id: 'sec-notes', label: 'ملاحظات', icon: StickyNote },
            ].map(tab => (
              <a
                key={tab.id}
                href={`#${tab.id}`}
                onClick={e => {
                  e.preventDefault();
                  document.getElementById(tab.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"
              >
                <tab.icon className="h-3.5 w-3.5" />
                {tab.label}
              </a>
            ))}
          </nav>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {loadingDetails && (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              جاري تحميل التفاصيل...
            </div>
          )}

          {/* Client info */}
          <Section id="sec-info" icon={User} title="معلومات العميل">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              <InfoCell label="الهاتف" value={client.phone_number} mono />
              {client.phone_number_2 && <InfoCell label="هاتف إضافي" value={client.phone_number_2} mono />}
              <InfoCell label="رقم الهوية" value={client.id_number} mono />
              <InfoCell label="رقم الملف" value={client.file_number} />
              <InfoCell label="تاريخ الانضمام" value={formatDate(client.date_joined)} />
              <InfoCell label="تاريخ الميلاد" value={formatDate(client.birth_date)} />
              {branchName && <InfoCell label="الفرع" value={branchName} />}
              {broker && <InfoCell label="الوسيط" value={broker.name} />}
              {client.under24_type === 'client' && <InfoCell label="الفئة العمرية" value="أقل من 24" warn />}
              {client.under24_type === 'additional_driver' && client.under24_driver_name && (
                <InfoCell
                  label="سائق إضافي -24"
                  value={`${client.under24_driver_name}${client.under24_driver_id ? ` (${client.under24_driver_id})` : ''}`}
                />
              )}
            </div>
          </Section>

          {/* Financial summary */}
          <Section id="sec-money" icon={Wallet} title="الملخص المالي">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <MoneyCard label="إجمالي التأمينات" value={totalInsurance} tone="neutral" />
              <MoneyCard label="المدفوع" value={paymentSummary.total_paid} tone="success" />
              <MoneyCard
                label="المتبقي"
                value={netRemaining}
                tone={netRemaining > 0 ? 'destructive' : 'success'}
                sub={
                  walletBalance.total_refunds > 0 && paymentSummary.total_remaining > 0
                    ? `المطلوب ₪${paymentSummary.total_remaining.toLocaleString()} - مرتجع ₪${walletBalance.total_refunds.toLocaleString()}`
                    : undefined
                }
              />
              <MoneyCard label="الأرباح" value={paymentSummary.total_profit} tone="primary" />
            </div>
          </Section>

          {/* Policies by car */}
          <Section id="sec-policies" icon={Car} title="السيارات والوثائق" count={policies.length}>
            <div className="space-y-4">
              {cars.map(car => {
                const items = itemsByCar.byCar[car.id] || [];
                return (
                  <div key={car.id} className="rounded-xl border overflow-hidden">
                    <div className="bg-muted/40 p-3 flex items-center gap-3 flex-wrap">
                      <div className="bg-yellow-200 border-2 border-foreground rounded px-2 py-0.5">
                        <span className="font-mono font-bold text-sm ltr-nums">{car.car_number}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm truncate">
                          {[car.manufacturer_name, car.model, car.year].filter(Boolean).join(' ') || 'بدون تفاصيل'}
                        </p>
                        <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap mt-0.5">
                          {car.car_type && <span>{carTypeLabels[car.car_type] || car.car_type}</span>}
                          {car.color && (
                            <span className="flex items-center gap-1">
                              <Palette className="h-3 w-3" />
                              {car.color}
                            </span>
                          )}
                          {car.car_value ? <span>القيمة: ₪{car.car_value.toLocaleString()}</span> : null}
                          {car.license_expiry && (
                            <span>انتهاء الرخصة: {formatDate(car.license_expiry)}</span>
                          )}
                        </div>
                      </div>
                      <Badge variant="secondary" className="text-[10px]">
                        {items.length} {items.length === 1 ? 'بند' : 'بنود'}
                      </Badge>
                    </div>
                    <div className="p-3 space-y-3">
                      {items.length === 0 ? (
                        <p className="text-center text-xs text-muted-foreground py-2">لا توجد وثائق</p>
                      ) : (
                        items.map(renderItem)
                      )}
                    </div>
                  </div>
                );
              })}

              {itemsByCar.noCar.length > 0 && (
                <div className="rounded-xl border overflow-hidden">
                  <div className="bg-muted/40 p-3">
                    <p className="font-medium text-sm">وثائق أخرى (بدون سيارة)</p>
                  </div>
                  <div className="p-3 space-y-3">{itemsByCar.noCar.map(renderItem)}</div>
                </div>
              )}

              {policies.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-8">لا توجد وثائق لهذا العميل</p>
              )}
            </div>
          </Section>

          {/* Payment history */}
          <Section id="sec-payments" icon={CreditCard} title="سجل الدفعات" count={paymentGroups.length}>
            {paymentGroups.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-4">لا توجد دفعات مسجلة</p>
            ) : (
              <div className="rounded-xl border overflow-hidden">
                <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-3 py-2 bg-muted/40 text-[11px] font-medium text-muted-foreground">
                  <span>التاريخ / الطريقة</span>
                  <span className="text-left">المبلغ</span>
                  <span className="text-left">الحالة</span>
                  <span />
                </div>
                <div className="divide-y">
                  {paymentGroups.map(group => {
                    const anyRefused = group.statuses.includes('refused');
                    return (
                      <div
                        key={group.id}
                        className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-3 py-2.5 items-center text-sm"
                      >
                        <div className="min-w-0">
                          <p className="font-medium ltr-nums">{formatDate(group.payment_date)}</p>
                          <div className="flex items-center gap-1 flex-wrap mt-0.5">
                            {group.types.map(t => (
                              <Badge key={t} variant="outline" className="text-[10px] font-normal">
                                {paymentTypeLabels[t] || t}
                              </Badge>
                            ))}
                            {group.items.length > 1 && (
                              <Badge variant="secondary" className="text-[10px]">
                                {group.items.length} دفعات
                              </Badge>
                            )}
                            {group.chequeNumbers.length > 0 && (
                              <span className="text-[10px] text-muted-foreground font-mono">
                                #{group.chequeNumbers.join(', ')}
                              </span>
                            )}
                          </div>
                        </div>
                        <p className="font-bold text-primary ltr-nums text-left">
                          ₪{group.totalAmount.toLocaleString()}
                        </p>
                        <Badge
                          className={cn(
                            'text-[10px]',
                            anyRefused
                              ? 'bg-destructive/10 text-destructive border-destructive/20'
                              : 'bg-success/10 text-success border-success/20'
                          )}
                        >
                          {anyRefused ? 'راجع' : 'مقبول'}
                        </Badge>
                        <div />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </Section>

          {/* Accidents */}
          <Section id="sec-accidents" icon={ShieldAlert} title="بلاغات الحوادث" count={accidents.length}>
            {accidents.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-4">لا توجد بلاغات حوادث</p>
            ) : (
              <div className="space-y-2">
                {accidents.map(a => {
                  const statusMeta = accidentStatusLabels[a.status] || { label: a.status, variant: 'secondary' as const };
                  return (
                    <div
                      key={a.id}
                      className="rounded-lg border bg-background p-3 flex items-center justify-between gap-3 flex-wrap"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-9 w-9 rounded-lg bg-destructive/10 text-destructive flex items-center justify-center shrink-0">
                          <AlertTriangle className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-sm">
                            بلاغ #{a.report_number}
                            {a.car?.car_number && (
                              <span className="text-muted-foreground font-mono mr-2 ltr-nums">{a.car.car_number}</span>
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground ltr-nums">
                            {formatDate(a.accident_date)}
                            {a.company ? ` • ${a.company.name_ar || a.company.name}` : ''}
                          </p>
                        </div>
                      </div>
                      <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          {/* Refunds */}
          <Section id="sec-refunds" icon={Banknote} title="المرتجعات" count={refunds.length}>
            {refunds.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-4">لا توجد مرتجعات</p>
            ) : (
              <div className="space-y-2">
                {refunds.map(r => (
                  <div
                    key={r.id}
                    className="rounded-lg border bg-background p-3 flex items-center justify-between gap-3 flex-wrap"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-9 w-9 rounded-lg bg-amber-500/10 text-amber-600 flex items-center justify-center shrink-0">
                        <Receipt className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className="text-[10px]">
                            {refundTypeLabels[r.transaction_type] || r.transaction_type}
                          </Badge>
                          {r.car?.car_number && (
                            <span className="text-xs text-muted-foreground font-mono ltr-nums">
                              {r.car.car_number}
                            </span>
                          )}
                          {r.payment_method && (
                            <span className="text-[10px] text-muted-foreground">
                              {paymentTypeLabels[r.payment_method] || r.payment_method}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground ltr-nums mt-0.5">
                          {formatDate(r.refund_date)}
                          {r.description ? ` • ${r.description}` : ''}
                        </p>
                      </div>
                    </div>
                    <p className="font-bold text-amber-600 ltr-nums">₪{r.amount.toLocaleString()}</p>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Notes */}
          {(client.notes || client.accident_notes) && (
            <Section id="sec-notes" icon={StickyNote} title="ملاحظات">
              <div className="space-y-2">
                {client.notes && (
                  <div className="rounded-lg border bg-background p-3">
                    <p className="text-[11px] text-muted-foreground mb-1">ملاحظات العميل</p>
                    <p className="text-sm whitespace-pre-wrap">{client.notes}</p>
                  </div>
                )}
                {client.accident_notes && (
                  <div className="rounded-lg border bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900 p-3">
                    <p className="text-[11px] text-amber-700 dark:text-amber-300 mb-1">ملاحظات الحوادث</p>
                    <p className="text-sm whitespace-pre-wrap">{client.accident_notes}</p>
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between pt-4 border-t text-xs text-muted-foreground">
            <p className="font-bold text-primary text-sm">{siteSettings?.site_title || 'وكالة التأمين'}</p>
            <p className="ltr-nums">{new Date().toLocaleDateString('en-GB')}</p>
          </div>
        </div>
      </DialogContent>

      <FileGalleryPopup
        open={fileGallery.open}
        onOpenChange={o => setFileGallery(prev => ({ ...prev, open: o }))}
        files={fileGallery.files}
        title={fileGallery.title}
      />
    </Dialog>
  );
}

// ---------- Small presentational cells ----------

function InfoCell({
  label,
  value,
  mono,
  warn,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
  warn?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border bg-background px-3 py-2',
        warn && 'border-amber-500/30 bg-amber-500/5'
      )}
    >
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={cn('text-sm font-semibold truncate', mono && 'font-mono ltr-nums')}>
        {value || '-'}
      </p>
    </div>
  );
}

function MoneyCard({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: number;
  tone: 'neutral' | 'success' | 'destructive' | 'primary';
  sub?: string;
}) {
  const toneClasses = {
    neutral: 'bg-muted/50 border-border text-foreground',
    success: 'bg-success/5 border-success/20 text-success',
    destructive: 'bg-destructive/5 border-destructive/20 text-destructive',
    primary: 'bg-primary/5 border-primary/20 text-primary',
  }[tone];

  return (
    <div className={cn('rounded-xl border p-3', toneClasses)}>
      <p className="text-[10px] text-muted-foreground mb-0.5">{label}</p>
      <p className="text-lg font-bold ltr-nums">₪{value.toLocaleString()}</p>
      {sub && <p className="text-[9px] text-muted-foreground mt-1 ltr-nums">{sub}</p>}
    </div>
  );
}
