// ─── /accounting → النظرة المالية ───────────────────────────────
//
// Unified P&L surface that pulls every other section's numbers into
// one place so the agent can answer "what did I earn / spend / am
// owed / owe this period?" without flipping between four tabs.
//
// Period filter: today / week / month / year / custom range. The
// chosen window flows through useAccountingData via dateFrom/dateTo,
// so every per-entity section's own KPIs and this overview always
// agree — there's literally one shared fetch.
//
// Calculations mirror the per-section totals exactly (see Plan-agent
// research at conversation log). Two profit numbers are surfaced
// side-by-side because they tell different stories:
//   • صافي الربح المحاسبي (accrual)  = gross profit on issued policies
//                                       − operating expenses
//   • صافي التدفق النقدي (cash)      = total cash in − total cash out
// They will NOT equal each other in the same period — that's by
// design and the most useful insight this tab delivers.

import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Label } from '@/components/ui/label';
import { ArabicDatePicker } from '@/components/ui/arabic-date-picker';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  Building2,
  CalendarRange,
  FileBarChart,
  Loader2,
  PiggyBank,
  Receipt,
  TrendingUp,
  Users,
  UserRound,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useAccountingData } from './useAccountingData';
import { type AccountingFiltersValue } from './AccountingFilters';
import { cn } from '@/lib/utils';

type Period = 'today' | 'week' | 'month' | 'year' | 'custom';

interface FinancialOverviewSectionProps {
  branchId?: string | null;
}

// Derive a YYYY-MM-DD range for each preset. "year" = current calendar
// year. "custom" lets the user pick — handled by the popover.
function getRange(period: Period, customFrom: string, customTo: string) {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = ymd(now);
  if (period === 'today') return { from: today, to: today };
  if (period === 'week') {
    const start = new Date(now);
    start.setDate(now.getDate() - 6);
    return { from: ymd(start), to: today };
  }
  if (period === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { from: ymd(start), to: ymd(end) };
  }
  if (period === 'year') {
    const start = new Date(now.getFullYear(), 0, 1);
    const end = new Date(now.getFullYear(), 11, 31);
    return { from: ymd(start), to: ymd(end) };
  }
  return { from: customFrom, to: customTo };
}

const PERIOD_LABEL: Record<Period, string> = {
  today: 'اليوم',
  week: 'هذا الأسبوع',
  month: 'هذا الشهر',
  year: 'هذه السنة',
  custom: 'مدى مخصص',
};

const AR_MONTH_NAMES = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

function describeRange(from: string, to: string): string {
  if (!from && !to) return 'كل التواريخ';
  if (!from || !to) return `${from || '...'} → ${to || '...'}`;
  const f = from.split('-');
  const t = to.split('-');
  if (f.length === 3 && t.length === 3 && f[0] === t[0]) {
    // Same year — check if it's a whole month, whole year, or single day
    if (f[1] === t[1]) {
      if (f[2] === t[2]) {
        return `${f[2]}/${f[1]}/${f[0]}`;
      }
      const mIdx = Number(f[1]) - 1;
      const lastDay = new Date(Number(f[0]), mIdx + 1, 0).getDate();
      if (Number(f[2]) === 1 && Number(t[2]) === lastDay) {
        return `شهر ${AR_MONTH_NAMES[mIdx] ?? f[1]} ${f[0]}`;
      }
    }
    if (f[1] === '01' && f[2] === '01' && t[1] === '12' && t[2] === '31') {
      return `سنة ${f[0]}`;
    }
  }
  return `${f[2]}/${f[1]}/${f[0]} → ${t[2]}/${t[1]}/${t[0]}`;
}

