import { useState, useEffect, useCallback, useRef } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Header } from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { ArabicDatePicker } from "@/components/ui/arabic-date-picker";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ArrowRight,
  Pencil,
  Phone,
  FileText,
  Wallet,
  Plus,
  Download,
  X,
  Loader2,
  Handshake,
  ArrowUpRight,
  ArrowDownLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { extractFunctionErrorMessage } from "@/lib/functionError";
import { ClientDrawer } from "@/components/clients/ClientDrawer";
import { PolicyWizard } from "@/components/policies/PolicyWizard";
import { PolicyDetailsDrawer } from "@/components/policies/PolicyDetailsDrawer";
import { RowActionsMenu } from "@/components/shared/RowActionsMenu";
import { getInsuranceTypeLabel } from "@/lib/insuranceTypes";

interface Broker {
  id: string;
  name: string;
  phone: string | null;
  image_url: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface Client {
  id: string;
  full_name: string;
  id_number: string;
  phone_number: string | null;
}

interface Policy {
  id: string;
  policy_type_parent: string;
  policy_type_child: string | null;
  insurance_price: number;
  broker_buy_price: number | null;
  profit: number;
  start_date: string;
  end_date: string;
  broker_direction: 'from_broker' | 'to_broker' | null;
  cancelled: boolean | null;
  transferred: boolean | null;
  client: { full_name: string } | null;
  car: { car_number: string } | null;
}

interface BrokerDetailsProps {
  broker: Broker;
  onBack: () => void;
  onEdit: () => void;
  onRefresh: () => void;
}

const policyTypeLabels: Record<string, string> = {
  ELZAMI: "إلزامي",
  THIRD_FULL: "طرف ثالث/شامل",
  ROAD_SERVICE: "خدمة الطريق",
  ACCIDENT_FEE_EXEMPTION: "إعفاء حدمات",
};

export function BrokerDetails({ broker, onBack, onEdit, onRefresh }: BrokerDetailsProps) {
  const [clients, setClients] = useState<Client[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalCollected: 0,
    totalRemaining: 0,
    fromBrokerTotal: 0,
    toBrokerTotal: 0,
    fromBrokerCount: 0,
    toBrokerCount: 0,
    paidToBroker: 0,
    receivedFromBroker: 0,
  });
  const [clientDrawerOpen, setClientDrawerOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [viewingPolicyId, setViewingPolicyId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  
  // Date filter state — YYYY-MM-DD strings matching ArabicDatePicker.
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  
  const { toast } = useToast();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch clients under this broker
      const { data: clientsData } = await supabase
        .from("clients")
        .select("id, full_name, id_number, phone_number")
        .eq("broker_id", broker.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });

      setClients(clientsData || []);

      // Fetch policies for this broker with date filter
      let query = supabase
        .from("policies")
        .select(`
          id, policy_type_parent, policy_type_child, insurance_price, broker_buy_price, profit, start_date, end_date, broker_direction,
          cancelled, transferred,
          clients!policies_client_id_fkey(full_name),
          cars!policies_car_id_fkey(car_number)
        `)
        .eq("broker_id", broker.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });

      if (startDate) {
        query = query.gte("start_date", startDate);
      }
      if (endDate) {
        query = query.lte("start_date", endDate);
      }

      const { data: policiesData } = await query;

      const formattedPolicies = (policiesData || []).map((p: any) => ({
        ...p,
        client: p.clients,
        car: p.cars,
      }));
      setPolicies(formattedPolicies);

      // Calculate stats
      const policyIds = formattedPolicies.map((p) => p.id);
      let totalCollected = 0;

      if (policyIds.length > 0) {
        const { data: payments } = await supabase
          .from("policy_payments")
          .select("amount, refused")
          .in("policy_id", policyIds);

        totalCollected =
          payments
            ?.filter((p) => !p.refused)
            .reduce((sum, p) => sum + Number(p.amount), 0) || 0;
      }

      const totalPrice = formattedPolicies.reduce(
        (sum, p) => sum + Number(p.insurance_price),
        0
      );

