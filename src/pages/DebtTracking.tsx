import { useState, useEffect, useMemo } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Header } from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { extractFunctionErrorMessage, toastFunctionError } from "@/lib/functionError";
import { useToast } from "@/hooks/use-toast";
import { format, differenceInDays } from "date-fns";

import { 
  DollarSign, Search, AlertTriangle, Clock, Send, 
  Phone, Eye, Filter, Users, TrendingDown, Calendar,
  MessageSquare, RefreshCw, ChevronDown, ChevronUp, Wallet, MessageCircle,
  SendHorizonal
} from "lucide-react";
import { PolicyDetailsDrawer } from "@/components/policies/PolicyDetailsDrawer";
import { DebtPaymentModal } from "@/components/debt/DebtPaymentModal";
import { ClientNotesPopover } from "@/components/clients/ClientNotesPopover";
import { useAuth } from "@/hooks/useAuth";

interface ClientDebt {
  client_id: string;
  client_name: string;
  phone_number: string | null;
  total_owed: number;
  total_paid: number;
  total_remaining: number;
  policies: PolicyDebt[];
  policies_count: number;
  earliest_expiry: string | null;
  days_until_expiry: number | null;
}

interface PolicyDebt {
  id: string;
  policy_number: string | null;
  insurance_price: number;
  office_commission: number;
  paid: number;
  remaining: number;
  end_date: string;
  days_until_expiry: number;
  status: 'active' | 'expiring_soon' | 'expired';
  policy_type_parent: string | null;
  policy_type_child: string | null;
  car_number: string | null;
  group_id: string | null;
}

// Aggregated row for the debt table. One per package (group_id) or one per
// standalone policy. ELZAMI policies that belong to a package are merged
// into the parent row so their price doesn't clutter the list; only their
// office_commission is surfaced as a "+ عمولة مكتب" badge on the row.
interface DebtRow {
  key: string;
  isPackage: boolean;
  typeLabel: string;
  hasCommission: boolean;
  commissionTotal: number;
  price: number;
  paid: number;
  remaining: number;
  endDate: string;
  daysUntilExpiry: number;
  status: 'active' | 'expiring_soon' | 'expired';
  carNumber: string | null;
  primaryPolicyId: string;
}

const POLICY_TYPE_LABELS: Record<string, string> = {
  'ELZAMI': 'إلزامي',
  'THIRD_FULL': 'ثالث/شامل',
  'THIRD_ONLY': 'طرف ثالث',
  'ROAD_SERVICE': 'خدمات طريق',
  'ACCIDENT_FEE_EXEMPTION': 'إعفاء رسوم الحادث',
};

const getPolicyTypeLabel = (parent: string | null, child: string | null): string => {
  if (!parent) return '';
  const parentLabel = POLICY_TYPE_LABELS[parent] || parent;
  if (child && parent === 'THIRD_FULL') {
    const childLabel = child === 'FULL' ? 'شامل' : child === 'THIRD' ? 'ثالث' : child;
    return childLabel; // Just show child label for THIRD_FULL
  }
  return parentLabel;
};

