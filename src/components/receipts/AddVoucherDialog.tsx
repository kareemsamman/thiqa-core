// ─── AddVoucherDialog ──────────────────────────────────────────
//
// The "إضافة سند" entry-point for the receipts page. A small picker
// modal that walks the user through THREE questions:
//
//   1. What kind of voucher?       (سند قبض / سند صرف / إشعار دائن)
//   2. Whose voucher is it?        (عميل / وسيط / شركة / آخر)
//   3. Which entity exactly?       (customer combobox for Phase 1)
//
// On "متابعة" it doesn't persist anything itself — it returns the
// chosen tuple to the parent, which then opens the matching
// specialized dialog (DebtPaymentModal for قبض/عميل,
// AddSettlementDialog for صرف/عميل, an inline credit-note form for
// إشعار دائن/عميل). The deferred counterparties (وسيط / شركة / آخر)
// render with a "قريباً" badge in Phase 1 — they exist visually so
// the user understands the planned scope, but they can't be selected.
//
// Why no inline payment lines: each specialized dialog already
// handles payment collection (distribute-across-policies for قبض,
// multi-line settlement for صرف, single-amount + reason for credit
// notes). Re-implementing those here would duplicate logic and risk
// drift from the customer-page flows the user trusts.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Receipt,
  Banknote,
  Wallet,
  User,
  Users,
  Building,
  UserPlus,
  ChevronsUpDown,
  Search,
  Loader2,
  Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useAgentContext } from '@/hooks/useAgentContext';

export type VoucherKind = 'payment' | 'disbursement' | 'credit_note';
export type CounterpartyKind = 'client' | 'broker' | 'company' | 'other';

export interface ClientLite {
  id: string;
  full_name: string;
  phone_number: string | null;
  id_number: string | null;
}

export interface VoucherPickResult {
  kind: VoucherKind;
  counterparty: CounterpartyKind;
  client?: ClientLite;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPicked: (result: VoucherPickResult) => void;
}

// Static config for the voucher-kind cards. The badge tone matches
// the per-row badge on the "الكل" tab so the user reads the same
// visual vocabulary on the table and in this picker.
const VOUCHER_KIND_OPTIONS: Array<{
  value: VoucherKind;
  label: string;
  description: string;
  icon: typeof Receipt;
  tone: 'success' | 'warning' | 'destructive';
}> = [
  {
    value: 'payment',
    label: 'سند قبض',
    description: 'استلام مبلغ من الجهة',
    icon: Receipt,
    tone: 'success',
  },
  {
    value: 'disbursement',
    label: 'سند صرف',
    description: 'صرف مبلغ من المكتب للجهة',
    icon: Banknote,
    tone: 'destructive',
  },
  {
    value: 'credit_note',
    label: 'إشعار دائن',
    description: 'تسجيل رصيد للجهة عندنا بدون كاش',
    icon: Wallet,
    tone: 'warning',
  },
];

const COUNTERPARTY_OPTIONS: Array<{
  value: CounterpartyKind;
  label: string;
  description: string;
  icon: typeof User;
  enabled: boolean;
}> = [
  {
    value: 'client',
    label: 'عميل',
    description: 'استخدم محرّك التسديد العادي',
    icon: User,
    enabled: true,
  },
  {
    value: 'broker',
    label: 'وسيط',
    description: 'قبض/صرف لوسيط مرتبط بالمكتب',
    icon: Users,
    enabled: false,
  },
  {
    value: 'company',
    label: 'شركة تأمين',
    description: 'تسوية مع شركة تأمين (باستثناء الإلزامي)',
    icon: Building,
    enabled: false,
  },
  {
    value: 'other',
    label: 'آخر',
    description: 'جهة خارجية أو مصروف عام',
    icon: UserPlus,
    enabled: false,
  },
];

