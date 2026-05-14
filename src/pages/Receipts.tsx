import { useState, useEffect, useCallback, useMemo } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Header } from "@/components/layout/Header";
import { AgentBranchFilter } from "@/components/shared/AgentBranchFilter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { PrintProgressDialog } from "@/components/shared/PrintProgressDialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Search,
  Plus,
  Printer,
  Receipt,
  Banknote,
  FileText,
  CreditCard,
  Building,
  Loader2,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Pencil,
  Trash2,
  XCircle,
  Ban,
  Wallet,
  Layers,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useAgentContext } from "@/hooks/useAgentContext";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { format } from "date-fns";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";
import { PaymentEditDialog } from "@/components/clients/PaymentEditDialog";
import {
  DebtPaymentModal,
  type DebtPaymentEditingSession,
} from "@/components/debt/DebtPaymentModal";
import {
  ReceiptGroupDetailsDialog,
  type ReceiptGroupView,
  type ReceiptRow,
} from "@/components/receipts/ReceiptGroupDetailsDialog";
import {
  AddVoucherDialog,
  type ClientLite,
  type BrokerLite,
  type VoucherPickResult,
} from "@/components/receipts/AddVoucherDialog";
import { AddCreditNoteDialog } from "@/components/receipts/AddCreditNoteDialog";
import { AddSettlementDialog } from "@/components/accounting/AddSettlementDialog";
import { DebtPaymentSuccessDialog } from "@/components/debt/DebtPaymentSuccessDialog";
import { VoucherSendDialog, type VoucherKind as VoucherSendKind } from "@/components/policies/VoucherSendDialog";
import { printAccountingReport } from "@/components/accounting/printAccountingReport";
import {
  AccountingFilters,
  type AccountingFiltersValue,
} from "@/components/accounting/AccountingFilters";
import {
  ManageColumnsDropdown,
  type ColumnOption,
} from "@/components/accounting/ManageColumnsDropdown";
import { POLICY_TYPE_DISPLAY } from "@/components/accounting/accountingTypes";
import { useTableColumnVisibility } from "@/hooks/useTableColumnVisibility";

// ─── Types ───────────────────────────────────────────────────────────

// The shared ReceiptRow shape lives in ReceiptGroupDetailsDialog so the
// page and the popup agree on one type. ReceiptRecord adds agent_id for
// the page's own insert/update calls.
interface ReceiptRecord extends ReceiptRow {
  agent_id: string;
}

interface ReceiptGroup extends ReceiptGroupView {
  created_minute: string;
  // Pulled from the first policy in the group; nullable for manual receipts.
  company_name: string | null;
  policy_type_label: string | null;
  client_id_number: string | null;
}

// ─── Constants ───────────────────────────────────────────────────────

const PAYMENT_METHOD_LABELS: Record<string, { label: string; icon: typeof Banknote }> = {
  cash: { label: "نقدي", icon: Banknote },
  cheque: { label: "شيك", icon: FileText },
  visa: { label: "فيزا", icon: CreditCard },
  visa_external: { label: "فيزا خارجي", icon: CreditCard },
  transfer: { label: "تحويل", icon: Building },
};

const PAYMENT_METHOD_OPTIONS = [
  { value: "all", label: "الكل" },
  { value: "cash", label: "نقدي" },
  { value: "cheque", label: "شيك" },
  { value: "visa", label: "فيزا" },
  { value: "transfer", label: "تحويل" },
];

const PAGE_SIZE = 50;

// Module-level default so every per-tab "no filters set yet" lookup
// returns the SAME object reference — avoids triggering useCallback /
// useEffect deps with a fresh empty filter set on every render.
const DEFAULT_FILTERS: AccountingFiltersValue = {
  dateFrom: "",
  dateTo: "",
  companies: [],
  types: [],
  paymentMethods: [],
};

// Tiny coloured pill rendered under the voucher number on the "الكل"
// tab so the user can tell سند قبض from سند إلغاء at a glance — both
// share the R-prefix in the receipt_number column. On single-type
// tabs the badge is redundant (the tab itself is the type indicator),
// so it's gated to activeTab === 'all' below.
const RECEIPT_TYPE_BADGE: Record<
  string,
  {
    label: string;
    variant: 'success' | 'destructive' | 'warning' | 'outline';
    icon: typeof Receipt;
  }
> = {
  payment: { label: 'سند قبض', variant: 'success', icon: Receipt },
  cancellation: { label: 'سند إلغاء', variant: 'destructive', icon: Ban },
  credit_note: { label: 'إشعار دائن', variant: 'warning', icon: Wallet },
  disbursement: { label: 'سند صرف', variant: 'outline', icon: Banknote },
};

// Display the receipts table's numeric receipt_number in the same
// "R{seq}/{year}" form policy_payments uses, so سندات قبض and
// تفاصيل الدفعات agree visually. Year is derived from the row's
// receipt_date; strings that already start with "R" pass through
// untouched (legacy auto-source rows that mirror policy_payments).
const formatReceiptNumber = (
  num: number | string | null | undefined,
  dateStr: string | null | undefined,
): string => {
  if (num == null || num === "") return "-";
  const s = String(num);
  if (s.startsWith("R")) return s;
  const n = Number(s);
  if (Number.isNaN(n)) return s;
  const year = dateStr ? new Date(dateStr).getFullYear() : new Date().getFullYear();
  const seq = n < 10 ? `0${n}` : `${n}`;
  return `R${seq}/${year}`;
};

// ─── Columns ─────────────────────────────────────────────────────────
//
// Schema for the manage-columns dropdown. actions is required (the row
// would lose its interactivity without it). Default visibility excludes
// ملاحظات / رقم الشيك since those only matter to a subset of users —
// they can opt in via the dropdown.
const RECEIPTS_COLUMNS: ColumnOption[] = [
  { key: "receipt_number", label: "رقم سند القبض" },
  // "النوع" is only meaningful on the "الكل" tab — single-type tabs
  // are filtered out of the column list below so the option doesn't
  // even appear in the Manage Columns dropdown there.
  { key: "receipt_type", label: "النوع" },
  { key: "amount", label: "المبلغ" },
  { key: "receipt_date", label: "التاريخ" },
  { key: "client_name", label: "اسم العميل" },
  { key: "client_id_number", label: "رقم هوية العميل" },
  { key: "car_number", label: "رقم السيارة" },
  { key: "company_name", label: "شركة التأمين" },
  { key: "policy_type", label: "نوع التأمين" },
  { key: "payment_method", label: "طريقة الدفع" },
  { key: "cheque_number", label: "رقم الشيك" },
  { key: "notes", label: "ملاحظات" },
  { key: "actions", label: "إجراءات", required: true },
];

const RECEIPTS_DEFAULT_VISIBLE = [
  "receipt_number",
  "receipt_type",
  "amount",
  "receipt_date",
  "client_name",
  "car_number",
  "payment_method",
  "actions",
];

const RECEIPTS_COLUMN_KEYS = RECEIPTS_COLUMNS.map((c) => c.key);

