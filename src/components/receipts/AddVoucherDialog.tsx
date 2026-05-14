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

import { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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

export interface BrokerLite {
  id: string;
  name: string;
  phone: string | null;
}

export interface VoucherPickResult {
  kind: VoucherKind;
  counterparty: CounterpartyKind;
  client?: ClientLite;
  broker?: BrokerLite;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPicked: (result: VoucherPickResult) => void;
}

// Static config for the voucher-kind cards. Each tone maps to a
// Tailwind colour pair (icon bubble background + ring/border on
// selection) so the card itself communicates the type at a glance —
// no need to read the badge first. Keep these in sync with
// RECEIPT_TYPE_BADGE on the receipts page for a consistent visual
// vocabulary between picker and table.
const VOUCHER_KIND_OPTIONS: Array<{
  value: VoucherKind;
  label: string;
  description: string;
  icon: typeof Receipt;
  iconWrap: string;
  iconColor: string;
  ring: string;
  selectedBg: string;
}> = [
  {
    value: 'payment',
    label: 'سند قبض',
    description: 'استلام مبلغ من الجهة',
    icon: Receipt,
    iconWrap: 'bg-emerald-100 dark:bg-emerald-950/40',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    ring: 'ring-emerald-500/40 border-emerald-500/60',
    selectedBg: 'bg-emerald-50/60 dark:bg-emerald-950/20',
  },
  {
    value: 'disbursement',
    label: 'سند صرف',
    description: 'صرف مبلغ من المكتب للجهة',
    icon: Banknote,
    iconWrap: 'bg-rose-100 dark:bg-rose-950/40',
    iconColor: 'text-rose-600 dark:text-rose-400',
    ring: 'ring-rose-500/40 border-rose-500/60',
    selectedBg: 'bg-rose-50/60 dark:bg-rose-950/20',
  },
  {
    value: 'credit_note',
    label: 'إشعار دائن',
    description: 'تسجيل رصيد للجهة عندنا بدون كاش',
    icon: Wallet,
    iconWrap: 'bg-amber-100 dark:bg-amber-950/40',
    iconColor: 'text-amber-600 dark:text-amber-400',
    ring: 'ring-amber-500/40 border-amber-500/60',
    selectedBg: 'bg-amber-50/60 dark:bg-amber-950/20',
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
    description: 'تسديد ديون أو إصدار إشعار',
    icon: User,
    enabled: true,
  },
  {
    value: 'broker',
    label: 'وسيط',
    description: 'قبض/صرف لوسيط',
    icon: Users,
    enabled: true,
  },
  {
    value: 'company',
    label: 'شركة تأمين',
    description: 'تسوية مع شركة',
    icon: Building,
    enabled: false,
  },
  {
    value: 'other',
    label: 'آخر',
    description: 'جهة خارجية أو مصروف',
    icon: UserPlus,
    enabled: false,
  },
];

export function AddVoucherDialog({ open, onOpenChange, onPicked }: Props) {
  const { agentId } = useAgentContext();
  const [kind, setKind] = useState<VoucherKind | null>(null);
  const [counterparty, setCounterparty] = useState<CounterpartyKind | null>(null);
  const [selectedClient, setSelectedClient] = useState<ClientLite | null>(null);
  const [selectedBroker, setSelectedBroker] = useState<BrokerLite | null>(null);

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
      setSelectedBroker(null);
    }
  }, [open]);

  // Continue enabled when the (kind, counterparty, entity) tuple is
  // complete. Counterparty-specific check:
  //   • client → need selectedClient
  //   • broker → need selectedBroker
  //   • company / other → still disabled (next iterations)
  const canContinue =
    !!kind &&
    ((counterparty === 'client' && !!selectedClient) ||
      (counterparty === 'broker' && !!selectedBroker));

  const handleContinue = () => {
    if (!kind || !counterparty) return;
    onPicked({
      kind,
      counterparty,
      client: counterparty === 'client' ? selectedClient ?? undefined : undefined,
      broker: counterparty === 'broker' ? selectedBroker ?? undefined : undefined,
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
          {/* Step 1: voucher kind. Vertical/centered cards — icon on
              top in a tinted bubble, label below it, description
              underneath. The whole card tints to its tone colour when
              selected so the type colour the user picks here matches
              the badge they'll see on the receipts table later. */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-muted-foreground">
              ١. نوع السند
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {VOUCHER_KIND_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const active = kind === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setKind(opt.value)}
                    className={cn(
                      'group relative flex flex-col items-center text-center gap-2 rounded-xl border p-4 transition-all',
                      'hover:border-primary/40 hover:shadow-sm',
                      active
                        ? cn('ring-2', opt.ring, opt.selectedBg)
                        : 'border-border',
                    )}
                  >
                    {active && (
                      <div className="absolute top-2 start-2">
                        <Check className={cn('h-4 w-4', opt.iconColor)} />
                      </div>
                    )}
                    <div
                      className={cn(
                        'inline-flex items-center justify-center h-12 w-12 rounded-full',
                        opt.iconWrap,
                      )}
                    >
                      <Icon className={cn('h-6 w-6', opt.iconColor)} />
                    </div>
                    <div className="text-sm font-bold">{opt.label}</div>
                    <p className="text-[11px] text-muted-foreground leading-snug">
                      {opt.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Step 2: counterparty kind — same vertical card layout as
              step 1 for visual consistency. Deferred entries (broker /
              company / other) dim out with a "قريباً" pill in the
              bottom-end corner so the user sees the planned scope but
              can't click them. */}
          {kind && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-muted-foreground">
                ٢. الجهة
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
                        'group relative flex flex-col items-center text-center gap-2 rounded-xl border p-3 transition-all',
                        opt.enabled && 'hover:border-primary/40 hover:shadow-sm',
                        active &&
                          'ring-2 ring-primary/40 border-primary/60 bg-primary/5',
                        !opt.enabled && 'opacity-50 cursor-not-allowed',
                      )}
                    >
                      {active && (
                        <div className="absolute top-2 start-2">
                          <Check className="h-3.5 w-3.5 text-primary" />
                        </div>
                      )}
                      {!opt.enabled && (
                        <Badge
                          variant="outline"
                          className="absolute top-1.5 start-1.5 text-[9px] px-1.5 py-0 h-4"
                        >
                          قريباً
                        </Badge>
                      )}
                      <div
                        className={cn(
                          'inline-flex items-center justify-center h-10 w-10 rounded-full bg-muted',
                          active && 'bg-primary/10',
                        )}
                      >
                        <Icon
                          className={cn(
                            'h-5 w-5 text-muted-foreground',
                            active && 'text-primary',
                          )}
                        />
                      </div>
                      <div className="text-sm font-bold">{opt.label}</div>
                      <p className="text-[10px] text-muted-foreground leading-snug">
                        {opt.description}
                      </p>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* Step 3: entity picker — Phase 1 supports client + broker.
              The picker swaps based on counterparty so the user only
              sees the search for the type they actually picked. */}
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
          {kind && counterparty === 'broker' && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-muted-foreground">
                ٣. اختيار الوسيط
              </h3>
              <BrokerPicker
                agentId={agentId}
                value={selectedBroker}
                onChange={setSelectedBroker}
              />
              {kind === 'credit_note' && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400 pt-1">
                  إشعار الدائن للوسطاء غير مفعّل حالياً — استخدم سند صرف عادي
                  لتسجيل المبلغ الذي يحتفظ به الوسيط على حسابك.
                </p>
              )}
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
                      // Soften the default accent (which renders as a
                      // heavy near-black tint in this theme) into a
                      // light muted hover state, and force the row text
                      // to stay on `foreground` so the muted ID/phone
                      // line keeps its readable greyscale instead of
                      // inverting against the selection background.
                      className="flex items-center gap-2 data-[selected=true]:bg-muted/60 data-[selected=true]:text-foreground"
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

// ─── BrokerPicker ──────────────────────────────────────────────
//
// Sibling of ClientPicker for the brokers table. Brokers carry only
// (id, name, phone) per the schema, so the search field is narrower
// — name and phone, no id_number. Same race-guarded debounced query
// pattern: we wait for two characters before hitting the DB and drop
// stale responses by request id.

interface BrokerPickerProps {
  agentId: string | null;
  value: BrokerLite | null;
  onChange: (broker: BrokerLite | null) => void;
}

function BrokerPicker({ agentId, value, onChange }: BrokerPickerProps) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<BrokerLite[]>([]);
  const [loading, setLoading] = useState(false);
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
      // brokers has no agent_id column in the legacy schema — every
      // agent currently sees the same global broker pool. If a tenant
      // wants per-agent brokers later, this is where to add the
      // .eq('agent_id', agentId) filter.
      const { data } = await supabase
        .from('brokers')
        .select('id, name, phone')
        .or(`name.ilike.%${trimmed}%,phone.ilike.%${trimmed}%`)
        .order('name')
        .limit(25);
      if (myReq !== requestRef.current) return;
      setResults((data ?? []) as BrokerLite[]);
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
              <span className="font-semibold">{value.name}</span>
              {value.phone && (
                <span className="text-xs text-muted-foreground ltr-nums">
                  {value.phone}
                </span>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground inline-flex items-center gap-2">
              <Search className="h-3.5 w-3.5" />
              ابحث بالاسم أو رقم الهاتف...
            </span>
          )}
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" dir="rtl">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="ابحث بالاسم أو رقم الهاتف..."
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
              <CommandEmpty>لا يوجد وسيط مطابق</CommandEmpty>
            )}
            {!loading && results.length > 0 && (
              <ScrollArea className="max-h-72">
                {results.map((b) => {
                  const isSelected = value?.id === b.id;
                  return (
                    <CommandItem
                      key={b.id}
                      value={b.id}
                      onSelect={() => {
                        onChange(b);
                        setOpen(false);
                      }}
                      className="flex items-center gap-2 data-[selected=true]:bg-muted/60 data-[selected=true]:text-foreground"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold truncate">{b.name}</div>
                        {b.phone && (
                          <div className="text-xs text-muted-foreground ltr-nums">
                            {b.phone}
                          </div>
                        )}
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
