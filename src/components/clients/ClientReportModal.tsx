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
  StickyNote,
  Banknote,
  Receipt,
  Building2,
  Calendar,
  Phone,
  IdCard,
  Palette,
  ShieldAlert,
  Zap,
  Handshake,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { parseFunctionError } from '@/lib/functionError';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { getInsuranceTypeLabel } from '@/lib/insuranceTypes';
import { getBankName } from '@/lib/banks';
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
  bank_code: string | null;
  branch_code: string | null;
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
    created_at?: string | null;
    broker_id?: string | null;
    broker_direction?: 'from_broker' | 'to_broker' | null;
    broker?: { id: string; name: string } | null;
    transferred_car_number?: string | null;
    transferred_to_car_number?: string | null;
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

// Policy-type color map (matches PolicyYearTimeline so the report looks
// identical to the in-app policy cards — same badges, same colors).
const policyTypeColors: Record<string, string> = {
  ELZAMI: 'bg-blue-500/10 text-blue-700 border-blue-500/30',
  THIRD_FULL: 'bg-purple-500/10 text-purple-700 border-purple-500/30',
  ROAD_SERVICE: 'bg-orange-500/10 text-orange-700 border-orange-500/30',
  ACCIDENT_FEE_EXEMPTION: 'bg-green-500/10 text-green-700 border-green-500/30',
  HEALTH: 'bg-pink-500/10 text-pink-700 border-pink-500/30',
  LIFE: 'bg-indigo-500/10 text-indigo-700 border-indigo-500/30',
  PROPERTY: 'bg-amber-500/10 text-amber-700 border-amber-500/30',
  TRAVEL: 'bg-cyan-500/10 text-cyan-700 border-cyan-500/30',
  BUSINESS: 'bg-slate-500/10 text-slate-700 border-slate-500/30',
  OTHER: 'bg-gray-500/10 text-gray-700 border-gray-500/30',
};

// Child type labels used when a THIRD_FULL is split into ثالث / شامل.
const policyChildLabels: Record<string, string> = {
  THIRD: 'ثالث',
  FULL: 'شامل',
};

// Prefer the child label when THIRD_FULL has one (ثالث / شامل), otherwise
// fall back to the parent label.
const getTypeDisplayLabel = (p: {
  policy_type_parent: string;
  policy_type_child: string | null;
}): string => {
  if (p.policy_type_parent === 'THIRD_FULL' && p.policy_type_child) {
    return policyChildLabels[p.policy_type_child] || p.policy_type_child;
  }
  return (
    getInsuranceTypeLabel(p.policy_type_parent as any, p.policy_type_child as any) ||
    p.policy_type_parent
  );
};

// "New" = created within the last 24 hours. Drives the green "جديدة" chip.
const isNewPolicy = (createdAt: string | null | undefined): boolean => {
  if (!createdAt) return false;
  const created = new Date(createdAt);
  if (isNaN(created.getTime())) return false;
  const hoursDiff = (Date.now() - created.getTime()) / (1000 * 60 * 60);
  return hoursDiff < 24;
};