// Collapse per-policy debt rows into per-package rows. For packages, ELZAMI
// price is excluded from the total (compulsory coverage is collected by the
// company via visa, not owed to the agent) — only its office_commission
// counts toward the debt.
//
// Grouping keys: prefer group_id when set; otherwise fall back to
// car_number so two policies for the same car still collapse into one
// package row.
const aggregateDebtRows = (policies: PolicyDebt[]): DebtRow[] => {
  const rows: DebtRow[] = [];
  const buckets = new Map<string, PolicyDebt[]>();

  const bucketKeyFor = (p: PolicyDebt): string => {
    if (p.group_id) return `g:${p.group_id}`;
    if (p.car_number) return `c:${p.car_number}`;
    return `p:${p.id}`;
  };

  for (const p of policies) {
    const key = bucketKeyFor(p);
    const list = buckets.get(key) || [];
    list.push(p);
    buckets.set(key, list);
  }

  for (const [key, items] of buckets) {
    // Standalone branch: single policy in the bucket.
    if (items.length === 1) {
      const p = items[0];
      // Skip bare ELZAMI with no commission — nothing for the agent.
      if (p.policy_type_parent === 'ELZAMI' && (p.office_commission || 0) === 0) continue;

      const isElzami = p.policy_type_parent === 'ELZAMI';
      const commission = p.office_commission || 0;
      const price = isElzami ? commission : (p.insurance_price + commission);
      const effectivePaid = isElzami ? Math.max(0, p.paid - p.insurance_price) : p.paid;
      const remaining = Math.max(0, price - effectivePaid);
      if (remaining <= 0) continue;

      rows.push({
        key: p.id,
        isPackage: false,
        typeLabel: isElzami
          ? 'عمولة مكتب'
          : getPolicyTypeLabel(p.policy_type_parent, p.policy_type_child) +
            (commission > 0 ? ' + عمولة مكتب' : ''),
        hasCommission: commission > 0,
        commissionTotal: commission,
        price,
        paid: Math.min(effectivePaid, price),
        remaining,
        endDate: p.end_date,
        daysUntilExpiry: p.days_until_expiry,
        status: p.status,
        carNumber: p.car_number,
        primaryPolicyId: p.id,
      });
      continue;
    }

    // Package branch: multiple policies share a group_id (or car).
    // ELZAMI contributes only office_commission, never its insurance_price.
    const nonElzami = items.filter((p) => p.policy_type_parent !== 'ELZAMI');
    const elzami = items.filter((p) => p.policy_type_parent === 'ELZAMI');
    const nonElzamiPrice = nonElzami.reduce((sum, p) => sum + p.insurance_price, 0);
    const elzamiCommission = elzami.reduce((sum, p) => sum + (p.office_commission || 0), 0);
    const elzamiBasePrice = elzami.reduce((sum, p) => sum + p.insurance_price, 0);
    const packagePrice = nonElzamiPrice + elzamiCommission;

    // Waterfall allocation across the whole package pool: the elzami base is a
    // passthrough to the insurance company, so the customer's payments cover
    // it first. Only what remains in the pool counts as paid toward the office
    // debt (non-elzami price + elzami commission). This way a 1650 payment on
    // a شامل+إلزامي package is attributed to the elzami base (company money),
    // not to the office, and the debt row shows paid=0 / remaining=full.
    const totalPaidPool = items.reduce((sum, p) => sum + p.paid, 0);
    const officePaidRaw = totalPaidPool - elzamiBasePrice;
    const packagePaid = Math.max(0, Math.min(packagePrice, officePaidRaw));
    const packageRemaining = packagePrice - packagePaid;
    if (packageRemaining <= 0) continue;

    const typeLabels = nonElzami
      .map((p) => getPolicyTypeLabel(p.policy_type_parent, p.policy_type_child))
      .filter(Boolean);
    const hasCommission = elzamiCommission > 0;
    const combined = typeLabels.join(' + ') + (hasCommission ? ' + عمولة مكتب' : '');

    const earliest = items.reduce(
      (best, p) => (!best || new Date(p.end_date) < new Date(best.end_date) ? p : best),
      items[0],
    );

    rows.push({
      key,
      isPackage: true,
      typeLabel: combined || 'باقة',
      hasCommission,
      commissionTotal: elzamiCommission,
      price: packagePrice,
      paid: packagePaid,
      remaining: packageRemaining,
      endDate: earliest.end_date,
      daysUntilExpiry: earliest.days_until_expiry,
      status: earliest.status,
      carNumber: earliest.car_number,
      primaryPolicyId: (nonElzami[0] || items[0]).id,
    });
  }

  // Keep deterministic ordering: earliest expiry first.
  rows.sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime());
  return rows;
};