export function FinancialOverviewSection({
  branchId,
}: FinancialOverviewSectionProps = {}) {
  const [period, setPeriod] = useState<Period>('month');
  // Custom range — only applied when period === 'custom'. Defaults to
  // the same month range so flipping to custom doesn't drop to "all".
  const initialRange = useMemo(() => getRange('month', '', ''), []);
  const [customFrom, setCustomFrom] = useState(initialRange.from);
  const [customTo, setCustomTo] = useState(initialRange.to);

  const range = useMemo(
    () => getRange(period, customFrom, customTo),
    [period, customFrom, customTo],
  );

  const filters: AccountingFiltersValue = useMemo(
    () => ({
      dateFrom: range.from,
      dateTo: range.to,
      companies: [],
      types: [],
      paymentMethods: [],
    }),
    [range],
  );

  const data = useAccountingData(filters, branchId);

  // ─── Cash flow (real money in vs out this period) ────────────
  const cashIn = useMemo(() => {
    // Client payments — mirrored from policy_payments, !cancelled.
    const fromClients = data.clientPayments
      .filter((r) => !r.cancelled_at)
      .reduce((s, r) => s + Number(r.amount || 0), 0);
    // Broker payments to us.
    const fromBrokers = data.brokerSettlements
      .filter((s) => s.direction === 'broker_owes' && !s.refused)
      .reduce((s, r) => s + Number(r.total_amount || 0), 0);
    // Insurance company refunding US (rare — usually flow is OUT).
    const fromCompanies = data.companyReceipts
      .filter((s) => !s.refused)
      .reduce((s, r) => s + Number(r.total_amount || 0), 0);
    // External party paying US (refund from utility provider, etc.).
    const fromOther = data.otherReceipts
      .filter((r) => r.receipt_type === 'payment' && !r.cancelled_at)
      .reduce((s, r) => s + Number(r.amount || 0), 0);
    return {
      fromClients,
      fromBrokers,
      fromCompanies,
      fromOther,
      total: fromClients + fromBrokers + fromCompanies + fromOther,
    };
  }, [data.clientPayments, data.brokerSettlements, data.companyReceipts, data.otherReceipts]);

  const cashOut = useMemo(() => {
    // Paid to insurance companies — premium settlements.
    const toCompanies = data.companySettlements
      .filter((s) => !s.refused)
      .reduce((s, r) => s + Number(r.total_amount || 0), 0);
    // Paid to brokers (commissions / payouts).
    const toBrokers = data.brokerSettlements
      .filter((s) => s.direction === 'we_owe' && !s.refused)
      .reduce((s, r) => s + Number(r.total_amount || 0), 0);
    // Refunds + transfer-adjustment disbursements to clients.
    const toClients = data.clientDisbursements
      .filter((r) => !r.cancelled_at)
      .reduce((s, r) => s + Number(r.amount || 0), 0);
    // External-party payouts (utility, lawyer, salary…).
    const toOther = data.otherReceipts
      .filter((r) => r.receipt_type === 'disbursement' && !r.cancelled_at)
      .reduce((s, r) => s + Number(r.amount || 0), 0);
    // Internal operating expenses (rent, internet, stationery…).
    // expensesTotal already applies the period filter via useAccountingData.
    const operating = data.expensesTotal;
    return {
      toCompanies,
      toBrokers,
      toClients,
      toOther,
      operating,
      total: toCompanies + toBrokers + toClients + toOther + operating,
    };
  }, [
    data.companySettlements,
    data.brokerSettlements,
    data.clientDisbursements,
    data.otherReceipts,
    data.expensesTotal,
  ]);

  const netCash = cashIn.total - cashOut.total;

  // ─── Accounting profit (accrual — based on issued policies) ───
  const accrual = useMemo(() => {
    // Office-billable insurance — the IssuanceRow.insurance_price
    // already excludes إلزامي in mixed packages (handled in
    // useAccountingData's moneySubs filter). For the headline we want
    // TRUE gross (every sub including إلزامي), same as CompaniesSection
    // does for its grossInsuranceSum pill.
    const grossInsurance = data.issuances.reduce(
      (s, r) =>
        s + r.sub_policies.reduce((ss, p) => ss + Number(p.insurance_price || 0), 0),
      0,
    );
    // Owed to insurance companies (cost of goods sold).
    const owedToCompanies = data.issuances.reduce(
      (s, r) => s + Number(r.payed_for_company || 0),
      0,
    );
    // Sum of `policies.profit` over issued. The recalc job already
    // sets `profit = insurance_price - payed_for_company` for office
    // and `to_broker` policies. `from_broker` rows have profit=0 by
    // design (handled separately via brokerProfit below).
    const profitOnly = data.issuances.reduce(
      (s, r) => s + Number(r.profit || 0),
      0,
    );
    // Office commission — sits separate from .profit so it can be
    // surfaced on its own pill.
    const commissionOnly = data.issuances.reduce(
      (s, r) => s + Number(r.office_commission || 0),
      0,
    );
    // from_broker margin — we resold a broker's policy. Profit =
    // what we charged the customer minus what we paid the broker.
    // Floored at 0 so a misconfigured row doesn't yank net negative.
    const brokerProfit = data.issuances
      .filter((r) => r.main.broker_direction === 'from_broker')
      .reduce(
        (s, r) =>
          s +
          Math.max(
            0,
            Number(r.insurance_price || 0) - Number(r.broker_buy_price || 0),
          ),
        0,
      );
    const grossProfit = profitOnly + commissionOnly + brokerProfit;
    const netProfit = grossProfit - data.expensesTotal;
    return {
      grossInsurance,
      owedToCompanies,
      profitOnly,
      commissionOnly,
      brokerProfit,
      grossProfit,
      netProfit,
      policyCount: data.issuances.length,
    };
  }, [data.issuances, data.expensesTotal]);

  // ─── Receivables (مستحق لنا) ─────────────────────────────────
  // Period-scoped receivables — what's still outstanding against
  // policies issued / paid within the chosen window. NOT a full
  // per-client lifetime balance; that lives on each client's kashf
  // page. Includes both directions: payments owed TO us and any
  // disbursement-style outflows that haven't actually cleared.
  const receivables = useMemo(() => {
    // CLIENTS — gross billed (insurance + commission, excluding
    // ELZAMI as already handled by useAccountingData.moneySubs)
    // minus collected payments minus credit notes we issued
    // (we credited them = they owe less) plus debit notes against
    // them (they owe more).
    const clientsBilled = data.issuances.reduce(
      (s, r) =>
        s +
        Number(r.insurance_price || 0) +
        Number(r.office_commission || 0),
      0,
    );
    // Credit notes ON clients (positive amount = we owe them = reduces
    // what they owe us); debit notes (positive amount = they owe more).
    const clientCreditNotesSum = data.clientCreditNotes
      .filter((r) => !r.cancelled_at && r.receipt_type === 'credit_note')
      .reduce((s, r) => s + Math.abs(Number(r.amount || 0)), 0);
    const clientDebitNotesSum = data.clientCreditNotes
      .filter((r) => !r.cancelled_at && r.receipt_type === 'debit_note')
      .reduce((s, r) => s + Math.abs(Number(r.amount || 0)), 0);
    const fromClients = Math.max(
      0,
      clientsBilled + clientDebitNotesSum - cashIn.fromClients - clientCreditNotesSum,
    );

    // BROKERS — to_broker policies create a receivable from the
    // broker. Subtract collected + debit notes (broker owes us extra
    // beyond the policy price).
    const grossDueFromBrokers = data.issuances
      .filter((r) => r.main.broker_direction === 'to_broker')
      .reduce((s, r) => s + Number(r.insurance_price || 0), 0);
    const brokerDebitNotesSum = data.brokerCreditNotes
      .filter((r) => !r.cancelled_at && r.receipt_type === 'debit_note')
      .reduce((s, r) => s + Math.abs(Number(r.amount || 0)), 0);
    const fromBrokers = Math.max(
      0,
      grossDueFromBrokers - cashIn.fromBrokers - brokerDebitNotesSum,
    );

    // EXTERNAL — debit notes against external parties (they owe us).
    const fromOther = data.otherReceipts
      .filter((r) => r.receipt_type === 'debit_note' && !r.cancelled_at)
      .reduce((s, r) => s + Math.abs(Number(r.amount || 0)), 0);
    return {
      fromClients,
      fromBrokers,
      fromOther,
      total: fromClients + fromBrokers + fromOther,
    };
  }, [
    data.issuances,
    data.clientCreditNotes,
    data.brokerCreditNotes,
    data.otherReceipts,
    cashIn.fromClients,
    cashIn.fromBrokers,
  ]);

  // ─── Payables (مستحق علينا) ───────────────────────────────────
  const payables = useMemo(() => {
    // To companies — canonical formula matches get_company_outstanding_summary:
    //   net = payable - paid - credit_notes - debit_notes
    const companyCreditNotesTotal = data.companyCreditNotes
      .filter((r) => !r.cancelled_at && r.receipt_type === 'credit_note')
      .reduce((s, r) => s + Math.abs(Number(r.amount || 0)), 0);
    const companyDebitNotesTotal = data.companyCreditNotes
      .filter((r) => !r.cancelled_at && r.receipt_type === 'debit_note')
      .reduce((s, r) => s + Math.abs(Number(r.amount || 0)), 0);
    const toCompanies = Math.max(
      0,
      accrual.owedToCompanies -
        cashOut.toCompanies -
        companyCreditNotesTotal -
        companyDebitNotesTotal,
    );
    // To brokers — gross from_broker buy-prices + credit notes we owe
    // − payouts already made.
    const grossDueToBrokers = data.issuances
      .filter((r) => r.main.broker_direction === 'from_broker')
      .reduce((s, r) => s + Number(r.broker_buy_price || 0), 0);
    const brokerCreditNotesSum = data.brokerCreditNotes
      .filter((r) => !r.cancelled_at && r.receipt_type === 'credit_note')
      .reduce((s, r) => s + Number(r.amount || 0), 0);
    const toBrokers = Math.max(
      0,
      grossDueToBrokers + brokerCreditNotesSum - cashOut.toBrokers,
    );
    // To external — credit notes we owe to external parties.
    const toOther = data.otherReceipts
      .filter((r) => r.receipt_type === 'credit_note' && !r.cancelled_at)
      .reduce((s, r) => s + Math.abs(Number(r.amount || 0)), 0);
    return {
      toCompanies,
      toBrokers,
      toOther,
      total: toCompanies + toBrokers + toOther,
    };
  }, [
    data.issuances,
    data.companyCreditNotes,
    data.brokerCreditNotes,
    data.otherReceipts,
    accrual.owedToCompanies,
    cashOut.toCompanies,
    cashOut.toBrokers,
  ]);

  const fmt = (n: number) =>
    `₪${Math.round(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

  return (
    <div className="space-y-4">
      {/* Period selector — three quick pills + year + custom range
          popover. Defaults to current month so the page loads useful
          numbers on first paint. */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="inline-flex items-center gap-1 rounded-full bg-secondary/60 p-1">
          {(['today', 'week', 'month', 'year'] as Period[]).map((p) => {
            const active = period === p;
            return (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={cn(
                  'h-9 px-4 rounded-full text-sm font-medium transition-all',
                  active
                    ? 'bg-foreground text-background shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {PERIOD_LABEL[p]}
              </button>
            );
          })}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                onClick={() => setPeriod('custom')}
                className={cn(
                  'h-9 px-4 rounded-full text-sm font-medium transition-all',
                  period === 'custom'
                    ? 'bg-foreground text-background shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {PERIOD_LABEL.custom}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-[300px] p-3" align="end" dir="rtl">
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">من تاريخ</Label>
                  <ArabicDatePicker
                    value={customFrom}
                    onChange={(v) => {
                      setCustomFrom(v);
                      setPeriod('custom');
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">إلى تاريخ</Label>
                  <ArabicDatePicker
                    value={customTo}
                    onChange={(v) => {
                      setCustomTo(v);
                      setPeriod('custom');
                    }}
                    min={customFrom}
                  />
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <Badge variant="secondary" className="gap-1.5 font-medium text-xs">
          <CalendarRange className="h-3.5 w-3.5" />
          {describeRange(range.from, range.to)}
          {data.loading && <Loader2 className="h-3 w-3 animate-spin" />}
        </Badge>
      </div>

      {/* Hero KPI row — 3 big pills covering revenue, expenses, and
          the two profit numbers (accrual vs cash) side-by-side. */}
      <TooltipProvider delayDuration={150}>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <HeroPill
            icon={ArrowDownLeft}
            tone="emerald"
            label="إجمالي الإيرادات (نقدي)"
            value={fmt(cashIn.total)}
            hint="مقبوض من كل المصادر"
            tooltip={
              <BreakdownLines
                title="مصادر الإيرادات النقدية"
                lines={[
                  { label: 'من العملاء', value: fmt(cashIn.fromClients) },
                  { label: 'من الوسطاء', value: fmt(cashIn.fromBrokers) },
                  ...(cashIn.fromCompanies > 0
                    ? [{ label: 'من الشركات', value: fmt(cashIn.fromCompanies) }]
                    : []),
                  ...(cashIn.fromOther > 0
                    ? [{ label: 'من جهات خارجية', value: fmt(cashIn.fromOther) }]
                    : []),
                  { label: 'الإجمالي', value: fmt(cashIn.total), strong: true },
                ]}
              />
            }
          />
          <HeroPill
            icon={ArrowUpRight}
            tone="rose"
            label="إجمالي المصروفات (نقدي)"
            value={fmt(cashOut.total)}
            hint="مدفوع من كل الوجهات"
            tooltip={
              <BreakdownLines
                title="وجهات المصروفات النقدية"
                lines={[
                  { label: 'لشركات التأمين', value: fmt(cashOut.toCompanies) },
                  { label: 'للوسطاء', value: fmt(cashOut.toBrokers) },
                  { label: 'للعملاء (استرداد/تحويل)', value: fmt(cashOut.toClients) },
                  ...(cashOut.toOther > 0
                    ? [{ label: 'لجهات خارجية', value: fmt(cashOut.toOther) }]
                    : []),
                  { label: 'مصاريف داخلية', value: fmt(cashOut.operating) },
                  { label: 'الإجمالي', value: fmt(cashOut.total), strong: true },
                ]}
              />
            }
          />
          <HeroPill
            icon={Banknote}
            tone={netCash >= 0 ? 'emerald' : 'rose'}
            label="صافي التدفق النقدي"
            value={fmt(netCash)}
            hint="إيرادات − مصروفات (نقدي فعلي)"
            tooltip={
              <BreakdownLines
                title="صافي التدفق النقدي"
                lines={[
                  { label: 'إيرادات', value: `+ ${fmt(cashIn.total)}` },
                  { label: 'مصروفات', value: `− ${fmt(cashOut.total)}` },
                  { label: 'الصافي', value: fmt(netCash), strong: true },
                  {
                    label: 'ملاحظة',
                    value:
                      'يعكس الحركة الفعلية للكاش بالفترة — مش الربح المحاسبي.',
                    muted: true,
                  },
                ]}
              />
            }
          />
          <HeroPill
            icon={PiggyBank}
            tone={accrual.netProfit >= 0 ? 'emerald' : 'rose'}
            label="صافي الربح المحاسبي"
            value={fmt(accrual.netProfit)}
            hint={`من ${accrual.policyCount} معاملة − مصاريف`}
            tooltip={
              <BreakdownLines
                title="صافي الربح المحاسبي (Accrual)"
                lines={[
                  { label: 'الأرباح على البوليصات', value: fmt(accrual.profitOnly) },
                  { label: 'عمولات المكتب', value: `+ ${fmt(accrual.commissionOnly)}` },
                  ...(accrual.brokerProfit > 0
                    ? [{ label: 'هامش بوليصات الوسطاء', value: `+ ${fmt(accrual.brokerProfit)}` }]
                    : []),
                  { label: 'إجمالي الربح', value: fmt(accrual.grossProfit), strong: true },
                  { label: 'مصاريف تشغيلية', value: `− ${fmt(data.expensesTotal)}` },
                  { label: 'الصافي', value: fmt(accrual.netProfit), strong: true },
                  {
                    label: 'ملاحظة',
                    value:
                      'محسوب على البوليصات الصادرة بالفترة، بغض النظر عن وقت الدفع الفعلي.',
                    muted: true,
                  },
                ]}
              />
            }
          />
        </div>

        {/* Secondary row — totals about the policies themselves (gross
            premium written, owed to companies, profit before expenses). */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-3 gap-3">
          <SmallPill
            icon={FileBarChart}
            tone="slate"
            label="إجمالي القسط المكتتب"
            value={fmt(accrual.grossInsurance)}
            hint={`${accrual.policyCount} معاملة بهالفترة`}
          />
          <SmallPill
            icon={Building2}
            tone="amber"
            label="المستحق للشركات (إجمالي)"
            value={fmt(accrual.owedToCompanies)}
            hint="قيمة الأقساط على المكتب للشركات"
          />
          <SmallPill
            icon={TrendingUp}
            tone="indigo"
            label="إجمالي الربح + العمولات"
            value={fmt(accrual.grossProfit)}
            hint="قبل خصم المصاريف التشغيلية"
          />
        </div>

        {/* Ledger row — receivables (مستحق لنا) and payables
            (مستحق علينا). Color-coded so the agent reads "what we
            should be collecting" vs "what we still need to settle"
            at a glance. */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <LedgerCard
            title="مستحق لنا"
            subtitle="ذمم مدينة — قيد التحصيل"
            tone="sky"
            total={receivables.total}
            fmt={fmt}
            lines={[
              { icon: UserRound, label: 'من العملاء', value: receivables.fromClients },
              { icon: Users, label: 'من الوسطاء', value: receivables.fromBrokers },
              { icon: Wallet, label: 'إشعار مدين على جهات خارجية', value: receivables.fromOther },
            ]}
          />
          <LedgerCard
            title="مستحق علينا"
            subtitle="ذمم دائنة — مطلوب الدفع"
            tone="rose"
            total={payables.total}
            fmt={fmt}
            lines={[
              { icon: Building2, label: 'لشركات التأمين', value: payables.toCompanies },
              { icon: Users, label: 'للوسطاء', value: payables.toBrokers },
              { icon: Wallet, label: 'إشعار دائن لجهات خارجية', value: payables.toOther },
            ]}
          />
        </div>

        {/* Cash flow breakdown — split income & expense bars side by
            side. Same data as the hero pills but visually decomposed. */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <BreakdownCard
            title="توزيع الإيرادات النقدية"
            icon={ArrowDownLeft}
            tone="emerald"
            total={cashIn.total}
            fmt={fmt}
            segments={[
              { icon: UserRound, label: 'العملاء', value: cashIn.fromClients },
              { icon: Users, label: 'الوسطاء', value: cashIn.fromBrokers },
              { icon: Building2, label: 'الشركات', value: cashIn.fromCompanies },
              { icon: Wallet, label: 'جهات خارجية', value: cashIn.fromOther },
            ]}
          />
          <BreakdownCard
            title="توزيع المصروفات النقدية"
            icon={ArrowUpRight}
            tone="rose"
            total={cashOut.total}
            fmt={fmt}
            segments={[
              { icon: Building2, label: 'لشركات التأمين', value: cashOut.toCompanies },
              { icon: Users, label: 'للوسطاء', value: cashOut.toBrokers },
              { icon: UserRound, label: 'للعملاء', value: cashOut.toClients },
              { icon: Wallet, label: 'لجهات خارجية', value: cashOut.toOther },
              { icon: Receipt, label: 'مصاريف داخلية', value: cashOut.operating },
            ]}
          />
        </div>
      </TooltipProvider>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Sub-components — pills, ledger cards, breakdown bars
// ─────────────────────────────────────────────────────────────────

const TONE_CLASSES: Record<string, { bg: string; text: string; ring: string; border: string }> = {
  slate: {
    bg: 'bg-slate-500/10',
    text: 'text-slate-700',
    ring: 'ring-slate-200',
    border: 'border-slate-200',
  },
  emerald: {
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-700',
    ring: 'ring-emerald-200',
    border: 'border-emerald-200',
  },
  amber: {
    bg: 'bg-amber-500/10',
    text: 'text-amber-700',
    ring: 'ring-amber-200',
    border: 'border-amber-200',
  },
  indigo: {
    bg: 'bg-indigo-500/10',
    text: 'text-indigo-700',
    ring: 'ring-indigo-200',
    border: 'border-indigo-200',
  },
  sky: {
    bg: 'bg-sky-500/10',
    text: 'text-sky-700',
    ring: 'ring-sky-200',
    border: 'border-sky-200',
  },
  rose: {
    bg: 'bg-rose-500/10',
    text: 'text-rose-700',
    ring: 'ring-rose-200',
    border: 'border-rose-200',
  },
};

function HeroPill({
  icon: Icon,
  tone,
  label,
  value,
  hint,
  tooltip,
}: {
  icon: LucideIcon;
  tone: keyof typeof TONE_CLASSES;
  label: string;
  value: string;
  hint?: string;
  tooltip?: React.ReactNode;
}) {
  const cls = TONE_CLASSES[tone];
  const card = (
    <Card className={cn('cursor-help transition-shadow hover:shadow-md', cls.border)}>
      <CardContent className="py-4 px-5">
        <div className="flex items-start justify-between gap-3 mb-2">
          <p className="text-xs text-muted-foreground font-medium">{label}</p>
          <div className={cn('h-9 w-9 rounded-xl flex items-center justify-center shrink-0', cls.bg)}>
            <Icon className={cn('h-4 w-4', cls.text)} />
          </div>
        </div>
        <p className={cn('text-2xl font-bold tabular-nums whitespace-nowrap', cls.text)}>
          {value}
        </p>
        {hint && <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>}
      </CardContent>
    </Card>
  );
  if (!tooltip) return card;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{card}</TooltipTrigger>
      <TooltipContent side="bottom" className="p-2.5 max-w-xs">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

function SmallPill({
  icon: Icon,
  tone,
  label,
  value,
  hint,
}: {
  icon: LucideIcon;
  tone: keyof typeof TONE_CLASSES;
  label: string;
  value: string;
  hint?: string;
}) {
  const cls = TONE_CLASSES[tone];
  return (
    <Card>
      <CardContent className="py-3 px-4 flex items-center gap-3">
        <div className={cn('h-9 w-9 rounded-xl flex items-center justify-center shrink-0', cls.bg)}>
          <Icon className={cn('h-4 w-4', cls.text)} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground truncate">{label}</p>
          <p className={cn('text-base font-bold tabular-nums whitespace-nowrap', cls.text)}>
            {value}
          </p>
          {hint && <p className="text-[10px] text-muted-foreground truncate">{hint}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

interface BreakdownLine {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
}

function BreakdownLines({ title, lines }: { title: string; lines: BreakdownLine[] }) {
  return (
    <div dir="rtl" className="space-y-1.5 text-xs">
      <div className="font-semibold text-foreground">{title}</div>
      <div className="flex flex-col gap-0.5">
        {lines.map((l, i) => (
          <div
            key={i}
            className={cn(
              'flex items-center justify-between gap-4',
              l.strong && 'border-t pt-1 mt-0.5 font-bold',
              l.muted && 'text-muted-foreground italic text-[11px]',
            )}
          >
            <span>{l.label}</span>
            <span className="tabular-nums">{l.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LedgerCard({
  title,
  subtitle,
  tone,
  total,
  lines,
  fmt,
}: {
  title: string;
  subtitle: string;
  tone: keyof typeof TONE_CLASSES;
  total: number;
  lines: { icon: LucideIcon; label: string; value: number }[];
  fmt: (n: number) => string;
}) {
  const cls = TONE_CLASSES[tone];
  return (
    <Card>
      <CardContent className="py-4 px-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h3 className="font-bold text-base">{title}</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>
          </div>
          <p className={cn('text-2xl font-bold tabular-nums whitespace-nowrap', cls.text)}>
            {fmt(total)}
          </p>
        </div>
        <div className="space-y-1.5 pt-3 border-t">
          {lines.map((l) => {
            const Icon = l.icon;
            const pct = total > 0 ? (l.value / total) * 100 : 0;
            return (
              <div key={l.label} className="flex items-center gap-2.5 text-sm">
                <Icon className={cn('h-3.5 w-3.5', cls.text)} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-foreground/80">{l.label}</span>
                    <span className="tabular-nums text-xs font-semibold">
                      {fmt(l.value)}
                    </span>
                  </div>
                  <div className="h-1 bg-muted/40 rounded-full overflow-hidden mt-1">
                    <div
                      className={cn('h-full transition-all', cls.bg.replace('/10', '/50'))}
                      style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// Per-segment palette — fixed HSL values that work with both light and
// dark themes. Each card cycles through these in segment order; same
// label always gets the same color across the two breakdown cards.
const CHART_COLORS = [
  'hsl(160 70% 45%)', // emerald
  'hsl(217 91% 60%)', // blue
  'hsl(38 92% 55%)',  // amber
  'hsl(280 70% 60%)', // purple
  'hsl(0 75% 60%)',   // rose
  'hsl(195 70% 50%)', // sky
];

function BreakdownCard({
  title,
  icon: Icon,
  tone,
  total,
  segments,
  fmt,
}: {
  title: string;
  icon: LucideIcon;
  tone: keyof typeof TONE_CLASSES;
  total: number;
  segments: { icon: LucideIcon; label: string; value: number }[];
  fmt: (n: number) => string;
}) {
  const cls = TONE_CLASSES[tone];
  // Filter out zero segments so the donut isn't cluttered with empty
  // slices and the legend stays focused on real activity.
  const visible = segments
    .map((s, idx) => ({ ...s, color: CHART_COLORS[idx % CHART_COLORS.length] }))
    .filter((s) => s.value > 0);

  // When total is zero we still render a ghost segment so the donut
  // shape stays consistent. Center overlay swaps to "لا توجد بيانات".
  const chartData =
    total > 0
      ? visible.map((s) => ({ name: s.label, value: s.value, color: s.color }))
      : [{ name: '', value: 1, color: 'hsl(var(--muted))' }];

  return (
    <Card className="h-full">
      <CardContent className="py-4 px-5">
        <div className="flex items-center gap-2.5 mb-3">
          <div className={cn('h-8 w-8 rounded-lg flex items-center justify-center', cls.bg)}>
            <Icon className={cn('h-4 w-4', cls.text)} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-sm">{title}</h3>
            <p className={cn('text-base font-bold tabular-nums', cls.text)}>{fmt(total)}</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-3 items-center">
          {/* Donut */}
          <div className="relative h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={80}
                  paddingAngle={total > 0 && visible.length > 1 ? 2 : 0}
                  dataKey="value"
                  isAnimationActive={total > 0}
                >
                  {chartData.map((d, i) => (
                    <Cell key={i} fill={d.color} />
                  ))}
                </Pie>
                {total > 0 && (
                  <RechartsTooltip
                    formatter={(v: number, n: string) => [fmt(v), n]}
                    contentStyle={{
                      direction: 'rtl',
                      textAlign: 'right',
                      backgroundColor: 'hsl(var(--background))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                  />
                )}
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              {total === 0 ? (
                <p className="text-[11px] text-muted-foreground">لا توجد حركات</p>
              ) : (
                <>
                  <p className="text-[10px] text-muted-foreground">الإجمالي</p>
                  <p className={cn('text-sm font-bold tabular-nums', cls.text)}>{fmt(total)}</p>
                </>
              )}
            </div>
          </div>
          {/* Legend */}
          <div className="space-y-1.5">
            {visible.length === 0 ? (
              <p className="text-xs text-muted-foreground">—</p>
            ) : (
              visible.map((s) => {
                const SegIcon = s.icon;
                const pct = total > 0 ? (s.value / total) * 100 : 0;
                return (
                  <div key={s.label} className="flex items-center gap-2 text-xs">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: s.color }}
                    />
                    <SegIcon className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="flex-1 truncate text-foreground/80">{s.label}</span>
                    <span className="tabular-nums text-muted-foreground text-[10px]">
                      {pct.toFixed(0)}%
                    </span>
                    <span className="tabular-nums font-semibold">{fmt(s.value)}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

