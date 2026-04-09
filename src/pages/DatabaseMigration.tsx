import { useState, useEffect } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Download, Upload, Database, FileJson, FileCode, Image, AlertTriangle, CheckCircle2, Loader2, Wifi, WifiOff, Server } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const TABLES_TO_EXPORT = [
  'branches',
  'brokers',
  'insurance_companies',
  'insurance_categories',
  'pricing_rules',
  'clients',
  'cars',
  'car_accidents',
  'policies',
  'policy_payments',
  'outside_cheques',
  'media_files',
  'invoice_templates',
  'invoices',
  'customer_signatures',
  'sms_settings',
  'payment_settings',
  'profiles',
  'user_roles',
  'notifications',
  'login_attempts'
];

interface ConnectionStatus {
  connected: boolean;
  projectUrl: string;
  projectId: string;
  tablesCount: number;
  policiesCount: number;
  clientsCount: number;
  mediaCount: number;
}

export default function DatabaseMigration() {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTable, setCurrentTable] = useState("");
  const [exportedData, setExportedData] = useState<Record<string, any[]> | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus | null>(null);

  const exportAllData = async () => {
    setExporting(true);
    setProgress(0);
    const allData: Record<string, any[]> = {};
    
    try {
      for (let i = 0; i < TABLES_TO_EXPORT.length; i++) {
        const table = TABLES_TO_EXPORT[i];
        setCurrentTable(table);
        setProgress(Math.round((i / TABLES_TO_EXPORT.length) * 100));
        
        const { data, error } = await supabase
          .from(table as any)
          .select('*');
        
        if (error) {
          console.warn(`Error exporting ${table}:`, error.message);
          allData[table] = [];
        } else {
          allData[table] = data || [];
        }
      }
      
      setExportedData(allData);
      setProgress(100);
      
      // Download as JSON file
      const blob = new Blob([JSON.stringify(allData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ab-insurance-backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      toast.success("تم تصدير البيانات بنجاح");
    } catch (error: any) {
      toast.error("خطأ في التصدير: " + error.message);
    } finally {
      setExporting(false);
      setCurrentTable("");
    }
  };

  const exportMediaLinks = async () => {
    try {
      const { data, error } = await supabase
        .from('media_files')
        .select('cdn_url, original_name, entity_type, entity_id')
        .is('deleted_at', null);
      
      if (error) throw error;
      
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `media-links-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      toast.success(`تم تصدير ${data?.length || 0} رابط وسائط`);
    } catch (error: any) {
      toast.error("خطأ في تصدير روابط الوسائط: " + error.message);
    }
  };

  const downloadMigrationSQL = () => {
    window.open('/migration.sql', '_blank');
  };

  const downloadMigrationGuide = () => {
    window.open('/migration-guide.md', '_blank');
  };

  const [importLog, setImportLog] = useState<string[]>([]);

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    setImporting(true);
    setProgress(0);
    setImportLog([]);
    
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      
      // Import order matters due to foreign keys
      const importOrder = [
        'branches',
        'brokers',
        'insurance_companies',
        'insurance_categories',
        'pricing_rules',
        'clients',
        'client_children',
        'client_notes',
        'cars',
        'car_accidents',
        'policies',
        'policy_payments',
        'policy_groups',
        'client_payments',
        'client_debits',
        'outside_cheques',
        'media_files',
        'invoice_templates',
        'invoices',
        'customer_signatures',
        'customer_wallet_transactions',
        'sms_settings',
        'payment_settings',
        'notifications',
        'tasks',
        'expenses',
        'correspondence_letters',
        'business_contacts',
        'ab_ledger',
        'broker_settlements',
        'broker_settlement_items',
        'company_settlements',
        'company_settlement_items',
        'accident_reports',
        'accident_third_parties',
        'accident_report_files',
        'accident_report_notes',
        'accident_report_reminders',
        'accident_injured_persons',
        'road_services',
        'accident_fee_services',
        'company_road_service_prices',
        'company_accident_fee_prices',
        'company_accident_templates',
        'auth_settings',
        'site_settings',
        'xservice_settings',
        'form_templates',
        'repair_claims',
        'lead_chats',
        'lead_notes',
        'login_attempts',
        'announcements',
        'announcement_dismissals',
      ];

      const tablesToImport = importOrder.filter(t => data[t] && data[t].length > 0);
      
      for (let i = 0; i < tablesToImport.length; i++) {
        const table = tablesToImport[i];
        const rows = data[table];
        setCurrentTable(`${table} (${rows.length} سجل)`);
        setProgress(Math.round((i / tablesToImport.length) * 100));
        
        try {
          const { data: result, error } = await supabase.functions.invoke('bulk-import', {
            body: { table, data: rows }
          });
          
          if (error) {
            const msg = `❌ ${table}: ${error.message}`;
            setImportLog(prev => [...prev, msg]);
            console.warn(msg);
          } else {
            const msg = `✅ ${table}: ${result.imported}/${result.total} imported`;
            setImportLog(prev => [...prev, msg]);
            if (result.errors) {
              result.errors.forEach((e: string) => {
                setImportLog(prev => [...prev, `  ⚠️ ${e}`]);
              });
            }
          }
        } catch (err: any) {
          const msg = `❌ ${table}: ${err.message}`;
          setImportLog(prev => [...prev, msg]);
        }
      }
      
      setProgress(100);
      toast.success("تم استيراد البيانات بنجاح");
    } catch (error: any) {
      toast.error("خطأ في الاستيراد: " + error.message);
    } finally {
      setImporting(false);
      setCurrentTable("");
    }
  };

  const testConnection = async () => {
    setTestingConnection(true);
    try {
      // Get project URL from environment
      const projectUrl = import.meta.env.VITE_SUPABASE_URL || '';
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID || projectUrl.replace('https://', '').replace('.supabase.co', '');
      
      // Test connection by counting records
      const [policiesResult, clientsResult, mediaResult] = await Promise.all([
        supabase.from('policies').select('id', { count: 'exact', head: true }),
        supabase.from('clients').select('id', { count: 'exact', head: true }),
        supabase.from('media_files').select('id', { count: 'exact', head: true }).is('deleted_at', null)
      ]);

      const status: ConnectionStatus = {
        connected: !policiesResult.error,
        projectUrl,
        projectId,
        tablesCount: TABLES_TO_EXPORT.length,
        policiesCount: policiesResult.count || 0,
        clientsCount: clientsResult.count || 0,
        mediaCount: mediaResult.count || 0
      };

      setConnectionStatus(status);
      
      if (status.connected) {
        toast.success("الاتصال بقاعدة البيانات ناجح");
      } else {
        toast.error("فشل الاتصال بقاعدة البيانات");
      }
    } catch (error: any) {
      setConnectionStatus({
        connected: false,
        projectUrl: '',
        projectId: '',
        tablesCount: 0,
        policiesCount: 0,
        clientsCount: 0,
        mediaCount: 0
      });
      toast.error("خطأ في اختبار الاتصال: " + error.message);
    } finally {
      setTestingConnection(false);
    }
  };

  // Test connection on mount
  useEffect(() => {
    testConnection();
  }, []);

  return (
    <MainLayout>
      <div className="space-y-6" dir="rtl">
        <div>
          <h1 className="text-3xl font-bold">نقل قاعدة البيانات</h1>
          <p className="text-muted-foreground">
            تصدير واستيراد البيانات للنقل إلى Supabase خارجي
          </p>
        </div>

        {/* Connection Status Card */}
        <Card className={connectionStatus?.connected ? "border-green-500/50 bg-green-500/5" : "border-destructive/50 bg-destructive/5"}>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {connectionStatus?.connected ? (
                  <Wifi className="h-5 w-5 text-green-500" />
                ) : (
                  <WifiOff className="h-5 w-5 text-destructive" />
                )}
                حالة الاتصال
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={testConnection}
                disabled={testingConnection}
              >
                {testingConnection ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "إعادة الاختبار"
                )}
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {connectionStatus ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <div className="flex items-center gap-2">
                  <Server className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <div className="text-xs text-muted-foreground">معرف المشروع</div>
                    <div className="font-mono text-sm">{connectionStatus.projectId || 'غير معروف'}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <div className="text-xs text-muted-foreground">عدد الوثائق</div>
                    <div className="font-bold text-lg">{connectionStatus.policiesCount.toLocaleString()}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <div className="text-xs text-muted-foreground">عدد العملاء</div>
                    <div className="font-bold text-lg">{connectionStatus.clientsCount.toLocaleString()}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Image className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <div className="text-xs text-muted-foreground">عدد الوسائط</div>
                    <div className="font-bold text-lg">{connectionStatus.mediaCount.toLocaleString()}</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                جاري اختبار الاتصال...
              </div>
            )}
          </CardContent>
        </Card>

        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>تحذير مهم</AlertTitle>
          <AlertDescription>
            تأكد من تصدير البيانات قبل إلغاء اشتراك Lovable. بعد الإلغاء لن تتمكن من الوصول إلى قاعدة البيانات.
          </AlertDescription>
        </Alert>

        <Tabs defaultValue="connection" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="connection">حالة الاتصال</TabsTrigger>
            <TabsTrigger value="export">تصدير البيانات</TabsTrigger>
            <TabsTrigger value="import">استيراد البيانات</TabsTrigger>
            <TabsTrigger value="guide">دليل النقل</TabsTrigger>
          </TabsList>

          <TabsContent value="connection" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Server className="h-5 w-5" />
                    معلومات Supabase الحالي
                  </CardTitle>
                  <CardDescription>
                    معلومات المشروع المتصل حالياً
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">رابط المشروع</div>
                    <code className="text-xs bg-muted px-2 py-1 rounded block break-all">
                      {connectionStatus?.projectUrl || 'جاري التحميل...'}
                    </code>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">معرف المشروع</div>
                    <code className="text-xs bg-muted px-2 py-1 rounded block">
                      {connectionStatus?.projectId || 'جاري التحميل...'}
                    </code>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">عدد الجداول</div>
                    <code className="text-xs bg-muted px-2 py-1 rounded block">
                      {TABLES_TO_EXPORT.length} جدول
                    </code>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileCode className="h-5 w-5" />
                    ملفات الإعداد
                  </CardTitle>
                  <CardDescription>
                    تحميل الملفات اللازمة للنقل
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Button
                    onClick={() => window.open('/setup-supabase.sh', '_blank')}
                    variant="outline"
                    className="w-full justify-start"
                  >
                    <Download className="ml-2 h-4 w-4" />
                    تحميل سكربت الإعداد (setup-supabase.sh)
                  </Button>
                  <Button
                    onClick={downloadMigrationSQL}
                    variant="outline"
                    className="w-full justify-start"
                  >
                    <Download className="ml-2 h-4 w-4" />
                    تحميل SQL Schema (migration.sql)
                  </Button>
                  <Button
                    onClick={downloadMigrationGuide}
                    variant="outline"
                    className="w-full justify-start"
                  >
                    <Download className="ml-2 h-4 w-4" />
                    تحميل دليل النقل (migration-guide.md)
                  </Button>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="export" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileJson className="h-5 w-5" />
                    تصدير كل البيانات (JSON)
                  </CardTitle>
                  <CardDescription>
                    تحميل كل الجداول كملف JSON واحد
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button 
                    onClick={exportAllData} 
                    disabled={exporting}
                    className="w-full"
                  >
                    {exporting ? (
                      <>
                        <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                        جاري التصدير... {currentTable}
                      </>
                    ) : (
                      <>
                        <Download className="ml-2 h-4 w-4" />
                        تصدير البيانات
                      </>
                    )}
                  </Button>
                  {exporting && (
                    <Progress value={progress} className="mt-4" />
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileCode className="h-5 w-5" />
                    تحميل SQL Schema
                  </CardTitle>
                  <CardDescription>
                    ملف SQL كامل لإنشاء الجداول في Supabase جديد
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button 
                    onClick={downloadMigrationSQL}
                    variant="outline"
                    className="w-full"
                  >
                    <Download className="ml-2 h-4 w-4" />
                    تحميل migration.sql
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Image className="h-5 w-5" />
                    تصدير روابط الوسائط
                  </CardTitle>
                  <CardDescription>
                    قائمة بكل روابط Bunny CDN
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button 
                    onClick={exportMediaLinks}
                    variant="outline"
                    className="w-full"
                  >
                    <Download className="ml-2 h-4 w-4" />
                    تصدير روابط الصور
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Database className="h-5 w-5" />
                    الجداول المصدّرة
                  </CardTitle>
                  <CardDescription>
                    {TABLES_TO_EXPORT.length} جدول
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-sm text-muted-foreground max-h-32 overflow-y-auto">
                    {TABLES_TO_EXPORT.map(table => (
                      <div key={table} className="py-0.5">{table}</div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="import" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Upload className="h-5 w-5" />
                  استيراد البيانات
                </CardTitle>
                <CardDescription>
                  رفع ملف JSON المصدّر لاستيراد البيانات
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    استخدم هذه الميزة فقط في Supabase الجديد بعد تشغيل migration.sql
                  </AlertDescription>
                </Alert>
                
                <div className="flex items-center gap-4">
                  <input
                    type="file"
                    accept=".json"
                    onChange={handleImport}
                    disabled={importing}
                    className="flex-1"
                  />
                </div>
                
                {importing && (
                  <div className="space-y-2">
                    <div className="text-sm text-muted-foreground">
                      جاري استيراد: {currentTable}
                    </div>
                    <Progress value={progress} />
                  </div>
                )}

                {importLog.length > 0 && (
                  <div className="mt-4 max-h-64 overflow-y-auto rounded border bg-muted/50 p-3 text-sm font-mono space-y-1" dir="ltr">
                    {importLog.map((line, i) => (
                      <div key={i}>{line}</div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="guide" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>خطوات النقل إلى Supabase خارجي</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      1
                    </div>
                    <div>
                      <h4 className="font-semibold">إنشاء مشروع Supabase مجاني</h4>
                      <p className="text-sm text-muted-foreground">
                        اذهب إلى <a href="https://supabase.com" target="_blank" className="text-primary underline">supabase.com</a> وأنشئ مشروع جديد
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      2
                    </div>
                    <div>
                      <h4 className="font-semibold">تشغيل migration.sql</h4>
                      <p className="text-sm text-muted-foreground">
                        في Supabase Dashboard → SQL Editor → انسخ والصق محتوى migration.sql
                      </p>
                      <Button 
                        onClick={downloadMigrationSQL}
                        variant="link"
                        className="p-0 h-auto"
                      >
                        تحميل migration.sql
                      </Button>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      3
                    </div>
                    <div>
                      <h4 className="font-semibold">تصدير البيانات من هنا</h4>
                      <p className="text-sm text-muted-foreground">
                        اضغط على "تصدير البيانات" في تبويب التصدير
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      4
                    </div>
                    <div>
                      <h4 className="font-semibold">تحديث .env في الكود</h4>
                      <p className="text-sm text-muted-foreground">
                        غيّر VITE_SUPABASE_URL و VITE_SUPABASE_PUBLISHABLE_KEY إلى قيم المشروع الجديد
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      5
                    </div>
                    <div>
                      <h4 className="font-semibold">استيراد البيانات</h4>
                      <p className="text-sm text-muted-foreground">
                        في النسخة الجديدة → استخدم تبويب الاستيراد لرفع ملف JSON
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      6
                    </div>
                    <div>
                      <h4 className="font-semibold">نشر على Plesk</h4>
                      <p className="text-sm text-muted-foreground">
                        npm run build → ارفع مجلد dist إلى Plesk
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      7
                    </div>
                    <div>
                      <h4 className="font-semibold">نشر Edge Functions</h4>
                      <p className="text-sm text-muted-foreground">
                        استخدم Supabase CLI: supabase functions deploy --project-ref YOUR_PROJECT_ID
                      </p>
                    </div>
                  </div>
                </div>

                <Button 
                  onClick={downloadMigrationGuide}
                  className="w-full"
                >
                  <Download className="ml-2 h-4 w-4" />
                  تحميل دليل النقل الكامل
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
