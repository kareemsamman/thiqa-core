import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  ArrowDownRight,
  ArrowUpRight,
  FileText,
  Plus,
  RotateCcw,
  LayoutGrid,
  Search,
  type LucideIcon,
} from 'lucide-react';
import { AddSettlementDialog, SettlementKind } from './AddSettlementDialog';
import { EditSettlementDialog } from './EditSettlementDialog';
import { SettlementRow } from './SettlementsTable';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
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
import {
  matchesIssuanceSearch,
  matchesSettlementSearch,
  useAccountingData,
} from './useAccountingData';
import {
  IssuanceEditOverlay,
  IssuanceEditPatch,
  POLICY_TYPE_DISPLAY,
  PAYMENT_METHOD_LABELS,
  applyOverlay,
} from './accountingTypes';

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
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [addKind, setAddKind] = useState<SettlementKind>('disbursement');
  const [editRow, setEditRow] = useState<SettlementRow | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editLocal, setEditLocal] = useState<IssuanceEditOverlay>({});
  const onPatch = (rowId: string, patch: IssuanceEditPatch) =>
    setEditLocal((prev) => ({ ...prev, [rowId]: { ...(prev[rowId] ?? {}), ...patch } }));
  const [filters, setFilters] = useState<AccountingFiltersValue>({
    dateFrom: '',
    dateTo: '',
    companies: [],
    types: [],
    paymentMethods: [],
  });

  const data = useAccountingData(filters);

  const handleDelete = async (row: SettlementRow) => {
    const { data: settlement, error: readError } = await supabase
      .from('broker_settlements')
      .select('customer_cheque_ids')
      .eq('id', row.id)
      .maybeSingle();
    if (!readError && settlement) {
      const ids = (settlement as { customer_cheque_ids?: string[] | null }).customer_cheque_ids;
      if (Array.isArray(ids) && ids.length > 0) {
        await supabase
          .from('policy_payments')
          .update({
            cheque_status: 'pending',
            transferred_to_type: null,
            transferred_to_id: null,
            transferred_payment_id: null,
            transferred_at: null,
          })
          .in('id', ids);
      }
    }
    const { error } = await supabase.from('broker_settlements').delete().eq('id', row.id);
    if (error) {
      toast.error(`فشل الحذف: ${error.message}`);
      return;
    }
    toast.success('تم حذف السند');
    data.refresh();
  };

  const handleEdit = (row: SettlementRow) => {
    setEditRow(row);
    setEditOpen(true);
  };

  const issuanceCols = useTableColumnVisibility(
    'accounting-brokers-issuances-v4',
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

  // Memoized — see CompaniesSection for the rationale.
  const issuancesAll = useMemo(
    () =>
      [...data.issuances, ...data.returns]
        .filter((r) => !!r.main.broker_id)
        .filter((r) => matchesIssuanceSearch(r, search)),
    [data.issuances, data.returns, search],
  );
  const issuancesActive = useMemo(
    () =>
      data.issuances
        .filter((r) => !!r.main.broker_id)
        .filter((r) => matchesIssuanceSearch(r, search)),
    [data.issuances, search],
  );
  const returns = useMemo(
    () =>
      data.returns
        .filter((r) => !!r.main.broker_id)
        .filter((r) => matchesIssuanceSearch(r, search)),
    [data.returns, search],
  );

  const disbursements = useMemo(
    () =>
      data.brokerSettlements
        .filter((s) => s.direction === 'we_owe')
        .filter((r) => matchesSettlementSearch(r, search)),
    [data.brokerSettlements, search],
  );
  const receipts = useMemo(
    () =>
      data.brokerSettlements
        .filter((s) => s.direction === 'broker_owes')
        .filter((r) => matchesSettlementSearch(r, search)),
    [data.brokerSettlements, search],
  );

  const totals = useMemo(() => {
    // Live overlay mirrors typed cell values into the pills before the
    // debounced save flushes back. For broker rows, profit lives on
    // each row's `profit` aggregate (which the recalc job sets to
    // `insurance_price - broker_buy_price` for from_broker rows and to
    // `insurance_price - payed_for_company` for to_broker rows), so
    // summing it works for either direction.
    const overlayed = issuancesActive.map((r) => applyOverlay(r, editLocal));
    const sellSum = overlayed.reduce((s, r) => s + Number(r.insurance_price || 0), 0);
    const profitSum = overlayed.reduce((s, r) => {
      if (r.main.broker_direction === 'to_broker') {
        return s + Number(r.profit || 0);
      }
      return s + Math.max(0, Number(r.insurance_price || 0) - Number(r.broker_buy_price || 0));
    }, 0);
    const disbursedSum = disbursements
      .filter((r) => !r.refused)
      .reduce((s, r) => s + Number(r.total_amount || 0), 0);
    const receivedSum = receipts
      .filter((r) => !r.refused)
      .reduce((s, r) => s + Number(r.total_amount || 0), 0);
    // Gross we owe brokers = sum of broker_buy_price on policies where
    // we bought from the broker (from_broker direction). The to_broker
    // rows are where we sold to the broker, so we don't owe them
    // anything against those — broker_buy_price = 0 in that case.
    const grossOwed = overlayed.reduce((s, r) => {
      if (r.main.broker_direction === 'to_broker') return s;
      return s + Number(r.broker_buy_price || 0);
    }, 0);
    // Net "still owe brokers" — what the user wants on the pill: a
    // disbursement reduces it.
    const remainingDueSum = Math.max(0, grossOwed - disbursedSum);
    return { sellSum, profitSum, disbursedSum, receivedSum, remainingDueSum };
  }, [issuancesActive, disbursements, receipts, editLocal]);

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
        <SummaryPill label="متبقي للوسطاء" value={fmt(totals.remainingDueSum)} tone="destructive" />
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
          <div className="relative w-full sm:w-80 md:w-96">
            <Search className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث بالاسم، رقم المعاملة، الهوية…"
              className="h-8 w-full pr-8 text-sm"
            />
          </div>
          {(tab === 'disbursements' || tab === 'receipts') && (
            <Button
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => {
                setAddKind(tab === 'disbursements' ? 'disbursement' : 'receipt');
                setAddOpen(true);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              {tab === 'disbursements' ? 'إضافة سند صرف' : 'إضافة سند قبض'}
            </Button>
          )}
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
            editLocal={editLocal}
            onPatch={onPatch}
            onSubPolicySaved={(id, patch) => data.patchSubPolicy(id, patch)}
          />
        </TabsContent>
        <TabsContent value="issuances" className="m-0">
          <CompanyIssuancesTable
            rows={issuancesActive}
            companies={data.companies}
            loading={data.loading}
            mode="broker"
            visible={issuanceCols.visible}
            editLocal={editLocal}
            onPatch={onPatch}
            onSubPolicySaved={(id, patch) => data.patchSubPolicy(id, patch)}
          />
        </TabsContent>
        <TabsContent value="returns" className="m-0">
          <CompanyIssuancesTable
            rows={returns}
            companies={data.companies}
            loading={data.loading}
            mode="broker"
            visible={issuanceCols.visible}
            editLocal={editLocal}
            onPatch={onPatch}
            onSubPolicySaved={(id, patch) => data.patchSubPolicy(id, patch)}
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
            onEdit={handleEdit}
            onDelete={handleDelete}
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
            onEdit={handleEdit}
            onDelete={handleDelete}
          />
        </TabsContent>
      </Tabs>

      <AddSettlementDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        mode="broker"
        kind={addKind}
        entities={data.brokers.map((b) => ({ id: b.id, name: b.name }))}
        onSaved={() => data.refresh()}
      />

      <EditSettlementDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        table="broker_settlements"
        row={editRow}
        onSaved={() => data.refresh()}
      />
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
  tone: 'primary' | 'success' | 'amber' | 'emerald' | 'destructive';
}) {
  const cls =
    tone === 'primary'
      ? 'text-primary'
      : tone === 'success'
      ? 'text-emerald-600'
      : tone === 'amber'
      ? 'text-amber-600'
      : tone === 'destructive'
      ? 'text-destructive'
      : 'text-emerald-700';
  return (
    <div className="inline-flex items-center gap-1.5 px-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className={`text-sm font-bold tabular-nums ${cls}`}>{value}</span>
    </div>
  );
}
