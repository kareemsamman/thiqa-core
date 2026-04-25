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

export function CompaniesSection() {
  const [tab, setTab] = useState<SubTab>('all');
  const [filters, setFilters] = useState<AccountingFiltersValue>({
    dateFrom: '',
    dateTo: '',
    companies: [],
    types: [],
    paymentMethods: [],
  });

  const data = useAccountingData(filters);

  const companyOptions = useMemo(
    () =>
      data.companies
        .filter((c) => !c.broker_id) // exclude broker-linked companies from companies section
        .map((c) => ({ value: c.id, label: c.name_ar || c.name })),
    [data.companies],
  );

  const typeOptions = useMemo(
    () =>
      Object.entries(POLICY_TYPE_DISPLAY).map(([value, label]) => ({ value, label })),
    [],
  );

  const paymentOptions = useMemo(
    () =>
      Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => ({ value, label })),
    [],
  );

  // Restrict to companies (not broker-linked) on the policies side too.
  const onlyDirect = (rows: typeof data.issuances) =>
    rows.filter((r) => !r.main.broker_id);

  const issuancesAll = onlyDirect([...data.issuances, ...data.returns]);
  const issuancesActive = onlyDirect(data.issuances);
  const returns = onlyDirect(data.returns);

  const totals = useMemo(() => {
    const insuranceSum = issuancesActive.reduce((s, r) => s + Number(r.insurance_price || 0), 0);
    const dueSum = issuancesActive.reduce((s, r) => s + Number(r.payed_for_company || 0), 0);
    // Profit per row = profit for non-ELZAMI sub-policies + office_commission
    // for ELZAMI sub-policies. The aggregate fields already sum each
    // separately across the package, so we just add both pots.
    const profitSum = issuancesActive.reduce(
      (s, r) => s + Number(r.profit || 0) + Number(r.office_commission || 0),
      0,
    );
    const disbursedSum = data.companySettlements.reduce(
      (s, r) => s + Number(r.total_amount || 0),
      0,
    );
    return { insuranceSum, dueSum, profitSum, disbursedSum };
  }, [issuancesActive, data.companySettlements]);

  const fmt = (n: number) => `₪${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

  return (
    <div className="space-y-3">
      {/* Top totals + filter */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <SummaryCard label="إجمالي سعر التأمين" value={fmt(totals.insuranceSum)} tone="primary" />
        <SummaryCard label="المستحق للشركات" value={fmt(totals.dueSum)} tone="destructive" />
        <SummaryCard label="الأرباح + العمولات" value={fmt(totals.profitSum)} tone="success" />
        <SummaryCard label="مدفوع للشركات" value={fmt(totals.disbursedSum)} tone="amber" />
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
          companyOptions={companyOptions}
          typeOptions={typeOptions}
          paymentMethodOptions={paymentOptions}
          show={{
            dateRange: true,
            companies: true,
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
            mode="company"
            onRowSaved={() => data.refresh()}
            storageId="accounting-companies-all"
          />
        </TabsContent>

        <TabsContent value="issuances" className="m-0">
          <CompanyIssuancesTable
            rows={issuancesActive}
            companies={data.companies}
            loading={data.loading}
            mode="company"
            onRowSaved={() => data.refresh()}
            storageId="accounting-companies-issuances"
          />
        </TabsContent>

        <TabsContent value="returns" className="m-0">
          <CompanyIssuancesTable
            rows={returns}
            companies={data.companies}
            loading={data.loading}
            mode="company"
            onRowSaved={() => data.refresh()}
            storageId="accounting-companies-returns"
          />
        </TabsContent>

        <TabsContent value="disbursements" className="m-0">
          <SettlementsTable
            rows={data.companySettlements}
            loading={data.loading}
            voucherKind="disbursement"
            storageId="accounting-companies-disbursements"
            entityLabel="شركة التأمين"
          />
        </TabsContent>

        <TabsContent value="receipts" className="m-0">
          <SettlementsTable
            rows={data.companyReceipts}
            loading={data.loading}
            voucherKind="receipt"
            storageId="accounting-companies-receipts"
            entityLabel="شركة التأمين"
          />
          {!data.loading && data.companyReceipts.length === 0 && (
            <p className="text-center text-xs text-muted-foreground mt-3">
              لا يوجد سندات قبض من شركات التأمين — جميع تحصيلات الشركات تتم عبر تسوية الصرف.
            </p>
          )}
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
  tone: 'primary' | 'destructive' | 'success' | 'amber';
}) {
  const cls =
    tone === 'primary'
      ? 'text-primary'
      : tone === 'destructive'
      ? 'text-destructive'
      : tone === 'success'
      ? 'text-emerald-600'
      : 'text-amber-600';
  return (
    <Card>
      <CardContent className="py-2 px-3">
        <p className="text-[11px] text-muted-foreground mb-0.5">{label}</p>
        <p className={`text-base font-bold tabular-nums ${cls}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
