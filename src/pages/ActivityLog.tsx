import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Header } from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  FileText,
  CreditCard,
  Users,
  Car,
  Filter,
  ChevronDown,
  Trash2,
  XCircle,
  ArrowLeftRight,
  Banknote,
  ReceiptText,
  Printer,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { format, startOfDay, endOfDay, isWithinInterval, parseISO } from "date-fns";
import { ArabicDatePicker } from "@/components/ui/arabic-date-picker";
import { AgentBranchFilter } from "@/components/shared/AgentBranchFilter";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ActivityItem {
  id: string;
  type: "policy" | "payment" | "client" | "car" | "delete" | "cancel" | "transfer" | "disbursement" | "credit_note" | "debt_payment";
  action: string;
  created_at: string;
  createdBy?: string;
  details: {
    amount?: number;
    payment_type?: string;
    cheque_number?: string;
    policy_type?: string;
    policy_type_child?: string;
    company_name?: string;
    car_number?: string;
    client_id?: string;
    client_name?: string;
    client_file_number?: string;
    insurance_price?: number;
    cancellation_note?: string;
    refund_amount?: number;
    transfer_to_car?: string;
    transfer_from_car?: string;
    transfer_note?: string;
    /** For "policy" activities: total paid against this policy across all
     *  recorded payments (ELZAMI auto-rows excluded). Set when the
     *  activity loader can resolve the policy id. */
    paid_amount?: number;
    remaining_amount?: number;
    /** Receipt-backed activities (payment / cancel / disbursement /
     *  credit_note / debt_payment) carry the receipts row id + type +
     *  the underlying policy_payment id (for receipt_type='payment' the
     *  print function needs the payment_id, not the receipt id). The
     *  voucher_number is shown inline so staff can match the printed
     *  document at a glance. */
    receipt_id?: string;
    receipt_type?: "payment" | "cancellation" | "disbursement" | "credit_note";
    voucher_number?: string;
    payment_id?: string;
  };
}

const PAYMENT_TYPE_LABELS: Record<string, string> = {
  cash: "نقدًا",
  cheque: "شيك",
  visa: "فيزا",
  transfer: "حوالة",
  credit_card: "بطاقة ائتمان",
};

const PAYMENT_TYPE_COLORS: Record<string, string> = {
  cash: "bg-green-500/10 text-green-600 border-green-200",
  cheque: "bg-amber-500/10 text-amber-600 border-amber-200",
  visa: "bg-blue-500/10 text-blue-600 border-blue-200",
  transfer: "bg-purple-500/10 text-purple-600 border-purple-200",
  credit_card: "bg-indigo-500/10 text-indigo-600 border-indigo-200",
};

const TYPE_LABELS: Record<string, string> = {
  policy: "معاملة",
  payment: "دفعة",
  debt_payment: "تسديد دين",
  client: "عميل",
  car: "سيارة",
  delete: "حذف",
  cancel: "إلغاء",
  transfer: "تحويل",
  disbursement: "سند صرف",
  credit_note: "إشعار دين",
};

const POLICY_TYPE_LABELS: Record<string, string> = {
  ELZAMI: "إلزامي",
  THIRD_FULL: "شامل طرف ثالث",
  ROAD_SERVICE: "خدمة طريق",
  ACCIDENT_FEE_EXEMPTION: "إعفاء رسوم حادث",
  HEALTH: "صحي",
  LIFE: "حياة",
  TRAVEL: "سفر",
  PROPERTY: "ممتلكات",
  BUSINESS: "أعمال",
  OTHER: "أخرى",
};

const typeIcons: Record<string, any> = {
  policy: FileText,
  payment: CreditCard,
  debt_payment: Banknote,
  client: Users,
  car: Car,
  delete: Trash2,
  cancel: XCircle,
  transfer: ArrowLeftRight,
  disbursement: Banknote,
  credit_note: ReceiptText,
};

const typeColors: Record<string, string> = {
  policy: "text-primary bg-primary/10",
  payment: "text-success bg-success/10",
  debt_payment: "text-emerald-600 bg-emerald-500/10",
  client: "text-accent bg-accent/10",
  car: "text-warning bg-warning/10",
  delete: "text-destructive bg-destructive/10",
  cancel: "text-destructive bg-destructive/10",
  transfer: "text-warning bg-warning/10",
  disbursement: "text-orange-600 bg-orange-500/10",
  credit_note: "text-purple-600 bg-purple-500/10",
};

