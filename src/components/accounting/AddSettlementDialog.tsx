import { useEffect, useMemo, useState } from 'react';
import { addMonths, format } from 'date-fns';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ArabicDatePicker } from '@/components/ui/arabic-date-picker';
import { Banknote, Copy, CreditCard, FileText, Loader2, Plus, Receipt, Scan, Split, Trash2, Wallet } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useAgentContext } from '@/hooks/useAgentContext';
import { toast } from 'sonner';
import { CustomerChequeSelector, SelectableCheque } from '@/components/shared/CustomerChequeSelector';
import { BankPicker } from '@/components/shared/BankPicker';
import { MultiImagePicker } from '@/components/shared/MultiImagePicker';
import { sanitizeChequeNumber, validateChequeNumber } from '@/lib/chequeUtils';
import { cn } from '@/lib/utils';
import { persistSettlementLines } from './persistSettlementLines';
import { useCompaniesOutstanding, type CompanyOutstanding } from '@/hooks/useCompaniesOutstanding';

export type SettlementMode = 'company' | 'broker' | 'client';
export type SettlementKind = 'disbursement' | 'receipt';
export type PaymentLineType = 'cash' | 'cheque' | 'customer_cheque' | 'bank_transfer' | 'visa';

export interface SettlementEntity {
  id: string;
  name: string;
}

/** Payload returned to the parent when stageOnly is enabled — the parent
 *  is responsible for calling persistSettlementLines at confirm time. */
export interface StagedSettlement {
  lines: PaymentLine[];
  notes: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: SettlementMode;
  kind: SettlementKind;
  defaultEntityId?: string | null;
  /** Required for company / broker modes; ignored on client mode (the
   *  client is identified by defaultEntityId, no picker shown). */
  entities?: SettlementEntity[];
  /** Called after the dialog's Save click resolves. When `stageOnly` is
   *  off, this fires after the DB writes succeed (payload omitted). When
   *  `stageOnly` is on, no DB write happens — the validated lines + notes
   *  are handed back so the caller can persist them later. */
  onSaved: (staged?: StagedSettlement) => void;
  // ── client-mode extras ─────────────────────────────────────────────
  /** Title-bar display name when mode === 'client'. */
  clientName?: string;
  /** Optional link to the policy this disbursement is settling (cancel
   *  or transfer flow). Stored on client_settlements.policy_id and
   *  mirrored through to the receipts row by the AFTER INSERT trigger. */
  policyId?: string | null;
  /** Optional branch override; defaults to inherit-from-agent. */
  branchId?: string | null;
  /** When set, the dialog refuses to save unless the line total equals
   *  this amount. Used by Cancel/Transfer modals to pin the
   *  disbursement to the refund value the user already typed. */
  targetAmount?: number;
  // ── staged mode (cancel / transfer detour) ─────────────────────────
  /** When true, Save validates but does NOT write to the DB. Instead the
   *  validated lines + notes flow back through onSaved so the caller can
   *  commit them atomically alongside the policy update. */
  stageOnly?: boolean;
  /** Seed the form with these lines when the dialog opens. Used by
   *  staged-mode callers to restore a prior in-progress entry so the
   *  agent can edit instead of starting over. */
  initialLines?: PaymentLine[];
  /** Seed the notes textarea on open — companion to initialLines. */
  initialNotes?: string;
  /** Label for the secondary footer button. Defaults to "إلغاء" — the
   *  /receipts AddVoucher wizard overrides this to "رجوع" because the
   *  picker stays mounted behind, so closing this dialog returns the
   *  user to their picks instead of cancelling the whole flow. */
  cancelLabel?: string;
}

export interface PaymentLine {
  id: string;
  payment_type: PaymentLineType;
  amount: number;
  /** Generic payment date — used by cash + bank_transfer. */
  payment_date: string;
  /** New cheque (cheque type) — registry lookup data. */
  cheque_number?: string;
  bank_code?: string | null;
  branch_code?: string | null;
  /** تاريخ الاستحقاق — when the cheque can be cashed. */
  cheque_due_date?: string;
  /** تاريخ الإصدار — when we wrote the cheque / when money left. */
  cheque_issue_date?: string;
  /** Multi-image attachments — first one is mirrored to cheque_image_url
   *  on save for backwards compat with old viewers. */
  cheque_image_urls?: string[];
  /** Bank transfer reference number. */
  bank_reference?: string;
  /** Customer cheque type — picked from the available pool. */
  selected_cheques?: SelectableCheque[];
}

const PAYMENT_TYPE_LABEL: Record<PaymentLineType, string> = {
  cash: 'نقداً',
  cheque: 'شيك جديد',
  customer_cheque: 'شيك عميل',
  bank_transfer: 'تحويل بنكي',
  visa: 'فيزا',
};

const PAYMENT_TYPE_ICON: Record<PaymentLineType, typeof Banknote> = {
  cash: Banknote,
  cheque: FileText,
  customer_cheque: Wallet,
  bank_transfer: Receipt,
  visa: CreditCard,
};

const today = () => format(new Date(), 'yyyy-MM-dd');

function isSeedEmpty(line: PaymentLine): boolean {
  return line.payment_type === 'cash' && Number(line.amount || 0) === 0;
}

function makeLine(type: PaymentLineType): PaymentLine {
  const base: PaymentLine = {
    id: crypto.randomUUID(),
    payment_type: type,
    amount: 0,
    payment_date: today(),
  };
  if (type === 'cheque') {
    base.cheque_due_date = today();
    base.cheque_issue_date = today();
    base.bank_code = null;
    base.branch_code = null;
  }
  return base;
}

const titleFor = (mode: SettlementMode, kind: SettlementKind, clientName?: string): string => {
  if (mode === 'company') {
    return kind === 'disbursement' ? 'إضافة سند صرف لشركة' : 'إضافة سند قبض من شركة';
  }
  if (mode === 'broker') {
    return kind === 'disbursement' ? 'إضافة سند صرف لوسيط' : 'إضافة سند قبض من وسيط';
  }
  // Client mode is always disbursement (incoming client money goes
  // through policy_payments, never this dialog). Show the customer
  // name in the title so the agent confirms the right person.
  return clientName ? `إضافة سند صرف للعميل — ${clientName}` : 'إضافة سند صرف للعميل';
};

