import { useMemo, useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ArrowDownRight, ArrowUpRight, FileText, RotateCcw, LayoutGrid, type LucideIcon } from 'lucide-react';
import { CompanyIssuancesTable } from './CompanyIssuancesTable';
import { SettlementsTable } from './SettlementsTable';
import {
  BROKER_ISSUANCE_COLUMNS,
  ISSUANCE_DEFAULT_OFF,
  SETTLEMENT_COLUMNS,
  SETTLEMENT_DEFAULT_OFF,
} from './columnDefs';
import { AccountingFilters, AccountingFiltersValue } from './AccountingFilters';
import { ManageColumnsDropdown } from './ManageColumnsDropdown';
import { useTableColumnVisibility } from '@/hooks/useTableColumnVisibility';
import { useAccountingData } from './useAccountingData';
import { POLICY_TYPE_DISPLAY, PAYMENT_METHOD_LABELS } from './accountingTypes';

type SubTab = 'all' | 'issuances' | 'returns' | 'disbursements' | 'receipts';

const TABS: { key: SubTab; label: string; Icon: LucideIcon }[] = [
  { key: 'all', label: 'الكل', Icon: LayoutGrid },
  { key: 'issuances', label: 'الإصدارات', Icon: FileText },
  { key: 'returns', label: 'المرتجعات', Icon: RotateCcw },
  { key: 'disbursements', label: 'سند الصرف', Icon: ArrowUpRight },
  { key: 'receipts', label: 'سند القبض', Icon: ArrowDownRight },
];

const ISSUANCE_KEYS = BROKER_ISSUANCE_COLUMNS.map((c) => c.key);
const ISSUANCE_DEFAULT_VISIBLE = ISSUANCE_KEYS.filter((k) => !ISSUANCE_DEFAULT_OFF.has(k));
const SETTLEMENT_KEYS = SETTLEMENT_COLUMNS.map((c) => c.key);
const SETTLEMENT_DEFAULT_VISIBLE = SETTLEMENT_KEYS.filter((k) => !SETTLEMENT_DEFAULT_OFF.has(k));