export default function DebtTracking() {
  const { toast } = useToast();
  const { profile } = useAuth();

  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState<ClientDebt[]>([]);
  const [search, setSearch] = useState("");
  const [expandedClients, setExpandedClients] = useState<Set<string>>(new Set());
  const [sendingSmsTo, setSendingSmsTo] = useState<string | null>(null);
  const [smsDialogOpen, setSmsDialogOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<ClientDebt | null>(null);
  const [customMessage, setCustomMessage] = useState("");
  const [selectedPolicyId, setSelectedPolicyId] = useState<string | null>(null);
  const [policyDrawerOpen, setPolicyDrawerOpen] = useState(false);
  const [filterDays, setFilterDays] = useState<number | null>(null);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentClient, setPaymentClient] = useState<ClientDebt | null>(null);

  // Bulk SMS state
  const [bulkSmsDialogOpen, setBulkSmsDialogOpen] = useState(false);
  const [bulkSmsMessage, setBulkSmsMessage] = useState("");
  const [sendingBulkSms, setSendingBulkSms] = useState(false);

  const [totalRows, setTotalRows] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  const pageSize = 50;

  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [summary, setSummary] = useState({
    totalClients: 0,
    totalOwed: 0,
    expiringSoon: 0,
    expired: 0,
  });

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 250);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPageIndex(0);
  }, [debouncedSearch, filterDays]);

  useEffect(() => {
    fetchDebtData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, filterDays, pageIndex]);

  const fetchDebtData = async () => {
    setLoading(true);
    try {
      const { data: clientRows, error: clientError } = await supabase.rpc(
        "report_client_debts",
        {
          p_search: debouncedSearch || null,
          p_filter_days: filterDays,
          p_limit: pageSize,
          p_offset: pageIndex * pageSize,
        },
      );

      if (clientError) throw clientError;

      const total = Number((clientRows as any)?.[0]?.total_rows ?? 0) || 0;
      setTotalRows(total);

      const baseClients: ClientDebt[] = (clientRows || []).map((r: any) => ({
        client_id: r.client_id,
        client_name: r.client_name,
        phone_number: r.client_phone,
        total_owed: Number(r.total_insurance) || 0, // Use unified total_insurance
        total_paid: Number(r.total_paid) || 0,      // Now returned from RPC
        total_remaining: Number(r.total_remaining) || 0, // Unified balance
        policies: [],
        policies_count: Number(r.policies_count) || 0,
        earliest_expiry: r.oldest_end_date ? String(r.oldest_end_date) : null,
        days_until_expiry: r.days_until_oldest == null || isNaN(Number(r.days_until_oldest)) ? null : Number(r.days_until_oldest),
      }));

      const clientIds = baseClients.map((c) => c.client_id);

      const summaryPromise = supabase.rpc("report_client_debts_summary", {
        p_search: debouncedSearch || null,
        p_filter_days: filterDays,
      });

      const policiesPromise = clientIds.length
        ? supabase.rpc("report_debt_policies_for_clients", {
            p_client_ids: clientIds,
          })
        : Promise.resolve({ data: [], error: null } as any);

      const [summaryRes, policiesRes] = await Promise.all([summaryPromise, policiesPromise]);

      if (summaryRes.error) throw summaryRes.error;
      if (policiesRes.error) throw policiesRes.error;

      const s = (summaryRes.data as any[])?.[0];
      setSummary({
        totalClients: Number(s?.total_clients) || 0,
        totalOwed: Number(s?.total_remaining) || 0, // Use total_remaining as the unified debt
        expiringSoon: 0, // These are computed separately if needed
        expired: 0,
      });

      const policiesByClient = new Map<string, PolicyDebt[]>();
      for (const row of (policiesRes.data as any[]) || []) {
        const policy: PolicyDebt = {
          id: row.policy_id,
          policy_number: row.policy_number,
          insurance_price: Number(row.insurance_price) || 0,
          office_commission: Number(row.office_commission) || 0,
          paid: Number(row.paid) || 0,
          remaining: Number(row.remaining) || 0,
          end_date: String(row.end_date),
          days_until_expiry: Number(row.days_until_expiry) || 0,
          status: row.status,
          policy_type_parent: row.policy_type_parent,
          policy_type_child: row.policy_type_child,
          car_number: row.car_number,
          group_id: row.group_id,
        };
        const list = policiesByClient.get(row.client_id) || [];
        list.push(policy);
        policiesByClient.set(row.client_id, list);
      }

      const hydrated = baseClients.map((c) => ({
        ...c,
        policies: policiesByClient.get(c.client_id) || [],
      }));

      setExpandedClients(new Set());
      setClients(hydrated);
    } catch (error: any) {
      console.error("Error fetching debt data:", error);
      toast({
        title: "خطأ",
        description: "فشل في تحميل بيانات الديون",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const toggleExpanded = (clientId: string) => {
    setExpandedClients((prev) => {
      const next = new Set(prev);
      if (next.has(clientId)) {
        next.delete(clientId);
      } else {
        next.add(clientId);
      }
      return next;
    });
  };

  const handleSendReminder = async () => {
    if (!selectedClient) return;
    
    const targetClientName = selectedClient.client_name;
    setSmsDialogOpen(false);
    setCustomMessage("");

    // Await the result so we can show quota-reached errors instead of a
    // silent failure. Keep it non-blocking on the UI with a short pending toast.
    try {
      const { error } = await supabase.functions.invoke("send-manual-reminder", {
        body: {
          client_id: selectedClient.client_id,
          message: customMessage || undefined,
          sms_type: "payment_request",
        },
      });
      if (error) throw error;
      toast({
        title: "تم الإرسال",
        description: `تم إرسال التذكير إلى ${targetClientName}`,
      });
    } catch (error) {
      console.error("Error sending reminder:", error);
      // Action-aware toast: surfaces the Arabic message and adds a
      // "buy more quota" button if the server returned a 429.
      await toastFunctionError(error, "حدث خطأ أثناء إرسال التذكير");
    }
  };

  const openSmsDialog = (client: ClientDebt) => {
    setSelectedClient(client);
    setSmsDialogOpen(true);
  };

  const openPolicyDetails = (policyId: string) => {
    setSelectedPolicyId(policyId);
    setPolicyDrawerOpen(true);
  };

  const openPaymentModal = (client: ClientDebt) => {
    setPaymentClient(client);
    setPaymentModalOpen(true);
  };

  // Get filter label for bulk SMS dialog
  const getFilterLabel = () => {
    if (filterDays === null) return 'الكل';
    if (filterDays === 7) return 'أسبوع';
    if (filterDays === 30) return 'شهر';
    if (filterDays === 0) return 'منتهية';
    return 'الكل';
  };

  // Handle bulk SMS send
  const handleBulkSmsSend = async () => {
    if (summary.totalClients === 0) return;
    
    setSendingBulkSms(true);
    try {
      // Call edge function to send bulk SMS
      const { data, error } = await supabase.functions.invoke("send-bulk-debt-sms", {
        body: {
          filter_days: filterDays,
          search: debouncedSearch || null,
          custom_message: bulkSmsMessage || null,
        },
      });

      if (error) throw error;

      toast({
        title: "تم الإرسال",
        description: `تم إرسال ${data?.sent_count || 0} رسالة بنجاح${data?.failed_count ? ` (فشل ${data.failed_count})` : ''}`,
      });
      setBulkSmsDialogOpen(false);
      setBulkSmsMessage("");
    } catch (error: any) {
      console.error("Error sending bulk SMS:", error);
      await toastFunctionError(error, "فشل في إرسال الرسائل");
    } finally {
      setSendingBulkSms(false);
    }
  };

  const getWhatsAppUrl = (client: ClientDebt): string | null => {
    if (!client.phone_number) return null;

    let phone = client.phone_number.replace(/[\s\-\(\)]/g, '');
    if (phone.startsWith('0')) {
      phone = '972' + phone.slice(1);
    } else if (!phone.startsWith('972') && !phone.startsWith('+972')) {
      phone = '972' + phone;
    }
    phone = phone.replace('+', '');

    // Build policy details by aggregating into package rows so packages
    // appear as a single line and ELZAMI commission is surfaced inline.
    const rows = aggregateDebtRows(client.policies);
    const policyDetails = rows
      .slice(0, 5)
      .map((r) => {
        const car = r.carNumber || '';
        const remaining = Math.round(r.remaining);
        return `• ${r.typeLabel}${car ? ` - ${car}` : ''} - ₪${remaining.toLocaleString('en-US')}`;
      })
      .join('\n');

    const message = `مرحباً ${client.client_name}،

عليك تسديد المبلغ: ${client.total_remaining.toLocaleString('en-US')} شيكل

الوثائق:
${policyDetails}

يرجى التواصل معنا للتسوية.`;
    return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  };

  const formatCurrency = (amount: number) => `₪${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

  const getExpiryBadge = (days: number | null | undefined) => {
    if (days === null || days === undefined || isNaN(days)) return null;
    if (days < 0) {
      return <Badge variant="destructive">منتهي منذ {Math.abs(days)} يوم</Badge>;
    }
    if (days === 0) {
      return <Badge variant="destructive">ينتهي اليوم</Badge>;
    }
    if (days <= 7) {
      return <Badge variant="destructive">ينتهي خلال {days} أيام</Badge>;
    }
    if (days <= 30) {
      return <Badge className="bg-amber-500 hover:bg-amber-600">ينتهي خلال {days} يوم</Badge>;
    }
    return <Badge variant="secondary">{days} يوم متبقي</Badge>;
  };

  return (
    <MainLayout>
      <Header title="متابعة الديون" subtitle="إدارة المبالغ المستحقة وإرسال التذكيرات" />

      <div className="p-6 space-y-6">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="bg-gradient-to-br from-primary/10 to-primary/5 border-primary/20">
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-full bg-primary/10">
                  <DollarSign className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">إجمالي الديون</p>
                  <p className="text-2xl font-bold">{formatCurrency(summary.totalOwed)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-full bg-muted">
                  <Users className="h-6 w-6 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">عدد العملاء</p>
                  <p className="text-2xl font-bold">{summary.totalClients}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800">
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-full bg-amber-100 dark:bg-amber-900">
                  <Clock className="h-6 w-6 text-amber-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">تنتهي قريباً</p>
                  <p className="text-2xl font-bold">{summary.expiringSoon}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-destructive/10 border-destructive/20">
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-full bg-destructive/10">
                  <AlertTriangle className="h-6 w-6 text-destructive" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">منتهية</p>
                  <p className="text-2xl font-bold">{summary.expired}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-wrap gap-4 items-center">
              <div className="flex-1 min-w-[200px] max-w-md">
                <div className="relative">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="بحث بالاسم أو الهاتف..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pr-10"
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  variant={filterDays === null ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFilterDays(null)}
                >
                  الكل
                </Button>
                <Button
                  variant={filterDays === 7 ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFilterDays(7)}
                >
                  أسبوع
                </Button>
                <Button
                  variant={filterDays === 30 ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFilterDays(30)}
                >
                  شهر
                </Button>
                <Button
                  variant={filterDays === 0 ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFilterDays(0)}
                  className="text-destructive"
                >
                  منتهية
                </Button>
              </div>

              <Button variant="outline" onClick={fetchDebtData}>
                <RefreshCw className="h-4 w-4 ml-2" />
                تحديث
              </Button>

              <Button 
                variant="default"
                onClick={() => setBulkSmsDialogOpen(true)}
                disabled={summary.totalClients === 0}
              >
                <SendHorizonal className="h-4 w-4 ml-2" />
                إرسال للكل ({summary.totalClients})
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Debt Table */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-primary" />
              قائمة الديون
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
            ) : clients.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <DollarSign className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>لا توجد ديون مستحقة</p>
              </div>
            ) : (
              <div className="space-y-2">
                {clients.map((client) => (
                  <div key={client.client_id} className="border rounded-lg overflow-hidden">
                    {/* Client Row */}
                    <div
                      className="flex items-center justify-between p-4 bg-muted/30 hover:bg-muted/50 cursor-pointer transition-colors"
                      onClick={() => toggleExpanded(client.client_id)}
                    >
                      <div className="flex items-center gap-4">
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          {expandedClients.has(client.client_id) ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )}
                        </Button>
                        <div>
                          <p 
                            className="font-medium text-primary cursor-pointer hover:underline"
                            onClick={(e) => {
                              e.stopPropagation();
                              window.location.href = `/clients/${client.client_id}`;
                            }}
                          >
                            {client.client_name}
                          </p>
                          <p className="text-sm text-muted-foreground flex items-center gap-2">
                            <Phone className="h-3 w-3" />
                            {client.phone_number || "لا يوجد رقم"}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        {/* Notes Popover */}
                        <ClientNotesPopover
                          clientId={client.client_id}
                          clientName={client.client_name}
                          branchId={profile?.branch_id}
                        />
                        <Badge variant="outline">{client.policies_count} وثيقة</Badge>
                        <div className="text-left min-w-[100px]">
                          <p className="font-bold text-lg text-destructive">
                            {formatCurrency(client.total_remaining)}
                          </p>
                        </div>
                        <Button
                          variant="default"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            openPaymentModal(client);
                          }}
                        >
                          <Wallet className="h-4 w-4 ml-2" />
                          تسديد المبلغ
                        </Button>
                        {client.phone_number ? (
                          <a
                            href={getWhatsAppUrl(client) || '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium border bg-transparent h-9 rounded-md px-3 text-green-600 border-green-600 hover:bg-green-50 transition-all"
                          >
                            <MessageCircle className="h-4 w-4" />
                          </a>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled
                            className="text-green-600 border-green-600"
                          >
                            <MessageCircle className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            openSmsDialog(client);
                          }}
                          disabled={!client.phone_number}
                        >
                          <Send className="h-4 w-4 ml-2" />
                          تذكير
                        </Button>
                      </div>
                    </div>

                    {/* Expanded aggregated rows — one per package or standalone policy */}
                    {expandedClients.has(client.client_id) && (() => {
                      const rows = aggregateDebtRows(client.policies);
                      return (
                        <div className="border-t">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="text-right">نوع الوثيقة</TableHead>
                                <TableHead className="text-right">رقم السيارة</TableHead>
                                <TableHead className="text-right">السعر</TableHead>
                                <TableHead className="text-right">المدفوع</TableHead>
                                <TableHead className="text-right">المتبقي</TableHead>
                                <TableHead className="text-right">تاريخ الانتهاء</TableHead>
                                <TableHead className="text-right">الحالة</TableHead>
                                <TableHead className="text-right">إجراءات</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {rows.map((row) => (
                                <TableRow key={row.key}>
                                  <TableCell>
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="font-medium">{row.typeLabel}</span>
                                      {row.isPackage && (
                                        <Badge variant="outline" className="text-[10px]">باقة</Badge>
                                      )}
                                      {row.hasCommission && row.commissionTotal > 0 && (
                                        <Badge className="text-[10px] bg-amber-100 text-amber-900 border-amber-300 hover:bg-amber-100">
                                          + {formatCurrency(row.commissionTotal)} عمولة
                                        </Badge>
                                      )}
                                    </div>
                                  </TableCell>
                                  <TableCell className="font-mono">
                                    {row.carNumber || '-'}
                                  </TableCell>
                                  <TableCell className="font-semibold">{formatCurrency(row.price)}</TableCell>
                                  <TableCell className="text-green-600">
                                    {formatCurrency(row.paid)}
                                  </TableCell>
                                  <TableCell className="text-destructive font-medium">
                                    {formatCurrency(row.remaining)}
                                  </TableCell>
                                  <TableCell>
                                    {format(new Date(row.endDate), "dd/MM/yyyy")}
                                  </TableCell>
                                  <TableCell>{getExpiryBadge(row.daysUntilExpiry)}</TableCell>
                                  <TableCell>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => openPolicyDetails(row.primaryPolicyId)}
                                    >
                                      <Eye className="h-4 w-4 ml-1" />
                                      عرض
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      );
                    })()}
                  </div>
                ))}

                {/* Pagination */}
                <div className="mt-4 flex flex-col md:flex-row items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">
                    عرض {totalRows === 0 ? 0 : pageIndex * pageSize + 1}–
                    {Math.min((pageIndex + 1) * pageSize, totalRows)} من {totalRows}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPageIndex((p) => Math.max(p - 1, 0))}
                      disabled={pageIndex === 0}
                    >
                      السابق
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPageIndex((p) => p + 1)}
                      disabled={(pageIndex + 1) * pageSize >= totalRows}
                    >
                      التالي
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* SMS Dialog */}
      <Dialog open={smsDialogOpen} onOpenChange={setSmsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إرسال تذكير دفع</DialogTitle>
            <DialogDescription>
              إرسال رسالة تذكير إلى {selectedClient?.client_name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground mb-2">رقم الهاتف</p>
              <p className="font-medium"><bdi>{selectedClient?.phone_number}</bdi></p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-2">المبلغ المستحق</p>
              <p className="font-bold text-lg text-destructive">
                {formatCurrency(selectedClient?.total_remaining || 0)}
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                رسالة مخصصة (اختياري - اتركها فارغة لاستخدام القالب الافتراضي)
              </p>
              <Textarea
                value={customMessage}
                onChange={(e) => setCustomMessage(e.target.value)}
                placeholder="اكتب رسالة مخصصة أو اترك الحقل فارغاً..."
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSmsDialogOpen(false)}>
              إلغاء
            </Button>
            <Button
              onClick={handleSendReminder}
              disabled={sendingSmsTo === selectedClient?.client_id}
            >
              {sendingSmsTo === selectedClient?.client_id ? (
                <RefreshCw className="h-4 w-4 ml-2 animate-spin" />
              ) : (
                <Send className="h-4 w-4 ml-2" />
              )}
              إرسال
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk SMS Dialog */}
      <Dialog open={bulkSmsDialogOpen} onOpenChange={setBulkSmsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إرسال رسائل جماعية</DialogTitle>
            <DialogDescription>
              سيتم إرسال رسالة تذكير لجميع العملاء المطابقين للفلتر الحالي
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
              <span className="text-sm text-muted-foreground">الفلتر الحالي</span>
              <Badge variant="outline">{getFilterLabel()}</Badge>
            </div>
            <div className="flex items-center justify-between p-3 bg-primary/10 rounded-lg">
              <span className="text-sm font-medium">عدد العملاء</span>
              <span className="font-bold text-lg">{summary.totalClients}</span>
            </div>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                رسالة مخصصة (اختياري - اتركها فارغة لاستخدام القالب الافتراضي)
              </p>
              <Textarea
                value={bulkSmsMessage}
                onChange={(e) => setBulkSmsMessage(e.target.value)}
                placeholder="اكتب رسالة مخصصة أو اترك الحقل فارغاً..."
                rows={4}
              />
            </div>
            <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg">
              <p className="text-sm text-amber-700 dark:text-amber-400">
                ⚠️ سيتم إرسال رسالة واحدة لكل عميل. تأكد من صحة الفلتر قبل الإرسال.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkSmsDialogOpen(false)}>
              إلغاء
            </Button>
            <Button
              onClick={handleBulkSmsSend}
              disabled={sendingBulkSms || summary.totalClients === 0}
            >
              {sendingBulkSms ? (
                <RefreshCw className="h-4 w-4 ml-2 animate-spin" />
              ) : (
                <SendHorizonal className="h-4 w-4 ml-2" />
              )}
              إرسال ({summary.totalClients})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Policy Details Drawer */}
      <PolicyDetailsDrawer
        policyId={selectedPolicyId}
        open={policyDrawerOpen}
        onOpenChange={setPolicyDrawerOpen}
        onUpdated={fetchDebtData}
        onViewRelatedPolicy={(newPolicyId) => {
          setSelectedPolicyId(newPolicyId);
        }}
      />

      {/* Debt Payment Modal */}
      {paymentClient && (
        <DebtPaymentModal
          open={paymentModalOpen}
          onOpenChange={(isOpen) => {
            setPaymentModalOpen(isOpen);
            if (!isOpen) {
              setPaymentClient(null);
            }
          }}
          clientId={paymentClient.client_id}
          clientName={paymentClient.client_name}
          clientPhone={paymentClient.phone_number}
          totalOwed={paymentClient.total_owed}
          onSuccess={() => {
            setPaymentClient(null);
            fetchDebtData();
          }}
        />
      )}
    </MainLayout>
  );
}
