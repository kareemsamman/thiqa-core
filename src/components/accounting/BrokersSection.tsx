import { useMemo, useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowDownRight, ArrowUpRight, FileText, RotateCcw, LayoutGrid, type LucideIcon } from 'lucide-react';
import { CompanyIssuancesTable } from './CompanyIssuancesTable';
import { SettlementsTable } from './SettlementsTable';
import { AccountingFilters, AccountingFiltersValue } from './AccountingFilters';
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

  // Companies that ARE broker-linked — those are who appear in the
  // brokers section (broker_id != null on the company).
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
    rows.filter((r) => !!r.broker_id);

  const issuancesAll = onlyBroker([...data.issuances, ...data.returns]);
  const issuancesActive = onlyBroker(data.issuances);
  const returns = onlyBroker(data.returns);

  // Split broker settlements by direction.
  const disbursements = data.brokerSettlements.filter((s) => s.direction === 'we_owe');
  const receipts = data.brokerSettlements.filter((s) => s.direction === 'broker_owes');

  const totals = useMemo(() => {
    const insuranceSum = issuancesActive.reduce((s, r) => s + Number(r.insurance_price || 0), 0);
    const profitSum = issuancesActive.reduce(
      (s, r) =>
        s +
        (r.policy_type_parent === 'ELZAMI'
          ? Number(r.office_commission || 0)
          : Number(r.profit || 0)),
      0,
    );
    const disbursedSum = disbursements.reduce((s, r) => s + Number(r.total_amount || 0), 0);
    const receivedSum = receipts.reduce((s, r) => s + Number(r.total_amount || 0), 0);
    return { insuranceSum, profitSum, disbursedSum, receivedSum };
  }, [issuancesActive, disbursements, receipts]);

  const fmt = (n: number) => `₪${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard label="إجمالي عبر الوسطاء" value={fmt(totals.insuranceSum)} tone="primary" />
        <SummaryCard label="الأرباح + العمولات" value={fmt(totals.profitSum)} tone="success" />
        <SummaryCard label="مدفوع للوسطاء" value={fmt(totals.disbursedSum)} tone="amber" />
        <SummaryCard label="مقبوض من الوسطاء" value={fmt(totals.receivedSum)} tone="emerald" />
      </div>

      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <Tabs value={tab} onValueChange={(v) => setTab(v as SubTab)}>
          <TabsList>
            {TABS.map(({ key, label, Icon }) => (
              <TabsTrigger key={key} value={key} className="gap-1.5">
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{label}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <AccountingFilters
          value={filters}
          onChange={setFilters}
          companyOptions={brokerCompanyOptions}
          typeOptions={typeOptions}
          paymentMethodOptions={paymentOptions}
          show={{
            dateRange: true,
            companies: tab !== 'disbursements' && tab !== 'receipts',
            types: tab !== 'disbursements' && tab !== 'receipts',
            paymentMethods: true,
          }}
        />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as SubTab)}>
        <TabsContent value="all" className="m-0">
          <CompanyIssuancesTable
            rows={issuancesAll}
            companies={data.companies}
            loading={data.loading}
            onRowSaved={() => data.refresh()}
            storageId="accounting-brokers-all"
          />
        </TabsContent>
        <TabsContent value="issuances" className="m-0">
          <CompanyIssuancesTable
            rows={issuancesActive}
            companies={data.companies}
            loading={data.loading}
            onRowSaved={() => data.refresh()}
            storageId="accounting-brokers-issuances"
          />
        </TabsContent>
        <TabsContent value="returns" className="m-0">
          <CompanyIssuancesTable
            rows={returns}
            companies={data.companies}
            loading={data.loading}
            onRowSaved={() => data.refresh()}
            storageId="accounting-brokers-returns"
          />
        </TabsContent>
        <TabsContent value="disbursements" className="m-0">
          <SettlementsTable
            rows={disbursements}
            loading={data.loading}
            voucherKind="disbursement"
            showDirection
            storageId="accounting-brokers-disbursements"
            entityLabel="الوسيط"
          />
        </TabsContent>
        <TabsContent value="receipts" className="m-0">
          <SettlementsTable
            rows={receipts}
            loading={data.loading}
            voucherKind="receipt"
            showDirection
            storageId="accounting-brokers-receipts"
            entityLabel="الوسيط"
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SummaryCard({
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
    <Card>
      <CardContent className="py-3 px-4">
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        <p className={`text-lg font-bold tabular-nums ${cls}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
