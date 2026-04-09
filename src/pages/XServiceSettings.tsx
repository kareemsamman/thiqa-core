import { useState, useEffect, useRef } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Save, TestTube, Trash2, RefreshCw, Loader2, CheckCircle, XCircle, Clock, Upload } from "lucide-react";
import { format } from "date-fns";
import { ar } from "date-fns/locale";

interface XServiceSettingsData {
  id: string;
  api_url: string;
  api_key: string;
  agent_name: string;
  xservice_agent_id: string | null;
  invoice_base_url: string | null;
  is_enabled: boolean;
  sync_road_service: boolean;
  sync_accident_fee: boolean;
  updated_at: string;
}

interface SyncLogEntry {
  id: string;
  policy_id: string;
  status: string;
  xservice_policy_id: string | null;
  error_message: string | null;
  created_at: string;
  retried_at: string | null;
}

export default function XServiceSettings() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [settings, setSettings] = useState<XServiceSettingsData | null>(null);
  const [logs, setLogs] = useState<SyncLogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);
  const [bulkSyncing, setBulkSyncing] = useState(false);
  const [bulkTotal, setBulkTotal] = useState(0);
  const [bulkProcessed, setBulkProcessed] = useState(0);
  const [bulkSynced, setBulkSynced] = useState(0);
  const [bulkFailed, setBulkFailed] = useState(0);
  const [eligibleCount, setEligibleCount] = useState<number | null>(null);
  const [alreadySyncedCount, setAlreadySyncedCount] = useState<number>(0);
  const [totalWithServiceCount, setTotalWithServiceCount] = useState<number>(0);
  const [missingServiceCount, setMissingServiceCount] = useState<number>(0);
  const bulkAbortRef = useRef(false);
  const [fixingLegacy, setFixingLegacy] = useState(false);

  useEffect(() => {
    fetchSettings();
    fetchLogs();
    fetchEligibleCount();
  }, []);

  const fetchEligibleCount = async () => {
    // Count policies that have a service_id (syncable)
    const { count: totalWithService } = await supabase
      .from("policies")
      .select("id", { count: "exact", head: true })
      .in("policy_type_parent", ["ROAD_SERVICE", "ACCIDENT_FEE_EXEMPTION"])
      .is("deleted_at", null)
      .or("road_service_id.not.is.null,accident_fee_service_id.not.is.null");

    // Count total service policies (including ones without service_id)
    const { count: totalAll } = await supabase
      .from("policies")
      .select("id", { count: "exact", head: true })
      .in("policy_type_parent", ["ROAD_SERVICE", "ACCIDENT_FEE_EXEMPTION"])
      .is("deleted_at", null);

    // Get already-synced count (paginated to avoid 1000-row limit)
    let syncedSet = new Set<string>();
    let syncFrom = 0;
    const syncPageSize = 1000;
    while (true) {
      const { data: syncPage } = await supabase
        .from("xservice_sync_log")
        .select("policy_id")
        .eq("status", "success")
        .range(syncFrom, syncFrom + syncPageSize - 1);
      if (!syncPage || syncPage.length === 0) break;
      for (const r of syncPage) syncedSet.add((r as any).policy_id);
      if (syncPage.length < syncPageSize) break;
      syncFrom += syncPageSize;
    }

    const withService = totalWithService ?? 0;
    const all = totalAll ?? 0;
    const synced = syncedSet.size;
    const missingServiceId = all - withService;
    setTotalWithServiceCount(withService);
    setAlreadySyncedCount(synced);
    setEligibleCount(Math.max(0, withService - synced));

    // Store missing count for display
    setMissingServiceCount(missingServiceId);
  };

  const fetchSettings = async () => {
    const { data, error } = await supabase
      .from("xservice_settings")
      .select("*")
      .limit(1)
      .single();
    if (error) {
      console.error("Failed to fetch xservice_settings:", error);
    } else {
      setSettings(data as unknown as XServiceSettingsData);
    }
    setLoading(false);
  };

  const fetchLogs = async () => {
    setLogsLoading(true);
    const { data, error } = await supabase
      .from("xservice_sync_log")
      .select("id, policy_id, status, xservice_policy_id, error_message, created_at, retried_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (!error && data) {
      setLogs(data as unknown as SyncLogEntry[]);
    }
    setLogsLoading(false);
  };

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    const { error } = await supabase
      .from("xservice_settings")
      .update({
        api_url: settings.api_url,
        api_key: settings.api_key,
        agent_name: settings.agent_name,
        invoice_base_url: settings.invoice_base_url,
        is_enabled: settings.is_enabled,
        sync_road_service: settings.sync_road_service,
        sync_accident_fee: settings.sync_accident_fee,
      })
      .eq("id", settings.id);

    setSaving(false);
    if (error) {
      toast({ title: "خطأ", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "تم الحفظ بنجاح" });
    }
  };

  const buildSyncUrl = (base: string, fn: string) => {
    const url = base.replace(/\/+$/, "");
    return url.includes("/functions/v1/") ? url.replace(/\/ab-sync-[a-z]+$/, `/${fn}`) : `${url}/functions/v1/${fn}`;
  };

  const handleTestConnection = async () => {
    if (!settings?.api_url) {
      toast({ title: "أدخل رابط API أولاً", variant: "destructive" });
      return;
    }
    setTesting(true);
    try {
      const res = await fetch(buildSyncUrl(settings.api_url, "ab-sync-receive"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: settings.api_key, test: true }),
      });
      if (res.ok) {
        toast({ title: "✅ الاتصال ناجح" });
      } else {
        const body = await res.json().catch(() => ({}));
        toast({ title: "❌ فشل الاتصال", description: body?.error || `HTTP ${res.status}`, variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "❌ خطأ في الاتصال", description: err.message, variant: "destructive" });
    }
    setTesting(false);
  };

  const handleClearData = async () => {
    if (!settings?.api_url || !settings?.api_key) return;
    setClearing(true);
    try {
      const res = await fetch(buildSyncUrl(settings.api_url, "ab-sync-clear"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: settings.api_key }),
      });
      if (res.ok) {
        // Also clear local sync log so all policies become eligible again
        await supabase.from("xservice_sync_log").delete().neq("id", "00000000-0000-0000-0000-000000000000");
        toast({ title: "✅ تم مسح البيانات وسجل المزامنة بنجاح" });
        fetchLogs();
        fetchEligibleCount();
      } else {
        const body = await res.json().catch(() => ({}));
        toast({ title: "❌ فشل المسح", description: body?.error || `HTTP ${res.status}`, variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "❌ خطأ", description: err.message, variant: "destructive" });
    }
    setClearing(false);
    setShowClearConfirm(false);
  };

  const handleRetry = async (logEntry: SyncLogEntry) => {
    toast({ title: "جاري إعادة المحاولة..." });
    const { error } = await supabase.functions.invoke("sync-to-xservice", {
      body: { policy_id: logEntry.policy_id },
    });
    if (error) {
      toast({ title: "فشل", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "تم إرسال طلب إعادة المزامنة" });
      // Update retried_at
      await supabase
        .from("xservice_sync_log")
        .update({ retried_at: new Date().toISOString() })
        .eq("id", logEntry.id);
      fetchLogs();
    }
  };

  const handleFixLegacy = async () => {
    setFixingLegacy(true);
    try {
      // Map old service_type from notes to current road_service_id
      // "زجاج + جرار" → زجاج +ونش ضفة قدس
      // "زجاج + جرار + سيارة بديلة + ضواو" → زجاج +ونش +سيارة بديلة ضفة قدس
      const { data: services } = await supabase
        .from("road_services")
        .select("id, name");
      
      const glassTow = services?.find(s => s.name.includes("ونش ضفة قدس") && !s.name.includes("سيارة") && !s.name.includes("تجاري") && !s.name.includes("اوتبوس"));
      const glassTowCar = services?.find(s => s.name.includes("سيارة بديلة"));
      const basicGlass = services?.find(s => s.name === "زجاج");

      if (!glassTow || !glassTowCar) {
        toast({ title: "خطأ", description: "لم يتم العثور على الخدمات المطلوبة", variant: "destructive" });
        setFixingLegacy(false);
        return;
      }

      // Fix "زجاج + جرار" policies (with or without trailing space)
      const { data: fixed1Data } = await supabase
        .from("policies")
        .update({ road_service_id: glassTow.id })
        .eq("policy_type_parent", "ROAD_SERVICE")
        .is("deleted_at", null)
        .is("road_service_id", null)
        .like("notes", "%Service Type: زجاج + جرار%")
        .not("notes", "like", "%سيارة بديلة%")
        .select("id");

      // Fix "زجاج + جرار + سيارة بديلة" policies
      const { data: fixed2Data } = await supabase
        .from("policies")
        .update({ road_service_id: glassTowCar.id })
        .eq("policy_type_parent", "ROAD_SERVICE")
        .is("deleted_at", null)
        .is("road_service_id", null)
        .like("notes", "%سيارة بديلة%")
        .select("id");

      // Fix remaining (no notes) → assign basic glass service
      if (basicGlass) {
        await supabase
          .from("policies")
          .update({ road_service_id: basicGlass.id })
          .eq("policy_type_parent", "ROAD_SERVICE")
          .is("deleted_at", null)
          .is("road_service_id", null);
      }

      const totalFixed = (fixed1Data?.length || 0) + (fixed2Data?.length || 0);
      toast({ title: `✅ تم إصلاح ${totalFixed} وثيقة` });
      fetchEligibleCount();
    } catch (err: any) {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    }
    setFixingLegacy(false);
  };

  const handleBulkSync = async () => {
    setBulkSyncing(true);
    setBulkProcessed(0);
    setBulkSynced(0);
    setBulkFailed(0);
    bulkAbortRef.current = false;

    const batchSize = 20;
    let offset = 0;
    let totalSynced = 0;
    let totalFailed = 0;

    try {
      // Use the accurate eligible count (server will also filter)
      const total = eligibleCount ?? 0;
      setBulkTotal(total);

      let done = false;
      while (!done && !bulkAbortRef.current) {
        const { data, error } = await supabase.functions.invoke("bulk-sync-to-xservice", {
          body: { offset, limit: batchSize },
        });
        if (error) {
          toast({ title: "خطأ في المزامنة", description: error.message, variant: "destructive" });
          break;
        }
        const result = data as any;
        totalSynced += result.synced || 0;
        totalFailed += result.failed || 0;
        offset += result.processed || batchSize;
        setBulkProcessed(Math.min(offset, total));
        setBulkSynced(totalSynced);
        setBulkFailed(totalFailed);
        done = result.done || result.processed === 0;
      }

      toast({ title: `✅ اكتملت المزامنة: نجح ${totalSynced}، فشل ${totalFailed}` });
      fetchLogs();
      fetchEligibleCount();
    } catch (err: any) {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    }
    setBulkSyncing(false);
  };

  const statusBadge = (status: string) => {
    if (status === "success") return <Badge variant="default" className="bg-green-600"><CheckCircle className="h-3 w-3 ml-1" />نجح</Badge>;
    if (status === "failed") return <Badge variant="destructive"><XCircle className="h-3 w-3 ml-1" />فشل</Badge>;
    return <Badge variant="secondary"><Clock className="h-3 w-3 ml-1" />قيد الانتظار</Badge>;
  };

  if (loading) {
    return (
      <MainLayout>
        <div className="p-6 space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-64 w-full" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="p-4 md:p-6 space-y-6" dir="rtl">
        <h1 className="text-2xl font-bold">إعدادات X-Service</h1>

        {/* Settings Card */}
        <Card>
          <CardHeader>
            <CardTitle>إعدادات الاتصال</CardTitle>
            <CardDescription>ربط الوكالة مع نظام X-Service لمزامنة الوثائق تلقائياً</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>رابط API</Label>
                <Input
                  placeholder="https://your-xservice.supabase.co"
                  value={settings?.api_url || ""}
                  onChange={(e) => setSettings(s => s ? { ...s, api_url: e.target.value } : s)}
                />
              </div>
              <div className="space-y-2">
                <Label>مفتاح API</Label>
                <Input
                  type="password"
                  placeholder="مفتاح المصادقة"
                  value={settings?.api_key || ""}
                  onChange={(e) => setSettings(s => s ? { ...s, api_key: e.target.value } : s)}
                />
              </div>
              <div className="space-y-2">
                <Label>اسم الوكيل</Label>
                <Input
                  placeholder="Thiqa"
                  value={settings?.agent_name || ""}
                  onChange={(e) => setSettings(s => s ? { ...s, agent_name: e.target.value } : s)}
                />
              </div>
              <div className="space-y-2">
                <Label>رابط فواتير X-Service</Label>
                <Input
                  placeholder="https://preview--x-service.lovable.app"
                  value={settings?.invoice_base_url || ""}
                  onChange={(e) => setSettings(s => s ? { ...s, invoice_base_url: e.target.value } : s)}
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-6 pt-2">
              <div className="flex items-center gap-2">
                <Switch
                  checked={settings?.is_enabled || false}
                  onCheckedChange={(v) => setSettings(s => s ? { ...s, is_enabled: v } : s)}
                />
                <Label>تفعيل المزامنة</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={settings?.sync_road_service || false}
                  onCheckedChange={(v) => setSettings(s => s ? { ...s, sync_road_service: v } : s)}
                />
                <Label>خدمات الطريق</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={settings?.sync_accident_fee || false}
                  onCheckedChange={(v) => setSettings(s => s ? { ...s, sync_accident_fee: v } : s)}
                />
                <Label>إعفاء رسوم الحوادث</Label>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-4">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <Save className="h-4 w-4 ml-2" />}
                حفظ
              </Button>
              <Button variant="outline" onClick={handleTestConnection} disabled={testing}>
                {testing ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <TestTube className="h-4 w-4 ml-2" />}
                اختبار الاتصال
              </Button>
              <Button variant="destructive" onClick={() => setShowClearConfirm(true)} disabled={clearing}>
                {clearing ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <Trash2 className="h-4 w-4 ml-2" />}
                مسح بيانات X-Service
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Bulk Sync */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              مزامنة جماعية
            </CardTitle>
            <CardDescription>
              إرسال جميع وثائق خدمات الطريق وإعفاء الحوادث الموجودة إلى X-Service
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
             <div className="text-sm text-muted-foreground space-y-1">
              <p>عدد الوثائق المؤهلة للمزامنة: <strong>{eligibleCount !== null ? eligibleCount : "..."}</strong></p>
              {alreadySyncedCount > 0 && (
                <p className="text-xs">✅ تمت مزامنة {alreadySyncedCount} وثيقة مسبقاً</p>
              )}
              {missingServiceCount > 0 && (
                <p className="text-xs text-orange-600">⚠️ {missingServiceCount} وثيقة بدون معرّف خدمة (لن تتم مزامنتها حتى يتم إصلاحها)</p>
              )}
            </div>
            {missingServiceCount > 0 && (
              <Button 
                variant="outline" 
                onClick={handleFixLegacy} 
                disabled={fixingLegacy}
                className="border-orange-300 text-orange-700 hover:bg-orange-50"
              >
                {fixingLegacy ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <RefreshCw className="h-4 w-4 ml-2" />}
                إصلاح الوثائق القديمة ({missingServiceCount})
              </Button>
            )}
            {bulkSyncing && (
              <div className="space-y-2">
                <Progress value={bulkTotal > 0 ? (bulkProcessed / bulkTotal) * 100 : 0} />
                <p className="text-xs text-muted-foreground">
                  تم معالجة {bulkProcessed} من {bulkTotal} — نجح: {bulkSynced} | فشل: {bulkFailed}
                </p>
              </div>
            )}
            <div className="flex gap-2">
              <Button onClick={handleBulkSync} disabled={bulkSyncing || !settings?.is_enabled}>
                {bulkSyncing ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <Upload className="h-4 w-4 ml-2" />}
                {bulkSyncing ? "جاري المزامنة..." : "بدء المزامنة الجماعية"}
              </Button>
              {bulkSyncing && (
                <Button variant="outline" onClick={() => { bulkAbortRef.current = true; }}>
                  إيقاف
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Sync Log */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>سجل المزامنة</CardTitle>
              <CardDescription>آخر 50 عملية مزامنة</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={fetchLogs}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent>
            {logsLoading ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : logs.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">لا توجد عمليات مزامنة بعد</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الحالة</TableHead>
                    <TableHead>التاريخ</TableHead>
                    <TableHead>معرف X-Service</TableHead>
                    <TableHead>الخطأ</TableHead>
                    <TableHead>إجراء</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell>{statusBadge(log.status)}</TableCell>
                      <TableCell className="text-xs">
                        {format(new Date(log.created_at), "dd/MM/yyyy HH:mm", { locale: ar })}
                      </TableCell>
                      <TableCell className="text-xs font-mono">{log.xservice_policy_id || "-"}</TableCell>
                      <TableCell className="text-xs text-destructive max-w-[200px] truncate">{log.error_message || "-"}</TableCell>
                      <TableCell>
                        {log.status === "failed" && (
                          <Button variant="ghost" size="sm" onClick={() => handleRetry(log)}>
                            <RefreshCw className="h-3 w-3 ml-1" />
                            إعادة
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <DeleteConfirmDialog
          open={showClearConfirm}
          onOpenChange={setShowClearConfirm}
          onConfirm={handleClearData}
          loading={clearing}
          title="مسح بيانات X-Service"
          description="سيتم حذف جميع الوثائق والسيارات والعملاء المرتبطين بهذا الوكيل في X-Service، وسيتم مسح سجل المزامنة المحلي بالكامل حتى يمكن إعادة المزامنة من الصفر. هل أنت متأكد؟"
        />
      </div>
    </MainLayout>
  );
}