export function AddVoucherDialog({ open, onOpenChange, onPicked }: Props) {
  const { agentId } = useAgentContext();
  const [kind, setKind] = useState<VoucherKind | null>(null);
  const [counterparty, setCounterparty] = useState<CounterpartyKind | null>(null);
  const [selectedClient, setSelectedClient] = useState<ClientLite | null>(null);

  // Reset all picks when the modal closes so the next opening starts
  // fresh. Without this, switching tabs and re-opening would carry
  // the prior selection silently — which is exactly the kind of stale
  // state that produces "I clicked one button and got a different
  // voucher" support tickets.
  useEffect(() => {
    if (!open) {
      setKind(null);
      setCounterparty(null);
      setSelectedClient(null);
    }
  }, [open]);

  // Continue enabled only when all three choices are made AND the
  // counterparty is one Phase 1 supports.
  const canContinue =
    !!kind &&
    counterparty === 'client' &&
    !!selectedClient;

  const handleContinue = () => {
    if (!kind || !counterparty) return;
    onPicked({
      kind,
      counterparty,
      client: counterparty === 'client' ? selectedClient ?? undefined : undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-2xl max-h-[90vh] overflow-y-auto"
        dir="rtl"
      >
        <DialogHeader>
          <DialogTitle className="text-xl">إضافة سند جديد</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* Step 1: voucher kind */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-muted-foreground">
              ١. نوع السند
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {VOUCHER_KIND_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const active = kind === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setKind(opt.value)}
                    className={cn(
                      'group relative flex flex-col gap-1 rounded-lg border p-3 text-right transition-colors',
                      'hover:border-primary/60 hover:bg-muted/40',
                      active && 'border-primary bg-primary/5 ring-2 ring-primary/20',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={opt.tone}
                        className="gap-1 px-2 py-0 h-5 text-[10px]"
                      >
                        <Icon className="h-3 w-3" />
                        {opt.label}
                      </Badge>
                      {active && (
                        <Check className="h-3.5 w-3.5 text-primary ms-auto" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {opt.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Step 2: counterparty kind — only after kind is picked, to
              guide the eye through the flow instead of dumping every
              question on screen at once. */}
          {kind && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-muted-foreground">
                ٢. الجهة
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {COUNTERPARTY_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  const active = counterparty === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={!opt.enabled}
                      onClick={() => setCounterparty(opt.value)}
                      className={cn(
                        'group relative flex flex-col items-start gap-1 rounded-lg border p-3 text-right transition-colors',
                        opt.enabled && 'hover:border-primary/60 hover:bg-muted/40',
                        active && 'border-primary bg-primary/5 ring-2 ring-primary/20',
                        !opt.enabled && 'opacity-60 cursor-not-allowed',
                      )}
                    >
                      <div className="flex items-center gap-2 w-full">
                        <Icon className="h-4 w-4 text-foreground" />
                        <span className="text-sm font-semibold">{opt.label}</span>
                        {!opt.enabled && (
                          <Badge variant="outline" className="ms-auto text-[9px] px-1.5 py-0 h-4">
                            قريباً
                          </Badge>
                        )}
                        {active && (
                          <Check className="h-3.5 w-3.5 text-primary ms-auto" />
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-tight">
                        {opt.description}
                      </p>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* Step 3: entity picker — Phase 1 only supports client. */}
          {kind && counterparty === 'client' && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-muted-foreground">
                ٣. اختيار العميل
              </h3>
              <ClientPicker
                agentId={agentId}
                value={selectedClient}
                onChange={setSelectedClient}
              />
            </section>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button disabled={!canContinue} onClick={handleContinue}>
            متابعة
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── ClientPicker ──────────────────────────────────────────────
//
// Debounced search-as-you-type combobox over the clients table. We
// don't preload all clients — agencies can have thousands, and the
// modal opens often. Instead we wait until the user has typed at
// least 2 characters then query the first 25 matches across name,
// phone, and id_number. Results refresh as the term changes.
//
// Why a Popover + Command rather than a plain <select>: native
// select can't show three fields per row (name + phone + ID) and
// can't be filtered with ILIKE. The shadcn Command primitive gives
// us both.

interface ClientPickerProps {
  agentId: string | null;
  value: ClientLite | null;
  onChange: (client: ClientLite | null) => void;
}

function ClientPicker({ agentId, value, onChange }: ClientPickerProps) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<ClientLite[]>([]);
  const [loading, setLoading] = useState(false);
  // requestRef tracks the most recent query; stale responses (from a
  // slower earlier request) are dropped so they can't overwrite the
  // current term's results — classic race-condition guard for
  // search-as-you-type.
  const requestRef = useRef(0);

  useEffect(() => {
    if (!agentId) return;
    const trimmed = term.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    const myReq = ++requestRef.current;
    setLoading(true);
    const handle = setTimeout(async () => {
      const { data } = await supabase
        .from('clients')
        .select('id, full_name, phone_number, id_number')
        .eq('agent_id', agentId)
        .is('deleted_at', null)
        .or(
          `full_name.ilike.%${trimmed}%,phone_number.ilike.%${trimmed}%,id_number.ilike.%${trimmed}%`,
        )
        .order('full_name')
        .limit(25);
      if (myReq !== requestRef.current) return; // stale
      setResults((data ?? []) as ClientLite[]);
      setLoading(false);
    }, 200);
    return () => clearTimeout(handle);
  }, [term, agentId]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          {value ? (
            <span className="flex items-center gap-2 truncate">
              <span className="font-semibold">{value.full_name}</span>
              {value.id_number && (
                <span className="text-xs text-muted-foreground ltr-nums">
                  {value.id_number}
                </span>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground inline-flex items-center gap-2">
              <Search className="h-3.5 w-3.5" />
              ابحث بالاسم أو الهاتف أو رقم الهوية...
            </span>
          )}
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" dir="rtl">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="ابحث بالاسم / الهاتف / رقم الهوية..."
            value={term}
            onValueChange={setTerm}
          />
          <CommandList>
            {loading && (
              <div className="py-6 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                جاري البحث...
              </div>
            )}
            {!loading && term.trim().length < 2 && (
              <div className="py-6 text-center text-xs text-muted-foreground">
                اكتب حرفين على الأقل لبدء البحث
              </div>
            )}
            {!loading && term.trim().length >= 2 && results.length === 0 && (
              <CommandEmpty>لا توجد نتائج مطابقة</CommandEmpty>
            )}
            {!loading && results.length > 0 && (
              <ScrollArea className="max-h-72">
                {results.map((c) => {
                  const isSelected = value?.id === c.id;
                  return (
                    <CommandItem
                      key={c.id}
                      value={c.id}
                      onSelect={() => {
                        onChange(c);
                        setOpen(false);
                      }}
                      className="flex items-center gap-2"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold truncate">{c.full_name}</div>
                        <div className="text-xs text-muted-foreground flex items-center gap-2 ltr-nums">
                          {c.id_number && <span>{c.id_number}</span>}
                          {c.phone_number && <span>· {c.phone_number}</span>}
                        </div>
                      </div>
                      {isSelected && <Check className="h-3.5 w-3.5 text-primary" />}
                    </CommandItem>
                  );
                })}
              </ScrollArea>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
