import { useState, useEffect, useCallback, useMemo } from "react";
import { Navigate } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Header } from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import {
  Plus,
  Receipt,
  FileText,
  Banknote,
  CreditCard,
  Building,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  ArrowDownRight,
  ArrowUpRight,
  ShoppingCart,
  RotateCcw,
  BookOpen,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useAgentContext } from "@/hooks/useAgentContext";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TabKey = "issuance" | "refund" | "payment" | "receipt" | "sale";
type EntityMode = "company" | "broker" | "other";

interface AccountingRow {
  id: string;
  tab: TabKey;
  source: string;
  client_name: string;
  car_number: string | null;
  amount: number;
  date: string;
  issue_date: string;
  description: string;
  company_name: string;
  payment_method: string;
}

interface EntityOption {
  id: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;

const TAB_META: Record<TabKey, { label: string; icon: React.ReactNode; color: string }> = {
  issuance: { label: "إصدارات", icon: <FileText className="h-4 w-4" />, color: "text-primary" },
  refund: { label: "استرجاعات", icon: <RotateCcw className="h-4 w-4" />, color: "text-destructive" },
  payment: { label: "مدفوعات", icon: <ArrowUpRight className="h-4 w-4" />, color: "text-orange-600" },
  receipt: { label: "إيصالات", icon: <ArrowDownRight className="h-4 w-4" />, color: "text-success" },
  sale: { label: "مبيعات", icon: <ShoppingCart className="h-4 w-4" />, color: "text-violet-600" },
};

const MODE_LABELS: Record<EntityMode, string> = {
  company: "شركة",
  broker: "وسيط",
  other: "أخرى",
};

const PAYMENT_METHOD_LABELS: Record<string, { label: string; icon: any }> = {
  cash: { label: "نقدي", icon: Banknote },
  cheque: { label: "شيك", icon: FileText },
  bank_transfer: { label: "تحويل بنكي", icon: Building },
  visa: { label: "فيزا", icon: CreditCard },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const formatCurrency = (amount: number) => {
  const sign = amount < 0 ? "-" : "";
  return `${sign}₪${Math.abs(amount).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
};

const formatDate = (dateStr: string) => {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("en-GB");
};

const mapPaymentType = (pt: string): string => {
  switch (pt) {
    case "cash": return "cash";
    case "cheque": return "cheque";
    case "visa": return "visa";
    case "transfer": return "bank_transfer";
    default: return "cash";
  }
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function Accounting() {
  const { isAdmin, profile } = useAuth();
  const { agentId } = useAgentContext();

  // --- top-level state ---
  const [entityMode, setEntityMode] = useState<EntityMode>("company");
  const [activeTab, setActiveTab] = useState<TabKey>("issuance");
  const [entityOptions, setEntityOptions] = useState<EntityOption[]>([]);
  const [selectedEntityId, setSelectedEntityId] = useState<string>("all");

  // --- data ---
  const [rows, setRows] = useState<AccountingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // --- filters ---
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  // --- pagination ---
  const [page, setPage] = useState(1);

  // --- add dialog ---
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addForm, setAddForm] = useState({
    description: "",
    amount: "",
    date: format(new Date(), "yyyy-MM-dd"),
    payment_method: "cash",
    contact_name: "",
    notes: "",
    voucher_type: "payment" as "payment" | "receipt",
  });

  // Guard: admin only
  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  // ---------------------------------------------------------------------------
  // Fetch entity options (companies / brokers)
  // ---------------------------------------------------------------------------

  const fetchEntityOptions = useCallback(async () => {
    if (entityMode === "other") {
      setEntityOptions([]);
      setSelectedEntityId("all");
      return;
    }

    try {
      if (entityMode === "company") {
        let query = supabase
          .from("insurance_companies")
          .select("id, name, name_ar")
          .eq("active", true)
          .order("name");
        if (agentId) query = query.eq("agent_id", agentId);
        const { data } = await query;
        setEntityOptions(
          (data || []).map((c: any) => ({ id: c.id, name: c.name_ar || c.name }))
        );
      } else {
        let query = supabase.from("brokers").select("id, name").order("name");
        if (agentId) query = query.eq("agent_id", agentId);
        const { data } = await query;
        setEntityOptions((data || []).map((b: any) => ({ id: b.id, name: b.name })));
      }
    } catch (err) {
      console.error("Error fetching entity options:", err);
    }
    setSelectedEntityId("all");
  }, [entityMode, agentId]);

  useEffect(() => {
    fetchEntityOptions();
  }, [fetchEntityOptions]);

  // ---------------------------------------------------------------------------
  // Fetch accounting data for ALL tabs at once
  // ---------------------------------------------------------------------------

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const allRows: AccountingRow[] = [];

      // ----- helpers for agent filter -----
      const agentFilter = agentId ? agentId : undefined;

      // =====================================================================
      // 1. ISSUANCES — active policies
      // =====================================================================
      {
        let q = supabase
          .from("policies")
          .select(
            "id, insurance_price, start_date, issue_date, policy_number, company_id, cancelled, " +
            "clients(full_name), cars(car_number), insurance_companies(name, name_ar, broker_id)"
          )
          .is("deleted_at", null)
          .eq("cancelled", false);
        if (agentFilter) q = q.eq("agent_id", agentFilter);

        // entity filtering
        if (entityMode === "company" && selectedEntityId !== "all") {
          q = q.eq("company_id", selectedEntityId);
        } else if (entityMode === "broker" && selectedEntityId !== "all") {
          q = q.eq("broker_id", selectedEntityId);
        }

        const { data } = await q;
        (data || []).forEach((p: any) => {
          const companyData = p.insurance_companies as any;
          // mode-based inclusion
          if (entityMode === "company" && companyData?.broker_id) return; // skip broker-linked
          if (entityMode === "broker" && !companyData?.broker_id) return;

          allRows.push({
            id: `iss_${p.id}`,
            tab: "issuance",
            source: "policies",
            client_name: (p.clients as any)?.full_name || "",
            car_number: (p.cars as any)?.car_number || null,
            amount: Number(p.insurance_price) || 0,
            date: p.start_date,
            issue_date: p.issue_date || p.start_date,
            description: p.policy_number ? `بوليصة ${p.policy_number}` : "بوليصة",
            company_name: companyData?.name_ar || companyData?.name || "",
            payment_method: "",
          });
        });
      }

      // =====================================================================
      // 2. REFUNDS — cancelled policies, refused cheques, wallet refunds
      // =====================================================================
      {
        // 2a. Cancelled policies
        let qCanc = supabase
          .from("policies")
          .select(
            "id, insurance_price, cancellation_date, start_date, issue_date, policy_number, company_id, " +
            "clients(full_name), cars(car_number), insurance_companies(name, name_ar, broker_id)"
          )
          .is("deleted_at", null)
          .eq("cancelled", true);
        if (agentFilter) qCanc = qCanc.eq("agent_id", agentFilter);
        if (entityMode === "company" && selectedEntityId !== "all") qCanc = qCanc.eq("company_id", selectedEntityId);
        if (entityMode === "broker" && selectedEntityId !== "all") qCanc = qCanc.eq("broker_id", selectedEntityId);

        const { data: cancData } = await qCanc;
        (cancData || []).forEach((p: any) => {
          const companyData = p.insurance_companies as any;
          if (entityMode === "company" && companyData?.broker_id) return;
          if (entityMode === "broker" && !companyData?.broker_id) return;

          allRows.push({
            id: `ref_canc_${p.id}`,
            tab: "refund",
            source: "cancelled_policy",
            client_name: (p.clients as any)?.full_name || "",
            car_number: (p.cars as any)?.car_number || null,
            amount: Number(p.insurance_price) || 0,
            date: p.cancellation_date || p.start_date,
            issue_date: p.issue_date || p.start_date,
            description: `إلغاء بوليصة ${p.policy_number || ""}`.trim(),
            company_name: companyData?.name_ar || companyData?.name || "",
            payment_method: "",
          });
        });

        // 2b. Refused cheque payments
        let qRefused = supabase
          .from("policy_payments")
          .select(
            "id, amount, payment_date, payment_type, " +
            "policies!inner(id, policy_number, company_id, issue_date, start_date, clients(full_name), cars(car_number), insurance_companies(name, name_ar, broker_id))"
          )
          .eq("refused", true);
        if (agentFilter) qRefused = qRefused.eq("agent_id", agentFilter);

        const { data: refusedData } = await qRefused;
        (refusedData || []).forEach((pp: any) => {
          const pol = pp.policies as any;
          const companyData = pol?.insurance_companies as any;
          if (entityMode === "company" && companyData?.broker_id) return;
          if (entityMode === "broker" && !companyData?.broker_id) return;
          if (entityMode === "company" && selectedEntityId !== "all" && pol?.company_id !== selectedEntityId) return;

          allRows.push({
            id: `ref_chq_${pp.id}`,
            tab: "refund",
            source: "refused_cheque",
            client_name: (pol?.clients as any)?.full_name || "",
            car_number: (pol?.cars as any)?.car_number || null,
            amount: Number(pp.amount) || 0,
            date: pp.payment_date,
            issue_date: pol?.issue_date || pol?.start_date || pp.payment_date,
            description: `شيك مرفوض - بوليصة ${pol?.policy_number || ""}`.trim(),
            company_name: companyData?.name_ar || companyData?.name || "",
            payment_method: mapPaymentType(pp.payment_type),
          });
        });

        // 2c. Wallet refunds
        if (entityMode === "other" || selectedEntityId === "all") {
          let qWallet = supabase
            .from("customer_wallet_transactions")
            .select("id, amount, created_at, description, payment_method, clients(full_name)")
            .eq("transaction_type", "refund");
          if (agentFilter) qWallet = qWallet.eq("agent_id", agentFilter);

          const { data: walletData } = await qWallet;
          (walletData || []).forEach((w: any) => {
            allRows.push({
              id: `ref_wal_${w.id}`,
              tab: "refund",
              source: "wallet_refund",
              client_name: (w.clients as any)?.full_name || "",
              car_number: null,
              amount: Number(w.amount) || 0,
              date: w.created_at,
              issue_date: w.created_at,
              description: w.description || "مرتجع من المحفظة",
              company_name: "",
              payment_method: w.payment_method || "cash",
            });
          });
        }
      }

      // =====================================================================
      // 3. PAYMENTS — expenses(voucher_type=payment) + company_settlements
      // =====================================================================
      {
        // 3a. Manual expense payments
        let qExp = supabase
          .from("expenses")
          .select("id, amount, expense_date, description, contact_name, payment_method, category, notes")
          .eq("voucher_type", "payment");
        if (agentFilter) qExp = qExp.eq("agent_id", agentFilter);
        // exclude sales entries (prefixed with [مبيعات])
        const { data: expData } = await qExp;
        (expData || []).forEach((e: any) => {
          const desc = e.description || "";
          if (desc.startsWith("[مبيعات]")) return; // sales go to "sale" tab

          // For "other" mode, include all. For company/broker mode, only include if not entity-specific
          if (entityMode !== "other" && selectedEntityId !== "all") return;

          allRows.push({
            id: `pay_exp_${e.id}`,
            tab: "payment",
            source: "expense",
            client_name: e.contact_name || "",
            car_number: null,
            amount: Number(e.amount) || 0,
            date: e.expense_date,
            issue_date: e.expense_date,
            description: desc || e.category || "سند صرف",
            company_name: "",
            payment_method: e.payment_method || "cash",
          });
        });

        // 3b. Company settlements (only in company mode)
        if (entityMode === "company" || selectedEntityId === "all") {
          let qSettl = supabase
            .from("company_settlements")
            .select("id, total_amount, settlement_date, payment_type, notes, company_id, refused, insurance_companies(name, name_ar)")
            .eq("status", "completed")
            .neq("refused", true);
          if (agentFilter) qSettl = qSettl.eq("agent_id", agentFilter);
          if (entityMode === "company" && selectedEntityId !== "all") {
            qSettl = qSettl.eq("company_id", selectedEntityId);
          }
          const { data: settlData } = await qSettl;
          (settlData || []).forEach((s: any) => {
            const comp = s.insurance_companies as any;
            allRows.push({
              id: `pay_set_${s.id}`,
              tab: "payment",
              source: "company_settlement",
              client_name: "",
              car_number: null,
              amount: Number(s.total_amount) || 0,
              date: s.settlement_date,
              issue_date: s.settlement_date,
              description: `تسوية شركة - ${comp?.name_ar || comp?.name || ""}`.trim(),
              company_name: comp?.name_ar || comp?.name || "",
              payment_method: mapPaymentType(s.payment_type),
            });
          });
        }
      }

      // =====================================================================
      // 4. RECEIPTS — expenses(voucher_type=receipt) + policy_payments
      // =====================================================================
      {
        // 4a. Manual receipt expenses
        let qRec = supabase
          .from("expenses")
          .select("id, amount, expense_date, description, contact_name, payment_method, category")
          .eq("voucher_type", "receipt");
        if (agentFilter) qRec = qRec.eq("agent_id", agentFilter);
        const { data: recData } = await qRec;
        (recData || []).forEach((e: any) => {
          if (entityMode !== "other" && selectedEntityId !== "all") return;

          allRows.push({
            id: `rec_exp_${e.id}`,
            tab: "receipt",
            source: "expense_receipt",
            client_name: e.contact_name || "",
            car_number: null,
            amount: Number(e.amount) || 0,
            date: e.expense_date,
            issue_date: e.expense_date,
            description: e.description || e.category || "سند قبض",
            company_name: "",
            payment_method: e.payment_method || "cash",
          });
        });

        // 4b. Policy payments (customer payments)
        {
          let qPP = supabase
            .from("policy_payments")
            .select(
              "id, amount, payment_date, payment_type, notes, refused, " +
              "policies!inner(id, policy_number, company_id, issue_date, start_date, broker_id, " +
              "clients(full_name), cars(car_number), insurance_companies(name, name_ar, broker_id))"
            )
            .eq("refused", false);
          if (agentFilter) qPP = qPP.eq("agent_id", agentFilter);

          const { data: ppData } = await qPP;
          (ppData || []).forEach((pp: any) => {
            const pol = pp.policies as any;
            const companyData = pol?.insurance_companies as any;

            if (entityMode === "company" && companyData?.broker_id) return;
            if (entityMode === "broker" && !companyData?.broker_id) return;
            if (entityMode === "company" && selectedEntityId !== "all" && pol?.company_id !== selectedEntityId) return;
            if (entityMode === "broker" && selectedEntityId !== "all" && pol?.broker_id !== selectedEntityId) return;

            allRows.push({
              id: `rec_pp_${pp.id}`,
              tab: "receipt",
              source: "policy_payment",
              client_name: (pol?.clients as any)?.full_name || "",
              car_number: (pol?.cars as any)?.car_number || null,
              amount: Number(pp.amount) || 0,
              date: pp.payment_date,
              issue_date: pol?.issue_date || pol?.start_date || pp.payment_date,
              description: `دفعة - بوليصة ${pol?.policy_number || ""}`.trim(),
              company_name: companyData?.name_ar || companyData?.name || "",
              payment_method: mapPaymentType(pp.payment_type),
            });
          });
        }
      }

      // =====================================================================
      // 5. SALES — expenses with [مبيعات] prefix
      // =====================================================================
      {
        let qSale = supabase
          .from("expenses")
          .select("id, amount, expense_date, description, contact_name, payment_method, category, voucher_type");
        if (agentFilter) qSale = qSale.eq("agent_id", agentFilter);
        const { data: saleData } = await qSale;
        (saleData || []).forEach((e: any) => {
          const desc = (e.description || "") as string;
          if (!desc.startsWith("[مبيعات]")) return;

          if (entityMode !== "other" && selectedEntityId !== "all") return;

          allRows.push({
            id: `sale_${e.id}`,
            tab: "sale",
            source: "expense_sale",
            client_name: e.contact_name || "",
            car_number: null,
            amount: Number(e.amount) || 0,
            date: e.expense_date,
            issue_date: e.expense_date,
            description: desc.replace("[مبيعات]", "").trim() || "مبيعات",
            company_name: "",
            payment_method: e.payment_method || "cash",
          });
        });
      }

      setRows(allRows);
    } catch (err) {
      console.error("Error fetching accounting data:", err);
      toast.error("حدث خطأ في جلب بيانات المحاسبة");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [agentId, entityMode, selectedEntityId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ---------------------------------------------------------------------------
  // Computed: filtered + paginated rows for active tab
  // ---------------------------------------------------------------------------

  const filteredRows = useMemo(() => {
    let result = rows.filter((r) => r.tab === activeTab);

    if (dateFrom) {
      const from = new Date(dateFrom);
      from.setHours(0, 0, 0, 0);
      result = result.filter((r) => new Date(r.date) >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      result = result.filter((r) => new Date(r.date) <= to);
    }

    // sort newest first
    result.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return result;
  }, [rows, activeTab, dateFrom, dateTo]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const paginatedRows = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // reset page when tab / entity changes
  useEffect(() => {
    setPage(1);
  }, [activeTab, entityMode, selectedEntityId, dateFrom, dateTo]);

  // ---------------------------------------------------------------------------
  // Summary totals (across all rows, respecting date filter)
  // ---------------------------------------------------------------------------

  const summaryTotals = useMemo(() => {
    let filtered = rows;
    if (dateFrom) {
      const from = new Date(dateFrom);
      from.setHours(0, 0, 0, 0);
      filtered = filtered.filter((r) => new Date(r.date) >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      filtered = filtered.filter((r) => new Date(r.date) <= to);
    }

    const totals: Record<TabKey, number> = {
      issuance: 0,
      refund: 0,
      payment: 0,
      receipt: 0,
      sale: 0,
    };
    filtered.forEach((r) => {
      totals[r.tab] += r.amount;
    });
    const net = totals.issuance - totals.refund - totals.payment + totals.receipt - totals.sale;
    return { ...totals, net };
  }, [rows, dateFrom, dateTo]);

  // ---------------------------------------------------------------------------
  // Add entry handler
  // ---------------------------------------------------------------------------

  const handleAddEntry = async () => {
    if (!addForm.amount || !addForm.date) {
      toast.error("يرجى ملء المبلغ والتاريخ");
      return;
    }

    setSaving(true);
    try {
      // Determine the description prefix for sales
      let description = addForm.description || "";
      if (activeTab === "sale") {
        description = `[مبيعات] ${description}`.trim();
      }

      const expenseData: any = {
        category: "other",
        description,
        amount: parseFloat(addForm.amount),
        expense_date: addForm.date,
        notes: addForm.notes || null,
        created_by_admin_id: profile?.id,
        voucher_type: activeTab === "receipt" ? "receipt" : "payment",
        payment_method: addForm.payment_method,
        contact_name: addForm.contact_name || null,
      };

      const { error } = await supabase.from("expenses").insert(expenseData);
      if (error) throw error;

      toast.success("تم إضافة القيد بنجاح");
      setDialogOpen(false);
      resetAddForm();
      fetchData();
    } catch (err) {
      console.error("Error adding entry:", err);
      toast.error("حدث خطأ في الحفظ");
    } finally {
      setSaving(false);
    }
  };

  const resetAddForm = () => {
    setAddForm({
      description: "",
      amount: "",
      date: format(new Date(), "yyyy-MM-dd"),
      payment_method: "cash",
      contact_name: "",
      notes: "",
      voucher_type: "payment",
    });
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    toast.success("تم تحديث البيانات");
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <MainLayout>
      <Header
        title="دفتر الحسابات الموحد"
        subtitle="عرض شامل لجميع الحركات المالية"
      />

      <div className="p-4 md:p-6 space-y-5">
        {/* ============================================================ */}
        {/* Top controls: entity mode + entity selector + date range     */}
        {/* ============================================================ */}
        <Card>
          <CardContent className="py-4">
            <div className="flex flex-col md:flex-row gap-4 items-start md:items-end">
              {/* Entity mode selector */}
              <div className="w-full md:w-48">
                <Label className="text-xs mb-1 block">نوع الجهة</Label>
                <Select value={entityMode} onValueChange={(v) => setEntityMode(v as EntityMode)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="company">{MODE_LABELS.company}</SelectItem>
                    <SelectItem value="broker">{MODE_LABELS.broker}</SelectItem>
                    <SelectItem value="other">{MODE_LABELS.other}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Entity dropdown (company / broker list) */}
              {entityMode !== "other" && (
                <div className="w-full md:w-64">
                  <Label className="text-xs mb-1 block">
                    {entityMode === "company" ? "شركة التأمين" : "الوسيط"}
                  </Label>
                  <Select value={selectedEntityId} onValueChange={setSelectedEntityId}>
                    <SelectTrigger>
                      <SelectValue placeholder="الكل" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">الكل</SelectItem>
                      {entityOptions.map((opt) => (
                        <SelectItem key={opt.id} value={opt.id}>
                          {opt.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Date range */}
              <div className="w-full md:w-44">
                <Label className="text-xs mb-1 block">من تاريخ</Label>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="text-sm"
                />
              </div>
              <div className="w-full md:w-44">
                <Label className="text-xs mb-1 block">إلى تاريخ</Label>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="text-sm"
                />
              </div>

              {/* Clear dates */}
              {(dateFrom || dateTo) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() => {
                    setDateFrom("");
                    setDateTo("");
                  }}
                >
                  مسح التواريخ
                </Button>
              )}

              {/* Refresh */}
              <Button
                size="sm"
                onClick={handleRefresh}
                disabled={refreshing}
                className="gap-2"
              >
                <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
                {refreshing ? "جاري التحديث..." : "تحديث"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ============================================================ */}
        {/* Summary cards                                                */}
        {/* ============================================================ */}
        {loading ? (
          <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        ) : (
          <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
            {(Object.keys(TAB_META) as TabKey[]).map((key) => (
              <Card
                key={key}
                className={cn(
                  "cursor-pointer transition-colors border-2",
                  activeTab === key ? "border-primary bg-primary/5" : "border-transparent hover:border-muted-foreground/20"
                )}
                onClick={() => setActiveTab(key)}
              >
                <CardContent className="py-3 px-4">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={TAB_META[key].color}>{TAB_META[key].icon}</span>
                    <span className="text-xs text-muted-foreground">{TAB_META[key].label}</span>
                  </div>
                  <p className={cn("text-lg font-bold", TAB_META[key].color)}>
                    {formatCurrency(summaryTotals[key])}
                  </p>
                </CardContent>
              </Card>
            ))}

            {/* Net card */}
            <Card className="border-2 border-dashed border-muted-foreground/30">
              <CardContent className="py-3 px-4">
                <div className="flex items-center gap-2 mb-1">
                  <BookOpen className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">الصافي</span>
                </div>
                <p className={cn("text-lg font-bold", summaryTotals.net >= 0 ? "text-success" : "text-destructive")}>
                  {formatCurrency(summaryTotals.net)}
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ============================================================ */}
        {/* Tabs                                                         */}
        {/* ============================================================ */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabKey)}>
            <TabsList>
              {(Object.keys(TAB_META) as TabKey[]).map((key) => (
                <TabsTrigger key={key} value={key} className="gap-1.5">
                  {TAB_META[key].icon}
                  <span className="hidden sm:inline">{TAB_META[key].label}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {/* Add entry button — only for payment / receipt / sale tabs */}
          {(activeTab === "payment" || activeTab === "receipt" || activeTab === "sale") && (
            <Button size="sm" onClick={() => setDialogOpen(true)} className="gap-1">
              <Plus className="h-4 w-4" />
              إضافة قيد
            </Button>
          )}
        </div>

        {/* ============================================================ */}
        {/* Data table                                                   */}
        {/* ============================================================ */}
        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : paginatedRows.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <Receipt className="h-12 w-12 mx-auto mb-3 opacity-40" />
                <p className="text-sm">لا توجد بيانات في هذا التبويب</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8">#</TableHead>
                      <TableHead>التاريخ</TableHead>
                      <TableHead>العميل</TableHead>
                      <TableHead>رقم السيارة</TableHead>
                      <TableHead>الوصف</TableHead>
                      <TableHead>الشركة</TableHead>
                      <TableHead>طريقة الدفع</TableHead>
                      <TableHead>المصدر</TableHead>
                      <TableHead className="text-left">المبلغ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedRows.map((row, idx) => {
                      const pmInfo = PAYMENT_METHOD_LABELS[row.payment_method];
                      return (
                        <TableRow key={row.id}>
                          <TableCell className="text-muted-foreground text-xs">
                            {(page - 1) * PAGE_SIZE + idx + 1}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm">
                            {formatDate(row.date)}
                          </TableCell>
                          <TableCell className="text-sm max-w-[160px] truncate">
                            {row.client_name || "-"}
                          </TableCell>
                          <TableCell className="text-sm">{row.car_number || "-"}</TableCell>
                          <TableCell className="text-sm max-w-[200px] truncate">
                            {row.description}
                          </TableCell>
                          <TableCell className="text-sm max-w-[140px] truncate">
                            {row.company_name || "-"}
                          </TableCell>
                          <TableCell className="text-sm">
                            {pmInfo ? (
                              <Badge variant="outline" className="gap-1 text-xs">
                                {pmInfo.label}
                              </Badge>
                            ) : (
                              "-"
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="text-[10px]">
                              {row.source === "policies"
                                ? "بوليصة"
                                : row.source === "cancelled_policy"
                                ? "إلغاء"
                                : row.source === "refused_cheque"
                                ? "شيك مرفوض"
                                : row.source === "wallet_refund"
                                ? "محفظة"
                                : row.source === "expense"
                                ? "سند صرف"
                                : row.source === "expense_receipt"
                                ? "سند قبض"
                                : row.source === "company_settlement"
                                ? "تسوية شركة"
                                : row.source === "policy_payment"
                                ? "دفعة عميل"
                                : row.source === "expense_sale"
                                ? "مبيعات"
                                : row.source}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-left font-semibold whitespace-nowrap">
                            <span className={TAB_META[row.tab].color}>
                              {formatCurrency(row.amount)}
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>

          {/* Pagination */}
          {!loading && filteredRows.length > PAGE_SIZE && (
            <div className="flex items-center justify-between border-t px-4 py-3">
              <p className="text-xs text-muted-foreground">
                {filteredRows.length} نتيجة — صفحة {page} من {totalPages}
              </p>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* ============================================================ */}
      {/* Add Entry Dialog                                             */}
      {/* ============================================================ */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>
              إضافة قيد جديد — {TAB_META[activeTab]?.label || ""}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <Label>الوصف</Label>
              <Input
                value={addForm.description}
                onChange={(e) => setAddForm({ ...addForm, description: e.target.value })}
                placeholder="وصف القيد"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>المبلغ *</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={addForm.amount}
                  onChange={(e) => setAddForm({ ...addForm, amount: e.target.value })}
                  placeholder="0.00"
                />
              </div>
              <div>
                <Label>التاريخ *</Label>
                <Input
                  type="date"
                  value={addForm.date}
                  onChange={(e) => setAddForm({ ...addForm, date: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>طريقة الدفع</Label>
                <Select
                  value={addForm.payment_method}
                  onValueChange={(v) => setAddForm({ ...addForm, payment_method: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PAYMENT_METHOD_LABELS).map(([key, { label }]) => (
                      <SelectItem key={key} value={key}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>اسم جهة الاتصال</Label>
                <Input
                  value={addForm.contact_name}
                  onChange={(e) => setAddForm({ ...addForm, contact_name: e.target.value })}
                  placeholder="اختياري"
                />
              </div>
            </div>

            <div>
              <Label>ملاحظات</Label>
              <Textarea
                value={addForm.notes}
                onChange={(e) => setAddForm({ ...addForm, notes: e.target.value })}
                placeholder="ملاحظات إضافية"
                rows={2}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="outline">إلغاء</Button>
            </DialogClose>
            <Button onClick={handleAddEntry} disabled={saving}>
              {saving ? "جاري الحفظ..." : "حفظ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
