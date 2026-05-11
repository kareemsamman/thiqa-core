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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  Eye,
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
  ReceiptGroupDetailsDialog,
  type ReceiptGroupView,
  type ReceiptRow,
} from "@/components/receipts/ReceiptGroupDetailsDialog";
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

// ─── Columns ─────────────────────────────────────────────────────────
//
// Schema for the manage-columns dropdown. document_number and actions
// are required (the row would lose its identity / interactivity without
// them). Default visibility excludes ملاحظات / رقم الشيك since those
// only matter to a subset of users — they can opt in via the dropdown.
const RECEIPTS_COLUMNS: ColumnOption[] = [
  { key: "document_number", label: "رقم المعاملة", required: true },
  { key: "receipt_number", label: "رقم سند القبض" },
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
  "document_number",
  "receipt_number",
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

function paymentLabelShort(method: string): string {
  return {
    cash: "نقدي",
    cheque: "شيك",
    visa: "فيزا",
    visa_external: "فيزا خارجي",
    transfer: "تحويل",
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
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${r.receipt_number || "-"}</td>
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
  // Receipt tab is locked to "payment" now — the accident_fee tab
  // was removed from the UI but the `receipt_type` filter on the
  // query stays so legacy accident_fee rows don't mix in.
  const activeTab = "payment";

  // Filters — search stays inline in the toolbar; everything else lives
  // in the AccountingFilters popover so we get one canonical filter UI
  // across the app (date range / month, companies, types, payment
  // methods).
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState<AccountingFiltersValue>({
    dateFrom: "",
    dateTo: "",
    companies: [],
    types: [],
    paymentMethods: [],
  });
  // Page-level branch filter — global admins only.
  const [branchFilter, setBranchFilter] = useState<string | null>(null);

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

  // Column visibility for the receipts table. Bumped to v1 so existing
  // localStorage from earlier (no manage-columns dropdown) starts fresh
  // with the documented defaults.
  const colsState = useTableColumnVisibility(
    "receipts-table-v1",
    RECEIPTS_DEFAULT_VISIBLE,
    RECEIPTS_COLUMN_KEYS,
  );
  const isCol = (key: string) => colsState.visible.includes(key);

  // Pagination
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  // Total receipts matching current filters — drives the "عدد الإيصالات"
  // tile and the printed report header so they reflect the whole set,
  // not just the current page (which is capped at PAGE_SIZE).
  const [totalCount, setTotalCount] = useState(0);

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
        ? "policy:policies!inner(id, document_number, group_id, company_id, policy_type_parent, policy_type_child, insurance_companies(id, name, name_ar), clients(id_number))"
        : "policy:policies(id, document_number, group_id, company_id, policy_type_parent, policy_type_child, insurance_companies(id, name, name_ar), clients(id_number))";
      const policyJoinCount = needsPolicyInnerJoin
        ? "policy:policies!inner(id)"
        : "policy:policies(id)";

      // Sort by created_at DESC first, so the receipt that was just
      // entered surfaces at the top even if the user back-dated it.
      let query = (supabase as any)
        .from("receipts")
        .select(`*, ${policyJoinFull}`)
        .eq("agent_id", agentId)
        .eq("receipt_type", activeTab)
        .eq("is_imported", false)
        .order("created_at", { ascending: false })
        .order("receipt_date", { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

      let countQuery = (supabase as any)
        .from("receipts")
        .select(`id, ${policyJoinCount}`, { count: "exact", head: true })
        .eq("agent_id", agentId)
        .eq("receipt_type", activeTab)
        .eq("is_imported", false);

      const applyShared = (q: any) => {
        // Hide ₪0 receipts — they have no print value and only confuse
        // the operator. Live receipts always carry a positive amount;
        // zero rows tend to be migration artifacts or aborted entries.
        q = q.gt("amount", 0);
        if (dateFrom) q = q.gte("receipt_date", dateFrom);
        if (dateTo) q = q.lte("receipt_date", dateTo);
        if (paymentMethods.length > 0) q = q.in("payment_method", paymentMethods);
        if (branchFilter) q = q.eq("branch_id", branchFilter);
        if (searchQuery.trim()) {
          const term = searchQuery.trim();
          q = q.or(`client_name.ilike.%${term}%,car_number.ilike.%${term}%`);
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
      setHasMore(rows.length > PAGE_SIZE);
      setReceipts(rows.length > PAGE_SIZE ? rows.slice(0, PAGE_SIZE) : rows);
      setTotalCount(total ?? 0);
    } catch (err: any) {
      console.error("Error fetching receipts:", err);
      toast.error("خطأ في تحميل الإيصالات");
    } finally {
      setLoading(false);
    }
  }, [agentId, activeTab, page, filters, branchFilter, searchQuery]);

  useEffect(() => {
    if (!agentLoading && agentId) {
      fetchReceipts();
    }
  }, [fetchReceipts, agentLoading, agentId]);

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
  }, [activeTab, filters, branchFilter, searchQuery]);

  // ─── Grouping ──────────────────────────────────────────────────
  //
  // Preferred grouping for auto-synced receipts (those with a policy
  // link): collapse every receipt whose policy shares the same package
  // (policies.group_id) into one row — matches how ClientDetails groups
  // the payments table. Standalone policies (no group_id) still collapse
  // all their payments into one row via policy_id. Manual receipts with
  // no policy link fall back to the old (client_name, car_number,
  // minute) key so same-batch manual entries still show together.
  // Receipts are already fetched newest-first, so Map insertion order
  // preserves that ordering in the output.
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
      let key: string;
      if (policy?.group_id) {
        key = `grp:${policy.group_id}`;
      } else if (policy?.id) {
        key = `pol:${policy.id}`;
      } else {
        const minute = roundToMinute(r.created_at);
        key = `manual:${r.client_name}||${r.car_number || ""}||${minute}`;
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
          document_numbers: [],
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
      const doc = policy?.document_number;
      if (doc && !g.document_numbers.includes(doc)) {
        g.document_numbers.push(doc);
      }
    }
    return Array.from(map.values());
  }, [receipts]);

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

    if (allAuto && paymentIds.length > 0) {
      try {
        const fn = paymentIds.length > 1
          ? "generate-bulk-payment-receipt"
          : "generate-payment-receipt";
        const body = paymentIds.length > 1
          ? { payment_ids: paymentIds }
          : { payment_id: paymentIds[0] };
        const { data, error } = await supabase.functions.invoke(fn, { body });
        if (error) throw error;
        const url = (data as any)?.receipt_url;
        if (url) {
          window.open(url, "_blank");
          return;
        }
        toast.error("لم يتم العثور على رابط السند");
        return;
      } catch (err: any) {
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

  const handleOpenDialog = () => {
    setEditingId(null);
    resetForm();
    setDialogOpen(true);
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
  const handlePrintAll = async () => {
    if (!agentId) return;
    setPrintingAll(true);
    try {
      const fmtMoney = (n: number) =>
        `₪${Math.round(n).toLocaleString("en-US")}`;
      const { dateFrom, dateTo, companies, types, paymentMethods } = filters;
      const needsPolicyInnerJoin = companies.length > 0 || types.length > 0;
      const policyJoin = needsPolicyInnerJoin
        ? "policy:policies!inner(id, document_number, group_id, company_id, policy_type_parent, policy_type_child, insurance_companies(id, name, name_ar), clients(id_number))"
        : "policy:policies(id, document_number, group_id, company_id, policy_type_parent, policy_type_child, insurance_companies(id, name, name_ar), clients(id_number))";

      // Pull every matching row (not just the current page) so طباعة الكل
      // actually reflects "all" — pagination is a screen affordance, not
      // a print one. Filters mirror fetchReceipts exactly so the print
      // and the table can't disagree.
      let q = (supabase as any)
        .from("receipts")
        .select(`*, ${policyJoin}`)
        .eq("agent_id", agentId)
        .eq("receipt_type", activeTab)
        .eq("is_imported", false)
        .gt("amount", 0)
        .order("created_at", { ascending: false })
        .order("receipt_date", { ascending: false });
      if (dateFrom) q = q.gte("receipt_date", dateFrom);
      if (dateTo) q = q.lte("receipt_date", dateTo);
      if (paymentMethods.length > 0) q = q.in("payment_method", paymentMethods);
      if (branchFilter) q = q.eq("branch_id", branchFilter);
      if (searchQuery.trim()) {
        const term = searchQuery.trim();
        q = q.or(`client_name.ilike.%${term}%,car_number.ilike.%${term}%`);
      }
      if (companies.length > 0) q = q.in("policy.company_id", companies);
      if (types.length > 0) {
        const clause = types.map(typeKeyToFilterClause).join(",");
        q = q.or(clause, { foreignTable: "policy" });
      }

      const { data, error } = await q;
      if (error) throw error;
      const allReceipts = (data || []) as ReceiptRecord[];

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

      // Build print columns from the on-screen Manage-Columns toggle
      // (minus the actions cell, which has no print equivalent), with
      // the row index pinned in front. Toggling شركة التأمين on screen
      // toggles it in print too — one knob, both surfaces.
      const PRINT_LABELS: Record<string, string> = {
        document_number: "رقم المعاملة",
        receipt_number: "رقم السند",
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
        ...RECEIPTS_COLUMNS.filter(
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
        return {
          idx: i + 1,
          document_number: policy?.document_number ?? "",
          receipt_number: r.receipt_number ?? "",
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
          subtitle="عرض وإدارة إيصالات الدفع ورسوم الحوادث"
        />

        <div className="p-3 md:p-6 space-y-4">
          {/* Toolbar — single row: primary actions on the right (RTL),
              search + count + manage columns + filter on the left, same
              pattern as /accounting. */}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={handleOpenDialog} className="h-8 gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              إضافة إيصال
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
                  placeholder="بحث باسم العميل أو رقم السيارة..."
                  className="h-8 w-full pr-8 text-sm"
                />
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {loading ? "..." : `${totalCount} إيصال`}
              </span>
              <ManageColumnsDropdown
                columns={RECEIPTS_COLUMNS}
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
                }}
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
                      ₪{totalAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}
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
        onEdit={handleEditReceipt}
        onDelete={(r) => setDeleteReceipt(r)}
      />

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

    // Per-column widths so table-fixed has something stable to size to.
    // Anything not listed gets `auto` (the client_name column flexes).
    const colWidths: Record<string, string | undefined> = {
      document_number: "110px",
      receipt_number: "160px",
      amount: "180px",
      receipt_date: "110px",
      client_name: undefined,
      client_id_number: "130px",
      car_number: "120px",
      company_name: "160px",
      policy_type: "100px",
      payment_method: "170px",
      cheque_number: "110px",
      notes: "180px",
      actions: "90px",
    };
    const visibleCols = RECEIPTS_COLUMNS.filter((c) => isCol(c.key));

    return (
      <div className="space-y-4">
        <Card>
          <div className="overflow-x-auto">
            {/* table-fixed + explicit widths on every column so the layout
                stops flex-sizing on content. The colgroup is rebuilt from
                visibleCols so toggling a column off in Manage Columns
                actually shortens the table. */}
            <Table className="table-fixed w-full min-w-[1000px]">
              <colgroup>
                {visibleCols.map((c) => (
                  <col
                    key={c.key}
                    style={colWidths[c.key] ? { width: colWidths[c.key] } : undefined}
                  />
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
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => handleOpenGroupDetails(group)}
                    >
                      {isCol("document_number") && (
                        <TableCell className="font-mono text-xs ltr-nums whitespace-nowrap">
                          {group.document_numbers.length > 0 ? (
                            <div className="flex items-center gap-1.5">
                              <span>{group.document_numbers.join(" · ")}</span>
                              {group.document_numbers.length > 1 && (
                                <Badge
                                  variant="outline"
                                  className="text-[9px] px-1.5 py-0 h-4 font-sans bg-amber-50 border-amber-300 text-amber-700 dark:bg-amber-950 dark:border-amber-800 dark:text-amber-300"
                                  title="هذه المعاملات ضمن باقة واحدة"
                                >
                                  📦 باقة
                                </Badge>
                              )}
                            </div>
                          ) : (
                            "-"
                          )}
                        </TableCell>
                      )}
                      {isCol("receipt_number") && (
                        <TableCell className="font-mono text-xs ltr-nums whitespace-nowrap">
                          {group.receipts.length <= 1 ? (
                            <span>{firstReceipt?.receipt_number ?? "-"}</span>
                          ) : (
                            <Tooltip delayDuration={100}>
                              <TooltipTrigger asChild>
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-[11px] font-semibold cursor-help hover:bg-primary/15 transition-colors">
                                  <Eye className="h-3 w-3" />
                                  عرض الكل
                                  <span className="bg-primary/20 rounded-full px-1.5 py-0 text-[9px]">
                                    {group.receipts.length}
                                  </span>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent
                                side="bottom"
                                align="end"
                                className="p-2"
                                dir="rtl"
                              >
                                <p className="text-[10px] text-muted-foreground mb-1.5 px-1">
                                  أرقام السندات ({group.receipts.length})
                                </p>
                                <ul className="flex flex-col gap-0.5">
                                  {group.receipts.map((r) => (
                                    <li
                                      key={r.id}
                                      className="px-2 py-1 rounded font-mono text-xs ltr-nums flex items-center gap-3 justify-between min-w-[140px]"
                                    >
                                      <span>{r.receipt_number ?? "-"}</span>
                                      <span className="text-muted-foreground">
                                        {paymentLabelShort(r.payment_method)}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </TableCell>
                      )}
                      {isCol("amount") && (
                        <TableCell className="font-semibold whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            ₪
                            {group.total.toLocaleString("en-US", {
                              minimumFractionDigits: 2,
                            })}
                            {group.receipts.length > 1 && (
                              <Badge
                                variant="secondary"
                                className="text-[10px] px-1.5 py-0"
                              >
                                {group.receipts.length} سندات
                              </Badge>
                            )}
                          </div>
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
                                {group.receipts.length > 1
                                  ? "طباعة السندات"
                                  : "طباعة السند"}
                              </DropdownMenuItem>
                              {/* For single-receipt rows expose edit/delete
                                  inline; for multi-receipt groups the user
                                  clicks the row itself, opens the details
                                  popup, and edits any individual card from
                                  there — no more per-receipt dropdown spam. */}
                              {group.receipts.length === 1 && (
                                <>
                                  <DropdownMenuItem
                                    onClick={() => handleEditReceipt(group.receipts[0])}
                                  >
                                    <Pencil className="h-4 w-4 ml-2" />
                                    تعديل
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    className="text-destructive focus:text-destructive"
                                    onClick={() => setDeleteReceipt(group.receipts[0])}
                                  >
                                    <Trash2 className="h-4 w-4 ml-2" />
                                    حذف
                                  </DropdownMenuItem>
                                </>
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