export function BrokersSection() {
  const [tab, setTab] = useState<SubTab>('all');
  const [filters, setFilters] = useState<AccountingFiltersValue>({
    dateFrom: '',
    dateTo: '',
    companies: [],
    types: [],
    paymentMethods: [],
  });

  const data = useAccountingData(filters);

  const issuanceCols = useTableColumnVisibility(
    'accounting-brokers-issuances-v3',
    ISSUANCE_DEFAULT_VISIBLE,
    ISSUANCE_KEYS,
  );
  const settlementCols = useTableColumnVisibility(
    'accounting-brokers-settlements-v3',
    SETTLEMENT_DEFAULT_VISIBLE,
    SETTLEMENT_KEYS,
  );

  const isSettlementTab = tab === 'disbursements' || tab === 'receipts';
  const activeColumns = isSettlementTab ? SETTLEMENT_COLUMNS : BROKER_ISSUANCE_COLUMNS;
  const activeState = isSettlementTab ? settlementCols : issuanceCols;

  const brokerCompanyOptions = useMemo(
    () =>
      data.companies
        .filter((c) => !!c.broker_id)
        .map((c) => ({ value: c.id, label: c.name_ar || c.name })),
    [data.companies],
  );
  const typeOptions = useMemo(
    () => Object.entries(POLICY_TYPE_DISPLAY).map(([value, label]) => ({ value, label })),
    [],
  );
  const paymentOptions = useMemo(
    () => Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => ({ value, label })),
    [],
  );

  const onlyBroker = (rows: typeof data.issuances) =>
    rows.filter((r) => !!r.main.broker_id);

  const issuancesAll = onlyBroker([...data.issuances, ...data.returns]);
  const issuancesActive = onlyBroker(data.issuances);
  const returns = onlyBroker(data.returns);

  const disbursements = data.brokerSettlements.filter((s) => s.direction === 'we_owe');
  const receipts = data.brokerSettlements.filter((s) => s.direction === 'broker_owes');

  const totals = useMemo(() => {
    const sellSum = issuancesActive.reduce((s, r) => s + Number(r.insurance_price || 0), 0);
    const buySum = issuancesActive.reduce((s, r) => s + Number(r.broker_buy_price || 0), 0);
    const profitSum = sellSum - buySum;
    const disbursedSum = disbursements.reduce((s, r) => s + Number(r.total_amount || 0), 0);
    const receivedSum = receipts.reduce((s, r) => s + Number(r.total_amount || 0), 0);
    return { sellSum, profitSum, disbursedSum, receivedSum };
  }, [issuancesActive, disbursements, receipts]);

  const fmt = (n: number) => `₪${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

  const activeRowCount =
    tab === 'all'
      ? issuancesAll.length
      : tab === 'issuances'
      ? issuancesActive.length
      : tab === 'returns'
      ? returns.length
      : tab === 'disbursements'
      ? disbursements.length
      : receipts.length;
  const countLabel = isSettlementTab ? 'سند' : 'معاملة';

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2">
        <SummaryPill label="سعر البيع للعميل" value={fmt(totals.sellSum)} tone="primary" />
        <Sep />
        <SummaryPill label="الربح" value={fmt(totals.profitSum)} tone="success" />
        <Sep />
        <SummaryPill label="مدفوع للوسطاء" value={fmt(totals.disbursedSum)} tone="amber" />
        <Sep />
        <SummaryPill label="مقبوض من الوسطاء" value={fmt(totals.receivedSum)} tone="emerald" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={tab} onValueChange={(v) => setTab(v as SubTab)}>
          <TabsList className="h-9">
            {TABS.map(({ key, label, Icon }) => (
              <TabsTrigger key={key} value={key} className="gap-1.5 h-7 px-2.5">
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{label}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2 mr-auto">
          <span className="text-xs text-muted-foreground">
            {data.loading ? '...' : `${activeRowCount} ${countLabel}`}
          </span>
          <ManageColumnsDropdown
            columns={activeColumns}
            visible={activeState.visible}
            onToggle={activeState.toggle}
            onReset={activeState.reset}
          />
          <AccountingFilters
            value={filters}
            onChange={setFilters}
            companyOptions={brokerCompanyOptions}
            typeOptions={typeOptions}
            paymentMethodOptions={paymentOptions}
            show={{
              dateRange: true,
              companies: !isSettlementTab,
              types: !isSettlementTab,
              paymentMethods: true,
            }}
          />
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as SubTab)}>
        <TabsContent value="all" className="m-0">
          <CompanyIssuancesTable
            rows={issuancesAll}
            companies={data.companies}
            loading={data.loading}
            mode="broker"
            visible={issuanceCols.visible}
            onRowSaved={() => data.refresh()}
          />
        </TabsContent>
        <TabsContent value="issuances" className="m-0">
          <CompanyIssuancesTable
            rows={issuancesActive}
            companies={data.companies}
            loading={data.loading}
            mode="broker"
            visible={issuanceCols.visible}
            onRowSaved={() => data.refresh()}
          />
        </TabsContent>
        <TabsContent value="returns" className="m-0">
          <CompanyIssuancesTable
            rows={returns}
            companies={data.companies}
            loading={data.loading}
            mode="broker"
            visible={issuanceCols.visible}
            onRowSaved={() => data.refresh()}
          />
        </TabsContent>
        <TabsContent value="disbursements" className="m-0">
          <SettlementsTable
            rows={disbursements}
            loading={data.loading}
            voucherKind="disbursement"
            showDirection
            visible={settlementCols.visible}
            entityLabel="الوسيط"
          />
        </TabsContent>
        <TabsContent value="receipts" className="m-0">
          <SettlementsTable
            rows={receipts}
            loading={data.loading}
            voucherKind="receipt"
            showDirection
            visible={settlementCols.visible}
            entityLabel="الوسيط"
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Sep() {
  return <span className="h-5 w-px bg-border hidden sm:inline-block" />;
}

function SummaryPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'primary' | 'success' | 'amber' | 'emerald';
}) {
  const cls =
    tone === 'primary'
      ? 'text-primary'
      : tone === 'success'
      ? 'text-emerald-600'
      : tone === 'amber'
      ? 'text-amber-600'
      : 'text-emerald-700';
  return (
    <div className="inline-flex items-center gap-1.5 px-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className={`text-sm font-bold tabular-nums ${cls}`}>{value}</span>
    </div>
  );
}