// Map a UI policy-type key (ELZAMI / THIRD / FULL / ROAD_SERVICE / ...)
// back to the (parent, child?) tuple stored on the policies table. THIRD
// and FULL share parent THIRD_FULL; everything else lives directly on
// the parent column.
function typeKeyToFilterClause(key: string): string {
  if (key === "THIRD" || key === "FULL") {
    return `and(policy_type_parent.eq.THIRD_FULL,policy_type_child.eq.${key})`;
  }
  return `policy_type_parent.eq.${key}`;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function roundToMinute(dateStr: string): string {
  const d = new Date(dateStr);
  d.setSeconds(0, 0);
  return d.toISOString();
}

function formatDate(dateStr: string): string {
  try {
    return format(new Date(dateStr), "yyyy-MM-dd");
  } catch {
    return dateStr;
  }
}

// A receipt is an "إلزامي passthrough" when its joined policy is
// ELZAMI and the amount equals that policy's insurance_price.
// Those rows are money the customer paid directly to the insurance
// company (typically by visa) — not collected by the agency — so
// the user wants the option to hide them from the receipts list.
// Manual receipts (no joined policy) are never passthroughs.
function isElzamiPassthrough(r: { amount: number; policy?: any }): boolean {
  const rawPolicy = r.policy;
  const policy = Array.isArray(rawPolicy) ? rawPolicy[0] ?? null : rawPolicy ?? null;
  if (!policy) return false;
  if (policy.policy_type_parent !== "ELZAMI") return false;
  const price = Number(policy.insurance_price ?? 0);
  if (price <= 0) return false;
  return Math.abs(Number(r.amount) - price) < 0.005;
}

function paymentLabelShort(method: string): string {
  return {
    cash: "نقدي",
    cheque: "شيك",
    visa: "فيزا",
    visa_external: "فيزا خارجي",
    transfer: "تحويل",
    // Mirrored from client_settlements when a multi-line disbursement
    // mixes payment types (e.g. cheque + visa under one D{nn}/YYYY).
    multiple: "متعدد",
  }[method] || method;
}

function getPaymentBadge(method: string) {
  const info = PAYMENT_METHOD_LABELS[method];
  if (!info) return <Badge variant="secondary">{method}</Badge>;
  const Icon = info.icon;
  return (
    <Badge variant="outline" className="gap-1">
      <Icon className="h-3 w-3" />
      {info.label}
    </Badge>
  );
}

// ─── Print Builder ───────────────────────────────────────────────────

function buildReceiptPrintHtml(
  group: ReceiptGroup,
  logoUrl: string | null,
  businessName: string,
): string {
  const today = new Date().toLocaleDateString("en-GB");
  const total = group.total.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const pmLabel = (m: string) => PAYMENT_METHOD_LABELS[m]?.label || m;

  const tableRows = group.receipts
    .map((r, i) => {
      const amt = r.amount.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      return `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">${i + 1}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${formatReceiptNumber(r.receipt_number, r.receipt_date)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${formatDate(r.receipt_date)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${pmLabel(r.payment_method)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${r.cheque_number || "-"}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${r.notes || "-"}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:left;font-weight:600;">₪${amt}</td>
      </tr>`;
    })
    .join("");

  const logoHtml = logoUrl
    ? `<img src="${logoUrl}" alt="Logo" style="max-height:70px;object-fit:contain;" />`
    : "";

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <title>إيصال</title>
  <style>
    @page { size: A4; margin: 15mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Arial', 'Tahoma', 'Noto Sans Arabic', sans-serif;
      direction: rtl;
      color: #1f2937;
      background: #fff;
      padding: 30px 40px;
      font-size: 13px;
    }
    .header-box {
      border: 3px solid #1e3a5f;
      border-radius: 8px;
      padding: 16px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }
    .header-right { text-align: right; }
    .header-right .biz-name {
      font-size: 22px;
      font-weight: 700;
      color: #1e3a5f;
      margin-bottom: 2px;
    }
    .header-center { text-align: center; }
    .header-left {
      text-align: left;
      font-size: 13px;
      color: #374151;
      font-weight: 600;
    }
    .title-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
      padding: 8px 0;
      border-bottom: 2px solid #1e3a5f;
    }
    .title-row .doc-title {
      font-size: 26px;
      font-weight: 700;
      color: #1e3a5f;
    }
    .title-row .doc-copy {
      font-size: 13px;
      color: #6b7280;
      font-weight: 600;
    }
    .info-section {
      display: flex;
      justify-content: space-between;
      margin-bottom: 16px;
      gap: 16px;
    }
    .info-box {
      flex: 1;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 10px 14px;
    }
    .info-box .label {
      font-size: 11px;
      color: #94a3b8;
      margin-bottom: 2px;
    }
    .info-box .value {
      font-size: 14px;
      font-weight: 600;
      color: #1e293b;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
    }
    thead th {
      background: #1e3a5f;
      color: #fff;
      padding: 10px 12px;
      font-size: 12px;
      font-weight: 600;
      text-align: right;
    }
    thead th:first-child { border-radius: 0 6px 0 0; text-align: center; }
    thead th:last-child { border-radius: 6px 0 0 0; text-align: left; }
    tbody tr:nth-child(even) { background: #f9fafb; }
    .summary-box {
      display: flex;
      justify-content: flex-start;
      margin-top: 10px;
    }
    .summary-inner {
      background: linear-gradient(135deg, #1e3a5f, #2d5a8e);
      color: #fff;
      border-radius: 10px;
      padding: 16px 32px;
      text-align: center;
      min-width: 220px;
    }
    .summary-inner .total-label {
      font-size: 12px;
      opacity: 0.85;
      margin-bottom: 4px;
    }
    .summary-inner .total-value {
      font-size: 26px;
      font-weight: 700;
    }
    .footer {
      margin-top: 40px;
      padding-top: 12px;
      border-top: 1px solid #e5e7eb;
      text-align: center;
      font-size: 11px;
      color: #9ca3af;
    }
    @media print {
      body { padding: 0; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="header-box">
    <div class="header-right">
      <div class="biz-name">${businessName}</div>
    </div>
    <div class="header-center">
      ${logoHtml}
    </div>
    <div class="header-left">
      تاريخ الطباعة: ${today}
    </div>
  </div>

  <div class="title-row">
    <div class="doc-title">إيصال</div>
    <div class="doc-copy">نسخة</div>
  </div>

  <div class="info-section">
    <div class="info-box">
      <div class="label">اسم العميل</div>
      <div class="value">${group.client_name}</div>
    </div>
    <div class="info-box">
      <div class="label">رقم السيارة</div>
      <div class="value">${group.car_number || "-"}</div>
    </div>
    <div class="info-box">
      <div class="label">عدد البنود</div>
      <div class="value">${group.receipts.length}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="text-align:center;">م</th>
        <th>رقم الإيصال</th>
        <th>التاريخ</th>
        <th>طريقة الدفع</th>
        <th>رقم الشيك</th>
        <th>ملاحظات</th>
        <th style="text-align:left;">المبلغ ₪</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows}
    </tbody>
  </table>

  <div class="summary-box">
    <div class="summary-inner">
      <div class="total-label">المجموع الكلي</div>
      <div class="total-value">₪${total}</div>
    </div>
  </div>

  <div class="footer">
    ${businessName} &bull; هذا المستند تم إنشاؤه تلقائياً
  </div>
</body>
</html>`;
}

function openReceiptPrint(html: string) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    toast.error("يرجى السماح بالنوافذ المنبثقة للطباعة");
    return;
  }
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.onafterprint = () => printWindow.close();
  printWindow.onload = () => setTimeout(() => printWindow.print(), 400);
}

// ─── Component ───────────────────────────────────────────────────────

export default function Receipts() {
  const { profile } = useAuth();
  const { agentId, loading: agentLoading } = useAgentContext();
  const { data: siteSettings } = useSiteSettings();

  // Data
  const [receipts, setReceipts] = useState<ReceiptRecord[]>([]);
  const [loading, setLoading] = useState(true);
  // Tabs:
  //  - payment:      سندات قبض  → receipt_type='payment'  (cancelled
  //                  originals stay here with a "ملغي" badge so the
  //                  audit trail surfaces in the same place the cashier
  //                  always looked)
  //  - cancellation: سندات إلغاء → receipt_type='cancellation' (vouchers
  //                  inserted by sync_receipt_from_policy_payment when
  //                  a payment is voided)
  // Legacy accident_fee rows are filtered out by the .eq() in
  // fetchReceipts and don't have their own tab.
  // Four receipt families in this page:
  //   • payment      — سندات القبض      (R{n}/YYYY, money in)
  //   • cancellation — سندات الإلغاء    (R{n}/YYYY voided)
  //   • credit_note  — اشعار دائن       (C{n}/YYYY, wallet credit)
  //   • disbursement — سند صرف          (D{n}/YYYY, money out)
  // activeTab maps 1:1 to receipts.receipt_type so the existing
  // .eq("receipt_type", activeTab) filter Just Works. 'all' is the
  // combined view — receipt_type filter is dropped and per-row logic
  // takes over (labels, print routing, action visibility).
  const [activeTab, setActiveTab] = useState<
    'all' | 'payment' | 'cancellation' | 'credit_note' | 'disbursement'
  >('all');

  // Filters — search stays inline in the toolbar; everything else lives
  // in the AccountingFilters popover so we get one canonical filter UI
  // across the app (date range / month, companies, types, payment
  // methods).
  // Filters / search / "hide إلزامي" / branch — all per-tab so the
  // user can keep one set of criteria on سندات القبض and another on
  // الكل without one stomping the other. Storage is in-memory only
  // (these are session-state, not preferences worth persisting).
  const [searchByTab, setSearchByTab] = useState<Record<string, string>>({});
  const [filtersByTab, setFiltersByTab] = useState<Record<string, AccountingFiltersValue>>({});
  const [branchByTab, setBranchByTab] = useState<Record<string, string | null>>({});
  const [hideElzamiByTab, setHideElzamiByTab] = useState<Record<string, boolean>>({});

  const searchQuery = searchByTab[activeTab] ?? "";
  const filters = filtersByTab[activeTab] ?? DEFAULT_FILTERS;
  const branchFilter = branchByTab[activeTab] ?? null;
  const hideElzamiPayments = hideElzamiByTab[activeTab] ?? false;

  const setSearchQuery = useCallback(
    (v: string) => setSearchByTab((prev) => ({ ...prev, [activeTab]: v })),
    [activeTab],
  );
  const setFilters = useCallback(
    (v: AccountingFiltersValue) =>
      setFiltersByTab((prev) => ({ ...prev, [activeTab]: v })),
    [activeTab],
  );
  const setBranchFilter = useCallback(
    (v: string | null) => setBranchByTab((prev) => ({ ...prev, [activeTab]: v })),
    [activeTab],
  );
  const setHideElzamiPayments = useCallback(
    (v: boolean) => setHideElzamiByTab((prev) => ({ ...prev, [activeTab]: v })),
    [activeTab],
  );

  // Insurance companies — loaded once for the filter dropdown options.
  const [companyOptions, setCompanyOptions] = useState<
    Array<{ value: string; label: string }>
  >([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("insurance_companies")
        .select("id, name, name_ar")
        .eq("active", true)
        .order("name");
      if (cancelled) return;
      setCompanyOptions(
        (data ?? []).map((c: any) => ({
          value: c.id,
          label: c.name_ar || c.name,
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const typeOptions = useMemo(
    () =>
      Object.entries(POLICY_TYPE_DISPLAY).map(([value, label]) => ({
        value,
        label,
      })),
    [],
  );

  const paymentMethodOptions = useMemo(
    () => PAYMENT_METHOD_OPTIONS.filter((o) => o.value !== "all"),
    [],
  );

  // Column visibility per tab. The hook can't accept a dynamic key
  // mid-life (its useState initializer only runs once), so we call it
  // once per tab and pick the matching one. Five localStorage entries,
  // five independent visibility states — the user can hide "ملاحظات"
  // on سندات القبض while keeping it on الكل.
  const colsAll = useTableColumnVisibility('receipts-all-v1', RECEIPTS_DEFAULT_VISIBLE, RECEIPTS_COLUMN_KEYS);
  const colsPayment = useTableColumnVisibility('receipts-payment-v1', RECEIPTS_DEFAULT_VISIBLE, RECEIPTS_COLUMN_KEYS);
  const colsCancel = useTableColumnVisibility('receipts-cancel-v1', RECEIPTS_DEFAULT_VISIBLE, RECEIPTS_COLUMN_KEYS);
  const colsCredit = useTableColumnVisibility('receipts-credit-v1', RECEIPTS_DEFAULT_VISIBLE, RECEIPTS_COLUMN_KEYS);
  const colsDisb = useTableColumnVisibility('receipts-disb-v1', RECEIPTS_DEFAULT_VISIBLE, RECEIPTS_COLUMN_KEYS);
  const colsState =
    activeTab === 'all' ? colsAll
      : activeTab === 'payment' ? colsPayment
      : activeTab === 'cancellation' ? colsCancel
      : activeTab === 'credit_note' ? colsCredit
      : colsDisb;
  const isCol = (key: string) => colsState.visible.includes(key);
  // Per-tab column list — "النوع" only appears on الكل (and only there
  // does the Manage Columns dropdown surface it as a toggle).
  const tabColumns = useMemo(
    () =>
      activeTab === 'all'
        ? RECEIPTS_COLUMNS
        : RECEIPTS_COLUMNS.filter((c) => c.key !== 'receipt_type'),
    [activeTab],
  );

  // Pagination
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  // Total receipts matching current filters — drives the "عدد الإيصالات"
  // tile and the printed report header so they reflect the whole set,
  // not just the current page (which is capped at PAGE_SIZE).
  const [totalCount, setTotalCount] = useState(0);

  // Switching tabs resets the cursor — otherwise the user lands on
  // a page that may not exist in the new tab's smaller result set.
  useEffect(() => {
    setPage(0);
  }, [activeTab]);

  // Cross-reference between an original payment receipt and its
  // cancellation voucher (and vice versa). Populated by fetchReceipts
  // after the main query — drives the "ملغي بسند #X" line on cancelled
  // payments and the "إلغاء سند #Y" line on cancellation vouchers.
  // Map keys: receipt.id (UUID) → the OTHER side's receipt_number.
  const [cancelXref, setCancelXref] = useState<Record<string, number | string>>({});

  // payment_id → payment_session_id. Receipts share a session when the
  // user collected several payment lines together via تسديد المبلغ;
  // the grouping memo collapses those into ONE row (one سند قبض)
  // instead of the legacy per-package grouping. Receipts without a
  // session_id (legacy data, or manual rows) fall back to the old
  // policy.group_id key.
  const [sessionByPaymentId, setSessionByPaymentId] = useState<Record<string, string>>({});
  // Set of policy_payments.id that already have printed_at stamped.
  // Used to lock the "تعديل" menu item — printed receipts are
  // immutable per the accountant's rule (same as سجل الدفعات).
  const [printedPaymentIds, setPrintedPaymentIds] = useState<Set<string>>(new Set());

  // Reason prompt for إلغاء السند on the receipts page. Same pattern
  // as the cheques page — required field, dialog blocks until typed.
  const [reasonDialogOpen, setReasonDialogOpen] = useState(false);
  const [reasonGroup, setReasonGroup] = useState<ReceiptGroupView | null>(null);
  // True when at least one target row has been printed. Drives the
  // dual-regime cancel rule the user set: printed → refused=true + سند
  // إلغاء + reason required; unprinted → DELETE the row cleanly with
  // no سند إلغاء, no reason needed. Same predicate as ClientDetails.
  const [reasonAnyPrinted, setReasonAnyPrinted] = useState<boolean>(true);

  // Unified edit modal — same DebtPaymentModal that ClientDetails uses.
  // Editing an unprinted سند قبض from the receipts list opens this
  // dialog seeded with the session's existing rows and replaces the
  // session on submit (DELETE old + INSERT new). The legacy single-row
  // PaymentEditDialog stays mounted for manual receipts that don't
  // belong to any session.
  const [debtModalOpen, setDebtModalOpen] = useState(false);
  const [debtModalEditingSession, setDebtModalEditingSession] =
    useState<DebtPaymentEditingSession | null>(null);
  const [debtModalClient, setDebtModalClient] = useState<{
    id: string;
    full_name: string;
    phone: string | null;
  } | null>(null);
  const [debtModalResolving, setDebtModalResolving] = useState(false);

  // "إضافة سند" — picker + routed sub-modals. The picker (Add­Voucher­
  // Dialog) collects three answers (kind / counterparty / entity)
  // then hands off to one of the specialized dialogs below. We keep
  // separate open-state for each follow-up so the picker can close
  // before the next dialog opens — overlapping dialogs introduce
  // focus-trap bugs in Radix UI.
  const [addVoucherOpen, setAddVoucherOpen] = useState(false);
  const [disburseClient, setDisburseClient] = useState<ClientLite | null>(null);
  const [creditNoteClient, setCreditNoteClient] = useState<ClientLite | null>(null);
  // Broker routes — same AddSettlementDialog the accounting page
  // uses, but launched from the wizard with a single pre-picked
  // broker pinned as the only entity option. `kind` selects
  // 'disbursement' (سند صرف لوسيط) vs 'receipt' (سند قبض من وسيط).
  const [brokerSettlement, setBrokerSettlement] = useState<{
    broker: BrokerLite;
    kind: 'disbursement' | 'receipt';
  } | null>(null);

  // After a voucher is created, hand the agent the print / SMS / WhatsApp
  // popup the rest of the app already uses. Two flavours:
  //   • paymentSuccess  → DebtPaymentSuccessDialog (payload: payment_ids
  //     from policy_payments, which the print path stamps with
  //     printed_at to lock subsequent edits).
  //   • voucherSend     → VoucherSendDialog (payload: receipts.id of the
  //     credit_note / disbursement row).
  // Both dialogs are unaware of the receipts page — they just hand off
  // to edge functions, which is exactly what we want here.
  const [paymentSuccess, setPaymentSuccess] = useState<{
    paymentIds: string[];
    clientPhone: string | null;
  } | null>(null);
  const [voucherSend, setVoucherSend] = useState<{
    kind: VoucherSendKind;
    receiptId: string;
    clientPhone: string | null;
  } | null>(null);
  const [reasonText, setReasonText] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [reasonSubmitting, setReasonSubmitting] = useState(false);
  // The pre-computed customer-level cancel target — every non-إلزامي,
  // non-visa_external policy_payment for this customer (live + batch
  // siblings of any live row). Populated by openCancelDialog before
  // the dialog opens so we can show the exact count + amount on the
  // confirm screen, and reused in confirmCancelReceipt so the cancel
  // matches the printed كشف القبض scope 1:1.
  const [reasonTargetIds, setReasonTargetIds] = useState<string[]>([]);
  const [reasonTargetSum, setReasonTargetSum] = useState<number>(0);
  const [reasonResolving, setReasonResolving] = useState(false);

  // Add / edit dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    client_name: "",
    car_number: "",
    amount: "",
    receipt_date: format(new Date(), "yyyy-MM-dd"),
    payment_method: "cash",
    cheque_number: "",
    notes: "",
  });

  // Details popup (click row → show receipts inside this group)
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsGroup, setDetailsGroup] = useState<ReceiptGroupView | null>(null);

  // Delete confirmation
  const [deleteReceipt, setDeleteReceipt] = useState<ReceiptRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Payment edit (for auto-source receipts that mirror a policy_payment)
  const [editPayment, setEditPayment] = useState<any | null>(null);

  // ─── Fetch ───────────────────────────────────────────────────────

  const fetchReceipts = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    try {
      const { dateFrom, dateTo, companies, types, paymentMethods } = filters;

      // Company / type filters live on the joined policies row, so we
      // switch the join to !inner when either is active. That means
      // manual receipts (no policy_id) drop out of the result — which
      // is the right behavior: "show me only receipts for company X"
      // can't include rows that aren't tied to any policy.
      const needsPolicyInnerJoin = companies.length > 0 || types.length > 0;
      // Both queries reuse the same `policy:policies` alias so the
      // foreign-table filters below ("policy.company_id", or() with
      // foreignTable:"policy") resolve identically against either.
      // Inner-join only when company/type filters are active.
      const policyJoinFull = needsPolicyInnerJoin
        ? "policy:policies!inner(id, client_id, document_number, group_id, company_id, policy_type_parent, policy_type_child, insurance_price, insurance_companies(id, name, name_ar), clients(id, id_number))"
        : "policy:policies(id, client_id, document_number, group_id, company_id, policy_type_parent, policy_type_child, insurance_price, insurance_companies(id, name, name_ar), clients(id, id_number))";
      const policyJoinCount = needsPolicyInnerJoin
        ? "policy:policies!inner(id)"
        : "policy:policies(id)";

      // Sort by created_at DESC first, so the receipt that was just
      // entered surfaces at the top even if the user back-dated it.
      let query = (supabase as any)
        .from("receipts")
        .select(`*, ${policyJoinFull}`)
        .eq("agent_id", agentId)
        .eq("is_imported", false)
        .order("created_at", { ascending: false })
        .order("receipt_date", { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
      if (activeTab !== 'all') query = query.eq("receipt_type", activeTab);

      let countQuery = (supabase as any)
        .from("receipts")
        .select(`id, ${policyJoinCount}`, { count: "exact", head: true })
        .eq("agent_id", agentId)
        .eq("is_imported", false);
      if (activeTab !== 'all') countQuery = countQuery.eq("receipt_type", activeTab);

      // Pre-resolve the search term across fields the receipts table
      // doesn't hold directly. The user wants to search by:
      //   • name              → receipts.client_name (ilike)
      //   • car number        → receipts.car_number (ilike)
      //   • amount            → receipts.amount (eq, when numeric)
      //   • customer ID number → clients.id_number (ilike)
      // The ID-number case can't be done in a single PostgREST OR
      // because id_number lives on a join two hops away; we look up
      // the matching client IDs first, then map them to receipts via
      // client_id (direct) and policy_id (the linked policy's owner).
      // Only triggered when the term looks like digits, to avoid the
      // extra round-trip on every keystroke for plain-text searches.
      const trimmedSearch = searchQuery.trim();
      let searchClientIds: string[] = [];
      let searchPolicyIds: string[] = [];
      if (trimmedSearch && /^\d{4,}$/.test(trimmedSearch)) {
        const { data: idClients } = await supabase
          .from('clients')
          .select('id')
          .ilike('id_number', `%${trimmedSearch}%`)
          .limit(50);
        searchClientIds = (idClients ?? []).map((c: any) => c.id);
        if (searchClientIds.length > 0) {
          const { data: idPolicies } = await supabase
            .from('policies')
            .select('id')
            .in('client_id', searchClientIds);
          searchPolicyIds = (idPolicies ?? []).map((p: any) => p.id);
        }
      }

      const applyShared = (q: any) => {
        // Hide ₪0 receipts — they have no print value and only confuse
        // the operator. Live receipts always carry a positive amount;
        // zero rows tend to be migration artifacts or aborted entries.
        q = q.gt("amount", 0);
        if (dateFrom) q = q.gte("receipt_date", dateFrom);
        if (dateTo) q = q.lte("receipt_date", dateTo);
        if (paymentMethods.length > 0) q = q.in("payment_method", paymentMethods);
        if (branchFilter) q = q.eq("branch_id", branchFilter);
        if (trimmedSearch) {
          const orClauses: string[] = [
            `client_name.ilike.%${trimmedSearch}%`,
            `car_number.ilike.%${trimmedSearch}%`,
          ];
          const numericTerm = Number(trimmedSearch.replace(/,/g, ''));
          if (Number.isFinite(numericTerm) && numericTerm > 0) {
            orClauses.push(`amount.eq.${numericTerm}`);
          }
          if (searchClientIds.length > 0) {
            orClauses.push(`client_id.in.(${searchClientIds.join(',')})`);
          }
          if (searchPolicyIds.length > 0) {
            orClauses.push(`policy_id.in.(${searchPolicyIds.join(',')})`);
          }
          q = q.or(orClauses.join(','));
        }
        if (companies.length > 0) {
          q = q.in("policy.company_id", companies);
        }
        if (types.length > 0) {
          // Build an OR clause across (parent) and (parent + child) tuples.
          // Applied on the joined policies table via the `policy` alias.
          const clause = types.map(typeKeyToFilterClause).join(",");
          q = q.or(clause, { foreignTable: "policy" });
        }
        return q;
      };

      query = applyShared(query);
      countQuery = applyShared(countQuery);

      const [{ data, error }, { count: total, error: countErr }] = await Promise.all([
        query,
        countQuery,
      ]);
      if (error) throw error;
      if (countErr) throw countErr;

      const rows = (data || []) as ReceiptRecord[];
      // Always drop the payments the office never actually collected:
      //   - payment_method='visa_external' (customer paid the insurer
      //     directly via card; the row exists for accounting context
      //     but the money never passed through the office)
      //   - ELZAMI passthrough (policy is ELZAMI + amount equals the
      //     insurance_price — same idea but logged under any payment
      //     method)
      // This mirrors the filter the bulk-receipt edge function applies
      // before rendering the printed copy, so the list and the print
      // can never disagree on what counts as "money the office
      // collected". hideElzamiPayments stays available as an opt-in
      // for users who want to also hide partial ELZAMI payments, but
      // visa_external + the strict passthrough match are no longer
      // gated behind it.
      const officeCollected = rows.filter(
        (r) => r.payment_method !== 'visa_external' && !isElzamiPassthrough(r),
      );
      const filtered = hideElzamiPayments
        ? officeCollected.filter((r) => !isElzamiPassthrough(r))
        : officeCollected;
      const trimmed = filtered.length > PAGE_SIZE ? filtered.slice(0, PAGE_SIZE) : filtered;
      setHasMore(filtered.length > PAGE_SIZE);
      setReceipts(trimmed);
      setTotalCount(total ?? 0);

      // Build the cancellation cross-reference. Two relationships,
      // both keyed by receipt.id → the OTHER side's receipt_number:
      //   • cancelled payment row → its cancellation voucher #
      //   • cancellation voucher  → the original receipt #
      // The 'all' tab can have both kinds of rows on screen at once,
      // so we always run both lookups. Single-type tabs naturally
      // short-circuit because only one set has matching rows.
      const xref: Record<string, number | string> = {};
      const cancelledPaymentIds = trimmed
        .filter((r) => (r as any).receipt_type === 'payment' && r.cancelled_at)
        .map((r) => r.id);
      if (cancelledPaymentIds.length > 0) {
        const { data: vouchers } = await supabase
          .from('receipts')
          .select('receipt_number, cancels_receipt_id')
          .eq('receipt_type', 'cancellation')
          .in('cancels_receipt_id', cancelledPaymentIds);
        for (const v of (vouchers ?? []) as Array<{ receipt_number: number | string | null; cancels_receipt_id: string | null }>) {
          if (v.cancels_receipt_id && v.receipt_number != null) {
            xref[v.cancels_receipt_id] = v.receipt_number;
          }
        }
      }
      const voucherOriginalIds = trimmed
        .filter((r) => (r as any).receipt_type === 'cancellation')
        .map((r) => r.cancels_receipt_id)
        .filter((id): id is string => !!id);
      if (voucherOriginalIds.length > 0) {
        const { data: originals } = await supabase
          .from('receipts')
          .select('id, receipt_number')
          .in('id', voucherOriginalIds);
        const byId = new Map<string, number | string>();
        for (const o of (originals ?? []) as Array<{ id: string; receipt_number: number | string | null }>) {
          if (o.receipt_number != null) byId.set(o.id, o.receipt_number);
        }
        for (const r of trimmed) {
          if ((r as any).receipt_type === 'cancellation' && r.cancels_receipt_id && byId.has(r.cancels_receipt_id)) {
            xref[r.id] = byId.get(r.cancels_receipt_id)!;
          }
        }
      }
      setCancelXref(xref);

      // Resolve payment_session_id for every auto receipt on this
      // page so the grouping memo can collapse a multi-line
      // collection event (cash + cheque entered together via تسديد
      // المبلغ) into one سند قبض row. Legacy rows without a
      // session_id (predate the 20260511180000 migration) fall back
      // to the old policy.group_id key.
      const autoPaymentIds = trimmed
        .map((r) => r.payment_id)
        .filter((id): id is string => !!id);
      const sessionMap: Record<string, string> = {};
      const printedSet = new Set<string>();
      if (autoPaymentIds.length > 0) {
        const { data: sessionRows } = await supabase
          .from('policy_payments')
          .select('id, payment_session_id, printed_at')
          .in('id', autoPaymentIds);
        for (const row of (sessionRows ?? []) as Array<{ id: string; payment_session_id: string | null; printed_at: string | null }>) {
          if (row.payment_session_id) {
            sessionMap[row.id] = row.payment_session_id;
          }
          if (row.printed_at) {
            printedSet.add(row.id);
          }
        }
      }
      setSessionByPaymentId(sessionMap);
      setPrintedPaymentIds(printedSet);
    } catch (err: any) {
      console.error("Error fetching receipts:", err);
      toast.error("خطأ في تحميل الإيصالات");
    } finally {
      setLoading(false);
    }
  }, [agentId, activeTab, page, filters, branchFilter, searchQuery, hideElzamiPayments]);

  useEffect(() => {
    if (!agentLoading && agentId) {
      fetchReceipts();
    }
  }, [fetchReceipts, agentLoading, agentId]);

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
  }, [activeTab, filters, branchFilter, searchQuery, hideElzamiPayments]);

  // ─── Grouping ──────────────────────────────────────────────────
  //
  // Preferred grouping for auto-synced receipts: by payment_session_id
  // (one collection event = one سند قبض row). When a session_id isn't
  // present — legacy rows that predate the 20260511180000 migration —
  // we fall back to the old policies.group_id grouping so historical
  // data keeps rendering as it always did. Standalone policies (no
  // group_id) collapse to one row via policy_id. Manual receipts with
  // no policy link still group by (client_name, car_number, minute)
  // so same-batch manual entries show together. Receipts are fetched
  // newest-first, so Map insertion order preserves that in the output.
  const groups: ReceiptGroup[] = useMemo(() => {
    const map = new Map<string, ReceiptGroup>();
    for (const r of receipts) {
      // PostgREST may return a single-FK join as an object OR a
      // one-element array depending on server version, so normalize.
      const rawPolicy = (r as any).policy;
      const policy = Array.isArray(rawPolicy) ? rawPolicy[0] ?? null : rawPolicy ?? null;
      const rawCompany = policy?.insurance_companies;
      const company = Array.isArray(rawCompany)
        ? rawCompany[0] ?? null
        : rawCompany ?? null;
      const rawClient = policy?.clients;
      const client = Array.isArray(rawClient)
        ? rawClient[0] ?? null
        : rawClient ?? null;
      const sessionId = r.payment_id ? sessionByPaymentId[r.payment_id] : null;
      // Prefix every key with the row's receipt_type so the "الكل" tab
      // never collapses a payment row and its cancellation voucher into
      // one line (they can share policies.group_id). Single-type tabs
      // get the prefix too — it's a no-op since every row in the
      // result set already shares the same type.
      const typePrefix = (r as any).receipt_type || 'payment';
      let key: string;
      if (sessionId) {
        key = `${typePrefix}:sess:${sessionId}`;
      } else if (policy?.group_id) {
        key = `${typePrefix}:grp:${policy.group_id}`;
      } else if (policy?.id) {
        key = `${typePrefix}:pol:${policy.id}`;
      } else {
        const minute = roundToMinute(r.created_at);
        key = `${typePrefix}:manual:${r.client_name}||${r.car_number || ""}||${minute}`;
      }

      if (!map.has(key)) {
        const typeKey = policy
          ? policy.policy_type_parent === "THIRD_FULL" && policy.policy_type_child
            ? policy.policy_type_child
            : policy.policy_type_parent
          : null;
        map.set(key, {
          key,
          client_name: r.client_name,
          car_number: r.car_number,
          created_minute: roundToMinute(r.created_at),
          receipts: [],
          total: 0,
          company_name: company?.name_ar || company?.name || null,
          policy_type_label: typeKey
            ? POLICY_TYPE_DISPLAY[typeKey] || typeKey
            : null,
          client_id_number: client?.id_number || null,
        });
      }
      const g = map.get(key)!;
      g.receipts.push(r);
      g.total += r.amount;
    }
    return Array.from(map.values());
  }, [receipts, sessionByPaymentId]);

  // ─── Print ─────────────────────────────────────────────────────
  //
  // For auto-source groups (rows mirrored from policy_payments) we call
  // generate-bulk-payment-receipt / generate-payment-receipt so the
  // output matches the سندات قبض layout used everywhere else — same
  // heading, same client info grid, same table. Manual-only groups
  // still fall back to the local HTML builder for now because the
  // edge function can't fetch them from policy_payments.

  const handlePrintGroup = async (group: ReceiptGroup) => {
    const paymentIds = group.receipts
      .map((r) => (r as any).payment_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    const allAuto = paymentIds.length === group.receipts.length;
    // Routing key is the row's own receipt_type, not the active tab —
    // on the "الكل" tab a single result set mixes all four types and
    // each row needs its own printable template.
    const groupType = (group.receipts[0] as any)?.receipt_type ?? 'payment';

    // اشعار دائن / سند صرف — each has its own dedicated edge
    // function. Both row types lack a payment_id (they don't come
    // from policy_payments), so the auto-route below would miss
    // them entirely and fall to the bare-bones local HTML. Handle
    // them up-front with the right renderer for each receipt_type.
    if (groupType === 'credit_note' || groupType === 'disbursement') {
      const firstReceipt = group.receipts[0];
      if (!firstReceipt?.id) {
        toast.error(
          groupType === 'credit_note' ? 'لا يوجد إشعار للطباعة' : 'لا يوجد سند صرف للطباعة',
        );
        return;
      }
      const fnName = 'generate-voucher';
      const docLabel = groupType === 'credit_note' ? 'الإشعار' : 'سند الصرف';
      setPrintProgress({ open: true, value: 8 });
      const ticker = setInterval(() => {
        setPrintProgress((s) => {
          if (!s.open) return s;
          if (s.value >= 90) return s;
          return { ...s, value: Math.min(90, s.value + 6) };
        });
      }, 220);
      const closeOverlay = (success: boolean) => {
        clearInterval(ticker);
        if (success) {
          setPrintProgress({ open: true, value: 100 });
          setTimeout(() => setPrintProgress({ open: false, value: 0 }), 350);
        } else {
          setPrintProgress({ open: false, value: 0 });
        }
      };
      try {
        const { data, error } = await supabase.functions.invoke(
          fnName,
          { body: { voucher_receipt_id: firstReceipt.id } },
        );
        if (error) throw error;
        const url = (data as any)?.receipt_url;
        if (url) {
          closeOverlay(true);
          window.open(url, '_blank');
          return;
        }
        closeOverlay(false);
        toast.error(`لم يتم العثور على رابط ${docLabel}`);
        return;
      } catch (err: any) {
        closeOverlay(false);
        console.error(`[Receipts] ${groupType} print failed:`, err);
        let detail = '';
        try {
          if (err?.context && typeof err.context.clone === 'function') {
            const body = await err.context.clone().json();
            detail = body?.error || body?.message || '';
          }
        } catch {}
        if (!detail) detail = err?.message || '';
        toast.error(detail ? `فشل في توليد ${docLabel}: ${detail}` : `فشل في توليد ${docLabel}`);
        return;
      }
    }

    // Broker receipts (no payment_id, but a broker_id on the
    // receipts row) get routed through the unified generate-voucher
    // edge function so they print with the same template family as
    // every other voucher kind. We pass voucher_receipt_id = the
    // canonical row's id and let the function resolve everything
    // (broker info, settlement siblings, etc.) from that single
    // pivot. Same fake-progress ticker as the bulk-receipt path so
    // the user gets visible feedback while the CDN upload completes.
    const firstRow = group.receipts[0] as any;
    const isBrokerRow = !!firstRow?.broker_id;
    if (isBrokerRow && firstRow?.id) {
      setPrintProgress({ open: true, value: 8 });
      const ticker = setInterval(() => {
        setPrintProgress((s) => {
          if (!s.open) return s;
          if (s.value >= 90) return s;
          return { ...s, value: Math.min(90, s.value + 6) };
        });
      }, 220);
      const closeOverlay = (success: boolean) => {
        clearInterval(ticker);
        if (success) {
          setPrintProgress({ open: true, value: 100 });
          setTimeout(() => setPrintProgress({ open: false, value: 0 }), 350);
        } else {
          setPrintProgress({ open: false, value: 0 });
        }
      };
      try {
        const { data, error } = await supabase.functions.invoke(
          'generate-voucher',
          { body: { voucher_receipt_id: firstRow.id } },
        );
        if (error) throw error;
        const url = (data as any)?.receipt_url;
        if (url) {
          closeOverlay(true);
          window.open(url, '_blank');
          return;
        }
        closeOverlay(false);
        toast.error('لم يتم العثور على رابط السند');
        return;
      } catch (err: any) {
        closeOverlay(false);
        console.error('[Receipts] broker voucher print failed:', err);
        toast.error(err?.message || 'فشل في توليد السند');
        return;
      }
    }

    if (allAuto && paymentIds.length > 0) {
      // Open the progress overlay and start a fake-progress ticker.
      // The edge function call doesn't expose real progress so we just
      // creep toward 90% to give visible motion; the final jump to 100
      // happens once the promise resolves. The ticker self-caps so a
      // slow function never overruns the bar.
      setPrintProgress({ open: true, value: 8 });
      const ticker = setInterval(() => {
        setPrintProgress((s) => {
          if (!s.open) return s;
          if (s.value >= 90) return s;
          return { ...s, value: Math.min(90, s.value + 6) };
        });
      }, 220);
      const closeOverlay = (success: boolean) => {
        clearInterval(ticker);
        if (success) {
          setPrintProgress({ open: true, value: 100 });
          setTimeout(() => setPrintProgress({ open: false, value: 0 }), 350);
        } else {
          setPrintProgress({ open: false, value: 0 });
        }
      };

      try {
        // Print the clicked سند قبض only, NOT the customer's whole
        // history. The user's revised rule (after seeing the
        // customer-scope output mix the new session with old cancelled
        // ones) is: one click = one printed سند, scoped to the rows of
        // that session — same scope as printing from ClientDetails →
        // سجل الدفعات. customer_scope=true is left in the function
        // signature for any caller that still wants the full كشف قبض,
        // but the receipts list no longer opts in.
        //
        // Tab branching: when the user is on the سندات الإلغاء tab,
        // the row they clicked is a cancellation voucher (one of the
        // receipts.receipt_type='cancellation' rows). That has its own
        // printable template — generate-cancellation-voucher — which
        // lives at a different CDN path and renders the "سند إلغاء"
        // layout. Hitting generate-bulk-payment-receipt instead would
        // print the cancelled-original سند قبض, which is the wrong
        // document.
        const isCancellationRow = groupType === 'cancellation';
        if (isCancellationRow) {
          // The receipts group on the cancellation tab is keyed by the
          // canonical voucher row; for our edge function we just need
          // its receipts.id. Pick the smallest receipt_number row in
          // the group as the canonical one (matches the dedupe we use
          // everywhere else).
          let canonical = group.receipts[0];
          for (const r of group.receipts) {
            const cur = (canonical as any).receipt_number ?? Number.MAX_SAFE_INTEGER;
            const cand = (r as any).receipt_number ?? Number.MAX_SAFE_INTEGER;
            if (cand < cur) canonical = r;
          }
          const { data, error } = await supabase.functions.invoke(
            'generate-voucher',
            { body: { voucher_receipt_id: (canonical as any).id } },
          );
          if (error) throw error;
          const url = (data as any)?.receipt_url;
          if (url) {
            closeOverlay(true);
            window.open(url, '_blank');
            return;
          }
          closeOverlay(false);
          toast.error('لم يتم العثور على رابط سند الإلغاء');
          return;
        }

        const fn = "generate-voucher";
        const body = { payment_ids: paymentIds };
        const { data, error } = await supabase.functions.invoke(fn, { body });
        if (error) throw error;
        const url = (data as any)?.receipt_url;
        if (url) {
          // Stamp printed_at on the underlying policy_payments so the
          // client profile's سجل الدفعات locks the "تعديل" entry on
          // these rows — printed receipts are immutable from now on,
          // only إلغاء stays open. We don't fail the print if the
          // UPDATE errors (the PDF is already in hand).
          await supabase
            .from('policy_payments')
            .update({ printed_at: new Date().toISOString() })
            .in('id', paymentIds)
            .is('printed_at', null);
          closeOverlay(true);
          window.open(url, "_blank");
          return;
        }
        closeOverlay(false);
        toast.error("لم يتم العثور على رابط السند");
        return;
      } catch (err: any) {
        closeOverlay(false);
        console.error("[Receipts] edge function print failed:", err);
        // Pull the actual error body out of the FunctionsHttpError so
        // the toast shows the function's message.
        let detail = "";
        try {
          if (err?.context && typeof err.context.clone === "function") {
            const body = await err.context.clone().json();
            detail = body?.error || body?.message || "";
          }
        } catch {}
        if (!detail) detail = err?.message || "";
        console.error("[Receipts] print detail:", detail);
        toast.error(detail ? `فشل في توليد السندات: ${detail}` : "فشل في توليد السندات");
        return;
      }
    }

    // Manual receipts fall through to the local HTML builder.
    const logoUrl = siteSettings?.logo_url || null;
    const businessName = siteSettings?.site_title || "Thiqa";
    const html = buildReceiptPrintHtml(group, logoUrl, businessName);
    openReceiptPrint(html);
  };

  // ─── Add / Edit Receipt ───────────────────────────────────────

  const resetForm = () => {
    setFormData({
      client_name: "",
      car_number: "",
      amount: "",
      receipt_date: format(new Date(), "yyyy-MM-dd"),
      payment_method: "cash",
      cheque_number: "",
      notes: "",
    });
  };

  // Open the unified edit flow for an auto-source سند قبض group. Same
  // DebtPaymentModal that ClientDetails uses, seeded with the session's
  // existing payments so the user can re-allocate / add / remove lines
  // and submit — that submit DELETEs the old session and INSERTs new
  // rows (sharing the same payment_session_id) per the user's rule
  // "edit on unprinted draft = tear up and rewrite, never UPDATE".
  // Falls back to the legacy single-row PaymentEditDialog for manual
  // receipts (no policy / no session).
  const openSessionEditModal = async (group: ReceiptGroupView) => {
    const firstReceipt = group.receipts[0];
    if (!firstReceipt) {
      toast.error('السند فارغ');
      return;
    }

    setDebtModalResolving(true);
    try {
      // Resolve client info from the first receipt's policy join.
      const rawPolicy = (firstReceipt as any).policy;
      const policy = Array.isArray(rawPolicy) ? rawPolicy[0] : rawPolicy;
      const rawClient = policy?.clients;
      const client = Array.isArray(rawClient) ? rawClient[0] : rawClient;
      const clientId = client?.id || policy?.client_id;
      if (!clientId) {
        toast.error('لم يمكن تحديد العميل من هذا الصف');
        return;
      }

      // Need name + phone too — the join above only had id, refetch
      // the rest for the DebtPaymentModal title and SMS path.
      const { data: clientRow, error: clientErr } = await supabase
        .from('clients')
        .select('id, full_name, phone_number')
        .eq('id', clientId)
        .maybeSingle();
      if (clientErr) throw clientErr;
      if (!clientRow) {
        toast.error('العميل غير موجود');
        return;
      }

      // Pull every policy_payments row for this session so the modal
      // can pre-load them. We use the session_id (preferred) or the
      // batch_id resolved in the existing sessionByPaymentId map; for
      // the rare manual receipts that have neither we fall back to
      // the receipts' own payment_id list.
      const paymentIds = group.receipts
        .map((r) => r.payment_id)
        .filter((x): x is string => !!x);
      if (paymentIds.length === 0) {
        toast.error('هذا السند يدوي ولا يدعم التعديل الموحد — استخدم النموذج التقليدي');
        return;
      }

      const { data: payRows, error: payErr } = await supabase
        .from('policy_payments')
        .select(`
          id, amount, payment_type, payment_date, cheque_number, cheque_date,
          cheque_issue_date, bank_code, branch_code, cheque_image_url, notes,
          batch_id, locked, refused, printed_at, receipt_number, payment_session_id
        `)
        .in('id', paymentIds);
      if (payErr) throw payErr;
      const rows = (payRows ?? []) as any[];
      if (rows.length === 0) {
        toast.error('الدفعات غير موجودة');
        return;
      }

      // Same printed-locks-edit guard the ClientDetails dropdown uses.
      const anyPrinted = rows.some((p) => p.printed_at != null);
      if (anyPrinted) {
        toast.error('السند مطبوع — لا يمكن تعديله. استخدم إلغاء بدلاً.');
        return;
      }
      const anyRefused = rows.some((p) => p.refused === true);
      if (anyRefused) {
        toast.error('السند ملغى أصلاً');
        return;
      }

      const totalAmount = rows.reduce((s, p) => s + Number(p.amount || 0), 0);
      // Smallest R-number across the session is the canonical one
      // (matches the display-dedupe logic in groupedPayments and the
      // bulk-receipt template).
      let receiptNumber: string | null = null;
      for (const p of rows) {
        if (!p.receipt_number) continue;
        if (!receiptNumber || String(p.receipt_number) < receiptNumber) {
          receiptNumber = String(p.receipt_number);
        }
      }

      // Group key = same fallback chain as everywhere else.
      const sessionKey = rows[0].payment_session_id || rows[0].batch_id || rows[0].id;

      setDebtModalEditingSession({
        id: sessionKey,
        paymentIds: rows.map((p) => p.id),
        payments: rows.map((p) => ({
          id: p.id,
          amount: Number(p.amount || 0),
          payment_type: p.payment_type,
          payment_date: p.payment_date,
          cheque_number: p.cheque_number,
          cheque_date: p.cheque_date,
          cheque_issue_date: p.cheque_issue_date,
          bank_code: p.bank_code ?? null,
          branch_code: p.branch_code ?? null,
          cheque_image_url: p.cheque_image_url,
          notes: p.notes,
          batch_id: p.batch_id,
          locked: p.locked,
        })),
        totalAmount,
        receiptNumber,
      });
      setDebtModalClient({
        id: clientRow.id,
        full_name: clientRow.full_name,
        phone: clientRow.phone_number ?? null,
      });
      setDebtModalOpen(true);
    } catch (err: any) {
      console.error('[Receipts] openSessionEditModal:', err);
      toast.error(err?.message || 'فشل تحضير التعديل');
    } finally {
      setDebtModalResolving(false);
    }
  };

  const handleEditReceipt = async (r: ReceiptRow) => {
    // Auto-source receipts mirror a policy_payment row via the DB
    // trigger, so edits on them have to go through PaymentEditDialog
    // (same dialog the customer page uses). Editing the receipts row
    // directly would be overwritten on the next trigger run.
    if (r.source === "auto" && r.payment_id) {
      try {
        const { data, error } = await (supabase as any)
          .from("policy_payments")
          .select(`
            id, policy_id, amount, payment_date, payment_type, cheque_number,
            cheque_image_url, card_last_four, refused, locked, notes,
            policy:policies!policy_payments_policy_id_fkey(
              id, policy_type_parent, policy_type_child, insurance_price
            )
          `)
          .eq("id", r.payment_id)
          .maybeSingle();
        if (error) throw error;
        if (!data) {
          toast.error("الدفعة المرتبطة بهذا السند غير موجودة");
          return;
        }
        const normalized = {
          ...data,
          policy: Array.isArray(data.policy) ? data.policy[0] : data.policy,
        };
        setEditPayment(normalized);
      } catch (err: any) {
        console.error("[Receipts] fetch policy_payment for edit:", err);
        toast.error(err?.message || "فشل تحميل بيانات الدفعة");
      }
      return;
    }

    // Manual receipt — the existing add/edit form handles it.
    setEditingId(r.id);
    setFormData({
      client_name: r.client_name || "",
      car_number: r.car_number || "",
      amount: String(r.amount ?? ""),
      receipt_date: r.receipt_date
        ? format(new Date(r.receipt_date), "yyyy-MM-dd")
        : format(new Date(), "yyyy-MM-dd"),
      payment_method: r.payment_method || "cash",
      cheque_number: r.cheque_number || "",
      notes: r.notes || "",
    });
    setDialogOpen(true);
  };

  const openCancelDialog = async (group: ReceiptGroupView) => {
    // Resolve the customer from the clicked row so we can expand the
    // cancel scope to every non-إلزامي / non-visa_external payment
    // this customer ever made — same scope the printed receipt shows.
    // Anything less and the row-clicked-cancel ends up half-voiding a
    // multi-split cheque (e.g. كریم تست 7 ended with cheque 901 slice
    // 834 cancelled while slice 332 stayed live — the bookkeeper's
    // worst nightmare).
    const firstReceipt = group.receipts.find((r) => r.policy);
    const policyResolved = Array.isArray((firstReceipt as any)?.policy)
      ? (firstReceipt as any).policy[0]
      : (firstReceipt as any)?.policy;
    const clientId =
      policyResolved?.clients?.id ||
      policyResolved?.client_id ||
      (Array.isArray(policyResolved?.clients) ? policyResolved.clients[0]?.id : null);
    if (!clientId) {
      toast.error('لم يمكن تحديد العميل من هذا الصف');
      return;
    }

    setReasonResolving(true);
    try {
      const { data: policies } = await supabase
        .from('policies')
        .select('id, policy_type_parent, insurance_price')
        .eq('client_id', clientId)
        .is('deleted_at', null);
      const policyIds = (policies ?? []).map((p: any) => p.id);
      if (policyIds.length === 0) {
        toast.error('لا توجد بوالص لهذا العميل');
        return;
      }

      const { data: payments } = await supabase
        .from('policy_payments')
        .select('id, amount, payment_type, batch_id, policy_id, refused, locked, printed_at')
        .in('policy_id', policyIds);

      const policyById = new Map<string, any>(
        (policies ?? []).map((p: any) => [p.id, p]),
      );

      // Stage 1: pick the live rows that survive the same filter the
      // print uses (skip already-refused, skip visa_external, skip
      // إلزامي passthrough — same rule from the edge function).
      // إلزامي passthrough now also requires locked=true so a manual
      // cash إلزامي premium the office actually collected isn't
      // wrongly hidden / skipped from the cancel scope.
      const survivors = (payments ?? []).filter((p: any) => {
        if (p.refused) return false;
        if (p.payment_type === 'visa_external') return false;
        if (p.locked !== true) return true;
        const pol = policyById.get(p.policy_id);
        if (!pol) return true;
        if (pol.policy_type_parent !== 'ELZAMI') return true;
        const price = Number(pol.insurance_price ?? 0);
        if (price <= 0) return true;
        return Math.abs(Number(p.amount ?? 0) - price) >= 0.005;
      });

      // Stage 2: keep multi-split cheques whole. If any slice of a
      // batch survives the filter, every still-live slice of that
      // batch joins the target — a physical cheque can't be half-
      // cancelled. Already-refused siblings are left alone (no point
      // re-flipping refused=true on rows that already are).
      const batchIds = new Set(
        survivors
          .filter((p: any) => !!p.batch_id)
          .map((p: any) => p.batch_id as string),
      );
      const survivorIds = new Set(survivors.map((p: any) => p.id));
      const finalRows = (payments ?? []).filter((p: any) => {
        if (p.refused) return false;
        if (survivorIds.has(p.id)) return true;
        return !!p.batch_id && batchIds.has(p.batch_id);
      });

      if (finalRows.length === 0) {
        toast.error('لا توجد سندات قابلة للإلغاء (كل دفعات العميل ملغاة أو إلزامي/فيزا خارجي)');
        return;
      }

      setReasonGroup(group);
      setReasonTargetIds(finalRows.map((p: any) => p.id));
      setReasonTargetSum(
        finalRows.reduce((s: number, p: any) => s + Number(p.amount || 0), 0),
      );
      setReasonAnyPrinted(
        finalRows.some((p: any) => p.printed_at != null),
      );
      setReasonText('');
      setReasonError(null);
      setReasonDialogOpen(true);
    } catch (err: any) {
      console.error('[Receipts] resolve cancel scope:', err);
      toast.error(err?.message || 'فشل في تحضير الإلغاء');
    } finally {
      setReasonResolving(false);
    }
  };

  const confirmCancelReceipt = async () => {
    if (!reasonGroup) return;
    if (reasonTargetIds.length === 0) {
      toast.error('لا توجد سندات قابلة للإلغاء');
      return;
    }
    // Dual-regime cancel, same rule as ClientDetails.confirmCancelPayment:
    //   * printed → refused=true + سند إلغاء + reason required (audit).
    //   * unprinted draft → DELETE the rows cleanly with no سند إلغاء.
    // We resolved `reasonAnyPrinted` in openCancelDialog so the UI
    // could swap copy/buttons accordingly; the same flag drives the
    // server-side path here.
    if (reasonAnyPrinted && !reasonText.trim()) {
      setReasonError('السبب مطلوب');
      return;
    }
    setReasonSubmitting(true);
    try {
      if (reasonAnyPrinted) {
        const { error } = await supabase
          .from('policy_payments')
          .update({
            refused: true,
            cheque_status: 'cancelled',
            cancellation_reason: reasonText.trim(),
          })
          .in('id', reasonTargetIds);
        if (error) throw error;
        toast.success(`تم إلغاء ${reasonTargetIds.length} سند${reasonTargetIds.length > 1 ? 'اً' : ''} وإصدار سند إلغاء`);
      } else {
        // Unprinted draft → clean delete. receipts.payment_id is
        // ON DELETE SET NULL, so the receipts rows would otherwise
        // linger as orphans with null payment_id — drop them too.
        // policy_payments delete cascades to payment_images via FK.
        const { error: receiptsErr } = await supabase
          .from('receipts')
          .delete()
          .in('payment_id', reasonTargetIds);
        if (receiptsErr) throw receiptsErr;

        const { error: payErr } = await supabase
          .from('policy_payments')
          .delete()
          .in('id', reasonTargetIds);
        if (payErr) throw payErr;
        toast.success(`تم حذف ${reasonTargetIds.length} سند${reasonTargetIds.length > 1 ? 'اً' : ''}`);
      }
      setReasonDialogOpen(false);
      setReasonGroup(null);
      setReasonTargetIds([]);
      setReasonTargetSum(0);
      setReasonText("");
      setReasonError(null);
      fetchReceipts();
    } catch (err: any) {
      console.error('[Receipts] cancel error:', err);
      toast.error(err?.message || 'فشل في إلغاء السند');
    } finally {
      setReasonSubmitting(false);
    }
  };

  const handleSaveReceipt = async () => {
    if (!agentId) {
      toast.error("لم يتم التعرف على الوكيل");
      return;
    }
    if (!formData.client_name.trim()) {
      toast.error("اسم العميل مطلوب");
      return;
    }
    const amount = parseFloat(formData.amount);
    if (isNaN(amount) || amount <= 0) {
      toast.error("المبلغ يجب أن يكون رقماً صحيحاً أكبر من صفر");
      return;
    }
    if (!formData.receipt_date) {
      toast.error("تاريخ الإيصال مطلوب");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        client_name: formData.client_name.trim(),
        car_number: formData.car_number.trim() || null,
        amount,
        receipt_date: formData.receipt_date,
        payment_method: formData.payment_method,
        cheque_number: formData.cheque_number.trim() || null,
        notes: formData.notes.trim() || null,
      };

      if (editingId) {
        const { error } = await (supabase as any)
          .from("receipts")
          .update(payload)
          .eq("id", editingId);
        if (error) throw error;
        toast.success("تم تحديث الإيصال");
      } else {
        const { error } = await (supabase as any).from("receipts").insert({
          agent_id: agentId,
          ...payload,
          receipt_type: activeTab,
        });
        if (error) throw error;
        toast.success("تم إضافة الإيصال بنجاح");
      }

      setDialogOpen(false);
      setEditingId(null);
      resetForm();
      await fetchReceipts();
      // If the details popup is open and we just edited something inside
      // it, refresh the in-memory group so the popup shows the new row.
      if (detailsGroup) {
        setDetailsGroup((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            receipts: prev.receipts.map((x) =>
              editingId && x.id === editingId ? { ...x, ...payload } as ReceiptRow : x,
            ),
            total: prev.receipts.reduce(
              (sum, x) =>
                sum + (editingId && x.id === editingId ? amount : Number(x.amount || 0)),
              0,
            ),
          };
        });
      }
    } catch (err: any) {
      console.error("Error saving receipt:", err);
      toast.error(err.message || "خطأ في حفظ الإيصال");
    } finally {
      setSaving(false);
    }
  };

  // ─── Delete Receipt ──────────────────────────────────────────

  const handleConfirmDelete = async () => {
    if (!deleteReceipt) return;
    setDeleting(true);
    try {
      const { error } = await (supabase as any)
        .from("receipts")
        .delete()
        .eq("id", deleteReceipt.id);
      if (error) throw error;
      toast.success("تم حذف الإيصال");

      // Drop the row from the details popup (if open) and close it when
      // empty so the user doesn't end up staring at a ghost card.
      if (detailsGroup) {
        const remaining = detailsGroup.receipts.filter((r) => r.id !== deleteReceipt.id);
        if (remaining.length === 0) {
          setDetailsOpen(false);
          setDetailsGroup(null);
        } else {
          setDetailsGroup({
            ...detailsGroup,
            receipts: remaining,
            total: remaining.reduce((sum, r) => sum + Number(r.amount || 0), 0),
          });
        }
      }

      setDeleteReceipt(null);
      await fetchReceipts();
    } catch (err: any) {
      console.error("Error deleting receipt:", err);
      toast.error(err.message || "خطأ في حذف الإيصال");
    } finally {
      setDeleting(false);
    }
  };

  // ─── Row interactions ────────────────────────────────────────

  const handleOpenGroupDetails = (group: ReceiptGroup) => {
    setDetailsGroup(group);
    setDetailsOpen(true);
  };

  // Picker → sub-modal router. We KEEP the picker open behind the
  // follow-up so closing the sub-modal returns the user to their
  // previous picks (which AddVoucherDialog preserves as long as it
  // stays mounted). Before opening the new sub-modal we close any
  // sibling that may be open — this handles the case where the user
  // already picked, opened a sub-modal, closed it, changed a pick,
  // and clicked متابعة again. Without the reset, two sub-modals
  // could end up stacked.
  const handleVoucherPicked = (result: VoucherPickResult) => {
    // Close any sibling sub-modal first — the user may be revising
    // their choice after opening a previous one, and stacking two
    // would corrupt Radix focus state.
    setDebtModalOpen(false);
    setDisburseClient(null);
    setCreditNoteClient(null);
    setBrokerSettlement(null);

    if (result.counterparty === 'client' && result.client) {
      const c = result.client;
      setTimeout(() => {
        if (result.kind === 'payment') {
          setDebtModalClient({ id: c.id, full_name: c.full_name, phone: c.phone_number });
          setDebtModalEditingSession(null);
          setDebtModalOpen(true);
        } else if (result.kind === 'disbursement') {
          setDisburseClient(c);
        } else if (result.kind === 'credit_note') {
          setCreditNoteClient(c);
        }
      }, 100);
      return;
    }

    if (result.counterparty === 'broker' && result.broker) {
      // إشعار دائن for brokers has no infrastructure yet (no
      // broker_wallet equivalent of customer_wallet_transactions),
      // so explicitly bounce that case rather than open a half-
      // working dialog. سند قبض / سند صرف map cleanly to
      // broker_settlements.direction ('broker_owes' / 'we_owe').
      if (result.kind === 'credit_note') {
        toast.info('إشعار الدائن للوسطاء غير مفعّل بعد — استخدم سند صرف عادي');
        return;
      }
      const broker = result.broker;
      const kind = result.kind === 'payment' ? 'receipt' : 'disbursement';
      setTimeout(() => {
        setBrokerSettlement({ broker, kind });
      }, 100);
      return;
    }

    toast.info('هذا النوع رح يكون متاح قريباً');
  };

  // ─── Summary ───────────────────────────────────────────────────

  const totalAmount = useMemo(
    () => receipts.reduce((sum, r) => sum + r.amount, 0),
    [receipts]
  );

  // ─── Print all (active filter set) ─────────────────────────────
  //
  // Builds the same accounting-style branded report used on /accounting
  // — agent logo, KPI strip, zebra-striped table — out of whatever the
  // user can currently see (filtered + searched). Calls the shared
  // generate-accounting-report edge function so the design and pipeline
  // match exactly.

  const [printingAll, setPrintingAll] = useState(false);

  // Progress overlay shown while a single-row print is being prepared.
  // The edge function call typically takes 1-4 seconds (fetch payments,
  // render HTML, upload to Bunny CDN) and the user wants visible
  // feedback in that window instead of a frozen-feeling click.
  const [printProgress, setPrintProgress] = useState<{ open: boolean; value: number }>({
    open: false,
    value: 0,
  });

  const handlePrintAll = async () => {
    if (!agentId) return;
    setPrintingAll(true);
    try {
      const fmtMoney = (n: number) =>
        `₪${Math.round(n).toLocaleString("en-US")}`;
      const { dateFrom, dateTo, companies, types, paymentMethods } = filters;
      const needsPolicyInnerJoin = companies.length > 0 || types.length > 0;
      const policyJoin = needsPolicyInnerJoin
        ? "policy:policies!inner(id, client_id, document_number, group_id, company_id, policy_type_parent, policy_type_child, insurance_price, insurance_companies(id, name, name_ar), clients(id, id_number))"
        : "policy:policies(id, client_id, document_number, group_id, company_id, policy_type_parent, policy_type_child, insurance_price, insurance_companies(id, name, name_ar), clients(id, id_number))";

      // Pull every matching row (not just the current page) so طباعة الكل
      // actually reflects "all" — pagination is a screen affordance, not
      // a print one. Filters mirror fetchReceipts exactly so the print
      // and the table can't disagree.
      let q = (supabase as any)
        .from("receipts")
        .select(`*, ${policyJoin}`)
        .eq("agent_id", agentId)
        .eq("is_imported", false)
        .gt("amount", 0)
        .order("created_at", { ascending: false })
        .order("receipt_date", { ascending: false });
      if (activeTab !== 'all') q = q.eq("receipt_type", activeTab);
      if (dateFrom) q = q.gte("receipt_date", dateFrom);
      if (dateTo) q = q.lte("receipt_date", dateTo);
      if (paymentMethods.length > 0) q = q.in("payment_method", paymentMethods);
      if (branchFilter) q = q.eq("branch_id", branchFilter);
      const trimmedSearch = searchQuery.trim();
      if (trimmedSearch) {
        // Same multi-field search the table view uses — keep them in
        // lockstep so "طباعة الكل" reflects exactly what the user
        // sees on screen.
        const orClauses: string[] = [
          `client_name.ilike.%${trimmedSearch}%`,
          `car_number.ilike.%${trimmedSearch}%`,
        ];
        const numericTerm = Number(trimmedSearch.replace(/,/g, ''));
        if (Number.isFinite(numericTerm) && numericTerm > 0) {
          orClauses.push(`amount.eq.${numericTerm}`);
        }
        if (/^\d{4,}$/.test(trimmedSearch)) {
          const { data: idClients } = await supabase
            .from('clients')
            .select('id')
            .ilike('id_number', `%${trimmedSearch}%`)
            .limit(50);
          const clientIds = (idClients ?? []).map((c: any) => c.id);
          if (clientIds.length > 0) {
            orClauses.push(`client_id.in.(${clientIds.join(',')})`);
            const { data: idPolicies } = await supabase
              .from('policies')
              .select('id')
              .in('client_id', clientIds);
            const policyIds = (idPolicies ?? []).map((p: any) => p.id);
            if (policyIds.length > 0) {
              orClauses.push(`policy_id.in.(${policyIds.join(',')})`);
            }
          }
        }
        q = q.or(orClauses.join(','));
      }
      if (companies.length > 0) q = q.in("policy.company_id", companies);
      if (types.length > 0) {
        const clause = types.map(typeKeyToFilterClause).join(",");
        q = q.or(clause, { foreignTable: "policy" });
      }

      const { data, error } = await q;
      if (error) throw error;
      const fetched = (data || []) as ReceiptRecord[];
      // Same office-collected filter the table view applies (see
      // fetchReceipts) so a "طباعة الكل" report can't smuggle in
      // visa_external / ELZAMI passthrough rows the table itself
      // hides.
      const officeCollected = fetched.filter(
        (r) => r.payment_method !== 'visa_external' && !isElzamiPassthrough(r),
      );
      const allReceipts = hideElzamiPayments
        ? officeCollected.filter((r) => !isElzamiPassthrough(r))
        : officeCollected;

      if (allReceipts.length === 0) {
        toast.error("لا توجد إيصالات للطباعة");
        return;
      }

      const allTotal = allReceipts.reduce((s, r) => s + Number(r.amount || 0), 0);
      const cashTotal = allReceipts
        .filter((r) => r.payment_method === "cash")
        .reduce((s, r) => s + r.amount, 0);
      const chequeTotal = allReceipts
        .filter((r) => r.payment_method === "cheque")
        .reduce((s, r) => s + r.amount, 0);
      const otherTotal = allReceipts
        .filter((r) => r.payment_method !== "cash" && r.payment_method !== "cheque")
        .reduce((s, r) => s + r.amount, 0);

      const filterBits: string[] = [];
      if (dateFrom || dateTo) {
        filterBits.push(`التاريخ: ${dateFrom || "—"} → ${dateTo || "—"}`);
      }
      if (paymentMethods.length > 0) {
        filterBits.push(
          `طريقة الدفع: ${paymentMethods
            .map((m) => paymentLabelShort(m))
            .join(" / ")}`,
        );
      }
      if (companies.length > 0) {
        const labels = companies
          .map((id) => companyOptions.find((c) => c.value === id)?.label || id)
          .join(" / ");
        filterBits.push(`الشركة: ${labels}`);
      }
      if (types.length > 0) {
        const labels = types
          .map((t) => POLICY_TYPE_DISPLAY[t] || t)
          .join(" / ");
        filterBits.push(`نوع التأمين: ${labels}`);
      }
      if (searchQuery) filterBits.push(`بحث: "${searchQuery}"`);
      if (hideElzamiPayments) filterBits.push("إخفاء دفعات الإلزامي");

      // Build print columns from the on-screen Manage-Columns toggle
      // (minus the actions cell, which has no print equivalent), with
      // the row index pinned in front. Toggling شركة التأمين on screen
      // toggles it in print too — one knob, both surfaces.
      const PRINT_LABELS: Record<string, string> = {
        receipt_number: "رقم السند",
        receipt_type: "النوع",
        amount: "المبلغ",
        receipt_date: "التاريخ",
        client_name: "العميل",
        client_id_number: "رقم هوية العميل",
        car_number: "رقم السيارة",
        company_name: "شركة التأمين",
        policy_type: "نوع التأمين",
        payment_method: "طريقة الدفع",
        cheque_number: "رقم الشيك",
        notes: "ملاحظات",
      };
      const printColumns = [
        { key: "idx", label: "#", align: "center" as const },
        ...tabColumns.filter(
          (c) => c.key !== "actions" && isCol(c.key),
        ).map((c) => ({
          key: c.key,
          label: PRINT_LABELS[c.key] ?? c.label,
          align: "right" as const,
        })),
      ];

      const rows = allReceipts.map((r, i) => {
        const rawPolicy = (r as any).policy;
        const policy = Array.isArray(rawPolicy)
          ? rawPolicy[0] ?? null
          : rawPolicy ?? null;
        const rawCompany = policy?.insurance_companies;
        const company = Array.isArray(rawCompany)
          ? rawCompany[0] ?? null
          : rawCompany ?? null;
        const rawClient = policy?.clients;
        const client = Array.isArray(rawClient)
          ? rawClient[0] ?? null
          : rawClient ?? null;
        const typeKey = policy
          ? policy.policy_type_parent === "THIRD_FULL" && policy.policy_type_child
            ? policy.policy_type_child
            : policy.policy_type_parent
          : null;
        const rt = (r as any).receipt_type as string | undefined;
        const rtLabel = rt && RECEIPT_TYPE_BADGE[rt]
          ? RECEIPT_TYPE_BADGE[rt].label
          : '';
        return {
          idx: i + 1,
          receipt_number: r.voucher_number ?? formatReceiptNumber(r.receipt_number, r.receipt_date),
          receipt_type: rtLabel,
          receipt_date: formatDate(r.receipt_date),
          client_name: r.client_name,
          client_id_number: client?.id_number ?? "",
          car_number: r.car_number ?? "",
          company_name: company?.name_ar || company?.name || "",
          policy_type: typeKey ? POLICY_TYPE_DISPLAY[typeKey] || typeKey : "",
          payment_method: paymentLabelShort(r.payment_method),
          cheque_number: r.cheque_number ?? "",
          notes: r.notes ?? "",
          amount: fmtMoney(r.amount),
        };
      });

      await printAccountingReport({
        title: "تقرير الإيصالات",
        subtitle: filterBits.length > 0 ? filterBits.join(" · ") : undefined,
        stats: [
          { label: "عدد الإيصالات", value: String(allReceipts.length), tone: "primary" },
          { label: "المجموع", value: fmtMoney(allTotal), tone: "emerald" },
          { label: "نقدي", value: fmtMoney(cashTotal), tone: "success" },
          { label: "شيك", value: fmtMoney(chequeTotal), tone: "amber" },
          { label: "تحويل / فيزا", value: fmtMoney(otherTotal), tone: "primary" },
        ],
        columns: printColumns,
        rows,
        // No total_key / total_label on purpose — the المجموع stat above
        // already tells the operator the grand total; the bottom black
        // strip was redundant and visually heavy.
      });
    } catch (err: any) {
      console.error("Print all error:", err);
      toast.error("فشل في توليد التقرير");
    } finally {
      setPrintingAll(false);
    }
  };

  // ─── Render ────────────────────────────────────────────────────

  return (
    <MainLayout>
      <div dir="rtl" className="min-h-screen">
        <Header
          title="إدارة الإيصالات"
          subtitle={
            activeTab === 'all'
              ? 'الكل — سندات القبض والإلغاء وإشعار الدائن وسند الصرف في قائمة واحدة'
              : activeTab === 'cancellation'
                ? 'سندات الإلغاء — كل عملية إلغاء تُنشئ سنداً مستقلاً يضمن التوثيق المحاسبي'
                : activeTab === 'credit_note'
                  ? 'اشعار دائن — رصيد للعميل عندنا بدون خروج كاش، يُحسم تلقائياً من أي دفعة قادمة'
                  : activeTab === 'disbursement'
                    ? 'سند صرف — مبالغ خرجت فعلياً من الشركة للعميل (نقدي / شيك / تحويل / فيزا)'
                    : 'سندات القبض — إيصالات الدفع الصادرة للعملاء'
          }
        />

        <div className="p-3 md:p-6 space-y-4">
          {/* Tab switcher — one slice of receipts.receipt_type per
              tab. The filters/search apply identically across all four;
              switching just resets the page cursor (useEffect on
              activeTab). */}
          <Tabs
            value={activeTab}
            onValueChange={(v) =>
              setActiveTab(v as 'all' | 'payment' | 'cancellation' | 'credit_note' | 'disbursement')
            }
          >
            <TabsList className="grid w-full max-w-3xl grid-cols-5">
              <TabsTrigger value="all" className="gap-2">
                <Layers className="h-3.5 w-3.5" />
                الكل
              </TabsTrigger>
              <TabsTrigger value="payment" className="gap-2">
                <Receipt className="h-3.5 w-3.5" />
                سندات القبض
              </TabsTrigger>
              <TabsTrigger value="cancellation" className="gap-2">
                <Ban className="h-3.5 w-3.5" />
                سندات الإلغاء
              </TabsTrigger>
              <TabsTrigger value="credit_note" className="gap-2">
                <Wallet className="h-3.5 w-3.5" />
                اشعار دائن
              </TabsTrigger>
              <TabsTrigger value="disbursement" className="gap-2">
                <Banknote className="h-3.5 w-3.5" />
                سند صرف
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Toolbar — single row: primary actions on the right (RTL),
              search + count + manage columns + filter on the left, same
              pattern as /accounting. */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => setAddVoucherOpen(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              <span>إضافة سند</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5"
              disabled={printingAll || loading || receipts.length === 0}
              onClick={handlePrintAll}
              title="طباعة كل الإيصالات حسب الفلتر الحالي"
            >
              {printingAll ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Printer className="h-3.5 w-3.5" />
              )}
              <span className="hidden sm:inline">طباعة الكل</span>
            </Button>

            <div className="flex items-center gap-2 flex-wrap mr-auto">
              <div className="relative w-full sm:w-72 md:w-96">
                <Search className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="بحث: اسم / رقم هوية / رقم سيارة / مبلغ..."
                  className="h-8 w-full pr-8 text-sm"
                />
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {loading ? "..." : `${totalCount} إيصال`}
              </span>
              <ManageColumnsDropdown
                columns={tabColumns}
                visible={colsState.visible}
                onToggle={colsState.toggle}
                onReset={colsState.reset}
              />
              <AccountingFilters
                value={filters}
                onChange={setFilters}
                companyOptions={companyOptions}
                typeOptions={typeOptions}
                paymentMethodOptions={paymentMethodOptions}
                show={{
                  dateRange: true,
                  companies: true,
                  types: true,
                  paymentMethods: true,
                  hideElzami: true,
                }}
                hideElzami={hideElzamiPayments}
                onHideElzamiChange={setHideElzamiPayments}
              />
              <AgentBranchFilter value={branchFilter} onChange={setBranchFilter} />
            </div>
          </div>

          <div>

            {/* Summary card */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
              <Card>
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="rounded-lg bg-primary/10 p-2.5">
                    <Receipt className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">عدد الإيصالات</p>
                    <p className="text-xl font-bold">{totalCount}</p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="rounded-lg bg-green-500/10 p-2.5">
                    <Banknote className="h-5 w-5 text-green-600" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">المجموع</p>
                    <p className="text-xl font-bold">
                      ₪{Math.round(totalAmount).toLocaleString("en-US")}
                    </p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="rounded-lg bg-blue-500/10 p-2.5">
                    <Printer className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">مجموعات طباعة</p>
                    <p className="text-xl font-bold">{groups.length}</p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Receipts table */}
            <div className="mt-4">
              {renderTable()}
            </div>
          </div>
        </div>
      </div>

      {/* Add / Edit Receipt Dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(o) => {
          setDialogOpen(o);
          if (!o) setEditingId(null);
        }}
      >
        <DialogContent className="sm:max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "تعديل الإيصال" : "إضافة إيصال جديد"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Client name */}
            <div className="space-y-1.5">
              <Label>اسم العميل *</Label>
              <Input
                value={formData.client_name}
                onChange={(e) =>
                  setFormData((p) => ({ ...p, client_name: e.target.value }))
                }
                placeholder="اسم العميل"
              />
            </div>

            {/* Car number */}
            <div className="space-y-1.5">
              <Label>رقم السيارة</Label>
              <Input
                value={formData.car_number}
                onChange={(e) =>
                  setFormData((p) => ({ ...p, car_number: e.target.value }))
                }
                placeholder="رقم السيارة"
              />
            </div>

            {/* Amount */}
            <div className="space-y-1.5">
              <Label>المبلغ *</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={formData.amount}
                onChange={(e) =>
                  setFormData((p) => ({ ...p, amount: e.target.value }))
                }
                placeholder="0.00"
              />
            </div>

            {/* Receipt date */}
            <div className="space-y-1.5">
              <Label>تاريخ الإيصال *</Label>
              <Input
                type="date"
                value={formData.receipt_date}
                onChange={(e) =>
                  setFormData((p) => ({ ...p, receipt_date: e.target.value }))
                }
              />
            </div>

            {/* Payment method */}
            <div className="space-y-1.5">
              <Label>طريقة الدفع</Label>
              <Select
                value={formData.payment_method}
                onValueChange={(v) =>
                  setFormData((p) => ({ ...p, payment_method: v }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">نقدي</SelectItem>
                  <SelectItem value="cheque">شيك</SelectItem>
                  <SelectItem value="visa">فيزا</SelectItem>
                  <SelectItem value="transfer">تحويل</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Cheque number - only visible if payment method is cheque */}
            {formData.payment_method === "cheque" && (
              <div className="space-y-1.5">
                <Label>رقم الشيك</Label>
                <Input
                  value={formData.cheque_number}
                  onChange={(e) =>
                    setFormData((p) => ({ ...p, cheque_number: e.target.value }))
                  }
                  placeholder="رقم الشيك"
                />
              </div>
            )}

            {/* Notes */}
            <div className="space-y-1.5">
              <Label>ملاحظات</Label>
              <Input
                value={formData.notes}
                onChange={(e) =>
                  setFormData((p) => ({ ...p, notes: e.target.value }))
                }
                placeholder="ملاحظات إضافية..."
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <DialogClose asChild>
              <Button variant="outline">إلغاء</Button>
            </DialogClose>
            <Button onClick={handleSaveReceipt} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin ml-2" />}
              {editingId ? "حفظ التعديلات" : "حفظ الإيصال"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReceiptGroupDetailsDialog
        open={detailsOpen}
        onOpenChange={(o) => {
          setDetailsOpen(o);
          if (!o) setDetailsGroup(null);
        }}
        group={detailsGroup}
        onPrint={(g) => handlePrintGroup(g as ReceiptGroup)}
        onEdit={(r) => {
          // Route auto receipts through the unified session edit flow.
          // The details dialog passes a single ReceiptRow; for auto
          // rows we lift that to the group it belongs to so the edit
          // operates at session granularity (matches the dropdown).
          if (r.source === 'auto' && detailsGroup) {
            setDetailsOpen(false);
            openSessionEditModal(detailsGroup as ReceiptGroupView);
            return;
          }
          handleEditReceipt(r);
        }}
        onDelete={(r) => setDeleteReceipt(r)}
      />

      {/* Unified edit modal for auto سند قبض. clientId/name/phone come
          from openSessionEditModal which resolved them from the clicked
          group; totalOwed is 0 in edit mode (we re-use the modal's
          `editingSession` path so the wallet ceiling is computed from
          the customer's debt minus the session being edited — see
          DebtPaymentModal). */}
      <DebtPaymentModal
        open={debtModalOpen}
        onOpenChange={(open) => {
          setDebtModalOpen(open);
          if (!open) {
            setDebtModalEditingSession(null);
            setDebtModalClient(null);
          }
        }}
        clientId={debtModalClient?.id || ''}
        clientName={debtModalClient?.full_name || ''}
        clientPhone={debtModalClient?.phone || null}
        totalOwed={0}
        editingSession={debtModalEditingSession}
        // Only relabel the secondary button when this modal was
        // launched from the AddVoucher wizard (addVoucherOpen=true).
        // The same modal is also opened from the edit-session flow on
        // existing receipt rows — that path doesn't sit behind a
        // picker, so "إلغاء" stays accurate there.
        cancelLabel={addVoucherOpen ? 'رجوع' : 'إلغاء'}
        onSuccess={async (paymentIds) => {
          // Capture the client phone BEFORE we null debtModalClient
          // out — the success dialog needs it for SMS/WhatsApp.
          const phone = debtModalClient?.phone ?? null;
          setDebtModalOpen(false);
          setDebtModalEditingSession(null);
          setDebtModalClient(null);
          // Voucher saved → close the picker too. (When the user hits
          // رجوع / X, onOpenChange runs but onSuccess does NOT, so the
          // picker stays mounted and the user lands back on their
          // previous picks — that's the "back" affordance.)
          setAddVoucherOpen(false);
          await fetchReceipts();
          // Empty paymentIds → edit-session case (existing rows were
          // re-stamped, nothing new to print/SMS); skip the popup so
          // the user doesn't see a "nothing to send" dialog.
          if (paymentIds.length > 0) {
            setPaymentSuccess({ paymentIds, clientPhone: phone });
          }
        }}
      />

      {/* "إضافة سند" picker — opens from the toolbar button on every
          tab. Picks (kind, counterparty, entity); on continue we hand
          off to one of the three sub-dialogs below. Phase 1: customer
          routes only. */}
      <AddVoucherDialog
        open={addVoucherOpen}
        onOpenChange={setAddVoucherOpen}
        onPicked={handleVoucherPicked}
      />

      {/* Customer + سند صرف — reuses the accounting page's existing
          settlement dialog, which already creates client_settlements
          rows that trigger a receipts mirror via the DB sync trigger. */}
      {disburseClient && (
        <AddSettlementDialog
          open={!!disburseClient}
          onOpenChange={(o) => !o && setDisburseClient(null)}
          mode="client"
          kind="disbursement"
          defaultEntityId={disburseClient.id}
          clientName={disburseClient.full_name}
          cancelLabel="رجوع"
          onSaved={async () => {
            const c = disburseClient;
            setDisburseClient(null);
            // Saved → close the picker too. رجوع / X leaves the
            // picker open behind so the user can revise their choice.
            setAddVoucherOpen(false);
            await fetchReceipts();
            // AddSettlementDialog doesn't expose the persisted
            // receipts.id directly (the row is created by the
            // client_settlements AFTER INSERT trigger), so look it
            // up by querying the most recent disbursement for this
            // client. Tight ordering: created_at DESC, limit 1.
            // Done after fetchReceipts so the new row is definitely
            // in the DB by the time we query.
            const { data: latest } = await supabase
              .from('receipts')
              .select('id')
              .eq('client_id', c.id)
              .eq('receipt_type', 'disbursement')
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            if (latest?.id) {
              setVoucherSend({
                kind: 'disbursement',
                receiptId: latest.id,
                clientPhone: c.phone_number,
              });
            }
          }}
        />
      )}

      {/* Broker + قبض/صرف — same AddSettlementDialog the accounting
          page's BrokersSection opens, but with the entities list
          pinned to the wizard's picked broker so the user can't
          accidentally switch entities mid-flow. Writes to
          broker_settlements; persistSettlementLines also mirrors a
          row into the receipts table (migration 20260514150000) so
          the new voucher surfaces on /receipts immediately. */}
      {brokerSettlement && (
        <AddSettlementDialog
          open={!!brokerSettlement}
          onOpenChange={(o) => !o && setBrokerSettlement(null)}
          mode="broker"
          kind={brokerSettlement.kind}
          entities={[{ id: brokerSettlement.broker.id, name: brokerSettlement.broker.name }]}
          defaultEntityId={brokerSettlement.broker.id}
          cancelLabel="رجوع"
          onSaved={async () => {
            const b = brokerSettlement.broker;
            const kind = brokerSettlement.kind;
            setBrokerSettlement(null);
            setAddVoucherOpen(false);
            await fetchReceipts();
            // Look up the receipts mirror row we just created
            // (persistSettlementLines.brokerReceiptId would be nicer,
            // but AddSettlementDialog doesn't pipe it through onSaved
            // yet — querying by broker_id + receipt_type and ordering
            // by created_at is good enough for an interactive flow).
            const { data: latest } = await supabase
              .from('receipts')
              .select('id')
              .eq('broker_id', b.id)
              .eq('receipt_type', kind === 'disbursement' ? 'disbursement' : 'payment')
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            if (latest?.id) {
              // Both broker سند قبض and سند صرف now ride the unified
              // generate-voucher pipeline through VoucherSendDialog
              // (kind='payment' or 'disbursement'). The dialog hides
              // SMS/WhatsApp for the printOnly 'payment' kind since
              // there's no send-broker-payment-sms wrapper yet.
              setVoucherSend({
                kind: kind === 'disbursement' ? 'disbursement' : 'payment',
                receiptId: latest.id,
                clientPhone: b.phone,
              });
            } else {
              // Mirror lookup miss — should be rare; surface a
              // success toast so the user still gets confirmation.
              toast.success(
                kind === 'disbursement'
                  ? `تم تسجيل سند صرف للوسيط ${b.name}`
                  : `تم تسجيل سند قبض من الوسيط ${b.name}`,
              );
            }
          }}
        />
      )}

      {/* Customer + إشعار دائن — standalone credit note (not tied to
          a cancellation). Inserts wallet transaction + receipt with
          a C{nn}/{year} voucher_number from the shared allocator. */}
      {creditNoteClient && (
        <AddCreditNoteDialog
          open={!!creditNoteClient}
          onOpenChange={(o) => !o && setCreditNoteClient(null)}
          client={creditNoteClient}
          cancelLabel="رجوع"
          onSaved={({ receiptId }) => {
            const c = creditNoteClient;
            setCreditNoteClient(null);
            setAddVoucherOpen(false);
            fetchReceipts();
            setVoucherSend({
              kind: 'credit_note',
              receiptId,
              clientPhone: c.phone_number,
            });
          }}
        />
      )}

      {/* Post-save action popups — same components the customer page
          and policy cancel/transfer flows already use, so the user
          sees one familiar "what next?" UI everywhere. The print path
          of DebtPaymentSuccessDialog stamps printed_at on
          policy_payments, which locks تعديل on those receipts. */}
      {paymentSuccess && (
        <DebtPaymentSuccessDialog
          open={!!paymentSuccess}
          onOpenChange={(o) => !o && setPaymentSuccess(null)}
          paymentIds={paymentSuccess.paymentIds}
          clientPhone={paymentSuccess.clientPhone}
          onClose={() => setPaymentSuccess(null)}
        />
      )}
      {voucherSend && (
        <VoucherSendDialog
          open={!!voucherSend}
          onOpenChange={(o) => !o && setVoucherSend(null)}
          voucher={{ kind: voucherSend.kind, receiptId: voucherSend.receiptId }}
          clientPhone={voucherSend.clientPhone}
          onClose={() => setVoucherSend(null)}
        />
      )}

      <DeleteConfirmDialog
        open={!!deleteReceipt}
        onOpenChange={(o) => !o && setDeleteReceipt(null)}
        onConfirm={handleConfirmDelete}
        title="حذف الإيصال"
        description="هل أنت متأكد من حذف هذا الإيصال؟ لا يمكن التراجع عن هذا الإجراء."
        loading={deleting}
      />

      <PaymentEditDialog
        open={!!editPayment}
        onOpenChange={(o) => !o && setEditPayment(null)}
        payment={editPayment}
        onSuccess={async () => {
          setEditPayment(null);
          // The DB trigger mirrors policy_payments → receipts, so a
          // refetch here picks up the updated row automatically.
          await fetchReceipts();
        }}
      />

      {/* Shared print-progress overlay (also reused by ClientDetails's
          سجل الدفعات prints so the bookkeeper sees the same spinner
          regardless of where they kicked off the print). */}
      <PrintProgressDialog
        open={printProgress.open}
        value={printProgress.value}
      />

      {/* Reason prompt for إلغاء السند. Reason is required by the
          immutable-accounting flow — the bookkeeper needs a written
          explanation that gets copied onto the cancellation voucher
          and the cancelled original. The count + total shown here
          come from the customer-scope resolver in openCancelDialog,
          NOT from the clicked row, because cancellation matches the
          printed كشف القبض (every non-إلزامي / non-visa_external
          payment of this customer + every batch sibling). */}
      <Dialog open={reasonDialogOpen} onOpenChange={(o) => {
        if (!o) {
          setReasonDialogOpen(false);
          setReasonGroup(null);
          setReasonTargetIds([]);
          setReasonTargetSum(0);
          setReasonText("");
          setReasonError(null);
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {reasonAnyPrinted ? 'إلغاء السند' : 'حذف السند (لم يُطبع)'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            {reasonGroup && (
              <p className="text-xs text-muted-foreground">
                {reasonAnyPrinted ? (
                  <>
                    سيُنشأ سند إلغاء لكل واحد من{' '}
                    <span className="font-bold ltr-nums">{reasonTargetIds.length}</span>{' '}
                    {reasonTargetIds.length === 1 ? 'سند' : 'سندات'} لهذا العميل بقيمة إجمالية{' '}
                    <span className="font-bold ltr-nums">
                      ₪{Math.round(reasonTargetSum).toLocaleString('en-US')}
                    </span>
                    . رصيد العميل سيرتد بالكامل كما لو لم يدفع.
                  </>
                ) : (
                  <>
                    السند لم يُطبع بعد ولم يُسلَّم للعميل، لذا سيُحذف نهائياً بدون سند إلغاء.{' '}
                    <span className="font-bold ltr-nums">{reasonTargetIds.length}</span>{' '}
                    {reasonTargetIds.length === 1 ? 'سند' : 'سندات'} بقيمة إجمالية{' '}
                    <span className="font-bold ltr-nums">
                      ₪{Math.round(reasonTargetSum).toLocaleString('en-US')}
                    </span>
                    . رصيد العميل سيرتد بالكامل.
                  </>
                )}
              </p>
            )}
            {reasonAnyPrinted && (
              <>
                <Label htmlFor="cancel-reason">
                  سبب الإلغاء<span className="text-destructive mr-1">*</span>
                </Label>
                <Textarea
                  id="cancel-reason"
                  value={reasonText}
                  onChange={(e) => {
                    setReasonText(e.target.value);
                    if (e.target.value.trim()) setReasonError(null);
                  }}
                  placeholder="مثال: العميل طلب الإلغاء، خطأ في الإصدار، شيك مكرر..."
                  rows={3}
                  autoFocus
                  disabled={reasonSubmitting}
                />
                {reasonError && <p className="text-sm text-destructive">{reasonError}</p>}
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReasonDialogOpen(false)} disabled={reasonSubmitting}>
              تراجع
            </Button>
            <Button
              variant={reasonAnyPrinted ? 'default' : 'destructive'}
              onClick={confirmCancelReceipt}
              disabled={reasonSubmitting || (reasonAnyPrinted && !reasonText.trim())}
            >
              {reasonSubmitting ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : null}
              {reasonAnyPrinted ? 'تأكيد الإلغاء' : 'حذف نهائي'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );

  // ─── Table renderer ────────────────────────────────────────────

  function renderTable() {
    if (loading) {
      return (
        <Card>
          <CardContent className="p-4 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </CardContent>
        </Card>
      );
    }

    if (receipts.length === 0) {
      return (
        <Card>
          <CardContent className="p-12 text-center">
            <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground text-lg">لا توجد إيصالات</p>
            <p className="text-muted-foreground text-sm mt-1">
              يمكنك إضافة إيصال جديد بالضغط على زر "إضافة إيصال"
            </p>
          </CardContent>
        </Card>
      );
    }

    // Column header for the leading "number" column is tab-aware so
    // the user reads "رقم اشعار الدائن" on the credit-note tab and
    // "رقم سند الصرف" on the disbursement tab instead of the generic
    // سند القبض label. The "الكل" tab mixes types, so it falls back
    // to a neutral "رقم السند".
    const receiptNumberLabel =
      activeTab === 'all'
        ? 'رقم السند'
        : activeTab === 'credit_note'
          ? 'رقم اشعار الدائن'
          : activeTab === 'disbursement'
            ? 'رقم سند الصرف'
            : activeTab === 'cancellation'
              ? 'رقم سند الإلغاء'
              : 'رقم سند القبض';
    const visibleCols = tabColumns.filter((c) => isCol(c.key)).map((c) =>
      c.key === 'receipt_number' ? { ...c, label: receiptNumberLabel } : c,
    );
    // Equal-width columns. table-fixed + an identical width on every
    // <col> hands every column the same slice of the table regardless
    // of content. min-w guarantees readable cells when the page is
    // narrow; wider viewports just stretch each column proportionally.
    const equalColWidth = `${(100 / visibleCols.length).toFixed(4)}%`;

    return (
      <div className="space-y-4">
        <Card>
          <div className="overflow-x-auto">
            <Table className="table-fixed w-full min-w-[1000px]">
              <colgroup>
                {visibleCols.map((c) => (
                  <col key={c.key} style={{ width: equalColWidth }} />
                ))}
              </colgroup>
              <TableHeader>
                <TableRow>
                  {visibleCols.map((c) => (
                    <TableHead
                      key={c.key}
                      className="text-right whitespace-nowrap"
                    >
                      {c.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((group) => {
                  const firstReceipt = group.receipts[0];
                  const combinedMethodLabel = Array.from(
                    new Set(group.receipts.map((r) => paymentLabelShort(r.payment_method))),
                  ).join(" + ");
                  // Cancellation state for this row.
                  //  - allCancelled: every payment receipt in the group
                  //    has been voided. Drives the big "ملغي" badge and
                  //    hides the cancel action from the dropdown.
                  //  - voucherRef: receipt_number of the cancellation
                  //    voucher (for payment tab) or the original receipt
                  //    (for cancellation tab) — sourced from cancelXref.
                  //  - canCancel: only auto-source rows in the payment
                  //    tab that aren't already cancelled.
                  // Effective receipt type for this row's group — drives
                  // every per-row branch below. On single-type tabs this
                  // equals activeTab; on the "الكل" tab it varies row by
                  // row because the result set mixes all four families.
                  const rowType = (firstReceipt as any)?.receipt_type ?? 'payment';
                  const allCancelled =
                    rowType === 'payment' &&
                    group.receipts.length > 0 &&
                    group.receipts.every((r) => !!r.cancelled_at);
                  const partiallyCancelled =
                    rowType === 'payment' &&
                    !allCancelled &&
                    group.receipts.some((r) => !!r.cancelled_at);
                  const voucherRef = rowType === 'payment'
                    ? cancelXref[group.receipts.find((r) => r.cancelled_at)?.id ?? '']
                    : cancelXref[firstReceipt?.id ?? ''];
                  const canCancel =
                    rowType === 'payment' &&
                    !allCancelled &&
                    group.receipts.some((r) => r.source === 'auto' && r.payment_id);
                  // Lock تعديل once any underlying policy_payment has
                  // been printed — matches the agent-side سجل الدفعات
                  // rule. إلغاء is still permitted (it's the documented
                  // out for printed receipts).
                  const isPrinted = group.receipts.some(
                    (r) => r.payment_id && printedPaymentIds.has(r.payment_id),
                  );
                  // Cheque number for the row — only meaningful when the
                  // group is a single cheque receipt.
                  const chequeNumber =
                    group.receipts.length === 1 && firstReceipt?.payment_method === "cheque"
                      ? firstReceipt.cheque_number || "-"
                      : "-";
                  const notesPreview =
                    group.receipts.length === 1
                      ? firstReceipt?.notes || "-"
                      : group.receipts
                          .map((r) => r.notes)
                          .filter(Boolean)
                          .join(" · ") || "-";
                  return (
                    <TableRow
                      key={group.key}
                      className="hover:bg-muted/40"
                    >
                      {isCol("receipt_number") && (
                        <TableCell className="font-mono text-xs ltr-nums whitespace-nowrap text-right">
                          <div className="flex flex-col items-end gap-1">
                            <span className="font-semibold">
                              {/* credit_note / disbursement carry their
                                  own pre-formatted voucher_number
                                  (C{nn}/YYYY, D{nn}/YYYY). Fall back to
                                  the legacy R{n}/YYYY format derived
                                  from receipt_number for the other
                                  receipt families. */}
                              {firstReceipt?.voucher_number
                                ? firstReceipt.voucher_number
                                : formatReceiptNumber(firstReceipt?.receipt_number, firstReceipt?.receipt_date)}
                            </span>
                            {/* Cancellation indicators. Payment tab: red
                                pill + the voucher number that cancelled
                                it. Cancellation tab: amber pill + the
                                original receipt number this voucher
                                cancels. */}
                            {allCancelled && (
                              <Badge variant="destructive" className="gap-1 px-2 py-0 h-5 text-[10px] font-medium">
                                <XCircle className="h-3 w-3" />
                                <span>ملغي</span>
                                {voucherRef != null && (
                                  <span className="font-mono ltr-nums opacity-80">
                                    {formatReceiptNumber(voucherRef, firstReceipt?.receipt_date)}
                                  </span>
                                )}
                              </Badge>
                            )}
                            {partiallyCancelled && (
                              <Badge variant="warning" className="gap-1 px-2 py-0 h-5 text-[10px] font-medium">
                                <AlertCircle className="h-3 w-3" />
                                <span>ملغي جزئياً</span>
                              </Badge>
                            )}
                            {rowType === 'cancellation' && voucherRef != null && (
                              <Badge variant="warning" className="gap-1 px-2 py-0 h-5 text-[10px] font-medium">
                                <Ban className="h-3 w-3" />
                                <span>إلغاء سند</span>
                                <span className="font-mono ltr-nums opacity-80">
                                  {formatReceiptNumber(voucherRef, firstReceipt?.receipt_date)}
                                </span>
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                      )}
                      {isCol("receipt_type") && activeTab === 'all' && (
                        <TableCell className="whitespace-nowrap">
                          {(() => {
                            const cfg = RECEIPT_TYPE_BADGE[rowType] ?? RECEIPT_TYPE_BADGE.payment;
                            const TypeIcon = cfg.icon;
                            return (
                              <Badge variant={cfg.variant} className="gap-1">
                                <TypeIcon className="h-3 w-3" />
                                <span>{cfg.label}</span>
                              </Badge>
                            );
                          })()}
                        </TableCell>
                      )}
                      {isCol("amount") && (
                        <TableCell className="font-semibold whitespace-nowrap">
                          ₪{Math.round(group.total).toLocaleString("en-US")}
                        </TableCell>
                      )}
                      {isCol("receipt_date") && (
                        <TableCell className="ltr-nums whitespace-nowrap">
                          {formatDate(firstReceipt?.receipt_date || "")}
                        </TableCell>
                      )}
                      {isCol("client_name") && (
                        <TableCell className="truncate" title={group.client_name}>
                          {group.client_name}
                        </TableCell>
                      )}
                      {isCol("client_id_number") && (
                        <TableCell className="font-mono text-xs ltr-nums whitespace-nowrap">
                          {group.client_id_number || "-"}
                        </TableCell>
                      )}
                      {isCol("car_number") && (
                        <TableCell className="whitespace-nowrap">
                          {group.car_number || "-"}
                        </TableCell>
                      )}
                      {isCol("company_name") && (
                        <TableCell className="whitespace-nowrap text-sm">
                          {group.company_name || "-"}
                        </TableCell>
                      )}
                      {isCol("policy_type") && (
                        <TableCell className="whitespace-nowrap text-sm">
                          {group.policy_type_label || "-"}
                        </TableCell>
                      )}
                      {isCol("payment_method") && (
                        <TableCell className="whitespace-nowrap">
                          {group.receipts.length === 1 ? (
                            getPaymentBadge(firstReceipt.payment_method)
                          ) : (
                            <Badge variant="outline">{combinedMethodLabel}</Badge>
                          )}
                        </TableCell>
                      )}
                      {isCol("cheque_number") && (
                        <TableCell className="font-mono text-xs ltr-nums whitespace-nowrap">
                          {chequeNumber}
                        </TableCell>
                      )}
                      {isCol("notes") && (
                        <TableCell
                          className="text-sm text-muted-foreground truncate"
                          title={notesPreview}
                        >
                          {notesPreview}
                        </TableCell>
                      )}
                      {isCol("actions") && (
                        <TableCell
                          className="whitespace-nowrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => handlePrintGroup(group)}
                              >
                                <Printer className="h-4 w-4 ml-2" />
                                {/* Label tracks the active tab's
                                    document type. Cancellation / credit_
                                    note / disbursement are conceptually
                                    one voucher per row, so they stay
                                    singular even when the underlying
                                    group bundles multiple receipts. */}
                                {rowType === 'credit_note'
                                  ? "طباعة الإشعار"
                                  : rowType === 'disbursement'
                                    ? "طباعة سند الصرف"
                                    : rowType === 'cancellation'
                                      ? "طباعة سند الإلغاء"
                                      : group.receipts.length > 1
                                        ? "طباعة السندات"
                                        : "طباعة السند"}
                              </DropdownMenuItem>
                              {/* إلغاء السند — voids every underlying
                                  policy_payment in the group, which fires
                                  the sync trigger to create cancellation
                                  vouchers and mark these receipts cancelled.
                                  Hidden once the row is fully cancelled
                                  (no point re-cancelling) and on the
                                  cancellation tab (vouchers are already
                                  the cancellation record). */}
                              {canCancel && (
                                <DropdownMenuItem
                                  className="text-amber-700 focus:text-amber-800"
                                  disabled={reasonResolving}
                                  onClick={() => openCancelDialog(group)}
                                >
                                  <Ban className="h-4 w-4 ml-2" />
                                  إلغاء السند
                                </DropdownMenuItem>
                              )}
                              {/* Edit / delete are only meaningful on
                                  the payment tab. سندات الإلغاء rows are
                                  cancellation vouchers — they're a
                                  ledger of what was voided, not editable
                                  records, so hide both actions there. */}
                              {rowType === 'payment' && !allCancelled && (
                                firstReceipt.source === 'auto'
                                  ? (
                                    <DropdownMenuItem
                                      disabled={debtModalResolving || isPrinted}
                                      onClick={() => openSessionEditModal(group)}
                                      title={isPrinted ? 'السند مطبوع — استخدم إلغاء بدلاً من التعديل' : undefined}
                                    >
                                      <Pencil className="h-4 w-4 ml-2" />
                                      تعديل
                                      {isPrinted && (
                                        <span className="ms-auto text-[10px] text-muted-foreground">مطبوع</span>
                                      )}
                                    </DropdownMenuItem>
                                  )
                                  : group.receipts.length === 1
                                    ? (
                                      <DropdownMenuItem
                                        disabled={isPrinted}
                                        onClick={() => handleEditReceipt(group.receipts[0])}
                                        title={isPrinted ? 'السند مطبوع — استخدم إلغاء بدلاً من التعديل' : undefined}
                                      >
                                        <Pencil className="h-4 w-4 ml-2" />
                                        تعديل
                                        {isPrinted && (
                                          <span className="ms-auto text-[10px] text-muted-foreground">مطبوع</span>
                                        )}
                                      </DropdownMenuItem>
                                    )
                                    : null
                              )}
                              {rowType === 'payment' && group.receipts.length === 1 && !allCancelled && firstReceipt.source !== 'auto' && (
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onClick={() => setDeleteReceipt(group.receipts[0])}
                                >
                                  <Trash2 className="h-4 w-4 ml-2" />
                                  حذف
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>

        {/* Pagination */}
        <div className="flex items-center justify-center gap-3 py-4">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="gap-1"
          >
            <ChevronRight className="h-4 w-4" />
            السابق
          </Button>
          <span className="text-sm text-muted-foreground">
            صفحة {page + 1}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasMore}
            onClick={() => setPage((p) => p + 1)}
            className="gap-1"
          >
            التالي
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }
}