      const fromBrokerPolicies = formattedPolicies.filter(
        (p) => p.broker_direction === 'from_broker'
      );
      const toBrokerPolicies = formattedPolicies.filter(
        (p) => p.broker_direction === 'to_broker' || p.broker_direction === null
      );

      // from_broker = I bought from broker at broker_buy_price, so I owe broker that amount
      // to_broker = Broker bought from me, broker owes me the insurance_price
      const fromBrokerTotal = fromBrokerPolicies.reduce(
        (sum, p) => sum + Number(p.broker_buy_price || p.insurance_price || 0),
        0
      );
      const toBrokerTotal = toBrokerPolicies.reduce(
        (sum, p) => sum + Number(p.insurance_price || 0),
        0
      );

      // Also fetch broker settlements to factor into the net calculation
      const { data: settlementsData } = await supabase
        .from("broker_settlements")
        .select("*")
        .eq("broker_id", broker.id)
        .eq("status", "completed");

      // we_owe = I paid broker (reduces my debt)
      // broker_owes = Broker paid me (reduces broker's debt)
      const paidToBroker = (settlementsData || [])
        .filter((s: any) => s.direction === 'we_owe' && !s.refused)
        .reduce((sum: number, s: any) => sum + Number(s.total_amount || 0), 0);
      
      const receivedFromBroker = (settlementsData || [])
        .filter((s: any) => s.direction === 'broker_owes' && !s.refused)
        .reduce((sum: number, s: any) => sum + Number(s.total_amount || 0), 0);

