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
  COMPANY_ISSUANCE_COLUMNS,
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

const ISSUANCE_KEYS = COMPANY_ISSUANCE_COLUMNS.map((c) => c.key);
const ISSUANCE_DEFAULT_VISIBLE = ISSUANCE_KEYS.filter((k) => !ISSUANCE_DEFAULT_OFF.has(k));
const SETTLEMENT_KEYS = SETTLEMENT_COLUMNS.map((c) => c.key);
const SETTLEMENT_DEFAULT_VISIBLE = SETTLEMENT_KEYS.filter((k) => !SETTLEMENT_DEFAULT_OFF.has(k));

export function CompaniesSection() {
  const [tab, setTab] = useState<SubTab>('all');
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [addKind, setAddKind] = useState<SettlementKind>('disbursement');
  const [editRow, setEditRow] = useState<SettlementRow | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  // Live overlay of inline edits across the issuances table — owned
  // here so the summary pills + calculation modal can mirror the cell
  // values before the debounced save flushes back. Keyed by row.id.
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
    // If the voucher consumed customer cheques, release them back to
    // the available pool so they can be re-used for another settlement.
    const { data: settlement, error: readError } = await supabase
      .from('company_settlements')
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
    const { error } = await supabase.from('company_settlements').delete().eq('id', row.id);
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

  // One visibility state per logical table type. Issuance tabs (all /
  // issuances / returns) all show the same column set, so they share
  // a single store. Disbursements + receipts share another. v3 forces
  // a clean slate after the layout refactor.
  const issuanceCols = useTableColumnVisibility(
    'accounting-companies-issuances-v4',
    ISSUANCE_DEFAULT_VISIBLE,
    ISSUANCE_KEYS,
  );
  const settlementCols = useTableColumnVisibility(
    'accounting-companies-settlements-v3',
    SETTLEMENT_DEFAULT_VISIBLE,
    SETTLEMENT_KEYS,
  );

  const isSettlementTab = tab === 'disbursements' || tab === 'receipts';
  const activeColumns = isSettlementTab ? SETTLEMENT_COLUMNS : COMPANY_ISSUANCE_COLUMNS;
  const activeState = isSettlementTab ? settlementCols : issuanceCols;

  const companyOptions = useMemo(
    () =>
      data.companies
        .filter((c) => !c.broker_id)
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

  // Memoized: recompute only when the underlying data or the search
  // string changes — not on every editLocal keystroke.
  const issuancesAll = useMemo(
    () =>
      [...data.issuances, ...data.returns]
        .filter((r) => !r.main.broker_id)
        .filter((r) => matchesIssuanceSearch(r, search)),
    [data.issuances, data.returns, search],
  );
  const issuancesActive = useMemo(
    () =>
      data.issuances
        .filter((r) => !r.main.broker_id)
        .filter((r) => matchesIssuanceSearch(r, search)),
    [data.issuances, search],
  );
  const returns = useMemo(
    () =>
      data.returns
        .filter((r) => !r.main.broker_id)
        .filter((r) => matchesIssuanceSearch(r, search)),
    [data.returns, search],
  );
  const companySettlements = useMemo(
    () => data.companySettlements.filter((r) => matchesSettlementSearch(r, search)),
    [data.companySettlements, search],
  );
  const companyReceipts = useMemo(
    () => data.companyReceipts.filter((r) => matchesSettlementSearch(r, search)),
    [data.companyReceipts, search],
  );

  const totals = useMemo(() => {
    // Apply the live edit overlay so the pills move in lock-step with
    // the table cells the user is typing into.
    const overlayed = issuancesActive.map((r) => applyOverlay(r, editLocal));
    const insuranceSum = overlayed.reduce((s, r) => s + Number(r.insurance_price || 0), 0);
    const dueSum = overlayed.reduce((s, r) => s + Number(r.payed_for_company || 0), 0);
    const profitSum = overlayed.reduce(
      (s, r) => s + Number(r.profit || 0) + Number(r.office_commission || 0),
      0,
    );
    const disbursedSum = companySettlements.reduce(
      (s, r) => s + Number(r.total_amount || 0),
      0,
    );
    return { insuranceSum, dueSum, profitSum, disbursedSum };
  }, [issuancesActive, companySettlements, editLocal]);

  const fmt = (n: number) => `₪${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

  const activeRowCount =
    tab === 'all'
      ? issuancesAll.length
      : tab === 'issuances'
      ? issuancesActive.length
      : tab === 'returns'
      ? returns.length
      : tab === 'disbursements'
      ? companySettlements.length
      : companyReceipts.length;
  const countLabel = isSettlementTab ? 'سند' : 'معاملة';

  return (
    <div className="space-y-2.5">
      {/* Compact summary strip — single horizontal row of pills. */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2">
        <SummaryPill label="إجمالي سعر التأمين" value={fmt(totals.insuranceSum)} tone="primary" />
        <Sep />
        <SummaryPill label="المستحق للشركات" value={fmt(totals.dueSum)} tone="destructive" />
        <Sep />
        <SummaryPill label="الأرباح + العمولات" value={fmt(totals.profitSum)} tone="success" />
        <Sep />
        <SummaryPill label="مدفوع للشركات" value={fmt(totals.disbursedSum)} tone="amber" />
      </div>

      {/* Single toolbar row: sub-tabs + count + manage columns + filter. */}
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
            companyOptions={companyOptions}
            typeOptions={typeOptions}
            paymentMethodOptions={paymentOptions}
            show={{
              dateRange: true,
              companies: true,
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
            mode="company"
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
            mode="company"
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
            mode="company"
            visible={issuanceCols.visible}
            editLocal={editLocal}
            onPatch={onPatch}
            onSubPolicySaved={(id, patch) => data.patchSubPolicy(id, patch)}
          />
        </TabsContent>
        <TabsContent value="disbursements" className="m-0">
          <SettlementsTable
            rows={companySettlements}
            loading={data.loading}
            voucherKind="disbursement"
            visible={settlementCols.visible}
            entityLabel="شركة التأمين"
            onEdit={handleEdit}
            onDelete={handleDelete}
          />
        </TabsContent>
        <TabsContent value="receipts" className="m-0">
          <SettlementsTable
            rows={companyReceipts}
            loading={data.loading}
            voucherKind="receipt"
            visible={settlementCols.visible}
            entityLabel="شركة التأمين"
            onEdit={handleEdit}
            onDelete={handleDelete}
          />
          {!data.loading && companyReceipts.length === 0 && (
            <p className="text-center text-xs text-muted-foreground mt-3">
              لا يوجد سندات قبض — استخدم زر "إضافة سند قبض" لتسجيل دفعة واردة من شركة.
            </p>
          )}
        </TabsContent>
      </Tabs>

      <AddSettlementDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        mode="company"
        kind={addKind}
        entities={companyOptions.map((c) => ({ id: c.value, name: c.label }))}
        onSaved={() => data.refresh()}
      />

      <EditSettlementDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        table="company_settlements"
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
    <div className="inline-flex items-center gap-1.5 px-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className={`text-sm font-bold tabular-nums ${cls}`}>{value}</span>
    </div>
  );
}