export function AddSettlementDialog({
  open,
  onOpenChange,
  mode,
  kind,
  defaultEntityId,
  entities,
  onSaved,
  clientName,
  policyId,
  branchId,
  targetAmount,
  stageOnly,
  initialLines,
  initialNotes,
  cancelLabel = 'إلغاء',
}: Props) {
  const { user } = useAuth();
  const { agentId } = useAgentContext();
  const [entityId, setEntityId] = useState<string>(defaultEntityId ?? '');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<PaymentLine[]>([makeLine('cash')]);
  const [saving, setSaving] = useState(false);
  // تقسيط — split a single amount into N lines spaced monthly.
  // The user picks the line type (cash/cheque/customer_cheque/bank_transfer/visa).
  const [splitAmount, setSplitAmount] = useState('');
  const [splitCount, setSplitCount] = useState(2);
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitType, setSplitType] = useState<PaymentLineType>('cheque');
  // Lazy-loaded cheque scanner — keeps the dialog bundle small.
  const [scannerOpen, setScannerOpen] = useState(false);
  const [ScannerComp, setScannerComp] = useState<React.ComponentType<{
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: (cheques: ScannedCheque[]) => void;
    title?: string;
  }> | null>(null);

  // Broker balance — only fetched when mode='broker' so the dialog
  // can surface the two-sided summary (broker owes us / we owe
  // broker) the user wants to see before recording a سند قبض or
  // سند صرف. Same math BrokersSection uses for its pills.
  const [brokerBalance, setBrokerBalance] = useState<{
    owesUs: number;
    weOwe: number;
  } | null>(null);

  // Company balance — the agent always owes companies (one-directional
  // relationship), so we just surface the breakdown the receipts
  // picker also shows. Pulled from the shared hook so the same
  // numbers reconcile across surfaces.
  const { outstandingByCompany } = useCompaniesOutstanding();
  const companyBalance: CompanyOutstanding | null =
    mode === 'company' && entityId
      ? outstandingByCompany.get(entityId) ?? null
      : null;

  useEffect(() => {
    if (mode !== 'broker' || !entityId) {
      setBrokerBalance(null);
      return;
    }
    let cancelled = false;
    (async () => {
      // Three parallel queries: every policy on this broker (gross
      // debt on each side), every broker_settlements row (cash
      // movements), and every broker إشعار مدين (paper credits the
      // office issued to write down what the broker still owes us).
      const [
        { data: policies },
        { data: settlements },
        { data: brokerCreditNotes },
      ] = await Promise.all([
        supabase
          .from('policies')
          .select('insurance_price, broker_buy_price, broker_direction, cancelled, transferred')
          .eq('broker_id', entityId)
          .is('deleted_at', null),
        supabase
          .from('broker_settlements')
          .select('total_amount, direction, refused')
          .eq('broker_id', entityId),
        supabase
          .from('receipts')
          .select('amount, cancelled_at')
          .eq('broker_id', entityId)
          .eq('receipt_type', 'credit_note'),
      ]);
      if (cancelled) return;

      // to_broker: broker sold our policy → owes us the insurance_price.
      //   Cancelled / transferred policies drop out — the obligation
      //   was reversed.
      // from_broker: broker brought us a customer → we owe broker the
      //   agreed buy price (broker_buy_price). Cancelled drops out
      //   for the same reason.
      const toBrokerGross = (policies ?? [])
        .filter(
          (p: any) =>
            p.broker_direction === 'to_broker' && !p.cancelled && !p.transferred,
        )
        .reduce((s: number, p: any) => s + Number(p.insurance_price || 0), 0);
      const fromBrokerGross = (policies ?? [])
        .filter(
          (p: any) =>
            p.broker_direction === 'from_broker' && !p.cancelled && !p.transferred,
        )
        .reduce((s: number, p: any) => s + Number(p.broker_buy_price || 0), 0);

      const collectedFromBroker = (settlements ?? [])
        .filter((s: any) => s.direction === 'broker_owes' && !s.refused)
        .reduce((s: number, x: any) => s + Number(x.total_amount || 0), 0);
      const paidToBroker = (settlements ?? [])
        .filter((s: any) => s.direction === 'we_owe' && !s.refused)
        .reduce((s: number, x: any) => s + Number(x.total_amount || 0), 0);

      // إشعار مدين للوسيط — paper credit. Per the user's
      // accounting model these write down what the broker still
      // owes us; the relationship is one-sided (only reduces the
      // owesUs side, never adds to weOwe).
      const brokerCreditNotesSum = (brokerCreditNotes ?? [])
        .filter((r: any) => !r.cancelled_at)
        .reduce((s: number, r: any) => s + Number(r.amount || 0), 0);

      setBrokerBalance({
        owesUs: Math.max(0, toBrokerGross - collectedFromBroker - brokerCreditNotesSum),
        weOwe: Math.max(0, fromBrokerGross - paidToBroker),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, entityId]);

  // Reset whenever the dialog opens or mode/kind changes underneath.
  // Staged callers (cancel/transfer) can hand us initialLines+initialNotes
  // so reopening preserves the prior entry instead of starting fresh.
  // initialLines/initialNotes deliberately stay out of the deps array —
  // they're a seed for the open transition, not a live binding.
  useEffect(() => {
    if (!open) return;
    setEntityId(defaultEntityId ?? '');
    setNotes(initialNotes ?? '');
    setLines(
      initialLines && initialLines.length > 0
        ? initialLines.map((l) => ({ ...l }))
        : [makeLine('cash')],
    );
    setSplitAmount('');
    setSplitCount(2);
    setSplitType('cheque');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultEntityId, mode, kind]);

  const total = useMemo(
    () =>
      lines.reduce((s, l) => {
        if (l.payment_type === 'customer_cheque' && l.selected_cheques) {
          return s + l.selected_cheques.reduce((a, c) => a + Number(c.amount || 0), 0);
        }
        return s + Number(l.amount || 0);
      }, 0),
    [lines],
  );

  // Pre-flight target-amount check. Mirrors the rule handleSave
  // enforces, but exposes it to the UI up-front so the save button
  // and the total bar can reflect the state without waiting for a
  // click. Only meaningful in client mode with a non-zero target.
  const targetCap = typeof targetAmount === 'number' && targetAmount > 0 ? targetAmount : null;
  const targetMismatch =
    mode === 'client' &&
    targetCap !== null &&
    Math.round(total * 100) !== Math.round(targetCap * 100);
  const targetExceeded =
    mode === 'client' && targetCap !== null && total > targetCap + 0.005;

  // Broker cap — the relevant pill amount is the hard ceiling. On a
  // سند قبض the user can't collect more than the broker still owes
  // us; on a سند صرف they can't pay out more than we owe the broker.
  // When the relevant side is zero the dialog refuses to save at all
  // (no balance → no voucher to record). brokerBalance is null until
  // the fetch resolves, so caps are NULL during the loading window —
  // the user can't trigger save anyway until they enter an amount.
  const brokerCap =
    mode === 'broker' && brokerBalance
      ? kind === 'receipt'
        ? brokerBalance.owesUs
        : brokerBalance.weOwe
      : null;
  const brokerCapExceeded =
    mode === 'broker' && brokerCap !== null && total > brokerCap + 0.005;
  const brokerCapZero =
    mode === 'broker' && brokerCap !== null && brokerCap <= 0.005 && total > 0;

  // Per-line validation surfaced up-front so the Save button stays
  // disabled until every started line is complete. Lines that look
  // like an untouched placeholder (no amount, no cheque number, no
  // bank, no customer cheques) are ignored — same filter handleSave
  // uses to drop empty rows before persisting.
  const effectiveLinesForValidation = lines.filter((line) => {
    if (line.payment_type === 'customer_cheque') {
      return (line.selected_cheques?.length ?? 0) > 0;
    }
    if (line.payment_type === 'cheque') {
      return (
        (line.amount ?? 0) > 0 ||
        !!(line.cheque_number && line.cheque_number.length > 0) ||
        !!line.bank_code
      );
    }
    return Number(line.amount || 0) > 0;
  });
  const getLineError = (line: PaymentLine): string | null => {
    if (line.payment_type === 'customer_cheque') {
      if ((line.selected_cheques?.length ?? 0) === 0) {
        return 'اختر شيك عميل واحد على الأقل';
      }
      return null;
    }
    if (!(Number(line.amount) > 0)) return 'المبلغ مطلوب';
    if (line.payment_type === 'cheque') {
      const v = validateChequeNumber(line.cheque_number ?? '');
      if (!v.isValid) return v.error ?? 'رقم الشيك غير صحيح';
      if (!line.bank_code) return 'اختر البنك';
      if (!line.cheque_due_date) return 'تاريخ الاستحقاق مطلوب';
      if (!line.cheque_issue_date) return 'تاريخ الإصدار مطلوب';
    }
    if (line.payment_type === 'bank_transfer') {
      if (!line.payment_date) return 'تاريخ التحويل مطلوب';
    }
    return null;
  };
  const firstLineError =
    effectiveLinesForValidation.length === 0
      ? 'أضف دفعة واحدة على الأقل'
      : (effectiveLinesForValidation
          .map((l) => getLineError(l))
          .find((e): e is string => e !== null) ?? null);
  const linesIncomplete = firstLineError !== null;

  const updateLine = (id: string, patch: Partial<PaymentLine>) =>
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const removeLine = (id: string) =>
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((l) => l.id !== id)));

  // Clone — copy editable fields, drop attachments (cheque_image_urls
  // belongs to a specific physical cheque) and selected_cheques (each
  // customer-cheque can only sit in one settlement, so the picker on
  // the new card opens empty for a fresh selection).
  const duplicateLine = (id: string) =>
    setLines((prev) => {
      const source = prev.find((l) => l.id === id);
      if (!source) return prev;
      return [
        ...prev,
        {
          ...source,
          id: crypto.randomUUID(),
          cheque_image_urls: undefined,
          selected_cheques: undefined,
        },
      ];
    });

  // Drop the seeded empty cash line when the user adds a different
  // payment — otherwise the dialog would keep that placeholder row
  // alongside whatever they actually wanted, forcing them to delete it.
  const addLineOfType = (t: PaymentLineType) =>
    setLines((prev) => {
      const stripped =
        prev.length === 1 && isSeedEmpty(prev[0]) ? [] : prev;
      return [...stripped, makeLine(t)];
    });

  // تقسيط — N equal lines of the chosen type spaced monthly. For
  // cheque lines we set issue=today and due=month i+1 (matching wallet).
  // For non-cheque lines we set payment_date=month i+1 — first installment
  // is one month out, mirroring how postdated cheques are scheduled.
  const handleSplit = () => {
    const amount = parseFloat(splitAmount);
    const count = Math.max(2, Math.min(24, Math.floor(splitCount)));
    if (!amount || amount <= 0) {
      toast.error('أدخل مبلغ التقسيط');
      return;
    }
    const per = Math.round((amount / count) * 100) / 100;
    const issued = today();
    const next = Array.from({ length: count }).map((_, i) => {
      const monthly = format(addMonths(new Date(), i + 1), 'yyyy-MM-dd');
      const base = makeLine(splitType);
      if (splitType === 'cheque') {
        return {
          ...base,
          amount: per,
          cheque_issue_date: issued,
          cheque_due_date: monthly,
        };
      }
      return {
        ...base,
        amount: per,
        payment_date: monthly,
      };
    });
    setLines((prev) => {
      const stripped = prev.length === 1 && isSeedEmpty(prev[0]) ? [] : prev;
      return [...stripped, ...next];
    });
    setSplitAmount('');
    setSplitCount(2);
    setSplitOpen(false);
    toast.success(`أُضيفت ${count} دفعات`);
  };

  const openScanner = async () => {
    if (!ScannerComp) {
      const mod = await import('@/components/payments/ChequeScannerDialog');
      setScannerComp(() => mod.ChequeScannerDialog);
    }
    setScannerOpen(true);
  };

  const handleScannedCheques = (scanned: ScannedCheque[]) => {
    if (!scanned.length) return;
    const issued = today();
    const next = scanned.map((c) => ({
      ...makeLine('cheque'),
      amount: Number(c.amount || 0),
      cheque_number: c.cheque_number ? sanitizeChequeNumber(c.cheque_number) : undefined,
      cheque_due_date: c.payment_date || today(),
      cheque_issue_date: issued,
      cheque_image_urls: c.image_url ? [c.image_url] : [],
      branch_code: c.branch_number || null,
    }));
    setLines((prev) => {
      const stripped = prev.length === 1 && isSeedEmpty(prev[0]) ? [] : prev;
      return [...stripped, ...next];
    });
    toast.success(`أُضيفت ${scanned.length} شيكات من الماسح`);
  };

  const handleSave = async () => {
    if (!entityId) {
      toast.error(
        mode === 'company'
          ? 'الرجاء اختيار شركة'
          : mode === 'broker'
            ? 'الرجاء اختيار وسيط'
            : 'العميل غير محدد',
      );
      return;
    }
    // When the caller pinned a target amount (cancel/transfer refund
    // scenarios), the line total must match it before save. Rounding
    // to 2 decimals so the comparison ignores floating-point dust.
    if (mode === 'client' && typeof targetAmount === 'number' && targetAmount > 0) {
      const totalRounded = Math.round(total * 100) / 100;
      const targetRounded = Math.round(targetAmount * 100) / 100;
      if (totalRounded !== targetRounded) {
        toast.error(
          `المجموع ₪${totalRounded.toLocaleString('en-US')} لا يساوي المبلغ المطلوب ₪${targetRounded.toLocaleString('en-US')}`,
        );
        return;
      }
    }
    // Silently drop empty placeholder lines — the dialog seeds with an
    // empty cash row, and quick-add buttons stack more empty rows when
    // staff are deciding what to add. A line counts as empty when:
    //   - cash / bank_transfer: amount <= 0
    //   - cheque: no amount AND no cheque_number AND no bank picked
    //   - customer_cheque: no cheques selected
    const effective = lines.filter((line) => {
      if (line.payment_type === 'customer_cheque') {
        return (line.selected_cheques?.length ?? 0) > 0;
      }
      if (line.payment_type === 'cheque') {
        return (
          (line.amount ?? 0) > 0 ||
          !!(line.cheque_number && line.cheque_number.length > 0) ||
          !!line.bank_code
        );
      }
      return Number(line.amount || 0) > 0;
    });
    if (effective.length === 0) {
      toast.error('أضف دفعة واحدة على الأقل');
      return;
    }
    // Validate only the lines we'll actually save.
    for (const line of effective) {
      if (line.payment_type === 'cheque') {
        const v = validateChequeNumber(line.cheque_number ?? '');
        if (!v.isValid) {
          toast.error(v.error ?? 'رقم الشيك غير صحيح');
          return;
        }
        if (!line.bank_code) {
          toast.error('اختر البنك للشيك');
          return;
        }
        if (!(line.amount > 0)) {
          toast.error('أدخل مبلغ الشيك');
          return;
        }
        // Cross-surface dup guard — even if the user dismissed the
        // auto-switch popup, we still refuse to write a cheque whose
        // (number + bank) already exists somewhere else.
        const dup = await findExistingCheque(line.cheque_number ?? '', line.bank_code ?? null);
        if (dup) {
          toast.error(`لا يمكن حفظ شيك مكرر — موجود مسبقاً: ${dup.description}`);
          return;
        }
      }
      if (line.payment_type !== 'customer_cheque' && !(line.amount > 0)) {
        toast.error('المبلغ يجب أن يكون أكبر من صفر');
        return;
      }
    }

    setSaving(true);
    try {
      if (stageOnly) {
        // Staged callers (cancel/transfer) need the validated payload
        // back so they can persist it atomically alongside the policy
        // update — no DB write happens here.
        onSaved({ lines: effective, notes });
        onOpenChange(false);
      } else {
        // Resolve the entity's display name from the entities prop
        // (broker/company modes) or the clientName prop (client mode).
        // persistSettlementLines uses it for the broker mirror's
        // receipts.client_name column, so /receipts shows "كريم
        // السمان" instead of a UUID in the customer column.
        const entityName =
          mode === 'client'
            ? clientName ?? null
            : entities?.find((e) => e.id === entityId)?.name ?? null;
        await persistSettlementLines({
          mode,
          kind,
          entityId,
          entityName,
          policyId,
          branchId,
          effective,
          notes,
          userId: user?.id ?? null,
          agentId: agentId ?? null,
        });
        toast.success('تم الحفظ');
        onSaved();
        onOpenChange(false);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'فشل الحفظ';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
        <DialogContent dir="rtl" className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{titleFor(mode, kind, clientName)}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Entity picker — hidden in client mode since the customer
                is already pinned via defaultEntityId from the cancel /
                transfer flow that opened the dialog. Showing a fake
                disabled picker would just add visual noise. */}
            {mode !== 'client' && (
              <div className="space-y-1.5">
                <Label className="text-xs">{mode === 'company' ? 'الشركة' : 'الوسيط'}</Label>
                <Select value={entityId} onValueChange={setEntityId}>
                  <SelectTrigger>
                    <SelectValue placeholder={mode === 'company' ? 'اختر شركة' : 'اختر وسيط'} />
                  </SelectTrigger>
                  <SelectContent>
                    {(entities ?? []).map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* In client mode, surface the target amount the cancel /
                transfer modal handed us so the agent has a constant
                reminder of what the sum must equal. */}
            {mode === 'client' && typeof targetAmount === 'number' && targetAmount > 0 && (
              <div className="flex items-center justify-between rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
                <span className="text-muted-foreground">المطلوب صرفه</span>
                <span className="font-semibold ltr-nums">
                  ₪{targetAmount.toLocaleString('en-US')}
                </span>
              </div>
            )}

            {/* Broker balance summary — two pills showing both
                directions of the running ledger:
                  • بدنا منه: what the broker still owes us from
                    to_broker policies (he sold our books) minus سند
                    قبض already collected
                  • بده مني: what we still owe the broker from
                    from_broker policies (he brought us customers)
                    minus سند صرف already paid out
                Both are independent — a broker can be owing us on
                one set of policies and owed money on another. Always
                shown when mode='broker' so the agent has the same
                situational awareness regardless of which voucher
                they're entering. */}
            {mode === 'broker' && brokerBalance && (
              <div className="grid grid-cols-2 gap-2">
                <div
                  className={cn(
                    'rounded-lg border p-3 transition-colors',
                    kind === 'receipt'
                      ? 'border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/20 ring-1 ring-emerald-500/30'
                      : 'border-border bg-muted/20',
                  )}
                >
                  <div className="text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold mb-1">
                    بدنا منه (الوسيط)
                  </div>
                  <div className="text-lg font-bold text-emerald-800 dark:text-emerald-300 tabular-nums">
                    ₪{Math.round(brokerBalance.owesUs).toLocaleString('en-US')}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    من معاملات الوسيط بعد خصم السنود المقبوضة
                  </div>
                </div>
                <div
                  className={cn(
                    'rounded-lg border p-3 transition-colors',
                    kind === 'disbursement'
                      ? 'border-amber-500/40 bg-amber-50 dark:bg-amber-950/20 ring-1 ring-amber-500/30'
                      : 'border-border bg-muted/20',
                  )}
                >
                  <div className="text-[10px] text-amber-700 dark:text-amber-400 font-semibold mb-1">
                    بده مني (للمكتب)
                  </div>
                  <div className="text-lg font-bold text-amber-800 dark:text-amber-300 tabular-nums">
                    ₪{Math.round(brokerBalance.weOwe).toLocaleString('en-US')}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    سعر شراء معاملات الوسيط بعد خصم سندات الصرف
                  </div>
                </div>
              </div>
            )}

            {/* Company balance — single-direction (agent owes the
                insurance company) so we surface the running-account
                breakdown rather than the bidirectional broker pills.
                The chosen voucher kind ring-highlights the row that
                will change: a سند صرف reduces المستحق, a سند قبض
                increases the المستلم column (rare — company refunding
                the agent). */}
            {mode === 'company' && companyBalance && (
              <div
                className={cn(
                  'rounded-lg border p-3 space-y-2',
                  kind === 'disbursement'
                    ? 'border-rose-500/40 bg-rose-50 dark:bg-rose-950/20 ring-1 ring-rose-500/30'
                    : 'border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/20 ring-1 ring-emerald-500/30',
                )}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[11px] font-semibold text-muted-foreground">
                    المستحق للشركة
                  </span>
                  <span
                    className={cn(
                      'text-lg font-bold tabular-nums',
                      companyBalance.outstanding > 0
                        ? 'text-rose-700 dark:text-rose-300'
                        : companyBalance.outstanding < 0
                          ? 'text-emerald-700 dark:text-emerald-300'
                          : 'text-muted-foreground',
                    )}
                  >
                    {companyBalance.outstanding < 0
                      ? `للشركة عندك ₪${Math.round(Math.abs(companyBalance.outstanding)).toLocaleString('en-US')}`
                      : `₪${Math.round(companyBalance.outstanding).toLocaleString('en-US')}`}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10.5px] text-muted-foreground tabular-nums">
                  <span>
                    إجمالي المستحق من البوليصات:
                    {' '}₪{Math.round(companyBalance.totalPayable).toLocaleString('en-US')}
                    {' '}({companyBalance.policiesCount} بوليصة)
                  </span>
                  <span>
                    إشعارات دائنة: ₪{Math.round(companyBalance.totalCreditNotes).toLocaleString('en-US')}
                  </span>
                  <span>
                    سندات الصرف: ₪{Math.round(companyBalance.totalPaidOut).toLocaleString('en-US')}
                  </span>
                  <span>
                    سندات القبض: ₪{Math.round(companyBalance.totalPaidIn).toLocaleString('en-US')}
                  </span>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs">الوصف / ملاحظات</Label>
              <Textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="وصف السند..."
              />
            </div>

            {/* Toolbar — type-specific quick adds + split + scanner.
                'customer_cheque' is only meaningful for OUTGOING
                payments (we hand a cheque the customer gave us to a
                broker/company/etc). On سند قبض (kind='receipt') it
                doesn't apply — the counterparty wouldn't pay us with
                cheques we already hold. Hide it on that side. */}
            <div className="space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="text-sm font-semibold">الدفعات</span>
                <div className="flex items-center gap-2 flex-wrap">
                  <QuickAddButton type="cash" onClick={() => addLineOfType('cash')} />
                  <QuickAddButton type="cheque" onClick={() => addLineOfType('cheque')} />
                  {kind === 'disbursement' && (
                    <QuickAddButton type="customer_cheque" onClick={() => addLineOfType('customer_cheque')} />
                  )}
                  <QuickAddButton type="bank_transfer" onClick={() => addLineOfType('bank_transfer')} />
                  <QuickAddButton type="visa" onClick={() => addLineOfType('visa')} />
                  <Popover open={splitOpen} onOpenChange={setSplitOpen}>
                    <PopoverTrigger asChild>
                      <Button type="button" variant="outline" size="sm" className="gap-1.5">
                        <Split className="h-3.5 w-3.5" />
                        تقسيط
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent dir="rtl" className="w-72 space-y-3" align="end">
                      <div className="space-y-1.5">
                        <Label className="text-xs">نوع الدفعة</Label>
                        <Select
                          value={splitType}
                          onValueChange={(v) => setSplitType(v as PaymentLineType)}
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(Object.keys(PAYMENT_TYPE_LABEL) as PaymentLineType[])
                              .filter((t) => kind === 'disbursement' || t !== 'customer_cheque')
                              .map((t) => (
                                <SelectItem key={t} value={t}>
                                  {PAYMENT_TYPE_LABEL[t]}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">المبلغ الإجمالي</Label>
                        <Input
                          type="number"
                          value={splitAmount}
                          onChange={(e) => setSplitAmount(e.target.value)}
                          placeholder="0"
                          dir="ltr"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">عدد الدفعات</Label>
                        <Input
                          type="number"
                          min={2}
                          max={24}
                          value={splitCount}
                          onChange={(e) => setSplitCount(parseInt(e.target.value) || 2)}
                          dir="ltr"
                        />
                      </div>
                      <Button onClick={handleSplit} className="w-full" size="sm">
                        إنشاء {Math.max(2, Math.min(24, Math.floor(splitCount)))} دفعات
                      </Button>
                    </PopoverContent>
                  </Popover>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={openScanner}
                    className="gap-1.5"
                  >
                    <Scan className="h-3.5 w-3.5" />
                    مسح شيكات
                  </Button>
                </div>
              </div>

              {/* Newest-first display so adding lines pushes prior
                  entries down rather than scrolling the user past
                  what they were just typing. The numeric label stays
                  tied to the original index for stable identity. */}
              {lines
                .map((line, idx) => ({ line, idx }))
                .reverse()
                .map(({ line, idx }) => (
                  <PaymentLineCard
                    key={line.id}
                    index={idx}
                    line={line}
                    onChange={(patch) => updateLine(line.id, patch)}
                    onRemove={lines.length > 1 ? () => removeLine(line.id) : undefined}
                    onDuplicate={() => duplicateLine(line.id)}
                  />
                ))}
            </div>

            <div
              className={cn(
                'flex items-center justify-between rounded-lg px-4 py-2.5',
                targetMismatch || brokerCapExceeded || brokerCapZero
                  ? 'bg-destructive/10 border border-destructive/30'
                  : 'bg-muted',
              )}
            >
              <span className="text-sm font-semibold">إجمالي السند:</span>
              <div className="flex flex-col items-end gap-0.5">
                <span
                  className={cn(
                    'text-lg font-bold tabular-nums',
                    (targetMismatch || brokerCapExceeded || brokerCapZero) && 'text-destructive',
                  )}
                >
                  ₪{total.toLocaleString('en-US')}
                </span>
                {targetMismatch && (
                  <span className="text-[11px] text-destructive font-medium">
                    {targetExceeded
                      ? `يتجاوز المطلوب ₪${targetCap!.toLocaleString('en-US')}`
                      : `أقل من المطلوب ₪${targetCap!.toLocaleString('en-US')}`}
                  </span>
                )}
                {brokerCapExceeded && !brokerCapZero && (
                  <span className="text-[11px] text-destructive font-medium">
                    {kind === 'receipt'
                      ? `يتجاوز ما عليه — أقصى ₪${Math.round(brokerCap!).toLocaleString('en-US')}`
                      : `يتجاوز ما له — أقصى ₪${Math.round(brokerCap!).toLocaleString('en-US')}`}
                  </span>
                )}
                {brokerCapZero && (
                  <span className="text-[11px] text-destructive font-medium">
                    {kind === 'receipt'
                      ? 'الوسيط ما عليه شي — لا يمكن تسجيل سند قبض'
                      : 'ما إله شي عند المكتب — لا يمكن تسجيل سند صرف'}
                  </span>
                )}
              </div>
            </div>

            {/* Inline line-validation hint so the agent sees what's
                blocking save without having to hover the button. Hidden
                when the only issue is target mismatch (already shown
                above) so the warnings don't stack. */}
            {linesIncomplete && !targetMismatch && !brokerCapExceeded && !brokerCapZero && (
              <div className="text-[11px] text-destructive font-medium px-1">
                ⚠ {firstLineError}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              {cancelLabel}
            </Button>
            <Button
              onClick={handleSave}
              disabled={
                saving ||
                targetMismatch ||
                linesIncomplete ||
                brokerCapExceeded ||
                brokerCapZero
              }
              className="gap-2"
              title={
                brokerCapZero
                  ? kind === 'receipt'
                    ? 'الوسيط ما عليه رصيد — لا يمكن تسجيل سند قبض'
                    : 'ما إله رصيد عند المكتب — لا يمكن تسجيل سند صرف'
                  : brokerCapExceeded
                    ? kind === 'receipt'
                      ? `المجموع يتجاوز ما على الوسيط (₪${Math.round(brokerCap!).toLocaleString('en-US')})`
                      : `المجموع يتجاوز ما له عند المكتب (₪${Math.round(brokerCap!).toLocaleString('en-US')})`
                    : targetMismatch
                      ? targetExceeded
                        ? `المجموع يتجاوز المبلغ المطلوب ₪${targetCap!.toLocaleString('en-US')}`
                        : `المجموع أقل من المبلغ المطلوب ₪${targetCap!.toLocaleString('en-US')}`
                      : firstLineError ?? undefined
              }
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {`حفظ (${lines.length})`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {ScannerComp && (
        <ScannerComp
          open={scannerOpen}
          onOpenChange={setScannerOpen}
          onConfirm={(scanned) => {
            handleScannedCheques(scanned);
            setScannerOpen(false);
          }}
          title="مسح شيكات للسند"
        />
      )}
    </>
  );
}

function QuickAddButton({
  type,
  onClick,
}: {
  type: PaymentLineType;
  onClick: () => void;
}) {
  const Icon = PAYMENT_TYPE_ICON[type];
  return (
    <Button type="button" variant="outline" size="sm" onClick={onClick} className="gap-1.5">
      <Plus className="h-3.5 w-3.5" />
      <Icon className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">{PAYMENT_TYPE_LABEL[type]}</span>
    </Button>
  );
}

function PaymentLineCard({
  index,
  line,
  onChange,
  onRemove,
  onDuplicate,
}: {
  index: number;
  line: PaymentLine;
  onChange: (patch: Partial<PaymentLine>) => void;
  onRemove?: () => void;
  onDuplicate?: () => void;
}) {
  const Icon = PAYMENT_TYPE_ICON[line.payment_type];
  return (
    <Card className="p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold text-muted-foreground">
            دفعة {index + 1} · {PAYMENT_TYPE_LABEL[line.payment_type]}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          {onDuplicate && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-primary hover:bg-primary/10"
              onClick={onDuplicate}
              aria-label="تكرار الدفعة"
              title="تكرار الدفعة"
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
          )}
          {onRemove && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onRemove} aria-label="حذف الدفعة">
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          )}
        </div>
      </div>

      {/* CASH + BANK_TRANSFER row layout. Source order: payment_type
          select → date → amount. RTL flex puts payment_type first
          (rightmost — physical-right), as the user requested. We keep
          the type select even though the line was created via the
          quick-add button, so a typo can be corrected without removing
          and re-adding. */}
      {(line.payment_type === 'cash' || line.payment_type === 'bank_transfer' || line.payment_type === 'visa') && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-[11px]">طريقة الدفع</Label>
            <Select
              value={line.payment_type}
              onValueChange={(v) => {
                // Switching INTO cheque from a non-cheque type leaves
                // cheque_due_date / cheque_issue_date undefined (the
                // current line was seeded as cash). Default both to
                // today so the agent doesn't open empty pickers and
                // has to remember to fill them just to save. Mirror
                // for customer_cheque so the selector card opens
                // ready to pick.
                const newType = v as PaymentLineType;
                const patch: Partial<PaymentLine> = { payment_type: newType };
                if (newType === 'cheque') {
                  if (!line.cheque_due_date) patch.cheque_due_date = today();
                  if (!line.cheque_issue_date) patch.cheque_issue_date = today();
                  if (line.bank_code === undefined) patch.bank_code = null;
                  if (line.branch_code === undefined) patch.branch_code = null;
                }
                onChange(patch);
              }}
            >
              <SelectTrigger className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PAYMENT_TYPE_LABEL) as PaymentLineType[]).map((t) => (
                  <SelectItem key={t} value={t}>
                    {PAYMENT_TYPE_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[11px]">التاريخ</Label>
            <ArabicDatePicker
              value={line.payment_date}
              onChange={(v) => onChange({ payment_date: v ?? '' })}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[11px]">المبلغ</Label>
            <Input
              type="number"
              value={line.amount || ''}
              onChange={(e) => onChange({ amount: parseFloat(e.target.value) || 0 })}
              placeholder="0"
              dir="ltr"
              className="h-10 tabular-nums"
            />
          </div>

          {line.payment_type === 'bank_transfer' && (
            <div className="md:col-span-3 space-y-1.5">
              <Label className="text-[11px]">رقم المرجع البنكي</Label>
              <Input
                value={line.bank_reference ?? ''}
                onChange={(e) => onChange({ bank_reference: e.target.value })}
                placeholder="رقم الحوالة"
                className="h-10"
                dir="ltr"
              />
            </div>
          )}
        </div>
      )}

      {/* CHEQUE — full chequebook entry. */}
      {line.payment_type === 'cheque' && <ChequeLineEditor line={line} onChange={onChange} />}

      {/* CUSTOMER CHEQUE — picker. */}
      {line.payment_type === 'customer_cheque' && (
        <div className="space-y-2 border-t pt-3">
          <Label className="text-xs">اختر شيكات العميل</Label>
          <CustomerChequeSelector
            selectedCheques={line.selected_cheques ?? []}
            onSelectionChange={(cheques) => {
              const sum = cheques.reduce((s, c) => s + Number(c.amount || 0), 0);
              onChange({ selected_cheques: cheques, amount: sum });
            }}
          />
        </div>
      )}
    </Card>
  );
}

function ChequeLineEditor({
  line,
  onChange,
}: {
  line: PaymentLine;
  onChange: (patch: Partial<PaymentLine>) => void;
}) {
  // Defensive default: any cheque line reaching this editor without
  // dates gets backfilled to today on mount. Covers initialLines from
  // legacy staged data and any other path that bypassed makeLine.
  // Empty-deps so this only runs once per line mount — onChange is
  // intentionally not tracked.
  useEffect(() => {
    const patch: Partial<PaymentLine> = {};
    if (!line.cheque_due_date) patch.cheque_due_date = today();
    if (!line.cheque_issue_date) patch.cheque_issue_date = today();
    if (Object.keys(patch).length > 0) onChange(patch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cross-surface duplicate detection — same query the expense form runs.
  const [duplicate, setDuplicate] = useState<DuplicateMatch | null>(null);
  // Once the user dismisses the auto-switch prompt for a given cheque
  // number we shouldn't keep popping it back up. Tracks the
  // "{number}|{bank}" pair the user already saw the dialog for.
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [switchOpen, setSwitchOpen] = useState(false);
  useEffect(() => {
    // Trigger on cheque number alone — bank is a *narrower* filter,
    // not a precondition. Without this, agents who only typed the
    // number (typical when copying off a paper cheque) never saw the
    // dedup popup at all. We still pass bank_code to findExistingCheque
    // so the search narrows when both are present.
    const num = (line.cheque_number ?? '').trim();
    if (num.length < 4) {
      setDuplicate(null);
      setSwitchOpen(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const found = await findExistingCheque(num, line.bank_code ?? null);
      if (cancelled) return;
      setDuplicate(found);
      // Only auto-open the switch dialog when the duplicate is a
      // customer cheque (policy_payments) — duplicates in any other
      // table can't be "switched to", they just have to be a different
      // cheque. Dismissed pairs are remembered to avoid loops.
      const key = `${line.cheque_number}|${line.bank_code}`;
      if (
        found &&
        found.source === 'policy_payments' &&
        dismissedKey !== key
      ) {
        setSwitchOpen(true);
      } else {
        setSwitchOpen(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [line.cheque_number, line.bank_code, dismissedKey]);

  const acceptSwitch = async () => {
    if (!duplicate || duplicate.source !== 'policy_payments') return;
    const cheque = await loadPolicyPaymentAsCheque(duplicate.recordId);
    if (!cheque) {
      toast.error('تعذر تحميل بيانات الشيك');
      return;
    }
    // Convert the line: customer_cheque type, pre-selected with the
    // matched record. Clear the new-cheque fields since they're no
    // longer relevant.
    onChange({
      payment_type: 'customer_cheque',
      selected_cheques: [cheque],
      amount: cheque.amount,
      cheque_number: undefined,
      bank_code: null,
      branch_code: null,
      cheque_image_urls: [],
      cheque_due_date: undefined,
      cheque_issue_date: undefined,
    });
    setSwitchOpen(false);
    setDuplicate(null);
    toast.success('تم تحويل الدفعة إلى شيك عميل واختيار الشيك');
  };

  const declineSwitch = () => {
    setDismissedKey(`${line.cheque_number}|${line.bank_code}`);
    setSwitchOpen(false);
  };

  // Three equal columns shared by both rows (bank/branch/cheque# and
  // amount/due/issue) so every field on the cheque card renders at the
  // same width — fixes the "البنك is bigger than الفرع" feedback. The
  // image picker hangs off the bottom-left in its own compact slot.
  const gridCls = 'grid grid-cols-1 md:grid-cols-3 gap-3';

  return (
    <div className="space-y-3 border-t pt-3">
      <div className={gridCls}>
        <div className="space-y-1.5 min-w-0">
          <Label className="text-[11px]">البنك</Label>
          <BankPicker
            value={line.bank_code}
            onChange={(c) => onChange({ bank_code: c })}
          />
        </div>
        <div className="space-y-1.5 min-w-0">
          <Label className="text-[11px]">الفرع</Label>
          <Input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            className="h-10 tabular-nums font-mono"
            placeholder="مثال: 305"
            value={line.branch_code ?? ''}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, '');
              onChange({ branch_code: v || null });
            }}
          />
        </div>
        <div className="space-y-1.5 min-w-0">
          <Label className="text-[11px]">رقم الشيك</Label>
          <Input
            value={line.cheque_number ?? ''}
            onChange={(e) => onChange({ cheque_number: sanitizeChequeNumber(e.target.value) })}
            placeholder="12345678"
            inputMode="numeric"
            dir="ltr"
            className={cn(
              'h-10 tabular-nums',
              duplicate && 'border-amber-500 ring-1 ring-amber-200',
            )}
          />
        </div>
      </div>

      {duplicate && (
        <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-1.5 flex items-center justify-between gap-2 flex-wrap">
          <span>⚠ هذا الشيك مسجل مسبقاً في النظام: {duplicate.description}</span>
          {duplicate.source === 'policy_payments' && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              onClick={() => setSwitchOpen(true)}
            >
              تحويل إلى شيك عميل
            </Button>
          )}
        </div>
      )}

      <AlertDialog open={switchOpen} onOpenChange={(v) => (v ? setSwitchOpen(true) : declineSwitch())}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>هذا الشيك موجود مسبقاً</AlertDialogTitle>
            <AlertDialogDescription>
              {duplicate?.description}. هل تريد تحويل هذه الدفعة إلى نوع <strong>شيك عميل</strong>{' '}
              واختيار هذا الشيك مباشرة؟ إذا اخترت <strong>إلغاء</strong> فلن يُسمح بحفظ الشيك بنفس الرقم.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={declineSwitch}>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={acceptSwitch}>تحويل واختيار</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Amount + due date on a 2-col row, issue date drops to its
          own full-width row below. Convention requested by staff:
          تاريخ الاستحقاق دائماً فوق، تاريخ الإصدار تحت. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1.5 min-w-0">
          <Label className="text-[11px]">المبلغ</Label>
          <Input
            type="number"
            value={line.amount || ''}
            onChange={(e) => onChange({ amount: parseFloat(e.target.value) || 0 })}
            placeholder="0"
            dir="ltr"
            className="h-10 tabular-nums"
          />
        </div>
        <div className="space-y-1.5 min-w-0">
          <Label className="text-[11px]">تاريخ الاستحقاق</Label>
          <ArabicDatePicker
            value={line.cheque_due_date ?? ''}
            onChange={(v) => onChange({ cheque_due_date: v ?? '' })}
          />
        </div>
      </div>
      <div className="space-y-1.5 min-w-0">
        <Label className="text-[11px]">تاريخ الإصدار</Label>
        <ArabicDatePicker
          value={line.cheque_issue_date ?? ''}
          onChange={(v) => onChange({ cheque_issue_date: v ?? '' })}
        />
      </div>

      {/* Multi-image picker — agents asked to attach multiple shots
          per cheque (front, back, copies). The single-image path is
          preserved on save by mirroring images[0] into cheque_image_url. */}
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <MultiImagePicker
          value={line.cheque_image_urls ?? []}
          onChange={(urls) => onChange({ cheque_image_urls: urls })}
          entityType="settlement_cheque"
          entityId={line.id}
          label="صور الشيك"
        />
        <span>
          {line.cheque_image_urls && line.cheque_image_urls.length > 0
            ? `${line.cheque_image_urls.length} صور مرفقة`
            : 'صور الشيك (اختياري)'}
        </span>
      </div>
    </div>
  );
}

interface ScannedCheque {
  cheque_number?: string;
  payment_date?: string;
  amount?: number;
  branch_number?: string;
  image_url?: string;
}

type DuplicateSource = 'company_settlements' | 'broker_settlements' | 'expenses' | 'policy_payments';

interface DuplicateMatch {
  description: string;
  source: DuplicateSource;
  recordId: string;
}

/**
 * Cross-surface cheque-duplicate lookup. Returns the source + record id
 * so the caller can offer a "switch to شيك عميل" flow when the match is
 * a customer-cheque (policy_payments). Same scan as ExpensesSection's
 * helper — kept inline so the dialog stays self-contained.
 */
async function findExistingCheque(
  chequeNumber: string,
  bankCode: string | null,
): Promise<DuplicateMatch | null> {
  if (!chequeNumber || chequeNumber.length < 4) return null;
  // When a bank is selected we narrow the search to that bank — same
  // cheque number across two different banks is a legitimate
  // coincidence. When no bank is set we fall back to a number-only
  // match so an in-progress entry still surfaces the duplicate.
  const narrowBank = <T,>(q: T): T =>
    bankCode ? ((q as { eq: (a: string, b: string) => T }).eq('bank_code', bankCode) as T) : q;
  const [{ data: cs }, { data: bs }, { data: ex }, { data: pp }] = await Promise.all([
    narrowBank(
      supabase
        .from('company_settlements')
        .select('id, settlement_date')
        .eq('cheque_number', chequeNumber)
        .limit(1),
    ),
    narrowBank(
      supabase
        .from('broker_settlements')
        .select('id, settlement_date')
        .eq('cheque_number', chequeNumber)
        .limit(1),
    ),
    narrowBank(
      supabase
        .from('expenses')
        .select('id, expense_date')
        .eq('cheque_number', chequeNumber)
        .limit(1),
    ),
    narrowBank(
      supabase
        .from('policy_payments')
        .select('id, payment_date')
        .eq('cheque_number', chequeNumber)
        .limit(1),
    ),
  ]);
  if (cs && cs.length) {
    const row = cs[0] as { id: string; settlement_date: string };
    return { source: 'company_settlements', recordId: row.id, description: `سند صرف شركة بتاريخ ${row.settlement_date}` };
  }
  if (bs && bs.length) {
    const row = bs[0] as { id: string; settlement_date: string };
    return { source: 'broker_settlements', recordId: row.id, description: `سند وسيط بتاريخ ${row.settlement_date}` };
  }
  if (ex && ex.length) {
    const row = ex[0] as { id: string; expense_date: string };
    return { source: 'expenses', recordId: row.id, description: `مصروف بتاريخ ${row.expense_date}` };
  }
  if (pp && pp.length) {
    const row = pp[0] as { id: string; payment_date: string };
    return { source: 'policy_payments', recordId: row.id, description: `دفعة عميل بتاريخ ${row.payment_date}` };
  }
  return null;
}

/**
 * Loads the policy_payment row + joined client/car info needed to build
 * a SelectableCheque, so the auto-switch flow can pre-select the matched
 * customer cheque without making the user pick it from the list.
 */
async function loadPolicyPaymentAsCheque(paymentId: string): Promise<SelectableCheque | null> {
  const { data, error } = await supabase
    .from('policy_payments')
    .select(
      'id, amount, payment_date, cheque_number, cheque_image_url, policy_id, bank_code, branch_code, transferred_to_type, refused, cheque_status, policies(clients(full_name, phone_number), cars(car_number))',
    )
    .eq('id', paymentId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as {
    id: string;
    amount: number | null;
    payment_date: string;
    cheque_number: string | null;
    cheque_image_url: string | null;
    policy_id: string;
    bank_code: string | null;
    branch_code: string | null;
    transferred_to_type: string | null;
    refused: boolean | null;
    cheque_status: string | null;
    policies: {
      clients: { full_name: string; phone_number: string | null } | null;
      cars: { car_number: string | null } | null;
    } | null;
  };
  // Refuse to surface cheques already consumed elsewhere, refused, or
  // explicitly past pending — those would just confuse the auto-switch.
  if (row.transferred_to_type) return null;
  if (row.refused) return null;
  if (row.cheque_status && row.cheque_status !== 'pending') return null;
  return {
    id: row.id,
    amount: Number(row.amount ?? 0),
    payment_date: row.payment_date,
    cheque_number: row.cheque_number,
    cheque_image_url: row.cheque_image_url,
    policy_id: row.policy_id,
    bank_code: row.bank_code,
    branch_code: row.branch_code,
    client_name: row.policies?.clients?.full_name ?? '',
    client_phone: row.policies?.clients?.phone_number ?? null,
    car_number: row.policies?.cars?.car_number ?? null,
  };
}