      setStats({
        totalCollected,
        totalRemaining: totalPrice - totalCollected,
        fromBrokerTotal, // Policy profits I owe broker
        toBrokerTotal,   // Policy profits broker owes me
        fromBrokerCount: fromBrokerPolicies.length,
        toBrokerCount: toBrokerPolicies.length,
        paidToBroker,    // Settlements I paid to broker
        receivedFromBroker, // Settlements broker paid to me
      });
    } catch (error) {
      console.error("Error fetching broker data:", error);
    } finally {
      setLoading(false);
    }
  }, [broker.id, startDate, endDate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const formatCurrency = (amount: number) => {
    return `₪${amount.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-GB");
  };

  const handleExportPdf = async (sendSms = false) => {
    setExporting(true);
    try {
      // Generation + optional SMS happen in a single call. The edge
      // function sends the SMS itself using the service role so we
      // avoid the gateway's HS256/ES256 JWT mismatch that 401'd the
      // old client-side send-sms round-trip.
      const { data, error } = await supabase.functions.invoke("generate-broker-report", {
        body: {
          broker_id: broker.id,
          start_date: startDate || undefined,
          end_date: endDate || undefined,
          direction_filter: 'all',
          send_sms: sendSms,
        },
      });

      if (error) throw error;

      if (!data?.url) return;

      if (sendSms) {
        if (data.sms_sent) {
          toast({
            title: "تم الإرسال",
            description: "تم إرسال رابط التقرير للوسيط عبر SMS",
          });
        } else {
          toast({
            title: "تعذر إرسال SMS",
            description: data.sms_error || "لم يتم إرسال الرسالة",
            variant: "destructive",
          });
        }
      } else {
        window.open(data.url, "_blank");
        toast({
          title: "تم التصدير",
          description: "تم إنشاء التقرير بنجاح",
        });
      }
    } catch (error: any) {
      console.error("Error exporting PDF:", error);
      const fallback = sendSms ? "فشل في إرسال التقرير" : "فشل في تصدير التقرير";
      const description = await extractFunctionErrorMessage(error);
      toast({
        title: "خطأ",
        description: description || fallback,
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  const clearDateFilter = () => {
    setStartDate("");
    setEndDate("");
  };

  // Net balance = (what broker owes me from policies + what I received from broker)
  //             - (what I owe broker from policies + what I paid to broker)
  // Simplified: (toBrokerTotal - fromBrokerTotal) + (receivedFromBroker - paidToBroker)
  const policyNetBalance = stats.toBrokerTotal - stats.fromBrokerTotal;
  const settlementNetBalance = stats.receivedFromBroker - stats.paidToBroker;
  const netBalance = policyNetBalance + settlementNetBalance;

  const dateRangeText = startDate || endDate
    ? `${startDate ? formatDate(startDate) : "..."} - ${endDate ? formatDate(endDate) : "..."}`
    : "كل الفترات";

  return (
    <MainLayout>
      <Header
        title={broker.name}
        subtitle={broker.phone || "الوسطاء"}
      />
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 print:hidden">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={onBack}>
              <ArrowRight className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                <span className="text-xl font-bold text-primary">
                  {broker.name.charAt(0)}
                </span>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-foreground">{broker.name}</h1>
                {broker.phone && (
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <Phone className="h-4 w-4" />
                    <bdi>{broker.phone}</bdi>
                  </div>
                )}
              </div>
            </div>
          </div>
          <TooltipProvider delayDuration={150}>
            <div className="flex flex-wrap items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" onClick={() => handleExportPdf(false)} disabled={exporting}>
                    {exporting ? (
                      <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4 ml-2" />
                    )}
                    تصدير التقرير
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" align="end" className="max-w-xs text-right">
                  فتح تقرير الوسيط في نافذة جديدة للطباعة أو الحفظ
                </TooltipContent>
              </Tooltip>

              {broker.phone && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" onClick={() => handleExportPdf(true)} disabled={exporting}>
                      {exporting ? (
                        <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                      ) : (
                        <FileText className="h-4 w-4 ml-2" />
                      )}
                      إرسال التقرير SMS
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" align="end" className="max-w-xs text-right">
                    إرسال رابط التقرير للوسيط عبر رسالة SMS على رقمه المسجّل
                  </TooltipContent>
                </Tooltip>
              )}

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" onClick={onEdit}>
                    <Pencil className="h-4 w-4 ml-2" />
                    تعديل
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" align="end" className="max-w-xs text-right">
                  تعديل بيانات الوسيط (الاسم، الهاتف، الملاحظات)
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button onClick={() => setWizardOpen(true)}>
                    <Plus className="h-4 w-4 ml-2" />
                    إضافة معاملة
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" align="end" className="max-w-xs text-right">
                  إنشاء معاملة تأمين جديدة مرتبطة بهذا الوسيط
                </TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>
        </div>


        {/* Date Filter */}
        <Card className="print:hidden">
          <CardContent className="pt-6">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5 flex-1 min-w-[180px] max-w-[220px]">
                <Label className="text-xs text-muted-foreground">من تاريخ</Label>
                <ArabicDatePicker
                  value={startDate}
                  onChange={setStartDate}
                  placeholder="اختر التاريخ"
                  compact
                />
              </div>
              <div className="space-y-1.5 flex-1 min-w-[180px] max-w-[220px]">
                <Label className="text-xs text-muted-foreground">إلى تاريخ</Label>
                <ArabicDatePicker
                  value={endDate}
                  onChange={setEndDate}
                  placeholder="اختر التاريخ"
                  compact
                />
              </div>
              {(startDate || endDate) && (
                <Button variant="ghost" size="sm" onClick={clearDateFilter} className="mb-0.5">
                  <X className="h-4 w-4 ml-1" />
                  مسح الفلتر
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Tabs - Hide tabs on print, show content directly */}
        <Tabs defaultValue="policies" className="space-y-4">
          <TabsList className="print:hidden">
            <TabsTrigger value="policies" className="gap-2">
              <FileText className="h-4 w-4" />
              المعاملات ({policies.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="policies" className="print:mt-0">
            <Card className="print:border print:shadow-none">
              <CardHeader>
                <CardTitle className="text-base">
                  معاملات الوسيط ({policies.length} معاملة)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                ) : policies.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">
                    لا توجد معاملات تحت هذا الوسيط
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="print:text-xs">#</TableHead>
                          <TableHead className="print:text-xs">الجهة</TableHead>
                          <TableHead className="print:text-xs">العميل</TableHead>
                          <TableHead className="print:text-xs">السيارة</TableHead>
                          <TableHead className="print:text-xs">النوع</TableHead>
                          <TableHead className="print:text-xs">سعر الشراء</TableHead>
                          <TableHead className="print:text-xs">الصلاحية</TableHead>
                          <TableHead className="w-[80px] print:hidden">إجراءات</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {policies.map((policy, index) => (
                          <TableRow 
                            key={policy.id}
                            className="cursor-pointer hover:bg-muted/50 print:hover:bg-transparent"
                            onClick={() => setViewingPolicyId(policy.id)}
                          >
                            <TableCell className="font-mono text-sm print:text-xs">
                              {index + 1}
                            </TableCell>
                            <TableCell className="print:text-xs">
                              <div className="flex flex-wrap items-center gap-1">
                                {policy.broker_direction === 'from_broker' ? (
                                  <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200 print:bg-orange-50">
                                    عن طريق {broker.name}
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 print:bg-green-50">
                                    تم تصديرها عن طريقي
                                  </Badge>
                                )}
                                {policy.cancelled && (
                                  <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 print:bg-red-50">
                                    ملغاة
                                  </Badge>
                                )}
                                {policy.transferred && !policy.cancelled && (
                                  <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 print:bg-amber-50">
                                    محولة
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="font-medium print:text-xs">
                              {policy.client?.full_name || "-"}
                            </TableCell>
                            <TableCell className="font-mono text-sm print:text-xs ltr-nums">
                              {policy.car?.car_number || "-"}
                            </TableCell>
                            <TableCell className="print:text-xs">
                              <Badge variant="outline" className="print:border">
                                {getInsuranceTypeLabel(policy.policy_type_parent as any, policy.policy_type_child as any)}
                              </Badge>
                            </TableCell>
                            <TableCell className="print:text-xs ltr-nums">
                              {formatCurrency(policy.broker_direction === 'from_broker' 
                                ? (policy.broker_buy_price || policy.insurance_price) 
                                : policy.insurance_price)}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground print:text-xs">
                              {formatDate(policy.start_date)} - {formatDate(policy.end_date)}
                            </TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()} className="print:hidden">
                              <RowActionsMenu
                                onView={() => setViewingPolicyId(policy.id)}
                                onEdit={() => setViewingPolicyId(policy.id)}
                              />
                            </TableCell>
                          </TableRow>
                        ))}
                        {/* Totals Row */}
                        <TableRow className="bg-muted/50 font-bold print:bg-gray-100">
                          <TableCell colSpan={5} className="text-left print:text-xs">
                            المجموع
                          </TableCell>
                          <TableCell className="print:text-xs ltr-nums">
                            {formatCurrency(policies.reduce((sum, p) => 
                              sum + Number(p.broker_direction === 'from_broker' 
                                ? (p.broker_buy_price || p.insurance_price) 
                                : p.insurance_price), 0))}
                          </TableCell>
                          <TableCell colSpan={2}></TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Summary card — moved to the bottom of the page so the
            transactions table stays the focus. The net balance is the
            hero metric (it's also "إجمالي المبالغ"); a small chip shows
            the policy count, the to/from rows are supporting context,
            and notes sit in a quiet footer. */}
        {!loading && (policies.length > 0 || broker.notes) && (
          <Card className="print:border print:shadow-none overflow-hidden">
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-base flex items-center gap-2">
                <Handshake className="h-4 w-4 text-muted-foreground" />
                ملخص التعامل مع {broker.name}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {/* Hero: net balance + count chip */}
              <div className={cn(
                "px-6 py-6 flex flex-wrap items-center justify-between gap-4 border-b",
                netBalance >= 0
                  ? "bg-green-50/50 dark:bg-green-950/20 print:bg-green-50/50"
                  : "bg-red-50/50 dark:bg-red-950/20 print:bg-red-50/50",
              )}>
                <div className="flex items-center gap-4">
                  <div className={cn(
                    "flex h-12 w-12 items-center justify-center rounded-full",
                    netBalance >= 0
                      ? "bg-green-100 dark:bg-green-900/40 print:bg-green-100"
                      : "bg-red-100 dark:bg-red-900/40 print:bg-red-100",
                  )}>
                    <Wallet className={cn(
                      "h-6 w-6",
                      netBalance >= 0 ? "text-green-600" : "text-red-600",
                    )} />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">
                      {netBalance >= 0 ? "الوسيط مدين لي" : "أنا مدين للوسيط"}
                    </p>
                    <p className={cn(
                      "text-3xl font-bold ltr-nums leading-none",
                      netBalance >= 0 ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400",
                    )}>
                      {netBalance < 0 ? "−" : ""}{formatCurrency(Math.abs(netBalance))}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 rounded-full bg-background border px-3 py-1.5">
                  <FileText className="h-4 w-4 text-blue-600" />
                  <span className="text-xs text-muted-foreground">عدد المعاملات</span>
                  <span className="text-sm font-bold text-blue-600 ltr-nums">{policies.length}</span>
                </div>
              </div>

              {/* Direction breakdown */}
              {policies.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x">
                  <div className="px-6 py-5">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-md bg-green-100 dark:bg-green-900/30 print:bg-green-100">
                        <ArrowDownLeft className="h-3.5 w-3.5 text-green-700 dark:text-green-400" />
                      </div>
                      <span className="text-sm font-medium">أنشأتها للوسيط</span>
                    </div>
                    <div className="text-xs text-muted-foreground mb-1.5">
                      {stats.toBrokerCount} {stats.toBrokerCount === 1 ? "معاملة" : "معاملات"} — يدفع لي الوسيط
                    </div>
                    <div className="text-2xl font-bold text-green-700 dark:text-green-400 ltr-nums">
                      {formatCurrency(stats.toBrokerTotal)}
                    </div>
                  </div>

                  <div className="px-6 py-5">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-md bg-orange-100 dark:bg-orange-900/30 print:bg-orange-100">
                        <ArrowUpRight className="h-3.5 w-3.5 text-orange-700 dark:text-orange-400" />
                      </div>
                      <span className="text-sm font-medium">أنشأها لي الوسيط</span>
                    </div>
                    <div className="text-xs text-muted-foreground mb-1.5">
                      {stats.fromBrokerCount} {stats.fromBrokerCount === 1 ? "معاملة" : "معاملات"} — أدفع للوسيط
                    </div>
                    <div className="text-2xl font-bold text-orange-700 dark:text-orange-400 ltr-nums">
                      {formatCurrency(stats.fromBrokerTotal)}
                    </div>
                  </div>
                </div>
              )}

              {/* Notes footer */}
              {broker.notes && (
                <div className="px-6 py-4 border-t bg-muted/30">
                  <p className="text-xs font-medium text-muted-foreground mb-1">ملاحظات</p>
                  <p className="text-sm whitespace-pre-line">{broker.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

      </div>

      {/* Add Client Drawer - pre-selected broker */}
      <ClientDrawer
        open={clientDrawerOpen}
        onOpenChange={setClientDrawerOpen}
        client={null}
        onSaved={() => {
          fetchData();
          onRefresh();
          setClientDrawerOpen(false);
        }}
        defaultBrokerId={broker.id}
      />

      {/* Policy Wizard - pre-selected broker */}
      <PolicyWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onComplete={() => {
          fetchData();
          onRefresh();
        }}
        defaultBrokerId={broker.id}
      />

      {/* Policy Details Drawer */}
      <PolicyDetailsDrawer
        open={!!viewingPolicyId}
        onOpenChange={(open) => !open && setViewingPolicyId(null)}
        policyId={viewingPolicyId}
        onUpdated={() => {
          fetchData();
          onRefresh();
        }}
        onViewRelatedPolicy={(newPolicyId) => {
          setViewingPolicyId(newPolicyId);
        }}
      />

    </MainLayout>
  );
}