// Main types that anchor a package (addons are ROAD_SERVICE / ACCIDENT_FEE_*).
// Used to pick the main policy for package header info (company/car/period).
const MAIN_POLICY_TYPES_FOR_CARD = ['THIRD_FULL', 'ELZAMI', 'HEALTH', 'LIFE', 'PROPERTY', 'TRAVEL', 'BUSINESS', 'OTHER'];

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
              .select('id, policy_id, amount, payment_date, payment_type, cheque_number, cheque_status, card_last_four, bank_code, branch_code, refused, notes, batch_id')
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

  // Total insurance = insurance_price + office_commission across all
  // ACTIVE policies — i.e. not cancelled and not transferred. This must
  // match the subset `fetchPaymentSummary` uses for total_paid/total_remaining
  // in ClientDetails, otherwise the three money cards don't reconcile
  // (total − paid − refund ≠ remaining) and the customer sees phantom debt.
  const totalInsurance = useMemo(
    () =>
      policies
        .filter((p) => !p.cancelled && !p.transferred)
        .reduce((s, p) => s + p.insurance_price + (p.office_commission || 0), 0),
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
    bankLines: string[];
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
          bankLines: [],
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
      const bankName = getBankName(p.bank_code);
      const branchLabel = p.branch_code ? `فرع ${p.branch_code}` : '';
      const bankLine = [bankName, branchLabel].filter(Boolean).join(' · ');
      if (bankLine && !g.bankLines.includes(bankLine)) {
        g.bankLines.push(bankLine);
      }
    }
    return Array.from(groups.values()).sort(
      (a, b) => new Date(b.payment_date).getTime() - new Date(a.payment_date).getTime()
    );
  }, [payments]);

  // ---------- Actions ----------

  // Log the full parsed response body (step name, detail, status) for any
  // FunctionsHttpError so the devtools console tells us exactly where the
  // edge function gave up — otherwise the browser just shows the generic
  // "Edge Function returned a non-2xx status code" and we're blind.
  const logFunctionError = async (label: string, error: unknown) => {
    const parsed = await parseFunctionError(error);
    console.error(`[${label}]`, {
      message: parsed.message,
      step: (parsed.payload as any)?.step,
      detail: (parsed.payload as any)?.detail,
      status: parsed.status,
      raw: error,
    });
    return parsed;
  };

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
      const parsed = await logFunctionError('generate-client-report:print', error);
      toast.error(parsed.message || 'فشل في تحضير التقرير للطباعة');
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

      await (supabase.from('sms_logs') as any).insert([
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
      const parsed = await logFunctionError('generate-client-report:sms', error);
      toast.error(parsed.message || 'فشل في إرسال الرسالة');
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
    <section id={id} className="scroll-mt-24">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
          <Icon className="h-5 w-5" />
        </div>
        <h3 className="font-bold text-lg text-foreground">{title}</h3>
        {count !== undefined && count !== 0 && (
          <Badge variant="secondary" className="text-xs px-2 py-0.5">{count}</Badge>
        )}
        <div className="flex-1 h-px bg-border" />
      </div>
      {children}
    </section>
  );

  // Pick the main policy for a package: prefer THIRD_FULL, then ELZAMI,
  // then any other main type, then the first member. Everything else
  // becomes an addon (ROAD_SERVICE, ACCIDENT_FEE_EXEMPTION, etc.).
  const pickMainPolicy = (
    pkgPolicies: ClientReportModalProps['policies']
  ): ClientReportModalProps['policies'][number] => {
    return (
      pkgPolicies.find((p) => p.policy_type_parent === 'THIRD_FULL') ||
      pkgPolicies.find((p) => p.policy_type_parent === 'ELZAMI') ||
      pkgPolicies.find((p) => MAIN_POLICY_TYPES_FOR_CARD.includes(p.policy_type_parent)) ||
      pkgPolicies[0]
    );
  };

  // Status derivation — matches PolicyYearTimeline's getPolicyStatus so the
  // سارية / ملغاة / محولة / منتهية chip shows the same state as the app.
  const cardStatusFor = (main: ClientReportModalProps['policies'][number]) => {
    if (main.cancelled) return 'cancelled' as const;
    if (main.transferred) return 'transferred' as const;
    if (new Date(main.end_date) < new Date()) return 'ended' as const;
    return 'active' as const;
  };

  // Single row inside a package's "مكونات الباقة" table. Mirrors
  // PackageComponentRow from PolicyYearTimeline so the report looks
  // identical to the app.
  const renderComponentRow = (
    policy: ClientReportModalProps['policies'][number],
    index: number,
    isActive: boolean
  ) => {
    const typeLabel = getTypeDisplayLabel(policy);
    const typeColor = policyTypeColors[policy.policy_type_parent] || policyTypeColors.OTHER;
    const commission = policy.office_commission || 0;
    const providerName = policy.company?.name_ar || policy.company?.name || '-';
    const files = policyFiles[policy.id] || [];

    return (
      <div
        key={policy.id}
        data-policy-row-id={policy.id}
        className={cn(
          'grid grid-cols-[2rem_1fr_auto_auto] items-center gap-3 px-3 py-2 text-xs border-b border-border/60 last:border-b-0 transition-colors hover:bg-muted/30',
          !isActive && 'opacity-70'
        )}
      >
        <span className="text-[10px] font-bold text-muted-foreground ltr-nums text-center">
          #{index}
        </span>
        <div className="flex items-center gap-2 min-w-0">
          <Badge className={cn('text-[10px] px-1.5 py-0 h-5 font-medium border shrink-0', typeColor)}>
            {typeLabel}
          </Badge>
          <span
            className={cn(
              'truncate',
              isActive ? 'text-muted-foreground' : 'text-muted-foreground/70'
            )}
          >
            {providerName}
          </span>
          {policy.broker_id && policy.broker && (
            <span
              className="text-[10px] font-semibold text-amber-700 bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0 h-5 inline-flex items-center gap-1 shrink-0"
              title={`${
                policy.broker_direction === 'from_broker' ? 'من الوسيط' : 'إلى الوسيط'
              }: ${policy.broker.name}`}
            >
              <Handshake className="h-3 w-3" />
              {policy.broker.name}
            </span>
          )}
          {files.length > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openFileGallery(files, `${typeLabel} ${policy.policy_number || ''}`.trim());
              }}
              className="text-[10px] font-semibold text-primary bg-primary/10 hover:bg-primary/20 border border-primary/30 rounded px-1.5 py-0 h-5 inline-flex items-center gap-1 shrink-0 transition-colors"
              title={`${files.length} ملف`}
            >
              <Paperclip className="h-3 w-3" />
              {files.length}
            </button>
          )}
        </div>
        <span
          className={cn(
            'ltr-nums text-[11px] shrink-0',
            isActive ? 'text-muted-foreground' : 'text-muted-foreground/70'
          )}
        >
          {formatDate(policy.end_date)} ← {formatDate(policy.start_date)}
        </span>
        <div className="flex flex-col items-end min-w-[70px]">
          <span
            className={cn(
              'font-semibold ltr-nums',
              isActive ? 'text-foreground' : 'text-muted-foreground'
            )}
          >
            ₪{policy.insurance_price.toLocaleString('en-US')}
          </span>
          {commission > 0 && (
            <span className="text-[9px] text-amber-700 font-semibold ltr-nums">
              + ₪{commission.toLocaleString('en-US')} عمولة
            </span>
          )}
        </div>
      </div>
    );
  };

  // Unified policy card — renders a standalone policy or a package with the
  // same visual language as the ClientDetails policy cards. Action buttons
  // (pay / print / SMS / edit) are intentionally omitted; this is a read-
  // only report preview.
  const renderPolicyCard = (item: Item) => {
    const isPkg = item.kind === 'package';
    const allPolicies = isPkg ? item.policies : [item.policy];
    const mainPolicy = isPkg ? pickMainPolicy(item.policies) : item.policy;
    const addons = isPkg
      ? item.policies.filter((p) => p.id !== mainPolicy.id)
      : [];

    const status = cardStatusFor(mainPolicy);
    const isActive = status === 'active';
    const isTransferred = status === 'transferred';
    const isCancelled = status === 'cancelled';

    const totalPrice = allPolicies.reduce(
      (s, p) => s + p.insurance_price + (p.office_commission || 0),
      0
    );
    const totalPaid = allPolicies.reduce((s, p) => s + (paidByPolicy[p.id] || 0), 0);
    const totalRemaining = Math.max(0, totalPrice - totalPaid);
    const hasUnpaid = totalRemaining > 0;

    const totalCommission = allPolicies.reduce(
      (s, p) => s + (p.office_commission || 0),
      0
    );

    // Broker chip — if any policy in the card is tied to a broker, surface
    // a single "من/إلى الوسيط: <name>" chip on the header row.
    const brokerPolicy = allPolicies.find((p) => p.broker_id && p.broker);
    const brokerDirectionLabel = brokerPolicy
      ? brokerPolicy.broker_direction === 'from_broker'
        ? 'من الوسيط'
        : brokerPolicy.broker_direction === 'to_broker'
          ? 'إلى الوسيط'
          : 'وسيط'
      : null;

    const wasTransferredFrom = mainPolicy.transferred_car_number;
    const wasTransferredTo = mainPolicy.transferred_to_car_number;
    const createdRecently =
      mainPolicy.created_at && isNewPolicy(mainPolicy.created_at);

    const files = policyFiles[mainPolicy.id] || [];
    const drivers = extraDriversByPolicy[mainPolicy.id] || [];

    return (
      <div
        key={isPkg ? `pkg-${item.groupId}` : `single-${mainPolicy.id}`}
        className={cn(
          'rounded-xl overflow-hidden transition-all duration-200 border bg-card',
          isActive && 'border-2 border-primary/40 shadow-md shadow-primary/5',
          status === 'ended' && 'bg-muted/20 border-border',
          (isTransferred || isCancelled) &&
            'bg-muted/10 border-dashed border-muted-foreground/30 opacity-70',
          hasUnpaid && isActive && 'border-r-4 border-r-destructive'
        )}
      >
        <div className="p-4">
          {/* Top row: status + type chips + package/new/broker badges */}
          <div className="flex items-center gap-2 flex-wrap mb-3">
            {isActive && (
              <Badge variant="success" className="gap-1 font-bold">
                <CheckCircle className="h-3.5 w-3.5" />
                سارية
              </Badge>
            )}
            {status === 'ended' && (
              <Badge variant="secondary" className="gap-1">
                منتهية
              </Badge>
            )}
            {isTransferred && (
              <Badge variant="warning" className="gap-1">
                <ArrowRightLeft className="h-3 w-3" />
                محولة{' '}
                {wasTransferredTo && (
                  <span className="font-mono ltr-nums">← {wasTransferredTo}</span>
                )}
              </Badge>
            )}
            {isCancelled && (
              <Badge variant="destructive" className="gap-1">
                <XCircle className="h-3 w-3" />
                ملغاة
              </Badge>
            )}

            {wasTransferredFrom && !isTransferred && (
              <Badge
                variant="outline"
                className="gap-1 text-xs bg-blue-500/10 border-blue-500/30 text-blue-600"
              >
                <ArrowRightLeft className="h-3 w-3" />
                محول من <span className="font-mono ltr-nums">{wasTransferredFrom}</span>
              </Badge>
            )}

            {/* Type chips — for packages show each member separated by + and
                append the باقة chip; for singles just the single type. */}
            {isPkg ? (
              <div className="flex flex-wrap items-center gap-1">
                <Badge
                  className={cn(
                    'border text-xs font-semibold',
                    policyTypeColors[mainPolicy.policy_type_parent] || policyTypeColors.OTHER
                  )}
                >
                  {getTypeDisplayLabel(mainPolicy)}
                </Badge>
                {addons.map((addon) => (
                  <span key={addon.id} className="flex items-center gap-1">
                    <span className="text-muted-foreground text-xs">+</span>
                    <Badge
                      className={cn(
                        'border text-xs',
                        policyTypeColors[addon.policy_type_parent] || policyTypeColors.OTHER
                      )}
                    >
                      {getTypeDisplayLabel(addon)}
                    </Badge>
                  </span>
                ))}
                <Badge
                  variant="outline"
                  className="gap-1 text-xs bg-primary/5 border-primary/20 text-primary mr-1"
                >
                  <Zap className="h-3 w-3" />
                  باقة
                </Badge>
              </div>
            ) : (
              <Badge
                className={cn(
                  'border text-xs font-semibold',
                  policyTypeColors[mainPolicy.policy_type_parent] || policyTypeColors.OTHER
                )}
              >
                {getTypeDisplayLabel(mainPolicy)}
              </Badge>
            )}

            {createdRecently && (
              <Badge
                variant="outline"
                className="gap-1 text-xs bg-emerald-500/10 border-emerald-500/30 text-emerald-600"
              >
                <Zap className="h-3 w-3" />
                جديدة
              </Badge>
            )}

            {brokerPolicy && brokerPolicy.broker && brokerDirectionLabel && (
              <Badge
                variant="outline"
                className="gap-1 text-xs bg-amber-500/10 border-amber-500/30 text-amber-700"
                title={`${brokerDirectionLabel}: ${brokerPolicy.broker.name}`}
              >
                <Handshake className="h-3 w-3" />
                {brokerDirectionLabel}: {brokerPolicy.broker.name}
              </Badge>
            )}

            {/* For singles we surface a Files button so customers can still
                open attachments; packages push file chips down into the
                component rows instead. */}
            {!isPkg && files.length > 0 && (
              <button
                type="button"
                onClick={() =>
                  openFileGallery(
                    files,
                    `${getTypeDisplayLabel(mainPolicy)} ${mainPolicy.policy_number || ''}`.trim()
                  )
                }
                className="inline-flex items-center gap-1.5 text-xs font-medium text-primary bg-primary/10 hover:bg-primary/20 border border-primary/30 rounded-full px-2.5 py-0.5 transition-colors"
              >
                <Paperclip className="h-3 w-3" />
                {files.length} ملف
              </button>
            )}
          </div>

          {/* Main info grid — الشركة / السيارة / الفترة / المبلغ */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div className="flex items-start gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">الشركة</p>
                <p
                  className={cn(
                    'font-medium truncate',
                    !isActive && 'text-muted-foreground'
                  )}
                >
                  {mainPolicy.company?.name_ar || mainPolicy.company?.name || '-'}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2">
              <Car className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">السيارة</p>
                <p
                  className={cn(
                    'font-mono font-medium ltr-nums',
                    !isActive && 'text-muted-foreground'
                  )}
                >
                  {mainPolicy.car?.car_number || '-'}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">الفترة</p>
                <p
                  className={cn(
                    'font-medium text-xs',
                    !isActive && 'text-muted-foreground'
                  )}
                >
                  <span className="ltr-nums">{formatDate(mainPolicy.start_date)}</span>
                  <span className="mx-1 text-muted-foreground">←</span>
                  <span className="ltr-nums">{formatDate(mainPolicy.end_date)}</span>
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2 justify-end">
              <div className="flex flex-col items-start leading-tight">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wide">المبلغ</span>
                <span
                  className={cn(
                    'text-lg font-bold ltr-nums',
                    isActive ? 'text-primary' : 'text-muted-foreground'
                  )}
                >
                  ₪{totalPrice.toLocaleString('en-US')}
                </span>
                {totalCommission > 0 && (
                  <span className="text-[9px] text-amber-700 font-semibold ltr-nums mt-0.5">
                    منها ₪{totalCommission.toLocaleString('en-US')} عمولة مكتب
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Package components table — only for packages */}
          {isPkg && (
            <div className="mt-3 pt-3 border-t border-border/50">
              <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5" />
                مكونات الباقة
              </div>
              <div className="rounded-lg border border-border/60 overflow-hidden bg-muted/20">
                <div className="grid grid-cols-[2rem_1fr_auto_auto] items-center gap-3 px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide bg-muted/40 border-b border-border/60">
                  <span className="text-center">#</span>
                  <span>المعاملة</span>
                  <span className="ltr-nums">الفترة</span>
                  <span className="text-left min-w-[70px]">السعر</span>
                </div>
                {renderComponentRow(mainPolicy, 1, isActive)}
                {addons.map((addon, i) => renderComponentRow(addon, i + 2, isActive))}
                <div className="flex items-start justify-end gap-6 px-3 py-2 border-t border-border/60 bg-muted/30 text-right">
                  <div className="flex flex-col text-xs items-end text-left">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wide">المدفوع</span>
                    <span className="font-bold text-success ltr-nums">
                      ₪{totalPaid.toLocaleString('en-US')}
                    </span>
                  </div>
                  <div className="flex flex-col text-xs items-end text-left">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wide">المتبقي للدفع</span>
                    <span
                      className={cn(
                        'font-bold ltr-nums',
                        totalRemaining > 0 ? 'text-destructive' : 'text-success'
                      )}
                    >
                      ₪{totalRemaining.toLocaleString('en-US')}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Standalone totals footer — same framed summary on single-policy
              cards so every card surfaces paid/remaining in the same place. */}
          {!isPkg && isActive && (
            <div className="mt-3 pt-3 border-t border-border/50">
              <div className="rounded-lg border border-border/60 bg-muted/20 overflow-hidden">
                <div className="flex items-start justify-end gap-6 px-3 py-2 text-right">
                  <div className="flex flex-col text-xs items-end text-left">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wide">المدفوع</span>
                    <span className="font-bold text-success ltr-nums">
                      ₪{totalPaid.toLocaleString('en-US')}
                    </span>
                  </div>
                  <div className="flex flex-col text-xs items-end text-left">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wide">المتبقي للدفع</span>
                    <span
                      className={cn(
                        'font-bold ltr-nums',
                        totalRemaining > 0 ? 'text-destructive' : 'text-success'
                      )}
                    >
                      ₪{totalRemaining.toLocaleString('en-US')}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Extra drivers */}
          {drivers.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border/50">
              <div className="flex items-start gap-2">
                <Users className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="flex flex-wrap gap-1.5">
                  {drivers.map((d) => (
                    <Badge
                      key={d.child_id}
                      variant="secondary"
                      className="text-xs font-normal px-2 py-1"
                    >
                      {d.full_name}
                      {d.relation ? ` • ${d.relation}` : ''}
                      {d.birth_date ? ` • ${formatDate(d.birth_date)}` : ''}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Notes — from the main policy (packages surface addon notes
              inline on their component rows elsewhere in the app, but the
              report uses the package-level note as the summary). */}
          {mainPolicy.notes && (
            <div className="mt-3 pt-3 border-t border-border/50">
              <div className="flex items-start gap-2">
                <MessageSquare className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">ملاحظات</p>
                  <p className="text-sm text-foreground whitespace-pre-wrap break-words">
                    {mainPolicy.notes}
                  </p>
                </div>
              </div>
            </div>
          )}
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

          {/* Top toolbar: close X + SMS + print all clustered on the visual
              left. dir="ltr" locks the order so they sit left-to-right
              regardless of the RTL page direction. */}
          <div
            dir="ltr"
            className="relative z-10 flex items-center gap-2 px-4 py-3 border-b border-white/10"
          >
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="إغلاق"
              className="flex h-8 w-8 items-center justify-center rounded-md text-white/80 hover:text-white hover:bg-white/10 transition focus:outline-none focus:ring-2 focus:ring-white/40"
            >
              <X className="h-4 w-4" />
            </button>
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

          <div className="relative px-4 sm:px-6 py-5">
            <div className="flex items-start gap-3 sm:gap-4 min-w-0">
              <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
                <User className="h-6 w-6 sm:h-7 sm:w-7 text-white" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <h1 className="text-lg sm:text-xl font-bold text-white break-words">{client.full_name}</h1>
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
                <div className="flex items-center gap-x-4 gap-y-1 mt-2 text-white/80 text-sm flex-wrap">
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

            {/* Stats row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-5">
              <HeaderStat label="معاملات سارية" value={`${activePoliciesCount}/${policies.length}`} />
              <HeaderStat label="السيارات" value={cars.length} />
              <HeaderStat label="الدفعات" value={paymentGroups.length} />
              <HeaderStat label="بلاغات حوادث" value={accidents.length} />
            </div>
          </div>
        </div>

        {/* Quick nav — pill tabs sitting between the hero header and the
            scrollable body. Rendered as buttons with visible backgrounds so
            they don't look like a breadcrumb and are obviously tappable. */}
        <div className="border-b bg-background shrink-0 shadow-sm">
          <div className="px-3 sm:px-4 py-2.5 overflow-x-auto scrollbar-thin">
            <nav className="flex gap-2 min-w-max">
              {[
                { id: 'sec-info', label: 'معلومات العميل', icon: User },
                { id: 'sec-money', label: 'الملخص المالي', icon: Wallet },
                { id: 'sec-policies', label: 'السيارات والمعاملات', icon: Car },
                { id: 'sec-payments', label: 'سجل الدفعات', icon: CreditCard },
                { id: 'sec-accidents', label: 'بلاغات الحوادث', icon: ShieldAlert },
                { id: 'sec-refunds', label: 'المرتجعات', icon: Banknote },
                { id: 'sec-notes', label: 'ملاحظات', icon: StickyNote },
              ].map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() =>
                    document
                      .getElementById(tab.id)
                      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-full border bg-muted/40 hover:bg-primary hover:border-primary hover:text-primary-foreground text-foreground/80 transition-colors whitespace-nowrap text-sm font-medium"
                >
                  <tab.icon className="h-4 w-4" />
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-5 space-y-6 sm:space-y-8 bg-muted/20">
          {loadingDetails && (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              جاري تحميل التفاصيل...
            </div>
          )}

          {/* Client info */}
          <Section id="sec-info" icon={User} title="معلومات العميل">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3">
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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <MoneyCard label="إجمالي التأمينات" value={totalInsurance} tone="neutral" />
              <MoneyCard label="المدفوع" value={paymentSummary.total_paid} tone="success" />
              <MoneyCard
                label="المتبقي"
                value={netRemaining}
                tone={netRemaining > 0 ? 'destructive' : 'success'}
              />
              <MoneyCard label="الأرباح" value={paymentSummary.total_profit} tone="primary" />
            </div>
            {walletBalance.total_refunds > 0 && paymentSummary.total_remaining > 0 && (
              <div className="mt-3 flex items-center justify-center gap-2 text-sm bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 rounded-lg p-3 flex-wrap">
                <span className="text-muted-foreground">المطلوب:</span>
                <span className="font-bold ltr-nums">₪{paymentSummary.total_remaining.toLocaleString()}</span>
                <span className="text-muted-foreground">−</span>
                <span className="text-amber-700 dark:text-amber-300">مرتجع للعميل:</span>
                <span className="font-bold text-amber-600 ltr-nums">₪{walletBalance.total_refunds.toLocaleString()}</span>
                <span className="text-muted-foreground">=</span>
                <span className="font-bold text-destructive ltr-nums">₪{netRemaining.toLocaleString()}</span>
              </div>
            )}
          </Section>

          {/* Policies by car */}
          <Section id="sec-policies" icon={Car} title="السيارات والمعاملات" count={policies.length}>
            <div className="space-y-4">
              {cars.map(car => {
                const items = itemsByCar.byCar[car.id] || [];
                return (
                  <div key={car.id} className="rounded-xl border overflow-hidden">
                    <div className="bg-muted/40 p-3 sm:p-4 flex items-start sm:items-center gap-3 flex-wrap">
                      <div className="bg-yellow-200 border-2 border-foreground rounded-md px-2.5 py-1 shrink-0">
                        <span className="font-mono font-bold text-base ltr-nums">{car.car_number}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-base truncate">
                          {[car.manufacturer_name, car.model, car.year].filter(Boolean).join(' ') || 'بدون تفاصيل'}
                        </p>
                        <div className="flex items-center gap-x-4 gap-y-1 text-xs text-muted-foreground flex-wrap mt-1">
                          {car.car_type && <span>{carTypeLabels[car.car_type] || car.car_type}</span>}
                          {car.color && (
                            <span className="flex items-center gap-1">
                              <Palette className="h-3.5 w-3.5" />
                              {car.color}
                            </span>
                          )}
                          {car.car_value ? (
                            <span className="ltr-nums">القيمة: ₪{car.car_value.toLocaleString()}</span>
                          ) : null}
                          {car.license_expiry && (
                            <span className="ltr-nums">
                              انتهاء الرخصة: {formatDate(car.license_expiry)}
                            </span>
                          )}
                        </div>
                      </div>
                      <Badge variant="secondary" className="text-xs shrink-0">
                        {items.length} {items.length === 1 ? 'بند' : 'بنود'}
                      </Badge>
                    </div>
                    <div className="p-3 sm:p-4 space-y-3">
                      {items.length === 0 ? (
                        <p className="text-center text-sm text-muted-foreground py-2">لا توجد معاملات</p>
                      ) : (
                        items.map(renderPolicyCard)
                      )}
                    </div>
                  </div>
                );
              })}

              {itemsByCar.noCar.length > 0 && (
                <div className="rounded-xl border overflow-hidden">
                  <div className="bg-muted/40 p-3 sm:p-4">
                    <p className="font-semibold text-base">معاملات أخرى (بدون سيارة)</p>
                  </div>
                  <div className="p-3 sm:p-4 space-y-3">{itemsByCar.noCar.map(renderPolicyCard)}</div>
                </div>
              )}

              {policies.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-8">لا توجد معاملات لهذا العميل</p>
              )}
            </div>
          </Section>

          {/* Payment history */}
          <Section id="sec-payments" icon={CreditCard} title="سجل الدفعات" count={paymentGroups.length}>
            {paymentGroups.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-4">لا توجد دفعات مسجلة</p>
            ) : (
              <div className="rounded-xl border divide-y overflow-hidden">
                {paymentGroups.map(group => {
                  const anyRefused = group.statuses.includes('refused');
                  return (
                    <div
                      key={group.id}
                      className="flex items-center justify-between gap-3 p-3 sm:p-4 flex-wrap"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div
                          className={cn(
                            'h-10 w-10 rounded-lg flex items-center justify-center shrink-0',
                            anyRefused
                              ? 'bg-destructive/10 text-destructive'
                              : 'bg-success/10 text-success'
                          )}
                        >
                          <CreditCard className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold ltr-nums text-sm">
                            {formatDate(group.payment_date)}
                          </p>
                          <div className="flex items-center gap-1.5 flex-wrap mt-1">
                            {group.types.map(t => (
                              <Badge key={t} variant="outline" className="text-xs font-normal">
                                {paymentTypeLabels[t] || t}
                              </Badge>
                            ))}
                            {group.items.length > 1 && (
                              <Badge variant="secondary" className="text-xs">
                                {group.items.length} دفعات
                              </Badge>
                            )}
                            {group.chequeNumbers.length > 0 && (
                              <span className="text-xs text-muted-foreground font-mono">
                                #{group.chequeNumbers.join(', ')}
                              </span>
                            )}
                          </div>
                          {group.bankLines.length > 0 && (
                            <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                              {group.bankLines.join(' · ')}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <p className="font-bold text-primary ltr-nums text-base">
                          ₪{group.totalAmount.toLocaleString()}
                        </p>
                        <Badge
                          className={cn(
                            'text-xs',
                            anyRefused
                              ? 'bg-destructive/10 text-destructive border-destructive/20'
                              : 'bg-success/10 text-success border-success/20'
                          )}
                        >
                          {anyRefused ? 'راجع' : 'مقبول'}
                        </Badge>
                      </div>
                    </div>
                  );
                })}
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
                  const statusMeta =
                    accidentStatusLabels[a.status] || { label: a.status, variant: 'secondary' as const };
                  return (
                    <div
                      key={a.id}
                      className="rounded-lg border bg-background p-3 sm:p-4 flex items-center justify-between gap-3 flex-wrap"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-10 w-10 rounded-lg bg-destructive/10 text-destructive flex items-center justify-center shrink-0">
                          <AlertTriangle className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-sm flex items-center gap-2">
                            <span>بلاغ #{a.report_number}</span>
                            {a.car?.car_number && (
                              <span className="text-muted-foreground font-mono ltr-nums text-xs">
                                {a.car.car_number}
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground ltr-nums mt-0.5">
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
                    className="rounded-lg border bg-background p-3 sm:p-4 flex items-center justify-between gap-3 flex-wrap"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-10 w-10 rounded-lg bg-amber-500/10 text-amber-600 flex items-center justify-center shrink-0">
                        <Receipt className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className="text-xs">
                            {refundTypeLabels[r.transaction_type] || r.transaction_type}
                          </Badge>
                          {r.car?.car_number && (
                            <span className="text-xs text-muted-foreground font-mono ltr-nums">
                              {r.car.car_number}
                            </span>
                          )}
                          {r.payment_method && (
                            <span className="text-xs text-muted-foreground">
                              {paymentTypeLabels[r.payment_method] || r.payment_method}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground ltr-nums mt-1">
                          {formatDate(r.refund_date)}
                          {r.description ? ` • ${r.description}` : ''}
                        </p>
                      </div>
                    </div>
                    <p className="font-bold text-amber-600 ltr-nums text-base">
                      ₪{r.amount.toLocaleString()}
                    </p>
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
        'rounded-lg border bg-background px-3 py-2.5',
        warn && 'border-amber-500/30 bg-amber-500/5'
      )}
    >
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className={cn('text-sm font-semibold truncate', mono && 'font-mono ltr-nums')}>
        {value || '-'}
      </p>
    </div>
  );
}

function HeaderStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-white/10 backdrop-blur-sm border border-white/10 px-3 py-2">
      <p className="text-xs text-white/70">{label}</p>
      <p className="text-lg sm:text-xl font-bold text-white ltr-nums">{value}</p>
    </div>
  );
}

function MoneyCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'neutral' | 'success' | 'destructive' | 'primary';
}) {
  const toneClasses = {
    neutral: 'bg-muted/50 border-border text-foreground',
    success: 'bg-success/5 border-success/20 text-success',
    destructive: 'bg-destructive/5 border-destructive/20 text-destructive',
    primary: 'bg-primary/5 border-primary/20 text-primary',
  }[tone];

  return (
    <div className={cn('rounded-xl border p-4', toneClasses)}>
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-xl sm:text-2xl font-bold ltr-nums">₪{value.toLocaleString()}</p>
    </div>
  );
}