export default function ActivityLog() {
  const { profile } = useAuth();
  // Branch-scoped users (workers / branch admins) are pinned to their
  // own branch_id. Global admins see everything by default; the
  // AgentBranchFilter dropdown lets them narrow to one branch.
  // Effective filter = profile.branch_id (if set) ?? UI selection.
  const [adminBranchPick, setAdminBranchPick] = useState<string | null>(null);
  const branchId = profile?.branch_id ?? adminBranchPick;

  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [displayLimit, setDisplayLimit] = useState(20);

  const { data: activities = [], isLoading } = useQuery({
    queryKey: ["activity-log", branchId],
    queryFn: async () => {
      const results: ActivityItem[] = [];
      const branchFilter = branchId ? { branch_id: branchId } : {};

      // Fetch policies with more details. Cancelled and transferred rows
      // are NOT filtered out — we emit a "new policy" entry for every
      // policy, and *also* emit a separate "cancelled" / "transferred"
      // entry at the cancellation/transfer timestamp so the activity
      // feed captures the full lifecycle.
      const { data: policies } = await supabase
        .from("policies")
        .select(`
          id, created_at, policy_type_parent, policy_type_child, cancelled, cancellation_date, cancellation_note, transferred, transferred_car_number, insurance_price,
          clients(id, full_name, file_number, deleted_at),
          cars(car_number),
          insurance_companies(name, name_ar),
          created_by_profile:profiles!policies_created_by_admin_id_fkey(full_name)
        `)
        .order("created_at", { ascending: false })
        .match(branchFilter)
        .limit(100);

      // Total paid per policy — used to show "paid X / remaining Y" on
      // each policy-creation activity. Excludes locked/system rows (the
      // auto ELZAMI anchor isn't a real payment).
      const paidByPolicyId = new Map<string, number>();
      if (policies && policies.length > 0) {
        const policyIds = policies.map((p) => p.id);
        const { data: payRows } = await supabase
          .from("policy_payments")
          .select("policy_id, amount, locked, source")
          .in("policy_id", policyIds);
        for (const row of payRows || []) {
          if ((row as any).locked === true || (row as any).source === "system") continue;
          const prev = paidByPolicyId.get((row as any).policy_id) || 0;
          paidByPolicyId.set((row as any).policy_id, prev + Number((row as any).amount || 0));
        }
      }

      if (policies) {
        for (const p of policies) {
          if ((p.clients as any)?.deleted_at) continue;
          const clientName = (p.clients as any)?.full_name || "عميل";
          const fileNumber = (p.clients as any)?.file_number || "";
          const policyLabel = POLICY_TYPE_LABELS[p.policy_type_parent] || p.policy_type_parent || "معاملة";
          const companyName = (p.insurance_companies as any)?.name_ar || (p.insurance_companies as any)?.name || "";
          const carNumber = (p.cars as any)?.car_number || "";

          // Original "policy created" event. Cancellation is no longer
          // emitted from here — receipts.receipt_type='cancellation'
          // carries the canonical event with its voucher_number so the
          // print button works.
          const paidAmt = paidByPolicyId.get(p.id) || 0;
          const remainingAmt = Math.max(0, Number(p.insurance_price || 0) - paidAmt);
          results.push({
            id: `policy-${p.id}`,
            type: "policy",
            action: "معاملة جديدة",
            created_at: p.created_at,
            createdBy: (p.created_by_profile as any)?.full_name || undefined,
            details: {
              policy_type: policyLabel,
              policy_type_child: p.policy_type_child || undefined,
              company_name: companyName,
              car_number: carNumber,
              client_id: (p.clients as any)?.id,
              client_name: clientName,
              client_file_number: fileNumber,
              insurance_price: p.insurance_price || undefined,
              paid_amount: paidAmt,
              remaining_amount: remainingAmt,
            },
          });
        }
      }

      // Fetch transfer events from policy_transfers so the feed shows
      // "تحويل" actions the same way it shows cancellations.
      const { data: transfers } = await supabase
        .from("policy_transfers")
        .select(`
          id, created_at, transfer_date, note,
          policy:policies!policy_transfers_policy_id_fkey(
            policy_type_parent,
            insurance_companies(name, name_ar),
            clients(id, full_name, file_number, deleted_at)
          ),
          from_car:cars!policy_transfers_from_car_id_fkey(car_number),
          to_car:cars!policy_transfers_to_car_id_fkey(car_number),
          created_by_profile:profiles!policy_transfers_created_by_admin_id_fkey(full_name)
        `)
        .order("created_at", { ascending: false })
        .match(branchFilter)
        .limit(100);

      if (transfers) {
        for (const t of transfers as any[]) {
          if (t.policy?.clients?.deleted_at) continue;
          const clientName = t.policy?.clients?.full_name || "عميل";
          const fileNumber = t.policy?.clients?.file_number || "";
          const policyLabel = POLICY_TYPE_LABELS[t.policy?.policy_type_parent] || t.policy?.policy_type_parent || "معاملة";
          const companyName = t.policy?.insurance_companies?.name_ar || t.policy?.insurance_companies?.name || "";
          results.push({
            id: `transfer-${t.id}`,
            type: "transfer",
            action: "تحويل معاملة",
            created_at: t.transfer_date || t.created_at,
            createdBy: t.created_by_profile?.full_name || undefined,
            details: {
              policy_type: policyLabel,
              company_name: companyName,
              car_number: t.from_car?.car_number || "",
              transfer_from_car: t.from_car?.car_number || "",
              transfer_to_car: t.to_car?.car_number || "",
              transfer_note: t.note || undefined,
              client_id: t.policy?.clients?.id,
              client_name: clientName,
              client_file_number: fileNumber,
            },
          });
        }
      }

      // Fetch receipts — one unified feed for سند قبض (payment),
      // سند صرف (disbursement), إشعار دين (credit_note) and
      // سند إلغاء (cancellation). Each row carries its own
      // voucher_number so the inline "طباعة" button can call the
      // matching edge function. Auto-mirrored receipts whose payment
      // row is system/locked are skipped, same as the old
      // policy_payments path.
      const { data: receiptRows } = await supabase
        .from("receipts")
        .select(`
          id, created_at, receipt_type, voucher_number, amount, payment_method,
          cheque_number, client_id, policy_id, payment_id,
          direct_client:clients(id, full_name, file_number, deleted_at),
          policies(
            policy_type_parent, policy_type_child,
            insurance_companies(name, name_ar),
            cars(car_number),
            policy_client:clients(id, full_name, file_number, deleted_at)
          ),
          payment:policy_payments!receipts_payment_id_fkey(locked, source),
          created_by_profile:profiles!receipts_created_by_fkey(full_name)
        `)
        .order("created_at", { ascending: false })
        .match(branchFilter)
        .is("cancelled_at", null)
        .limit(150);

      if (receiptRows) {
        for (const r of receiptRows as any[]) {
          // Cancellation + payment receipts often arrive with
          // receipts.client_id = NULL — the row is only linked to the
          // client via policy.client_id. Fall back to the policy's
          // client so those events still cluster under the correct
          // customer card instead of an "عميل" bucket. The two
          // embeds are aliased (direct_client / policy_client)
          // because PostgREST can't infer which clients embed is
          // meant when both sit in the same select.
          const receiptClient = r.direct_client;
          const policyClient = r.policies?.policy_client;
          const client = receiptClient || policyClient;
          if (client?.deleted_at) continue;

          // Skip the system/locked anchor rows (auto ELZAMI "external
          // visa") — those carried over via the mirror but aren't
          // real customer-facing receipts.
          if (r.payment?.locked === true || r.payment?.source === "system") continue;

          const clientName = client?.full_name || "عميل";
          const fileNumber = client?.file_number || "";
          const policyType = POLICY_TYPE_LABELS[r.policies?.policy_type_parent] || "";
          const companyName = r.policies?.insurance_companies?.name_ar ||
                              r.policies?.insurance_companies?.name || "";
          const carNumber = r.policies?.cars?.car_number || "";

          let type: ActivityItem["type"];
          let action: string;
          switch (r.receipt_type) {
            case "payment":
              // No policy attached → standalone debt settlement (the
              // customer paid against their open balance without
              // singling out one معاملة). Different icon, different
              // label, no policy meta in the row.
              if (r.policy_id) {
                type = "payment";
                action = "دفعة مستلمة";
              } else {
                type = "debt_payment";
                action = "تسديد دين";
              }
              break;
            case "cancellation":
              type = "cancel";
              action = "معاملة ملغاة";
              break;
            case "disbursement":
              type = "disbursement";
              action = "تم عمل سند صرف";
              break;
            case "credit_note":
              type = "credit_note";
              action = "إشعار دين";
              break;
            default:
              continue;
          }

          results.push({
            id: `receipt-${r.id}`,
            type,
            action,
            created_at: r.created_at,
            createdBy: r.created_by_profile?.full_name || undefined,
            details: {
              // numeric columns come back from PostgREST as strings;
              // coerce up-front so downstream summations don't degrade
              // into "0" + "1000" → "01000" string concatenations.
              amount: Number(r.amount) || 0,
              payment_type: r.payment_method || undefined,
              cheque_number: r.cheque_number || undefined,
              policy_type: policyType,
              company_name: companyName,
              car_number: carNumber,
              client_id: client?.id,
              client_name: clientName,
              client_file_number: fileNumber,
              receipt_id: r.id,
              receipt_type: r.receipt_type,
              voucher_number: r.voucher_number || undefined,
              payment_id: r.payment_id || undefined,
            },
          });
        }
      }

      // Fetch clients
      const { data: clients } = await supabase
        .from("clients")
        .select(`
          id, created_at, full_name, file_number,
          created_by_profile:profiles!clients_created_by_admin_id_fkey(full_name)
        `)
        .order("created_at", { ascending: false })
        .match(branchFilter)
        .is("deleted_at", null)
        .limit(50);

      if (clients) {
        for (const c of clients) {
          results.push({
            id: `client-${c.id}`,
            type: "client",
            action: "عميل جديد",
            created_at: c.created_at,
            createdBy: (c.created_by_profile as any)?.full_name || undefined,
            details: {
              client_id: c.id,
              client_name: c.full_name,
              client_file_number: c.file_number || "",
            },
          });
        }
      }

      // Fetch cars
      const { data: cars } = await supabase
        .from("cars")
        .select(`
          id, created_at, updated_at, car_number,
          clients(id, full_name, file_number),
          created_by_profile:profiles!cars_created_by_admin_id_fkey(full_name)
        `)
        .order("updated_at", { ascending: false })
        .match(branchFilter)
        .is("deleted_at", null)
        .limit(50);

      if (cars) {
        for (const car of cars) {
          const isNew = car.created_at === car.updated_at;
          results.push({
            id: `car-${car.id}`,
            type: "car",
            action: isNew ? "سيارة جديدة" : "تحديث سيارة",
            created_at: car.updated_at,
            createdBy: (car.created_by_profile as any)?.full_name || undefined,
            details: {
              car_number: car.car_number,
              client_id: (car.clients as any)?.id,
              client_name: (car.clients as any)?.full_name || "",
              client_file_number: (car.clients as any)?.file_number || "",
            },
          });
        }
      }

      // Fetch delete events from notifications
      const { data: deleteNotifs } = await supabase
        .from("notifications")
        .select("id, created_at, title, message, metadata")
        .eq("type", "policy_deleted")
        .order("created_at", { ascending: false })
        .limit(50);

      if (deleteNotifs) {
        for (const n of deleteNotifs) {
          const meta = (n.metadata || {}) as any;
          results.push({
            id: `delete-${n.id}`,
            type: "delete",
            action: n.title || "حذف معاملة",
            created_at: n.created_at,
            createdBy: meta.deleted_by || undefined,
            details: {
              client_name: meta.client_name || "",
              policy_type: meta.policy_type || "",
              company_name: meta.company_name || "",
              insurance_price: meta.insurance_price || 0,
            },
          });
        }
      }

      // Sort all by created_at descending
      results.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      return results;
    },
    staleTime: 60 * 1000,
  });

  // Filter and search
  const filteredActivities = useMemo(() => {
    let filtered = [...activities];

    // Type filter
    if (typeFilter !== "all") {
      filtered = filtered.filter((a) => a.type === typeFilter);
    }

    // Date filter
    if (dateFrom || dateTo) {
      filtered = filtered.filter((a) => {
        const activityDate = parseISO(a.created_at);
        const from = dateFrom ? startOfDay(parseISO(dateFrom)) : new Date(0);
        const to = dateTo ? endOfDay(parseISO(dateTo)) : new Date(2100, 0, 1);
        return isWithinInterval(activityDate, { start: from, end: to });
      });
    }

    // Search filter
    if (search.trim()) {
      const searchLower = search.toLowerCase();
      filtered = filtered.filter((a) => {
        const searchableText = [
          a.details.client_name,
          a.details.client_file_number,
          a.details.car_number,
          a.details.company_name,
          a.details.policy_type,
          a.createdBy,
          a.action,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return searchableText.includes(searchLower);
      });
    }

    return filtered;
  }, [activities, typeFilter, dateFrom, dateTo, search]);

  // Calculate totals — both targeted payments and standalone debt
  // settlements are money in, so they roll up into the same total.
  const paymentTotal = useMemo(() => {
    return filteredActivities
      .filter((a) => a.type === "payment" || a.type === "debt_payment")
      .reduce((sum, a) => sum + (a.details.amount || 0), 0);
  }, [filteredActivities]);

  const displayedActivities = filteredActivities.slice(0, displayLimit);
  const hasMore = filteredActivities.length > displayLimit;

  // Print a receipt-backed activity by calling the matching edge
  // function. The four receipt types each use their own template (the
  // /receipts page does the same dispatch) — sand qabd / cancellation
  // / disbursement / credit-note all live in different CDN folders, so
  // hitting the wrong function would print the wrong document.
  const [printingId, setPrintingId] = useState<string | null>(null);
  const handlePrintReceipt = async (activity: ActivityItem) => {
    const d = activity.details;
    if (!d.receipt_id || !d.receipt_type) return;
    setPrintingId(activity.id);
    try {
      let fnName: string;
      // All voucher kinds now go through the unified
      // generate-voucher edge function — it reads the receipts row
      // (resolving payment_ids → receipt for legacy callers) and
      // branches on receipt_type internally.
      fnName = "generate-voucher";
      const body: Record<string, unknown> =
        d.receipt_type === "payment" && d.payment_id
          ? { payment_ids: [d.payment_id] }
          : { voucher_receipt_id: d.receipt_id };
      const { data, error } = await supabase.functions.invoke(fnName, { body });
      if (error) throw error;
      const url = (data as any)?.receipt_url;
      if (!url) {
        toast.error("لم يتم العثور على رابط السند");
        return;
      }
      window.open(url, "_blank");
    } catch (err: any) {
      console.error("[ActivityLog] receipt print failed:", err);
      toast.error(err?.message || "فشل في طباعة السند");
    } finally {
      setPrintingId(null);
    }
  };

  // Group activities by customer so one customer renders as a single
  // card with their own internal numbered timeline. Activities without
  // a client_id (e.g. some delete-notification rows) get their own card
  // keyed by activity id so they still appear in the feed.
  // singleActor is set when every activity in the group was done by
  // the same worker — lets the UI hoist "بواسطة <name>" up to the card
  // header instead of repeating it on every step.
  type CustomerGroup = {
    key: string;
    clientId: string | null;
    clientName: string;
    clientFileNumber: string | null;
    activities: ActivityItem[]; // newest-first; reverse for numbered display
    singleActor: string | null;
  };
  const groupedByCustomer = useMemo<CustomerGroup[]>(() => {
    const groups = new Map<string, CustomerGroup>();
    for (const activity of displayedActivities) {
      const clientId = activity.details.client_id ?? null;
      const key = clientId ?? `__no_client_${activity.id}`;
      const existing = groups.get(key);
      if (existing) {
        existing.activities.push(activity);
      } else {
        groups.set(key, {
          key,
          clientId,
          clientName: activity.details.client_name || "—",
          clientFileNumber: activity.details.client_file_number || null,
          activities: [activity],
          singleActor: null, // computed below
        });
      }
    }
    // Resolve singleActor per group: the unique creator across all steps,
    // or null if any step has a different creator (or none).
    return Array.from(groups.values()).map((g) => {
      const actors = new Set<string>();
      let missing = false;
      for (const a of g.activities) {
        if (a.createdBy) actors.add(a.createdBy);
        else missing = true;
      }
      const singleActor =
        actors.size === 1 && !missing ? Array.from(actors)[0] : null;
      return { ...g, singleActor };
    });
  }, [displayedActivities]);

  const clearFilters = () => {
    setSearch("");
    setDateFrom("");
    setDateTo("");
    setTypeFilter("all");
    setDisplayLimit(20);
  };

  const hasActiveFilters = search || dateFrom || dateTo || typeFilter !== "all";

  return (
    <MainLayout>
      <Header
        title="سجل النشاط"
        subtitle="تتبع جميع النشاطات والعمليات في النظام"
      />

      <div className="md:p-6 space-y-6">
        {/* Filters. Mobile layout stacks each control on its own row
            (`space-y-3`) with full-width controls and short inline
            labels for the date inputs; desktop falls back to the
            original `flex-wrap` row via `sm:flex sm:flex-wrap`. */}
        <Card>
          <CardContent className="p-3 sm:p-6">
            <div className="space-y-3 sm:space-y-0 sm:flex sm:flex-wrap sm:gap-4">
              {/* Search */}
              <div className="relative sm:flex-1 sm:min-w-[200px]">
                <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="بحث بالاسم، رقم الملف، رقم السيارة..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pr-10"
                />
              </div>

              {/* Date From — fixed-width label so "من" / "إلى" align
                  vertically as a clean column on mobile. */}
              <div className="flex items-center gap-2 sm:gap-1">
                <span className="text-sm text-muted-foreground shrink-0 w-8 sm:w-auto">من</span>
                <ArabicDatePicker
                  value={dateFrom}
                  onChange={setDateFrom}
                  placeholder="تاريخ البداية"
                  compact
                />
              </div>

              {/* Date To */}
              <div className="flex items-center gap-2 sm:gap-1">
                <span className="text-sm text-muted-foreground shrink-0 w-8 sm:w-auto">إلى</span>
                <ArabicDatePicker
                  value={dateTo}
                  onChange={setDateTo}
                  placeholder="تاريخ النهاية"
                  compact
                />
              </div>

              {/* Type Filter */}
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-full sm:w-[150px]">
                  <Filter className="h-4 w-4 ml-2" />
                  <SelectValue placeholder="النوع" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="policy">المعاملات</SelectItem>
                  <SelectItem value="cancel">الإلغاءات</SelectItem>
                  <SelectItem value="transfer">التحويلات</SelectItem>
                  <SelectItem value="payment">الدفعات</SelectItem>
                  <SelectItem value="debt_payment">تسديد الدين</SelectItem>
                  <SelectItem value="disbursement">سندات الصرف</SelectItem>
                  <SelectItem value="credit_note">إشعارات الدين</SelectItem>
                  <SelectItem value="client">العملاء</SelectItem>
                  <SelectItem value="car">السيارات</SelectItem>
                </SelectContent>
              </Select>

              {/* Branch filter — global admins only. Branch-scoped users
                  are pinned to their own branch via profile.branch_id
                  (component hides itself for them). */}
              <AgentBranchFilter
                value={adminBranchPick}
                onChange={setAdminBranchPick}
              />

              {/* Clear Filters */}
              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  onClick={clearFilters}
                  className="w-full sm:w-auto text-muted-foreground"
                >
                  مسح الفلاتر
                </Button>
              )}
            </div>

            {/* Results Summary */}
            <div className="mt-4 pt-3 border-t flex items-center justify-between gap-3 text-sm flex-wrap">
              <span className="text-muted-foreground">
                عرض {displayedActivities.length} من {filteredActivities.length} نتيجة
              </span>
              {(typeFilter === "payment" || typeFilter === "all") && paymentTotal > 0 && (
                <Badge variant="secondary" className="bg-success/10 text-success">
                  مجموع الدفعات: ₪{paymentTotal.toLocaleString()}
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Customer cards. Each card represents one customer and shows
            their activities as a numbered inner timeline (1, 2, 3, ...
            in chronological order, oldest first → newest). */}
        <div className="space-y-4">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-xl border bg-card p-5 shadow-sm">
                <Skeleton className="h-7 w-48 mb-4" />
                <div className="space-y-3">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              </div>
            ))
          ) : groupedByCustomer.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                لا توجد نتائج مطابقة للبحث
              </CardContent>
            </Card>
          ) : (
            groupedByCustomer.map((group) => {
              // Reverse so step #1 = oldest activity for this customer
              const steps = [...group.activities].reverse();
              return (
                <div
                  key={group.key}
                  className="rounded-2xl border bg-card p-5 sm:p-6 shadow-sm hover:shadow-md hover:border-primary/30 transition-all"
                >
                  {/* Customer name header — big + clickable. When every
                      activity in the card was performed by the same
                      worker, hoist the "بواسطة" chip up here so it
                      doesn't repeat on every step. */}
                  <div className="flex items-baseline justify-between gap-3 flex-wrap mb-5 pb-4 border-b">
                    <div className="flex items-baseline gap-3 min-w-0 flex-wrap">
                      {group.clientId ? (
                        <Link
                          to={`/clients/${group.clientId}`}
                          className="text-xl sm:text-2xl font-bold text-foreground hover:text-primary hover:underline underline-offset-4 transition-colors truncate"
                        >
                          {group.clientName}
                        </Link>
                      ) : (
                        <span className="text-xl sm:text-2xl font-bold text-foreground truncate">
                          {group.clientName}
                        </span>
                      )}
                      {group.clientFileNumber && (
                        <span className="text-sm text-muted-foreground">
                          ({group.clientFileNumber})
                        </span>
                      )}
                      {group.singleActor && (
                        <span className="inline-flex items-center gap-1.5 pl-2 pr-1 py-0.5 rounded-full bg-primary/10 border border-primary/15 text-[11px]">
                          <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-primary text-primary-foreground text-[9px] font-bold uppercase shrink-0">
                            {group.singleActor.trim().charAt(0)}
                          </span>
                          <span className="text-foreground/75">
                            بواسطة <span className="font-semibold text-foreground/95">{group.singleActor}</span>
                          </span>
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {steps.length} نشاط
                    </span>
                  </div>

                  {/* Card-level paid/remaining totals — computed from
                      the actual events in this card so it reflects
                      what the customer DID rather than what's stamped
                      on individual policy rows (the per-policy
                      paid_amount only sees payments tied to that one
                      policy_id and misses standalone debt
                      settlements). Invoiced = sum of new policy
                      prices, paid = every payment/debt-settlement
                      receipt minus any سند صرف refunded back to the
                      customer. */}
                  {(() => {
                    let invoiced = 0;
                    let paid = 0;
                    for (const s of steps) {
                      if (s.type === "policy") {
                        invoiced += s.details.insurance_price || 0;
                      } else if (s.type === "payment" || s.type === "debt_payment") {
                        paid += s.details.amount || 0;
                      } else if (s.type === "disbursement") {
                        paid -= s.details.amount || 0;
                      }
                    }
                    if (invoiced === 0 && paid === 0) return null;
                    const remaining = Math.max(0, invoiced - paid);
                    return (
                      <div className="flex items-center gap-2 flex-wrap mb-4 -mt-2">
                        <Badge variant="outline" className="text-xs border-success/40 text-success bg-success/5">
                          مدفوع: ₪{paid.toLocaleString()}
                        </Badge>
                        {remaining > 0 && (
                          <Badge variant="outline" className="text-xs border-destructive/40 text-destructive bg-destructive/5">
                            متبقي: ₪{remaining.toLocaleString()}
                          </Badge>
                        )}
                      </div>
                    );
                  })()}

                  {/* Inner numbered timeline. Each step:
                      [step #] · [icon] · [action + details + timestamp]
                      A vertical line connects the icons through their
                      centers. Layout: 24px step + 12px gap + 32px icon —
                      icon center sits at 24+12+16 = 52px from the right. */}
                  <div className="relative">
                    {steps.length > 1 && (
                      <div className="absolute right-[52px] top-6 bottom-6 w-px bg-border pointer-events-none" />
                    )}

                    <ol className="space-y-4">
                      {steps.map((activity, idx) => {
                        const Icon = typeIcons[activity.type];
                        return (
                          <li key={activity.id} className="relative flex items-start gap-3 group">
                            {/* Step number */}
                            <div className="shrink-0 w-6 h-6 mt-1 rounded-full bg-muted text-foreground/70 text-xs font-bold flex items-center justify-center">
                              {idx + 1}
                            </div>

                            {/* Icon marker on the inner timeline track */}
                            <div className={cn(
                              "relative z-10 rounded-lg p-2 shrink-0 ring-4 ring-card transition-transform group-hover:scale-105",
                              typeColors[activity.type],
                            )}>
                              <Icon className="h-4 w-4" />
                            </div>

                            {/* Step content */}
                            <div className="flex-1 min-w-0 pt-1">
                              {/* Top: action + actor chip + timestamp */}
                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                <div className="flex items-center gap-x-2 gap-y-1 flex-wrap min-w-0">
                                  <span className="font-semibold text-foreground">
                                    {activity.action}
                                  </span>
                                  {/* Per-step actor — only when the card
                                      has multiple workers; otherwise the
                                      header already shows it for the
                                      whole group. */}
                                  {!group.singleActor && activity.createdBy && (
                                    <span className="inline-flex items-center gap-1.5 pl-2 pr-1 py-0.5 rounded-full bg-primary/10 border border-primary/15 text-[11px]">
                                      <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-primary text-primary-foreground text-[9px] font-bold uppercase shrink-0">
                                        {activity.createdBy.trim().charAt(0)}
                                      </span>
                                      <span className="text-foreground/75">
                                        بواسطة <span className="font-semibold text-foreground/95">{activity.createdBy}</span>
                                      </span>
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  {/* Voucher # on receipt-backed rows so
                                      staff can match what the print
                                      button is about to render. */}
                                  {activity.details.voucher_number && (
                                    <span className="text-[11px] sm:text-xs font-mono text-muted-foreground/80 ltr-nums" dir="ltr">
                                      {activity.details.voucher_number}
                                    </span>
                                  )}
                                  {/* Inline print — fires the matching
                                      edge function for the receipt type
                                      and opens the rendered PDF in a
                                      new tab. Disabled while in-flight
                                      to avoid double-clicks. */}
                                  {activity.details.receipt_id && (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 px-2 text-xs"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handlePrintReceipt(activity);
                                      }}
                                      disabled={printingId === activity.id}
                                    >
                                      {printingId === activity.id ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <Printer className="h-3.5 w-3.5" />
                                      )}
                                      <span className="mr-1">طباعة</span>
                                    </Button>
                                  )}
                                  <span className="text-[11px] sm:text-xs text-muted-foreground whitespace-nowrap ltr-nums" dir="ltr">
                                    {format(new Date(activity.created_at), "dd/MM/yyyy HH:mm")}
                                  </span>
                                </div>
                              </div>

                              {/* Details */}
                              <div className="text-sm space-y-1 mt-1.5 text-muted-foreground">
                                {(activity.type === "payment" || activity.type === "debt_payment" || activity.type === "disbursement" || activity.type === "credit_note") && (
                                  <div className="flex items-center gap-x-3 gap-y-1 flex-wrap">
                                    <span className={cn(
                                      "font-semibold",
                                      activity.type === "disbursement" ? "text-orange-600" :
                                      activity.type === "credit_note" ? "text-purple-600" :
                                      "text-success",
                                    )}>
                                      ₪{(activity.details.amount || 0).toLocaleString()}
                                    </span>
                                    {activity.details.payment_type && (
                                      <Badge
                                        variant="outline"
                                        className={cn(
                                          "text-xs",
                                          PAYMENT_TYPE_COLORS[activity.details.payment_type] || PAYMENT_TYPE_COLORS.cash,
                                        )}
                                      >
                                        {PAYMENT_TYPE_LABELS[activity.details.payment_type] || activity.details.payment_type}
                                      </Badge>
                                    )}
                                    {activity.details.cheque_number && (
                                      <span className="text-xs">شيك #{activity.details.cheque_number}</span>
                                    )}
                                  </div>
                                )}

                                {(activity.details.policy_type || activity.details.company_name) && (
                                  <div className="flex items-start gap-2">
                                    <FileText className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                                    <div className="flex-1 min-w-0 flex items-center gap-x-2 gap-y-1 flex-wrap">
                                      <span>
                                        {activity.details.policy_type}
                                        {activity.details.company_name && (
                                          <span className="mr-1">← {activity.details.company_name}</span>
                                        )}
                                      </span>
                                      {activity.details.insurance_price && activity.type === "policy" && (
                                        <Badge variant="secondary" className="text-xs">
                                          ₪{activity.details.insurance_price.toLocaleString()}
                                        </Badge>
                                      )}
                                    </div>
                                  </div>
                                )}

                                {/* Per-row paid/remaining badges removed —
                                    one combined "مدفوع / متبقي" summary
                                    is rendered once at the foot of the
                                    card below (see paidTotals). */}

                                {activity.details.car_number && activity.type !== "transfer" && (
                                  <div className="flex items-center gap-2">
                                    <Car className="h-3.5 w-3.5 shrink-0" />
                                    <span className="ltr-nums">{activity.details.car_number}</span>
                                  </div>
                                )}

                                {activity.type === "cancel" && (
                                  <div className="flex items-center gap-3 flex-wrap">
                                    {(activity.details.refund_amount || 0) > 0 && (
                                      <Badge variant="destructive" className="text-xs">
                                        مرتجع للعميل: ₪{activity.details.refund_amount!.toLocaleString()}
                                      </Badge>
                                    )}
                                    {activity.details.cancellation_note && (
                                      <span className="text-xs">{activity.details.cancellation_note}</span>
                                    )}
                                  </div>
                                )}

                                {activity.type === "transfer" && (
                                  <>
                                    <div className="flex items-center gap-2">
                                      <ArrowLeftRight className="h-3.5 w-3.5" />
                                      <span className="font-mono text-xs ltr-nums">
                                        {activity.details.transfer_from_car || "—"} ← {activity.details.transfer_to_car || "—"}
                                      </span>
                                    </div>
                                    {activity.details.transfer_note && (
                                      <div className="text-xs">{activity.details.transfer_note}</div>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                </div>
              );
            })
          )}

          {/* Load More */}
          {hasMore && (
            <div className="flex justify-center pt-6">
              <Button
                variant="outline"
                onClick={() => setDisplayLimit((prev) => prev + 20)}
                className="gap-2"
              >
                <ChevronDown className="h-4 w-4" />
                تحميل المزيد ({filteredActivities.length - displayLimit} متبقي)
              </Button>
            </div>
          )}
        </div>
      </div>
    </MainLayout>
  );
}
