import { useState, useRef, useEffect } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Upload, Trash2, FileJson, AlertTriangle, CheckCircle2, XCircle, Loader2, Clock, Download, RefreshCw, Link2, Play } from "lucide-react";
import { POLICY_TYPE_LABELS } from "@/lib/insuranceTypes";

interface PreviewCounts {
  insuranceCompanies: number;
  pricingRules: number;
  brokers: number;
  clients: number;
  cars: number;
  policies: number;
  payments: number;
  outsideCheques: number;
  invoices: number;
  mediaFiles: number;
  carAccidents: number;
}

interface ImportStats {
  [key: string]: { inserted: number; updated: number; errors: ErrorRecord[] };
}

interface ErrorRecord {
  entity: string;
  identifier: string;
  reason: string;
  timestamp: string;
}

interface ImportStep {
  key: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'error' | 'skipped';
  count: number;
  processed?: number;
  lastError?: string;
}

interface SavedProgress {
  id: string;
  currentStepIndex: number;
  completedSteps: string[];
  mappings: Record<string, Record<string, string>>;
  stats: ImportStats;
  mediaOffset: number;
  totalMedia: number;
}

const BATCH_SIZE = 50;
const STEP_KEYS = ['preserveRules', 'clear', 'companies', 'restoreRules', 'brokers', 'clients', 'cars', 'policies', 'payments', 'media', 'invoices', 'outsideCheques'];

const WordPressImport = () => {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [jsonData, setJsonData] = useState<any>(null);
  const [fileName, setFileName] = useState<string>("");
  const [preview, setPreview] = useState<PreviewCounts | null>(null);
  const [incrementalMode, setIncrementalMode] = useState(true); // Default: incremental (safe)
  const [clearBeforeImport, setClearBeforeImport] = useState(false); // Default: DO NOT clear
  const [resetCompanies, setResetCompanies] = useState(false); // Default: DO NOT reset companies
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [importing, setImporting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [importStats, setImportStats] = useState<ImportStats | null>(null);
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState<string>("");
  const [steps, setSteps] = useState<ImportStep[]>([]);
  const [estimatedTime, setEstimatedTime] = useState<string>("");
  const [startTime, setStartTime] = useState<Date | null>(null);
  
  // Incremental analysis state
  const [analyzingJson, setAnalyzingJson] = useState(false);
  const [incrementalAnalysis, setIncrementalAnalysis] = useState<{
    clients: { new: number; existing: number };
    cars: { new: number; existing: number };
    policies: { new: number; existing: number };
    payments: { new: number; existing: number };
  } | null>(null);
  
  // Resume mode state
  const [savedProgress, setSavedProgress] = useState<SavedProgress | null>(null);
  const [resumeMode, setResumeMode] = useState(false);
  const [activeTab, setActiveTab] = useState("import");
  
  // Linking tool state
  const [linkingPolicies, setLinkingPolicies] = useState(false);
  const [linkingStats, setLinkingStats] = useState<{ found: number; linked: number; notFound: string[] } | null>(null);
  
  // Update policies only state
  const [updatingPoliciesOnly, setUpdatingPoliciesOnly] = useState(false);
  const updatePoliciesCancelRef = useRef(false);
  const [updatePoliciesProgress, setUpdatePoliciesProgress] = useState<{ processed: number; total: number }>({
    processed: 0,
    total: 0,
  });
  const [updatePoliciesChunkRange, setUpdatePoliciesChunkRange] = useState<{ from: number; to: number } | null>(null);
  const [updatePoliciesStartedAt, setUpdatePoliciesStartedAt] = useState<number | null>(null);
  const [updatePoliciesNow, setUpdatePoliciesNow] = useState<number>(() => Date.now());
  const [updatePoliciesStats, setUpdatePoliciesStats] = useState<{
    policiesUpdated: number;
    policiesSkipped: number;
    paymentsDeleted: number;
    paymentsInserted: number;
    chequesFixed?: number;
    errors: string[];
  } | null>(null);

  // Fix ELZAMI payments state
  const [fixingElzami, setFixingElzami] = useState(false);
  const [elzamiFixStats, setElzamiFixStats] = useState<{
    found: number;
    fixed: number;
    errors: string[];
  } | null>(null);
  const [elzamiUnpaidCount, setElzamiUnpaidCount] = useState<number | null>(null);

  // Clear POL- policy numbers state
  const [clearingPolNumbers, setClearingPolNumbers] = useState(false);
  const [polNumbersCount, setPolNumbersCount] = useState<number | null>(null);
  const [polNumbersClearStats, setPolNumbersClearStats] = useState<{
    found: number;
    cleared: number;
    errors: string[];
  } | null>(null);

  // Missing packages detection state
  const [detectingPackages, setDetectingPackages] = useState(false);
  const [packageSearch, setPackageSearch] = useState("");
  const [missingPackages, setMissingPackages] = useState<{
    client_id: string;
    car_id: string;
    client_name: string;
    car_number: string;
    policy_count: number;
    policy_ids: string[];
    types: string[];
    total_price: number;
    first_created: string;
    selected: boolean;
  }[]>([]);
  const [linkingPackages, setLinkingPackages] = useState(false);
  const [packageLinkStats, setPackageLinkStats] = useState<{
    found: number;
    linked: number;
    errors: string[];
  } | null>(null);
  
  // Filtered packages based on search
  const filteredPackages = missingPackages.filter(pkg => 
    !packageSearch.trim() || 
    pkg.client_name.includes(packageSearch) ||
    pkg.car_number.includes(packageSearch)
  );

  const entityLabels: Record<string, string> = {
    companies: "شركات التأمين",
    brokers: "الوسطاء",
    clients: "العملاء",
    cars: "السيارات",
    policies: "الوثائق",
    payments: "المدفوعات",
    outsideCheques: "الشيكات الخارجية",
    media: "ملفات الوسائط",
    insuranceCompanies: "شركات التأمين",
    pricingRules: "قواعد التسعير",
    invoices: "الفواتير",
    mediaFiles: "ملفات الوسائط",
    carAccidents: "حوادث السيارات",
  };

  // Load saved progress on mount
  useEffect(() => {
    loadSavedProgress();
  }, []);

  // Update policies only timer/ETA tick
  useEffect(() => {
    if (!updatingPoliciesOnly) {
      setUpdatePoliciesStartedAt(null);
      return;
    }

    const startedAt = Date.now();
    setUpdatePoliciesStartedAt(startedAt);
    setUpdatePoliciesNow(startedAt);

    const interval = window.setInterval(() => setUpdatePoliciesNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [updatingPoliciesOnly]);

  // Fetch unpaid ELZAMI count on mount - using paginated queries to handle >1000 records
  const fetchUnpaidElzamiCount = async () => {
    try {
      // Use a paginated approach to get ALL ELZAMI policies
      const allElzamiIds: string[] = [];
      let offset = 0;
      const pageSize = 1000;
      
      while (true) {
        const { data: batch, error: policiesError } = await supabase
          .from('policies')
          .select('id')
          .eq('policy_type_parent', 'ELZAMI')
          .range(offset, offset + pageSize - 1);
        
        if (policiesError) throw policiesError;
        if (!batch || batch.length === 0) break;
        
        allElzamiIds.push(...batch.map(p => p.id));
        if (batch.length < pageSize) break;
        offset += pageSize;
      }
      
      if (allElzamiIds.length === 0) {
        setElzamiUnpaidCount(0);
        return;
      }
      
      // Get ALL policies that have non-refused payments (chunked to avoid .in() limits)
      const allPaidPolicyIds = new Set<string>();
      const chunkSize = 500;
      
      for (let i = 0; i < allElzamiIds.length; i += chunkSize) {
        const chunk = allElzamiIds.slice(i, i + chunkSize);
        const { data: paidBatch, error: paymentsError } = await supabase
          .from('policy_payments')
          .select('policy_id')
          .in('policy_id', chunk)
          .eq('refused', false);
        
        if (paymentsError) throw paymentsError;
        if (paidBatch) {
          paidBatch.forEach(p => allPaidPolicyIds.add(p.policy_id));
        }
      }
      
      const unpaidCount = allElzamiIds.filter(id => !allPaidPolicyIds.has(id)).length;
      setElzamiUnpaidCount(unpaidCount);
    } catch (e) {
      console.error('Error fetching unpaid ELZAMI count:', e);
    }
  };

  // Fetch POL- policy numbers count
  const fetchPolNumbersCount = async () => {
    try {
      const { count, error } = await supabase
        .from('policies')
        .select('id', { count: 'exact', head: true })
        .like('policy_number', 'POL-%');
      
      if (error) throw error;
      setPolNumbersCount(count || 0);
    } catch (e) {
      console.error('Error fetching POL- count:', e);
    }
  };

  // Handle clearing POL- policy numbers
  const handleClearPolNumbers = async () => {
    setClearingPolNumbers(true);
    setPolNumbersClearStats(null);
    
    const stats = { found: 0, cleared: 0, errors: [] as string[] };
    
    try {
      // 1. Fetch ALL policy IDs with POL- prefix using pagination
      const allPolicyIds: string[] = [];
      let offset = 0;
      const pageSize = 1000;
      
      while (true) {
        const { data: batch, error } = await supabase
          .from('policies')
          .select('id')
          .like('policy_number', 'POL-%')
          .range(offset, offset + pageSize - 1);
        
        if (error) throw error;
        if (!batch || batch.length === 0) break;
        
        allPolicyIds.push(...batch.map(p => p.id));
        if (batch.length < pageSize) break;
        offset += pageSize;
      }
      
      stats.found = allPolicyIds.length;
      
      if (stats.found === 0) {
        toast({ title: "لا توجد وثائق", description: "لم يتم العثور على أرقام POL-" });
        setClearingPolNumbers(false);
        return;
      }
      
      // 2. Clear policy_number in batches
      const batchSize = 100;
      for (let i = 0; i < allPolicyIds.length; i += batchSize) {
        const chunk = allPolicyIds.slice(i, i + batchSize);
        
        const { error: updateError } = await supabase
          .from('policies')
          .update({ policy_number: null })
          .in('id', chunk);
        
        if (updateError) {
          stats.errors.push(`دفعة ${i + 1}-${i + chunk.length}: ${updateError.message}`);
        } else {
          stats.cleared += chunk.length;
        }
      }
      
      toast({
        title: "تم المسح",
        description: `تم مسح ${stats.cleared} رقم بوليصة من أصل ${stats.found}`,
      });
      
      // Refresh count
      fetchPolNumbersCount();
      
    } catch (e: any) {
      stats.errors.push(e.message);
      toast({ title: "خطأ", description: e.message, variant: "destructive" });
    } finally {
      setPolNumbersClearStats(stats);
      setClearingPolNumbers(false);
    }
  };

  // Detect missing packages function
  const detectMissingPackages = async () => {
    setDetectingPackages(true);
    setPackageLinkStats(null);
    try {
      const { data, error } = await supabase.rpc('find_missing_packages').range(0, 10000);
      
      if (error) throw error;
      
      setMissingPackages((data || []).map((pkg: any) => ({
        ...pkg,
        selected: false  // Not selected by default - user chooses what to link
      })));
      
      toast({
        title: "تم الاكتشاف",
        description: `تم العثور على ${data?.length || 0} باقة مفقودة`
      });
    } catch (e: any) {
      toast({ title: "خطأ", description: e.message, variant: "destructive" });
    } finally {
      setDetectingPackages(false);
    }
  };

  // Link missing packages function
  const linkMissingPackages = async () => {
    const selected = missingPackages.filter(p => p.selected);
    if (selected.length === 0) {
      toast({ title: "لم يتم تحديد أي باقات" });
      return;
    }
    
    setLinkingPackages(true);
    const stats = { found: selected.length, linked: 0, errors: [] as string[] };
    
    try {
      for (const pkg of selected) {
        // 1. First create a record in policy_groups (required for foreign key)
        const { data: groupData, error: groupError } = await supabase
          .from('policy_groups')
          .insert({
            client_id: pkg.client_id,
            car_id: pkg.car_id,
            name: `باقة - ${new Date(pkg.first_created).toLocaleDateString('en-GB')}`,
          })
          .select()
          .single();
        
        if (groupError) {
          stats.errors.push(`${pkg.client_name}: فشل إنشاء المجموعة - ${groupError.message}`);
          continue;
        }
        
        // 2. Update policies with the valid group_id
        const { error: updateError } = await supabase
          .from('policies')
          .update({ group_id: groupData.id })
          .in('id', pkg.policy_ids);
        
        if (updateError) {
          stats.errors.push(`${pkg.client_name}: ${updateError.message}`);
        } else {
          stats.linked++;
        }
      }
      
      toast({
        title: "تم الربط",
        description: `تم ربط ${stats.linked} باقة من أصل ${stats.found}`
      });
      
      // Refresh detection
      await detectMissingPackages();
      
    } catch (e: any) {
      stats.errors.push(e.message);
    } finally {
      setPackageLinkStats(stats);
      setLinkingPackages(false);
    }
  };

  useEffect(() => {
    fetchUnpaidElzamiCount();
    fetchPolNumbersCount();
  }, []);

  const handleFixElzamiPayments = async () => {
    setFixingElzami(true);
    setElzamiFixStats(null);
    
    const stats = { found: 0, fixed: 0, errors: [] as string[] };
    
    try {
      // 1. Fetch ALL ELZAMI policies using pagination (to handle >1000 records)
      const allElzamiPolicies: { id: string; policy_number: string | null; insurance_price: number | null; start_date: string | null }[] = [];
      let offset = 0;
      const pageSize = 1000;
      
      while (true) {
        const { data: batch, error } = await supabase
          .from('policies')
          .select('id, policy_number, insurance_price, start_date')
          .eq('policy_type_parent', 'ELZAMI')
          .range(offset, offset + pageSize - 1);
        
        if (error) throw error;
        if (!batch || batch.length === 0) break;
        
        allElzamiPolicies.push(...batch);
        if (batch.length < pageSize) break;
        offset += pageSize;
      }
      
      if (allElzamiPolicies.length === 0) {
        toast({ title: "لا توجد وثائق إلزامي", description: "لم يتم العثور على أي وثائق إلزامي" });
        setFixingElzami(false);
        return;
      }
      
      const policyIds = allElzamiPolicies.map(p => p.id);
      
      // 2. Get ALL policies that already have non-refused payments (chunked to avoid .in() limits)
      const paidPolicyIds = new Set<string>();
      const chunkSize = 500;
      
      for (let i = 0; i < policyIds.length; i += chunkSize) {
        const chunk = policyIds.slice(i, i + chunkSize);
        const { data: paidBatch, error: paymentsError } = await supabase
          .from('policy_payments')
          .select('policy_id')
          .in('policy_id', chunk)
          .eq('refused', false);
        
        if (paymentsError) throw paymentsError;
        if (paidBatch) {
          paidBatch.forEach(p => paidPolicyIds.add(p.policy_id));
        }
      }
      
      const needsPayment = allElzamiPolicies.filter(p => !paidPolicyIds.has(p.id));
      
      stats.found = needsPayment.length;
      
      if (stats.found === 0) {
        toast({ title: "لا توجد وثائق بحاجة إصلاح", description: "جميع وثائق الإلزامي لديها دفعات" });
        setFixingElzami(false);
        setElzamiFixStats(stats);
        return;
      }
      
      // 3. Create payments in batches
      const batchSize = 50;
      for (let i = 0; i < needsPayment.length; i += batchSize) {
        const batch = needsPayment.slice(i, i + batchSize);
        const payments = batch.map(policy => ({
          policy_id: policy.id,
          payment_type: 'cash' as const,
          amount: policy.insurance_price || 0,
          payment_date: policy.start_date || new Date().toISOString().split('T')[0],
          refused: false,
          source: 'system' as const,
          locked: true,
          notes: 'دفعة إلزامي تلقائية - إصلاح بيانات',
        }));
        
        const { error: insertError } = await supabase
          .from('policy_payments')
          .insert(payments);
        
        if (insertError) {
          stats.errors.push(`دفعة ${i + 1}-${i + batch.length}: ${insertError.message}`);
        } else {
          stats.fixed += batch.length;
        }
      }
      
      toast({
        title: "تم الإصلاح",
        description: `تم إضافة ${stats.fixed} دفعة من أصل ${stats.found}`,
      });
      
      // Refresh count
      fetchUnpaidElzamiCount();
      
    } catch (e: any) {
      stats.errors.push(e.message);
      toast({
        title: "خطأ",
        description: e.message,
        variant: "destructive",
      });
    } finally {
      setElzamiFixStats(stats);
      setFixingElzami(false);
    }
  };

  const loadSavedProgress = async () => {
    try {
      const { data } = await supabase
        .from('import_progress')
        .select('*')
        .eq('import_type', 'wordpress')
        .in('status', ['running', 'paused'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (data && data.metadata) {
        const metadata = data.metadata as any;
        setSavedProgress({
          id: data.id,
          currentStepIndex: metadata.currentStepIndex || 0,
          completedSteps: metadata.completedSteps || [],
          mappings: metadata.mappings || {},
          stats: metadata.stats || {},
          mediaOffset: metadata.mediaOffset || 0,
          totalMedia: metadata.totalMedia || 0,
        });
        setResumeMode(true);
        toast({ title: "تم العثور على استيراد سابق", description: "يمكنك استئناف الاستيراد من حيث توقف" });
      }
    } catch (e) {
      console.error('Error loading saved progress:', e);
    }
  };

  const saveProgress = async (
    stepIndex: number,
    completedSteps: string[],
    mappings: Record<string, any>,
    stats: ImportStats,
    mediaOffset: number,
    totalMedia: number,
    status: 'running' | 'paused' | 'completed' | 'failed' = 'running'
  ) => {
    try {
      const progressId = savedProgress?.id;
      const metadata = JSON.parse(JSON.stringify({
        currentStepIndex: stepIndex,
        completedSteps,
        mappings,
        stats,
        mediaOffset,
        totalMedia,
      }));
      const errorLog = JSON.parse(JSON.stringify(Object.values(stats).flatMap(s => s.errors).slice(-100)));

      if (progressId) {
        await supabase
          .from('import_progress')
          .update({
            status,
            processed_items: Object.values(stats).reduce((sum, s) => sum + s.inserted + s.updated, 0),
            failed_items: Object.values(stats).reduce((sum, s) => sum + s.errors.length, 0),
            metadata,
            error_log: errorLog,
          })
          .eq('id', progressId);
      } else {
        const { data } = await supabase
          .from('import_progress')
          .insert([{
            import_type: 'wordpress',
            status,
            total_items: totalMedia,
            processed_items: 0,
            metadata,
            started_at: new Date().toISOString(),
          }])
          .select('id')
          .single();
        
        if (data) {
          setSavedProgress({ id: data.id, currentStepIndex: stepIndex, completedSteps, mappings, stats, mediaOffset, totalMedia });
        }
      }
    } catch (e) {
      console.error('Error saving progress:', e);
    }
  };

  const extractCompaniesFromPolicies = (policies: any[]): any[] => {
    const companiesMap = new Map<string, any>();
    for (const policy of policies || []) {
      if (policy.company_details && policy.company_name) {
        const companyName = policy.company_name.toLowerCase();
        if (!companiesMap.has(companyName)) {
          companiesMap.set(companyName, {
            name: policy.company_name,
            legacy_wp_id: policy.company_legacy_id,
            category_parent: mapCategoryFromParentTerm(policy.company_details.parent_term_name),
          });
        }
      }
    }
    return Array.from(companiesMap.values());
  };

  const mapCategoryFromParentTerm = (termName: string | null | undefined): string | null => {
    if (!termName) return null;
    const mapping: Record<string, string> = {
      'الزامي': 'ELZAMI',
      'ثالث/شامل': 'THIRD_FULL',
      'خدمات الطريق': 'ROAD_SERVICE',
      'اعفاء رسوم حادث': 'ACCIDENT_FEE_EXEMPTION',
    };
    return mapping[termName] || null;
  };

  const extractCarsFromPolicies = (policies: any[]): any[] => {
    const carsMap = new Map<string, any>();
    for (const policy of policies || []) {
      if (policy.car_details && policy.car_number) {
        const carNumber = policy.car_number;
        if (!carsMap.has(carNumber)) {
          carsMap.set(carNumber, {
            ...policy.car_details,
            car_number: carNumber,
            client_id_number: policy.client_details?.id_number,
          });
        }
      }
    }
    return Array.from(carsMap.values());
  };

  const extractPolicies = (policies: any[]): any[] => {
    return (policies || []).map(p => ({
      legacy_wp_id: p.legacy_wp_id,
      policy_number_hint: p.policy_number_hint,
      client_id_number: p.client_details?.id_number,
      car_number: p.car_number,
      company_name: p.company_name,
      broker_name: p.broker_name,
      policy_type_parent: p.policy_type_parent,
      policy_type_child: p.policy_type_child,
      start_date: p.start_date,
      end_date: p.end_date,
      insurance_price: p.insurance_price,
      profit: p.profit,
      payed_for_company: p.payed_for_company,
      is_under_24: p.is_under_24,
      cancelled: p.cancelled,
      transferred: p.transferred,
      transferred_car_number: p.transferred_car_number,
      notes: p.notes,
      calc_status: p.calc_status,
    }));
  };

  const extractPayments = (policies: any[]): any[] => {
    const payments: any[] = [];
    for (const policy of policies || []) {
      const policyNotes = policy.notes || '';
      const paymentWay = policy.payment_way || '';
      
      for (const payment of policy.payments || []) {
        let paymentType = payment.payment_type || paymentWay;
        if (!paymentType && policyNotes.includes('Payment Way:')) {
          const match = policyNotes.match(/Payment Way:\s*(\w+)/i);
          if (match) paymentType = match[1];
        }
        
        payments.push({
          policy_legacy_wp_id: policy.legacy_wp_id,
          payment_type: paymentType,
          check_number: payment.check_number || payment.cheque_number || '',
          amount: payment.amount,
          date: payment.date,
          check_image_url: payment.check_image_url || payment.cheque_image_url || '',
          refused_status: payment.refused_status,
          policy_notes: policyNotes,
        });
      }
    }
    return payments;
  };

  const extractMedia = (policies: any[]): any[] => {
    const media: any[] = [];
    for (const policy of policies || []) {
      for (const url of policy.images || []) {
        if (url) {
          media.push({
            policy_legacy_wp_id: policy.legacy_wp_id,
            url,
          });
        }
      }
    }
    return media;
  };

  const extractInvoices = (policies: any[]): any[] => {
    const invoices: any[] = [];
    for (const policy of policies || []) {
      for (const invoice of policy.invoices || []) {
        if (invoice.pdf) {
          invoices.push({
            policy_legacy_wp_id: policy.legacy_wp_id,
            pdf: invoice.pdf,
            date: invoice.date,
            amount: invoice.amount_of_fatoorah,
          });
        }
      }
    }
    return invoices;
  };

  const countData = (data: any): PreviewCounts => {
    const policies = data.policies || [];
    const companiesMap = new Map<string, any>();
    const carsMap = new Map<string, any>();
    let paymentsCount = 0;
    let mediaCount = 0;
    let invoicesCount = 0;

    for (const policy of policies) {
      if (policy.company_name) companiesMap.set(policy.company_name.toLowerCase(), true);
      if (policy.car_number) carsMap.set(policy.car_number, true);
      paymentsCount += (policy.payments || []).length;
      mediaCount += (policy.images || []).length;
      invoicesCount += (policy.invoices || []).filter((i: any) => i.pdf).length;
    }

    return {
      insuranceCompanies: companiesMap.size,
      pricingRules: 0,
      brokers: (data.brokers || []).length,
      clients: (data.clients || []).length,
      cars: carsMap.size,
      policies: policies.length,
      payments: paymentsCount,
      outsideCheques: (data.outside_cheques || []).length,
      invoices: invoicesCount,
      mediaFiles: mediaCount,
      carAccidents: 0,
    };
  };

  const formatTime = (seconds: number): string => {
    if (seconds < 60) return `${Math.round(seconds)} ثانية`;
    if (seconds < 3600) return `${Math.round(seconds / 60)} دقيقة`;
    const hours = Math.floor(seconds / 3600);
    const mins = Math.round((seconds % 3600) / 60);
    return `${hours} ساعة و ${mins} دقيقة`;
  };

  const calculateEstimatedTime = (totalMedia: number): string => {
    const seconds = (totalMedia / 10) * 2.5;
    return formatTime(seconds);
  };

  // Analyze JSON for incremental import - shows what's new vs existing
  const analyzeJsonForIncrementalImport = async (data: any) => {
    if (!data) return;
    
    setAnalyzingJson(true);
    setIncrementalAnalysis(null);
    
    try {
      // Helper function to fetch ALL records (bypasses 1000 row limit)
      const fetchAllRecords = async (
        tableName: 'clients' | 'cars' | 'policies',
        selectField: string,
        filters: { column: string; op: 'is' | 'not'; value: null }[]
      ): Promise<string[]> => {
        const allRecords: string[] = [];
        const pageSize = 1000;
        let offset = 0;
        
        while (true) {
          let query = supabase.from(tableName).select(selectField);
          
          for (const filter of filters) {
            if (filter.op === 'is') {
              query = query.is(filter.column, filter.value);
            } else {
              query = query.not(filter.column, 'is', filter.value);
            }
          }
          
          const { data: batch, error } = await query.range(offset, offset + pageSize - 1);
          
          if (error) throw error;
          if (!batch || batch.length === 0) break;
          
          allRecords.push(...batch.map((r: any) => r[selectField]));
          if (batch.length < pageSize) break;
          offset += pageSize;
        }
        
        return allRecords;
      };
      
      // Fetch ALL existing data in parallel (handles >1000 records)
      const [existingClientIds, existingCarNumbers, existingPolicyWpIds] = await Promise.all([
        fetchAllRecords('clients', 'id_number', [{ column: 'deleted_at', op: 'is', value: null }]),
        fetchAllRecords('cars', 'car_number', [{ column: 'deleted_at', op: 'is', value: null }]),
        fetchAllRecords('policies', 'legacy_wp_id', [{ column: 'legacy_wp_id', op: 'not', value: null }]),
      ]);
      
      const clientIdSet = new Set(existingClientIds.filter(Boolean));
      const carNumberSet = new Set(existingCarNumbers.filter(Boolean));
      const policyWpIdSet = new Set(existingPolicyWpIds.filter(Boolean));
      
      console.log(`[Analysis] Fetched ${clientIdSet.size} clients, ${carNumberSet.size} cars, ${policyWpIdSet.size} policies from DB`);
      
      // Analyze clients
      const jsonClients = data.clients || [];
      const newClients = jsonClients.filter((c: any) => !clientIdSet.has(c.id_number));
      
      // Extract cars from policies
      const carsMap = new Map<string, boolean>();
      for (const policy of data.policies || []) {
        if (policy.car_number) {
          carsMap.set(policy.car_number, carNumberSet.has(policy.car_number));
        }
      }
      const newCars = Array.from(carsMap.entries()).filter(([_, exists]) => !exists).length;
      const existingCars = carsMap.size - newCars;
      
      // Analyze policies
      const jsonPolicies = data.policies || [];
      const newPolicies = jsonPolicies.filter((p: any) => !policyWpIdSet.has(p.legacy_wp_id));
      
      // Count payments
      let totalPayments = 0;
      for (const policy of jsonPolicies) {
        totalPayments += (policy.payments || []).length;
      }
      
      setIncrementalAnalysis({
        clients: { new: newClients.length, existing: jsonClients.length - newClients.length },
        cars: { new: newCars, existing: existingCars },
        policies: { new: newPolicies.length, existing: jsonPolicies.length - newPolicies.length },
        payments: { new: totalPayments, existing: 0 }, // Payments will be linked to policies
      });
      
      toast({ title: "تم التحليل", description: `موجود: ${clientIdSet.size} عميل، ${carNumberSet.size} سيارة، ${policyWpIdSet.size} وثيقة` });
    } catch (err: any) {
      console.error('Analysis error:', err);
      toast({ title: "خطأ في التحليل", description: err.message, variant: "destructive" });
    } finally {
      setAnalyzingJson(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.json')) {
      toast({ title: "خطأ", description: "يرجى اختيار ملف JSON", variant: "destructive" });
      return;
    }

    setFileName(file.name);
    setImportStats(null);
    setSteps([]);
    setResumeMode(false);

    try {
      const text = await file.text();
      const data = JSON.parse(text);
      setJsonData(data);

      const counts = countData(data);
      setPreview(counts);
      setEstimatedTime(calculateEstimatedTime(counts.mediaFiles));
      toast({ title: "تم تحميل الملف", description: `${(file.size / 1024 / 1024).toFixed(2)} MB` });
    } catch (err: any) {
      toast({ title: "خطأ في قراءة الملف", description: err.message, variant: "destructive" });
      setJsonData(null);
      setPreview(null);
    }
  };

  const chunkArray = <T,>(array: T[], size: number): T[][] => {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  };

  const exportErrorsToCSV = () => {
    if (!importStats) return;
    
    const allErrors: ErrorRecord[] = Object.values(importStats).flatMap(s => s.errors);
    if (allErrors.length === 0) {
      toast({ title: "لا توجد أخطاء", description: "لم يتم تسجيل أي أخطاء" });
      return;
    }

    const headers = ['الكيان', 'المعرف', 'السبب', 'الوقت'];
    const rows = allErrors.map(err => [
      err.entity,
      err.identifier,
      err.reason.replace(/,/g, ';'),
      err.timestamp,
    ]);

    const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `import-errors-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    
    toast({ title: "تم التصدير", description: `تم تصدير ${allErrors.length} خطأ` });
  };

  const handleImport = async (isResume = false) => {
    if (!jsonData && !isResume) return;

    setImporting(true);
    setProgress(0);
    setStartTime(new Date());

    // Initialize or restore stats
    const stats: ImportStats = isResume && savedProgress?.stats ? { ...savedProgress.stats } : {
      companies: { inserted: 0, updated: 0, errors: [] },
      brokers: { inserted: 0, updated: 0, errors: [] },
      clients: { inserted: 0, updated: 0, errors: [] },
      cars: { inserted: 0, updated: 0, errors: [] },
      policies: { inserted: 0, updated: 0, errors: [] },
      payments: { inserted: 0, updated: 0, errors: [] },
      media: { inserted: 0, updated: 0, errors: [] },
      invoices: { inserted: 0, updated: 0, errors: [] },
      outsideCheques: { inserted: 0, updated: 0, errors: [] },
    };

    const completedSteps: string[] = isResume && savedProgress?.completedSteps ? [...savedProgress.completedSteps] : [];
    let mappings = isResume && savedProgress?.mappings ? { ...savedProgress.mappings } : { companies: {}, brokers: {}, clients: {}, cars: {}, policies: {} };
    let mediaOffset = isResume && savedProgress?.mediaOffset ? savedProgress.mediaOffset : 0;

    // In incremental mode, skip clear/preserve/restore steps
    const isIncremental = incrementalMode && !clearBeforeImport;
    
    const allSteps: ImportStep[] = [
      { key: 'preserveRules', label: 'حفظ قواعد التسعير', status: completedSteps.includes('preserveRules') ? 'done' : (isIncremental ? 'skipped' : 'pending'), count: 0 },
      { key: 'clear', label: 'تنظيف البيانات', status: completedSteps.includes('clear') ? 'done' : (isIncremental ? 'skipped' : 'pending'), count: 0 },
      { key: 'companies', label: 'شركات التأمين', status: completedSteps.includes('companies') ? 'done' : 'pending', count: 0 },
      { key: 'restoreRules', label: 'استعادة قواعد التسعير', status: completedSteps.includes('restoreRules') ? 'done' : (isIncremental ? 'skipped' : 'pending'), count: 0 },
      { key: 'brokers', label: 'الوسطاء', status: completedSteps.includes('brokers') ? 'done' : 'pending', count: 0 },
      { key: 'clients', label: 'العملاء', status: completedSteps.includes('clients') ? 'done' : 'pending', count: 0 },
      { key: 'cars', label: 'السيارات', status: completedSteps.includes('cars') ? 'done' : 'pending', count: 0 },
      { key: 'policies', label: 'الوثائق', status: completedSteps.includes('policies') ? 'done' : 'pending', count: 0 },
      { key: 'payments', label: 'المدفوعات', status: completedSteps.includes('payments') ? 'done' : 'pending', count: 0 },
      { key: 'media', label: 'ملفات الوسائط (CDN)', status: completedSteps.includes('media') ? 'done' : 'pending', count: 0 },
      { key: 'invoices', label: 'فواتير PDF', status: completedSteps.includes('invoices') ? 'done' : 'pending', count: 0 },
      { key: 'outsideCheques', label: 'الشيكات الخارجية', status: completedSteps.includes('outsideCheques') ? 'done' : 'pending', count: 0 },
    ];
    
    // Filter out skipped steps from view in incremental mode for cleaner UI
    const initialSteps = isIncremental 
      ? allSteps.filter(s => !['preserveRules', 'clear', 'restoreRules'].includes(s.key))
      : allSteps;
    setSteps(initialSteps);

    const updateStep = (key: string, status: ImportStep['status'], count?: number, processed?: number, lastError?: string) => {
      setSteps(prev => prev.map(s => s.key === key ? { ...s, status, count: count ?? s.count, processed: processed ?? s.processed, lastError } : s));
      setCurrentStep(key);
    };

    const addError = (entityType: string, identifier: string, reason: string) => {
      const errorRecord: ErrorRecord = {
        entity: entityLabels[entityType] || entityType,
        identifier,
        reason,
        timestamp: new Date().toISOString(),
      };
      stats[entityType]?.errors.push(errorRecord);
      return errorRecord;
    };

    try {
      let preservedRules: Record<string, any[]> = {};
      const media = extractMedia(jsonData?.policies || []);
      const totalMedia = media.length;

      // Step 1: Preserve pricing rules if resetting companies (skip in incremental mode)
      if (!completedSteps.includes('preserveRules')) {
        if (!isIncremental && resetCompanies) {
          updateStep('preserveRules', 'running');
          const { data: rulesResult } = await supabase.functions.invoke('wordpress-import', {
            body: { action: 'preservePricingRules' }
          });
          preservedRules = rulesResult?.preservedRules || {};
          updateStep('preserveRules', 'done', rulesResult?.count || 0);
        } else {
          // In incremental mode, just mark as skipped
          if (!isIncremental) updateStep('preserveRules', 'skipped');
        }
        completedSteps.push('preserveRules');
        if (!isIncremental) await saveProgress(0, completedSteps, mappings, stats, mediaOffset, totalMedia);
      }
      setProgress(3);

      // Step 2: Clear data - SKIP ENTIRELY in incremental mode
      if (!completedSteps.includes('clear')) {
        if (!isIncremental && clearBeforeImport) {
          updateStep('clear', 'running');

          // 1) Clear transactional data first (policies/cars/clients/brokers/...) so FK deletion is safe
          const { error: clearError } = await supabase.functions.invoke('wordpress-import', {
            body: { action: 'clear' },
          });
          if (clearError) throw clearError;

          // 2) If requested, reset companies AFTER clearing transactional data
          if (resetCompanies) {
            const { error: deleteCompaniesError } = await supabase.functions.invoke('wordpress-import', {
              body: { action: 'deleteCompanies' },
            });
            if (deleteCompaniesError) throw deleteCompaniesError;
          }

          updateStep('clear', 'done');
        } else {
          // In incremental mode, just skip
          if (!isIncremental) updateStep('clear', 'skipped');
        }
        completedSteps.push('clear');
        if (!isIncremental) await saveProgress(1, completedSteps, mappings, stats, mediaOffset, totalMedia);
      }
      setProgress(6);

      // Step 3: Get existing mappings
      if (!isResume || Object.keys(mappings.companies || {}).length === 0) {
        const { data: mappingsResult } = await supabase.functions.invoke('wordpress-import', {
          body: { action: 'getMappings' }
        });
        mappings = mappingsResult?.mappings || { companies: {}, brokers: {}, clients: {}, cars: {}, policies: {} };
      }

      // Step 4: Import companies
      if (!completedSteps.includes('companies')) {
        const companies = extractCompaniesFromPolicies(jsonData?.policies || []);
        updateStep('companies', 'running', companies.length);
        for (const batch of chunkArray(companies, BATCH_SIZE)) {
          const { data: result, error } = await supabase.functions.invoke('wordpress-import', {
            body: { action: 'importBatch', entityType: 'companies', batch, data: { mappings } }
          });
          if (error) {
            addError('companies', 'batch', error.message);
            updateStep('companies', 'error', companies.length, 0, error.message);
            throw error;
          }
          if (result) {
            stats.companies.inserted += result.stats.inserted;
            stats.companies.updated += result.stats.updated;
            result.stats.errors.forEach((e: string) => addError('companies', 'unknown', e));
            mappings.companies = { ...mappings.companies, ...result.newMappings };
          }
        }
        updateStep('companies', 'done', companies.length);
        completedSteps.push('companies');
        await saveProgress(2, completedSteps, mappings, stats, mediaOffset, totalMedia);
      }
      setProgress(10);

      // Step 5: Restore pricing rules (skip in incremental mode)
      if (!completedSteps.includes('restoreRules')) {
        if (!isIncremental && resetCompanies && Object.keys(preservedRules).length > 0 && !isResume) {
          updateStep('restoreRules', 'running');
          const { data: restoreResult } = await supabase.functions.invoke('wordpress-import', {
            body: { action: 'restorePricingRules', data: { preservedRules } }
          });
          updateStep('restoreRules', 'done', restoreResult?.restored || 0);
        } else {
          if (!isIncremental) updateStep('restoreRules', 'skipped');
        }
        completedSteps.push('restoreRules');
        if (!isIncremental) await saveProgress(3, completedSteps, mappings, stats, mediaOffset, totalMedia);
      }
      setProgress(12);

      // Step 6: Import brokers
      if (!completedSteps.includes('brokers')) {
        const brokers = jsonData?.brokers || [];
        updateStep('brokers', 'running', brokers.length);
        for (const batch of chunkArray(brokers, BATCH_SIZE)) {
          const { data: result, error } = await supabase.functions.invoke('wordpress-import', {
            body: { action: 'importBatch', entityType: 'brokers', batch, data: { mappings } }
          });
          if (error) {
            addError('brokers', 'batch', error.message);
          }
          if (result) {
            stats.brokers.inserted += result.stats.inserted;
            stats.brokers.updated += result.stats.updated;
            result.stats.errors.forEach((e: string) => addError('brokers', 'unknown', e));
            mappings.brokers = { ...mappings.brokers, ...result.newMappings };
          }
        }
        updateStep('brokers', 'done', brokers.length);
        completedSteps.push('brokers');
        await saveProgress(4, completedSteps, mappings, stats, mediaOffset, totalMedia);
      }
      setProgress(18);

      // Step 7: Import clients
      if (!completedSteps.includes('clients')) {
        const clients = jsonData?.clients || [];
        updateStep('clients', 'running', clients.length);
        for (const batch of chunkArray(clients, BATCH_SIZE)) {
          const { data: result, error } = await supabase.functions.invoke('wordpress-import', {
            body: { action: 'importBatch', entityType: 'clients', batch, data: { mappings } }
          });
          if (error) {
            addError('clients', 'batch', error.message);
          }
          if (result) {
            stats.clients.inserted += result.stats.inserted;
            stats.clients.updated += result.stats.updated;
            result.stats.errors.forEach((e: string) => addError('clients', 'unknown', e));
            mappings.clients = { ...mappings.clients, ...result.newMappings };
          }
        }
        updateStep('clients', 'done', clients.length);
        completedSteps.push('clients');
        await saveProgress(5, completedSteps, mappings, stats, mediaOffset, totalMedia);
      }
      setProgress(30);

      // Step 8: Import cars
      if (!completedSteps.includes('cars')) {
        const cars = extractCarsFromPolicies(jsonData?.policies || []);
        updateStep('cars', 'running', cars.length);
        for (const batch of chunkArray(cars, BATCH_SIZE)) {
          const { data: result, error } = await supabase.functions.invoke('wordpress-import', {
            body: { action: 'importBatch', entityType: 'cars', batch, data: { mappings } }
          });
          if (error) {
            addError('cars', 'batch', error.message);
          }
          if (result) {
            stats.cars.inserted += result.stats.inserted;
            stats.cars.updated += result.stats.updated;
            result.stats.errors.forEach((e: string) => addError('cars', 'unknown', e));
            mappings.cars = { ...mappings.cars, ...result.newMappings };
          }
        }
        updateStep('cars', 'done', cars.length);
        completedSteps.push('cars');
        await saveProgress(6, completedSteps, mappings, stats, mediaOffset, totalMedia);
      }
      setProgress(40);

      // Step 9: Import policies
      if (!completedSteps.includes('policies')) {
        const policies = extractPolicies(jsonData?.policies || []);
        updateStep('policies', 'running', policies.length);
        for (const batch of chunkArray(policies, BATCH_SIZE)) {
          const { data: result, error } = await supabase.functions.invoke('wordpress-import', {
            body: { action: 'importBatch', entityType: 'policies', batch, data: { mappings } }
          });
          if (error) {
            addError('policies', 'batch', error.message);
          }
          if (result) {
            stats.policies.inserted += result.stats.inserted;
            stats.policies.updated += result.stats.updated;
            result.stats.errors.forEach((e: string) => addError('policies', 'unknown', e));
            mappings.policies = { ...mappings.policies, ...result.newMappings };
          }
        }
        updateStep('policies', 'done', policies.length);
        completedSteps.push('policies');
        await saveProgress(7, completedSteps, mappings, stats, mediaOffset, totalMedia);
      }
      setProgress(55);

      // Step 10: Import payments
      if (!completedSteps.includes('payments')) {
        const payments = extractPayments(jsonData?.policies || []);
        updateStep('payments', 'running', payments.length);
        for (const batch of chunkArray(payments, BATCH_SIZE)) {
          const { data: result, error } = await supabase.functions.invoke('wordpress-import', {
            body: { action: 'importBatch', entityType: 'payments', batch, data: { mappings } }
          });
          if (error) {
            addError('payments', 'batch', error.message);
          }
          if (result) {
            stats.payments.inserted += result.stats.inserted;
            stats.payments.updated += result.stats.updated;
            result.stats.errors.forEach((e: string) => addError('payments', 'unknown', e));
          }
        }
        updateStep('payments', 'done', payments.length);
        completedSteps.push('payments');
        await saveProgress(8, completedSteps, mappings, stats, mediaOffset, totalMedia);
      }
      setProgress(65);

      // Step 11: Import media with parallel upload and persistent cursor
      if (!completedSteps.includes('media')) {
        updateStep('media', 'running', totalMedia, mediaOffset);
        
        const MEDIA_BATCH_SIZE = 100; // Larger batch for parallel processing
        const CONCURRENCY = 10; // 10 concurrent uploads
        
        // Process media from offset
        const remainingMedia = media.slice(mediaOffset);
        const mediaBatches = chunkArray(remainingMedia, MEDIA_BATCH_SIZE);
        
        for (let batchIndex = 0; batchIndex < mediaBatches.length; batchIndex++) {
          const batch = mediaBatches[batchIndex];
          const currentOffset = mediaOffset + (batchIndex * MEDIA_BATCH_SIZE);
          
          try {
            const { data: result, error } = await supabase.functions.invoke('wordpress-import', {
              body: { 
                action: 'importMediaBatchParallel', 
                data: { 
                  mediaItems: batch, 
                  mappings, 
                  offset: currentOffset,
                  batchSize: MEDIA_BATCH_SIZE,
                  concurrency: CONCURRENCY,
                }
              }
            });
            
            if (error) {
              addError('media', `batch-${batchIndex}`, error.message);
              updateStep('media', 'error', totalMedia, currentOffset, `فشل عند الدفعة ${batchIndex + 1}: ${error.message}`);
              // Save progress for resume
              await saveProgress(9, completedSteps, mappings, stats, currentOffset, totalMedia, 'paused');
              throw new Error(`توقف رفع الوسائط عند الملف ${currentOffset + 1}: ${error.message}`);
            }
            
            if (result) {
              stats.media.inserted += result.inserted || 0;
              stats.media.updated += 0; // Skipped files
              
              // Add errors to stats
              (result.errors || []).forEach((e: string) => {
                addError('media', e.split(':')[0] || 'unknown', e);
              });
              
              if (result.failed > 0) {
                console.log(`Media batch ${batchIndex + 1}: ${result.inserted} inserted, ${result.failed} failed`);
              }
            }
            
            // Update progress
            const processedCount = currentOffset + (result?.processedCount || batch.length);
            updateStep('media', 'running', totalMedia, Math.min(processedCount, totalMedia));
            setProgress(65 + Math.round((Math.min(processedCount, totalMedia) / totalMedia) * 20));
            
            // Save progress after each batch
            await saveProgress(9, completedSteps, mappings, stats, processedCount, totalMedia);
            
          } catch (err: any) {
            // Already handled above, but in case of network errors
            if (!err.message.includes('توقف رفع الوسائط')) {
              addError('media', `batch-${batchIndex}`, err.message);
              await saveProgress(9, completedSteps, mappings, stats, currentOffset, totalMedia, 'paused');
              throw new Error(`خطأ في الشبكة عند الدفعة ${batchIndex + 1}: ${err.message}`);
            }
            throw err;
          }
        }
        
        // Update final offset
        mediaOffset = totalMedia;
        updateStep('media', 'done', totalMedia, totalMedia);
        completedSteps.push('media');
        await saveProgress(9, completedSteps, mappings, stats, totalMedia, totalMedia);
      }
      setProgress(85);

      // Step 12: Import invoices
      if (!completedSteps.includes('invoices')) {
        const invoices = extractInvoices(jsonData?.policies || []);
        updateStep('invoices', 'running', invoices.length);
        for (const batch of chunkArray(invoices, BATCH_SIZE)) {
          const { data: result, error } = await supabase.functions.invoke('wordpress-import', {
            body: { action: 'importBatch', entityType: 'invoices', batch, data: { mappings } }
          });
          if (error) {
            addError('invoices', 'batch', error.message);
          }
          if (result) {
            stats.invoices.inserted += result.stats.inserted;
            stats.invoices.updated += result.stats.updated;
            result.stats.errors.forEach((e: string) => addError('invoices', 'unknown', e));
          }
        }
        updateStep('invoices', 'done', invoices.length);
        completedSteps.push('invoices');
        await saveProgress(10, completedSteps, mappings, stats, mediaOffset, totalMedia);
      }
      setProgress(94);

      // Step 13: Import outside cheques
      if (!completedSteps.includes('outsideCheques')) {
        const outsideCheques = jsonData?.outside_cheques || [];
        updateStep('outsideCheques', 'running', outsideCheques.length);
        for (const batch of chunkArray(outsideCheques, BATCH_SIZE)) {
          const { data: result, error } = await supabase.functions.invoke('wordpress-import', {
            body: { action: 'importBatch', entityType: 'outsideCheques', batch, data: { mappings } }
          });
          if (error) {
            addError('outsideCheques', 'batch', error.message);
          }
          if (result) {
            stats.outsideCheques.inserted += result.stats.inserted;
            stats.outsideCheques.updated += result.stats.updated;
            result.stats.errors.forEach((e: string) => addError('outsideCheques', 'unknown', e));
          }
        }
        updateStep('outsideCheques', 'done', outsideCheques.length);
        completedSteps.push('outsideCheques');
      }
      setProgress(100);

      // Mark complete
      await saveProgress(11, completedSteps, mappings, stats, mediaOffset, totalMedia, 'completed');
      setSavedProgress(null);
      setResumeMode(false);

      setImportStats(stats);
      setCurrentStep("");
      
      const totalErrors = Object.values(stats).reduce((sum, s) => sum + s.errors.length, 0);
      if (totalErrors > 0) {
        toast({ 
          title: "تم الاستيراد مع أخطاء", 
          description: `${totalErrors} خطأ - راجع السجل أدناه`,
          variant: "destructive"
        });
      } else {
        toast({ title: "تم الاستيراد بنجاح", description: "تم استيراد جميع البيانات" });
      }
    } catch (err: any) {
      toast({ title: "خطأ في الاستيراد", description: err.message, variant: "destructive" });
      updateStep(currentStep, 'error');
      setImportStats(stats);
      
      // Save for resume
      const totalMediaCount = preview?.mediaFiles || 0;
      await saveProgress(
        STEP_KEYS.indexOf(currentStep),
        completedSteps,
        mappings,
        stats,
        mediaOffset,
        totalMediaCount,
        'paused'
      );
      setSavedProgress({
        id: savedProgress?.id || '',
        currentStepIndex: STEP_KEYS.indexOf(currentStep),
        completedSteps,
        mappings,
        stats,
        mediaOffset,
        totalMedia: totalMediaCount,
      });
      setResumeMode(true);
    } finally {
      setImporting(false);
    }
  };

  // Bulk assign company to unlinked policies (no JSON needed)
  const [bulkCompanyId, setBulkCompanyId] = useState<string>('');
  const [bulkPolicyType, setBulkPolicyType] = useState<string>('all');
  const [bulkAssigning, setBulkAssigning] = useState(false);
  const [unlinkedStats, setUnlinkedStats] = useState<{ total: number; byType: Record<string, number> } | null>(null);
  const [companies, setCompanies] = useState<{ id: string; name: string; name_ar: string | null }[]>([]);

  // Fetch companies and unlinked stats on mount
  useEffect(() => {
    const fetchData = async () => {
      const { data: comps } = await supabase.from('insurance_companies').select('id, name, name_ar').eq('active', true);
      setCompanies(comps || []);
      
      const { data: stats } = await supabase.functions.invoke('wordpress-import', {
        body: { action: 'getUnlinkedPoliciesStats' }
      });
      if (stats) setUnlinkedStats(stats);
    };
    fetchData();
  }, []);

  const handleBulkAssignCompany = async () => {
    if (!bulkCompanyId) {
      toast({ title: "خطأ", description: "يرجى اختيار شركة التأمين", variant: "destructive" });
      return;
    }

    setBulkAssigning(true);
    try {
      const { data, error } = await supabase.functions.invoke('wordpress-import', {
        body: { 
          action: 'bulkAssignCompany',
          data: { 
            companyId: bulkCompanyId,
            policyTypeFilter: bulkPolicyType === 'all' ? null : bulkPolicyType
          }
        }
      });

      if (error) throw error;

      toast({ 
        title: "تم الربط", 
        description: `تم ربط ${data.linked} وثيقة بالشركة` 
      });
      
      // Refresh stats
      const { data: newStats } = await supabase.functions.invoke('wordpress-import', {
        body: { action: 'getUnlinkedPoliciesStats' }
      });
      if (newStats) setUnlinkedStats(newStats);
    } catch (err: any) {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    } finally {
      setBulkAssigning(false);
    }
  };

  const handleLinkPoliciesToCompanies = async () => {
    if (!jsonData?.policies) {
      toast({ 
        title: "خطأ", 
        description: "يرجى تحميل ملف JSON أولاً للحصول على بيانات الشركات", 
        variant: "destructive" 
      });
      return;
    }
    
    setLinkingPolicies(true);
    setLinkingStats(null);
    
    try {
      // Build a map of legacy_wp_id -> company_name from JSON data
      const policyCompanyMap: Record<number, string> = {};
      for (const policy of jsonData.policies || []) {
        if (policy.legacy_wp_id && policy.company_name) {
          policyCompanyMap[policy.legacy_wp_id] = policy.company_name;
        }
      }
      
      console.log(`Built policy-company map with ${Object.keys(policyCompanyMap).length} entries`);
      
      const { data: result, error } = await supabase.functions.invoke('wordpress-import', {
        body: { 
          action: 'linkPoliciesToCompanies',
          data: { policyCompanyMap }
        }
      });
      
      if (error) throw error;
      
      setLinkingStats({
        found: result.found || 0,
        linked: result.linked || 0,
        notFound: result.notFound || [],
      });
      
      toast({ 
        title: "تم الربط", 
        description: `تم ربط ${result.linked} وثيقة من أصل ${result.found}` 
      });
    } catch (err: any) {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    } finally {
      setLinkingPolicies(false);
    }
  };

  const handleUpdatePoliciesOnly = async () => {
    if (!jsonData?.policies) {
      toast({
        title: "خطأ",
        description: "يرجى تحميل ملف JSON أولاً",
        variant: "destructive",
      });
      return;
    }

    const allPolicies: any[] = jsonData.policies || [];
    const total = allPolicies.length;

    if (total === 0) {
      toast({
        title: "خطأ",
        description: "ملف JSON لا يحتوي على وثائق",
        variant: "destructive",
      });
      return;
    }

    // Chunked processing to avoid backend timeouts
    const MAX_POLICIES_PER_CALL = 400;

    updatePoliciesCancelRef.current = false;
    setUpdatingPoliciesOnly(true);
    setUpdatePoliciesStats(null);
    setUpdatePoliciesProgress({ processed: 0, total });
    setUpdatePoliciesChunkRange(null);

    const totals = {
      policiesUpdated: 0,
      policiesSkipped: 0,
      paymentsDeleted: 0,
      paymentsInserted: 0,
      chequesFixed: 0,
      errors: [] as string[],
    };

    let processedSoFar = 0;

    try {
      for (let offset = 0; offset < total; offset += MAX_POLICIES_PER_CALL) {
        if (updatePoliciesCancelRef.current) break;

        const chunk = allPolicies.slice(offset, offset + MAX_POLICIES_PER_CALL);
        const from = offset + 1;
        const to = offset + chunk.length;
        setUpdatePoliciesChunkRange({ from, to });

        const { data: result, error } = await supabase.functions.invoke('wordpress-import', {
          body: {
            action: 'updatePoliciesOnly',
            data: {
              policies: chunk,
              offset,
              total,
              isChunk: true,
            },
          },
        });

        if (error) throw error;

        const s = result?.stats || {};
        totals.policiesUpdated += Number(s.policiesUpdated || 0);
        totals.policiesSkipped += Number(s.policiesSkipped || 0);
        totals.paymentsDeleted += Number(s.paymentsDeleted || 0);
        totals.paymentsInserted += Number(s.paymentsInserted || 0);
        totals.chequesFixed += Number(s.chequesFixed || 0);
        totals.errors.push(...((s.errors || []) as string[]));

        // Keep UI fast + memory bounded
        if (totals.errors.length > 200) {
          totals.errors = totals.errors.slice(-200);
        }

        setUpdatePoliciesStats({ ...totals });

        processedSoFar = Math.min(offset + chunk.length, total);
        setUpdatePoliciesProgress({ processed: processedSoFar, total });

        // Tiny breath (avoid UI freeze)
        await new Promise((r) => setTimeout(r, 50));
      }

      setUpdatePoliciesChunkRange(null);

      if (updatePoliciesCancelRef.current) {
        toast({
          title: "تم الإيقاف",
          description: `تم إيقاف العملية عند ${processedSoFar}/${total}`,
        });
      } else {
        toast({
          title: "تم التحديث",
          description: `تم تحديث ${totals.policiesUpdated} وثيقة وإضافة ${totals.paymentsInserted} مدفوعة`,
        });
      }
    } catch (err: any) {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    } finally {
      setUpdatingPoliciesOnly(false);
      setUpdatePoliciesChunkRange(null);
    }
  };

  const handleClearAll = async () => {
    if (deleteConfirmText !== "DELETE ALL") return;

    setClearing(true);
    try {
      const { error } = await supabase.functions.invoke('wordpress-import', {
        body: { action: 'clear' }
      });

      if (error) throw error;
      toast({ title: "تم الحذف", description: "تم حذف جميع البيانات بنجاح" });
      setDeleteConfirmText("");
    } catch (err: any) {
      toast({ title: "خطأ في الحذف", description: err.message, variant: "destructive" });
    } finally {
      setClearing(false);
    }
  };

  const handleCancelResume = async () => {
    if (savedProgress?.id) {
      await supabase
        .from('import_progress')
        .update({ status: 'cancelled' })
        .eq('id', savedProgress.id);
    }
    setSavedProgress(null);
    setResumeMode(false);
    toast({ title: "تم إلغاء الاستئناف" });
  };

  if (!isAdmin) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-full">
          <p className="text-muted-foreground">ليس لديك صلاحية الوصول لهذه الصفحة</p>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="space-y-6 max-w-4xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold">استيراد بيانات WordPress</h1>
          <p className="text-muted-foreground">استيراد البيانات من نظام WordPress القديم - جميع البيانات ستُعيّن لفرع بيت حنينا</p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="import">الاستيراد</TabsTrigger>
            <TabsTrigger value="tools">أدوات الإصلاح</TabsTrigger>
            <TabsTrigger value="errors">سجل الأخطاء</TabsTrigger>
          </TabsList>

          <TabsContent value="import" className="space-y-6">
            {/* Resume Mode Alert */}
            {resumeMode && savedProgress && (
              <Card className="border-primary bg-primary/5">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-primary">
                    <RefreshCw className="h-5 w-5" />
                    استئناف الاستيراد السابق
                  </CardTitle>
                  <CardDescription>
                    توقف الاستيراد في الخطوة: <strong>{STEP_KEYS[savedProgress.currentStepIndex]}</strong>
                    {savedProgress.mediaOffset > 0 && ` (الوسائط: ${savedProgress.mediaOffset}/${savedProgress.totalMedia})`}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex gap-2">
                  <Button onClick={() => handleImport(true)} disabled={importing || !jsonData}>
                    <Play className="h-4 w-4 ml-2" />
                    استئناف
                  </Button>
                  <Button variant="outline" onClick={handleCancelResume}>
                    إلغاء والبدء من جديد
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* File Upload */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileJson className="h-5 w-5" />
                  تحميل ملف JSON
                </CardTitle>
                <CardDescription>قم بتحميل ملف التصدير من WordPress</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <Button onClick={() => fileInputRef.current?.click()} variant="outline" className="w-full">
                  <Upload className="h-4 w-4 ml-2" />
                  {fileName || "اختر ملف JSON"}
                </Button>

                {preview && (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-4">
                      {Object.entries(preview).map(([key, count]) => (
                        <div key={key} className="flex justify-between items-center p-2 bg-muted rounded">
                          <span className="text-sm">{entityLabels[key]}</span>
                          <Badge variant="secondary">{count}</Badge>
                        </div>
                      ))}
                    </div>
                    
                    {preview.mediaFiles > 0 && (
                      <div className="flex items-center gap-2 p-3 bg-primary/10 rounded-lg">
                        <Clock className="h-4 w-4 text-primary" />
                        <span className="text-sm">
                          الوقت المتوقع لرفع {preview.mediaFiles} ملف: <strong>{estimatedTime}</strong>
                        </span>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            {/* Incremental Import Mode Card */}
            {jsonData && !resumeMode && (
              <Card className={incrementalMode ? "border-green-500 bg-green-50 dark:bg-green-900/10" : "border-muted"}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                      <RefreshCw className="h-5 w-5" />
                      وضع الاستيراد التفاضلي (آمن)
                    </div>
                    <Checkbox
                      id="incrementalMode"
                      checked={incrementalMode}
                      onCheckedChange={(v) => {
                        setIncrementalMode(v === true);
                        if (v === true) {
                          setClearBeforeImport(false);
                          setResetCompanies(false);
                        }
                      }}
                    />
                  </CardTitle>
                  <CardDescription className={incrementalMode ? "text-green-700 dark:text-green-400" : ""}>
                    {incrementalMode ? (
                      <>
                        ✅ سيتم استيراد السجلات الجديدة فقط التي غير موجودة في النظام.
                        <br />
                        <strong>لن يتم حذف أي بيانات موجودة.</strong>
                      </>
                    ) : (
                      "قم بتفعيل هذا الوضع لاستيراد الجديد فقط بدون حذف"
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Analyze Button */}
                  {incrementalMode && (
                    <Button
                      onClick={() => analyzeJsonForIncrementalImport(jsonData)}
                      disabled={analyzingJson}
                      variant="outline"
                      className="w-full border-green-500 text-green-700 hover:bg-green-100 dark:text-green-400 dark:hover:bg-green-900/30"
                    >
                      {analyzingJson ? (
                        <><Loader2 className="h-4 w-4 ml-2 animate-spin" />جاري التحليل...</>
                      ) : (
                        <><RefreshCw className="h-4 w-4 ml-2" />تحليل الملف (معاينة ما سيتم استيراده)</>
                      )}
                    </Button>
                  )}

                  {/* Analysis Results */}
                  {incrementalAnalysis && incrementalMode && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="p-3 rounded-lg border border-green-300 bg-white dark:bg-green-900/20">
                        <div className="text-xs text-muted-foreground mb-1">العملاء</div>
                        <div className="flex items-center gap-2">
                          <Badge className="bg-green-500">🆕 {incrementalAnalysis.clients.new}</Badge>
                          <Badge variant="secondary">🔄 {incrementalAnalysis.clients.existing}</Badge>
                        </div>
                      </div>
                      <div className="p-3 rounded-lg border border-green-300 bg-white dark:bg-green-900/20">
                        <div className="text-xs text-muted-foreground mb-1">السيارات</div>
                        <div className="flex items-center gap-2">
                          <Badge className="bg-green-500">🆕 {incrementalAnalysis.cars.new}</Badge>
                          <Badge variant="secondary">🔄 {incrementalAnalysis.cars.existing}</Badge>
                        </div>
                      </div>
                      <div className="p-3 rounded-lg border border-green-300 bg-white dark:bg-green-900/20">
                        <div className="text-xs text-muted-foreground mb-1">الوثائق</div>
                        <div className="flex items-center gap-2">
                          <Badge className="bg-green-500">🆕 {incrementalAnalysis.policies.new}</Badge>
                          <Badge variant="secondary">🔄 {incrementalAnalysis.policies.existing}</Badge>
                        </div>
                      </div>
                      <div className="p-3 rounded-lg border border-green-300 bg-white dark:bg-green-900/20">
                        <div className="text-xs text-muted-foreground mb-1">المدفوعات</div>
                        <div className="flex items-center gap-2">
                          <Badge className="bg-green-500">🆕 {incrementalAnalysis.payments.new}</Badge>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Import Options (only shown when NOT in incremental mode) */}
            {jsonData && !resumeMode && !incrementalMode && (
              <Card className="border-destructive/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-destructive">
                    <AlertTriangle className="h-5 w-5" />
                    خيارات الاستيراد المتقدمة (خطر)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="clear"
                        checked={clearBeforeImport}
                        onCheckedChange={(v) => setClearBeforeImport(v === true)}
                      />
                      <Label htmlFor="clear" className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-destructive" />
                        حذف جميع البيانات قبل الاستيراد
                      </Label>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="resetCompanies"
                        checked={resetCompanies}
                        onCheckedChange={(v) => setResetCompanies(v === true)}
                      />
                      <Label htmlFor="resetCompanies" className="flex items-center gap-2">
                        إعادة تعيين شركات التأمين (مع الحفاظ على قواعد التسعير)
                      </Label>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Start Import Button */}
            {jsonData && !resumeMode && (
              <Button 
                onClick={() => handleImport(false)} 
                disabled={importing} 
                className={`w-full ${incrementalMode ? 'bg-green-600 hover:bg-green-700' : ''}`}
                size="lg"
              >
                {importing ? <Loader2 className="h-4 w-4 ml-2 animate-spin" /> : <Upload className="h-4 w-4 ml-2" />}
                {importing ? "جاري الاستيراد..." : (incrementalMode ? "🚀 بدء الاستيراد التفاضلي (آمن)" : "بدء الاستيراد")}
              </Button>
            )}

            {/* Import Progress */}
            {(importing || steps.length > 0) && (
              <Card>
                <CardHeader>
                  <CardTitle>تقدم الاستيراد</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {importing && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Progress value={progress} className="flex-1 ml-4" />
                        <span className="text-sm font-medium">{progress}%</span>
                      </div>
                      {startTime && (
                        <p className="text-xs text-muted-foreground text-center">
                          بدأ: {startTime.toLocaleTimeString('ar-EG')}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="space-y-2 border rounded-lg p-4 max-h-80 overflow-y-auto">
                    {steps.map((step) => (
                      <div key={step.key} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            {step.status === 'pending' && <div className="w-4 h-4 rounded-full border-2 border-muted" />}
                            {step.status === 'running' && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
                            {step.status === 'done' && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                            {step.status === 'error' && <XCircle className="w-4 h-4 text-destructive" />}
                            {step.status === 'skipped' && <div className="w-4 h-4 rounded-full bg-muted" />}
                            <span className={step.status === 'running' ? 'font-medium text-primary' : step.status === 'skipped' ? 'text-muted-foreground' : ''}>{step.label}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            {step.processed !== undefined && step.count > 0 && step.status === 'running' && (
                              <span className="text-xs text-muted-foreground">{step.processed}/{step.count}</span>
                            )}
                            {step.count > 0 && <Badge variant="outline">{step.count}</Badge>}
                          </div>
                        </div>
                        {step.lastError && (
                          <p className="text-xs text-destructive mr-6 truncate" title={step.lastError}>
                            ⚠️ {step.lastError}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Import Results */}
            {importStats && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                      نتائج الاستيراد
                    </span>
                    {Object.values(importStats).some(s => s.errors.length > 0) && (
                      <Button variant="outline" size="sm" onClick={exportErrorsToCSV}>
                        <Download className="h-4 w-4 ml-2" />
                        تصدير الأخطاء CSV
                      </Button>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {Object.entries(importStats).map(([key, stats]) => (
                      <div key={key} className="flex items-center justify-between p-2 border rounded">
                        <span>{entityLabels[key]}</span>
                        <div className="flex gap-2">
                          <Badge variant="default">{stats.inserted} جديد</Badge>
                          <Badge variant="secondary">{stats.updated} محدث</Badge>
                          {stats.errors.length > 0 && (
                            <Badge variant="destructive">{stats.errors.length} أخطاء</Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Clear All Data */}
            <Card className="border-destructive">
              <CardHeader>
                <CardTitle className="text-destructive flex items-center gap-2">
                  <Trash2 className="h-5 w-5" />
                  حذف جميع البيانات
                </CardTitle>
                <CardDescription>
                  سيتم حذف: العملاء، السيارات، الوثائق، المدفوعات، الفواتير، الوسائط، الحوادث، الوسطاء
                  <br />
                  <strong>لن يتم حذف:</strong> شركات التأمين، قواعد التسعير، الفروع، المستخدمين
                </CardDescription>
              </CardHeader>
              <CardContent>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive">
                      <Trash2 className="h-4 w-4 ml-2" />
                      حذف جميع البيانات
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>تأكيد الحذف</AlertDialogTitle>
                      <AlertDialogDescription>
                        هذا الإجراء لا يمكن التراجع عنه. اكتب "DELETE ALL" للتأكيد.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <Input
                      value={deleteConfirmText}
                      onChange={(e) => setDeleteConfirmText(e.target.value)}
                      placeholder="DELETE ALL"
                    />
                    <AlertDialogFooter>
                      <AlertDialogCancel>إلغاء</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={(e) => {
                          e.preventDefault();
                          handleClearAll();
                        }}
                        disabled={deleteConfirmText !== "DELETE ALL" || clearing}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        {clearing ? <><Loader2 className="h-4 w-4 animate-spin ml-2" />جاري الحذف...</> : "حذف"}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="tools" className="space-y-6">
            {/* Update Policies Only (re-sync payments) - First card in tools */}
            <Card className="border-2 border-primary">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-primary">
                  <RefreshCw className="h-5 w-5" />
                  تحديث الوثائق والمدفوعات فقط
                </CardTitle>
                <CardDescription>
                  يعيد مزامنة المدفوعات من ملف JSON للوثائق الموجودة فقط (يحذف المدفوعات القديمة ويستبدلها)
                  <br />
                  <strong>لا يمس:</strong> العملاء، السيارات، شركات التأمين، الوسائط
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!jsonData && (
                  <div className="p-3 bg-muted border border-border rounded-lg text-sm text-muted-foreground">
                    ⚠️ يرجى تحميل ملف JSON أولاً من تبويب "الاستيراد"
                  </div>
                )}

                {jsonData && (
                  <div className="p-3 bg-primary/5 border border-primary/20 rounded-lg space-y-1">
                    <p className="text-sm">
                      <strong>الوثائق في JSON:</strong> {(jsonData?.policies || []).length}
                    </p>
                    <p className="text-sm">
                      <strong>إجمالي المدفوعات:</strong>{' '}
                      {(jsonData?.policies || []).reduce((sum: number, p: any) => sum + (p.payments?.length || 0), 0)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-2">
                      سيتم حذف جميع المدفوعات الحالية واستبدالها بالبيانات من JSON مع ضمان عدم تجاوز سعر التأمين
                    </p>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    onClick={handleUpdatePoliciesOnly}
                    disabled={updatingPoliciesOnly || !jsonData}
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    {updatingPoliciesOnly ? (
                      <>
                        <Loader2 className="h-4 w-4 ml-2 animate-spin" />جاري التحديث...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="h-4 w-4 ml-2" />تحديث المدفوعات
                      </>
                    )}
                  </Button>

                  {updatingPoliciesOnly && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        updatePoliciesCancelRef.current = true;
                      }}
                    >
                      إيقاف
                    </Button>
                  )}
                </div>

                {updatePoliciesProgress.total > 0 && (updatingPoliciesOnly || updatePoliciesProgress.processed > 0) && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {updatePoliciesChunkRange
                          ? `جاري معالجة الوثائق ${updatePoliciesChunkRange.from}-${updatePoliciesChunkRange.to}`
                          : "جاري المعالجة..."}
                      </span>
                      <span>
                        {updatePoliciesProgress.processed}/{updatePoliciesProgress.total} (
                        {Math.round((updatePoliciesProgress.processed / updatePoliciesProgress.total) * 100)}%)
                      </span>
                    </div>

                    <Progress value={(updatePoliciesProgress.processed / updatePoliciesProgress.total) * 100} />

                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      {(() => {
                        const elapsedSec = updatePoliciesStartedAt
                          ? Math.max(0, Math.floor((updatePoliciesNow - updatePoliciesStartedAt) / 1000))
                          : 0;
                        const processed = updatePoliciesProgress.processed;
                        const total = updatePoliciesProgress.total;
                        const remaining = Math.max(0, total - processed);
                        const speed = processed > 0 ? processed / Math.max(1, elapsedSec) : 0;
                        const etaSec = speed > 0 ? Math.round(remaining / speed) : null;

                        return (
                          <>
                            <span>الوقت: {updatePoliciesStartedAt ? formatTime(elapsedSec) : "-"}</span>
                            <span>المتبقي: {etaSec !== null ? formatTime(etaSec) : "..."}</span>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                )}

                {updatePoliciesStats && (
                  <div className="p-4 border rounded-lg space-y-2 bg-muted">
                    <div className="grid grid-cols-3 gap-4 text-center">
                      <div>
                        <p className="text-sm text-muted-foreground">وثائق محدثة</p>
                        <p className="text-2xl font-bold text-green-600">{updatePoliciesStats.policiesUpdated}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">مدفوعات جديدة</p>
                        <p className="text-2xl font-bold text-blue-600">{updatePoliciesStats.paymentsInserted}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">شيكات مصححة</p>
                        <p className="text-2xl font-bold text-purple-600">{updatePoliciesStats.chequesFixed || 0}</p>
                      </div>
                    </div>
                    {updatePoliciesStats.policiesSkipped > 0 && (
                      <p className="text-sm text-amber-600">
                        ⚠️ تم تخطي {updatePoliciesStats.policiesSkipped} وثيقة (غير موجودة في النظام)
                      </p>
                    )}
                    {updatePoliciesStats.errors?.length > 0 && (
                      <div className="text-sm text-destructive">
                        <p className="font-medium">أخطاء ({updatePoliciesStats.errors.length}):</p>
                        <ScrollArea className="h-24 mt-1">
                          {updatePoliciesStats.errors.slice(0, 10).map((err: string, i: number) => (
                            <p key={i} className="text-xs">{err}</p>
                          ))}
                        </ScrollArea>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Bulk Assign Company Tool - NO JSON NEEDED */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Link2 className="h-5 w-5" />
                  ربط الوثائق بشركة التأمين (بدون JSON)
                </CardTitle>
                <CardDescription>
                  اختر شركة التأمين وربط جميع الوثائق غير المربوطة بها
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {unlinkedStats && (
                  <div className="p-3 bg-muted rounded-lg space-y-2">
                    <p className="font-medium">وثائق بدون شركة: {unlinkedStats.total}</p>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(unlinkedStats.byType).map(([type, count]) => (
                        <Badge key={type} variant="outline">
                          {POLICY_TYPE_LABELS[type as keyof typeof POLICY_TYPE_LABELS] || type}: {count}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>شركة التأمين</Label>
                    <Select value={bulkCompanyId} onValueChange={setBulkCompanyId}>
                      <SelectTrigger>
                        <SelectValue placeholder="اختر الشركة" />
                      </SelectTrigger>
                      <SelectContent>
                        {companies.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name_ar || c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>نوع الوثيقة</Label>
                    <Select value={bulkPolicyType} onValueChange={setBulkPolicyType}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">جميع الأنواع</SelectItem>
                        <SelectItem value="ROAD_SERVICE">خدمات الطريق</SelectItem>
                        <SelectItem value="ELZAMI">إلزامي</SelectItem>
                        <SelectItem value="THIRD_FULL">طرف ثالث/شامل</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Button onClick={handleBulkAssignCompany} disabled={bulkAssigning || !bulkCompanyId}>
                  {bulkAssigning ? <Loader2 className="h-4 w-4 ml-2 animate-spin" /> : <Link2 className="h-4 w-4 ml-2" />}
                  {bulkAssigning ? "جاري الربط..." : "ربط الوثائق"}
                </Button>
              </CardContent>
            </Card>

            {/* Link Policies using JSON (legacy method) */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileJson className="h-5 w-5" />
                  ربط الوثائق باستخدام JSON (متقدم)
                </CardTitle>
                <CardDescription>
                  يستخدم بيانات JSON للمطابقة التلقائية - مطلوب تحميل ملف JSON أولاً
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!jsonData && (
                  <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-sm text-amber-700 dark:text-amber-300">
                    ⚠️ يرجى تحميل ملف JSON أولاً من تبويب "الاستيراد"
                  </div>
                )}
                <Button onClick={handleLinkPoliciesToCompanies} disabled={linkingPolicies || !jsonData} variant="outline">
                  {linkingPolicies ? <Loader2 className="h-4 w-4 ml-2 animate-spin" /> : <Link2 className="h-4 w-4 ml-2" />}
                  {linkingPolicies ? "جاري الربط..." : "بدء الربط"}
                </Button>

                {linkingStats && (
                  <div className="space-y-3 p-4 border rounded-lg">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm text-muted-foreground">وثائق بدون شركة</p>
                        <p className="text-2xl font-bold">{linkingStats.found}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">تم ربطها</p>
                        <p className="text-2xl font-bold text-green-500">{linkingStats.linked}</p>
                      </div>
                    </div>
                    
                    {linkingStats.notFound.length > 0 && (
                      <div>
                        <p className="text-sm font-medium mb-2">شركات غير موجودة ({linkingStats.notFound.length}):</p>
                        <ScrollArea className="h-32 border rounded p-2">
                          {linkingStats.notFound.map((name, i) => (
                            <p key={i} className="text-sm text-muted-foreground">{name}</p>
                          ))}
                        </ScrollArea>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Fix ELZAMI Payments Tool */}
            <Card className="border-2 border-amber-500">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-amber-600">
                  <AlertTriangle className="h-5 w-5" />
                  إصلاح دفعات الإلزامي
                </CardTitle>
                <CardDescription>
                  يقوم بإضافة دفعة تلقائية لكل وثيقة إلزامي بدون دفعات.
                  <br />
                  الإلزامي يُدفع مباشرة للشركة، لذا يجب أن تكون كل وثيقة "مدفوعة".
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Show count of unpaid ELZAMI */}
                <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">وثائق إلزامي بدون دفعات:</span>
                    <Badge variant={elzamiUnpaidCount && elzamiUnpaidCount > 0 ? "destructive" : "secondary"}>
                      {elzamiUnpaidCount !== null ? elzamiUnpaidCount : '...'}
                    </Badge>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button 
                    onClick={handleFixElzamiPayments} 
                    disabled={fixingElzami || elzamiUnpaidCount === 0}
                    className="bg-amber-600 hover:bg-amber-700"
                  >
                    {fixingElzami ? (
                      <><Loader2 className="h-4 w-4 ml-2 animate-spin" />جاري الإصلاح...</>
                    ) : (
                      <><Play className="h-4 w-4 ml-2" />إصلاح الدفعات</>
                    )}
                  </Button>
                  
                  <Button 
                    variant="outline" 
                    onClick={fetchUnpaidElzamiCount}
                    disabled={fixingElzami}
                  >
                    <RefreshCw className="h-4 w-4 ml-2" />
                    تحديث العدد
                  </Button>
                </div>

                {/* Results */}
                {elzamiFixStats && (
                  <div className="p-4 border rounded-lg space-y-2 bg-muted">
                    <div className="grid grid-cols-2 gap-4 text-center">
                      <div>
                        <p className="text-sm text-muted-foreground">وثائق بحاجة إصلاح</p>
                        <p className="text-2xl font-bold">{elzamiFixStats.found}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">تم إصلاحها</p>
                        <p className="text-2xl font-bold text-green-600">{elzamiFixStats.fixed}</p>
                      </div>
                    </div>
                    {elzamiFixStats.errors.length > 0 && (
                      <div className="text-sm text-destructive">
                        <p className="font-medium">أخطاء ({elzamiFixStats.errors.length}):</p>
                        <ScrollArea className="h-24 mt-1">
                          {elzamiFixStats.errors.map((err, i) => (
                            <p key={i} className="text-xs">{err}</p>
                          ))}
                        </ScrollArea>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Missing Packages Detection Tool */}
            <Card className="border-2 border-primary">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-primary">
                  <Link2 className="h-5 w-5" />
                  ربط الباقات المفقودة
                </CardTitle>
                <CardDescription>
                  تبحث عن وثائق يجب أن تكون ضمن باقة واحدة:
                  <br />
                  • نفس العميل والسيارة
                  <br />
                  • أُنشئت خلال ساعة واحدة
                  <br />
                  • أنواع مختلفة (إلزامي، ثالث/شامل، خدمات طريق)
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Detection count */}
                <div className="p-3 bg-primary/10 border border-primary/20 rounded-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">باقات مفقودة تم اكتشافها:</span>
                    <Badge variant={missingPackages.length > 0 ? "default" : "secondary"}>
                      {missingPackages.length}
                    </Badge>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button 
                    onClick={detectMissingPackages} 
                    disabled={detectingPackages}
                    variant="outline"
                  >
                    {detectingPackages ? (
                      <><Loader2 className="h-4 w-4 ml-2 animate-spin" />جاري الاكتشاف...</>
                    ) : (
                      <><RefreshCw className="h-4 w-4 ml-2" />اكتشاف الباقات</>
                    )}
                  </Button>
                  
                  <Button 
                    onClick={linkMissingPackages} 
                    disabled={linkingPackages || missingPackages.filter(p => p.selected).length === 0}
                    className="bg-primary hover:bg-primary/90"
                  >
                    {linkingPackages ? (
                      <><Loader2 className="h-4 w-4 ml-2 animate-spin" />جاري الربط...</>
                    ) : (
                    <><Link2 className="h-4 w-4 ml-2" />ربط المحددة ({missingPackages.filter(p => p.selected).length})</>
                    )}
                  </Button>
                </div>

                {/* Search field */}
                {missingPackages.length > 0 && (
                  <div className="relative">
                    <Input
                      placeholder="بحث بالاسم أو رقم السيارة..."
                      value={packageSearch}
                      onChange={(e) => setPackageSearch(e.target.value)}
                      className="pr-3"
                    />
                    {packageSearch && (
                      <span className="text-xs text-muted-foreground mt-1 block">
                        نتائج البحث: {filteredPackages.length} من {missingPackages.length}
                      </span>
                    )}
                  </div>
                )}

                {/* List of missing packages */}
                {filteredPackages.length > 0 && (
                  <ScrollArea className="h-64 border rounded-lg">
                    <div className="divide-y">
                      {filteredPackages.map((pkg) => {
                        const originalIdx = missingPackages.findIndex(
                          p => p.client_id === pkg.client_id && p.car_id === pkg.car_id && p.first_created === pkg.first_created
                        );
                        return (
                          <div 
                            key={`${pkg.client_id}-${pkg.car_id}-${pkg.first_created}`} 
                            className={`p-3 flex items-start gap-3 hover:bg-muted/50 cursor-pointer ${pkg.selected ? 'bg-primary/5' : ''}`}
                            onClick={() => {
                              setMissingPackages(prev => prev.map((p, idx) => 
                                idx === originalIdx ? { ...p, selected: !p.selected } : p
                              ));
                            }}
                          >
                            <Checkbox 
                              checked={pkg.selected}
                              onCheckedChange={(checked) => {
                                setMissingPackages(prev => prev.map((p, idx) => 
                                  idx === originalIdx ? { ...p, selected: !!checked } : p
                                ));
                              }}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium truncate">{pkg.client_name}</span>
                                <Badge variant="outline">{pkg.car_number}</Badge>
                              </div>
                              <div className="text-sm text-muted-foreground mt-1">
                                {pkg.policy_count} وثائق: {pkg.types.join('، ')}
                              </div>
                              <div className="text-sm text-muted-foreground">
                                المجموع: ₪{(pkg.total_price || 0).toLocaleString()}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                )}

                {/* Results */}
                {packageLinkStats && (
                  <div className="p-4 border rounded-lg space-y-2 bg-muted">
                    <div className="grid grid-cols-2 gap-4 text-center">
                      <div>
                        <p className="text-sm text-muted-foreground">باقات تم تحديدها</p>
                        <p className="text-2xl font-bold">{packageLinkStats.found}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">تم ربطها</p>
                        <p className="text-2xl font-bold text-green-600">{packageLinkStats.linked}</p>
                      </div>
                    </div>
                    {packageLinkStats.errors.length > 0 && (
                      <div className="text-sm text-destructive">
                        <p className="font-medium">أخطاء ({packageLinkStats.errors.length}):</p>
                        <ScrollArea className="h-24 mt-1">
                          {packageLinkStats.errors.map((err, i) => (
                            <p key={i} className="text-xs">{err}</p>
                          ))}
                        </ScrollArea>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Clear POL- Policy Numbers Tool */}
            <Card className="border-2 border-destructive">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-destructive">
                  <Trash2 className="h-5 w-5" />
                  مسح أرقام البوليصة (POL-)
                </CardTitle>
                <CardDescription>
                  يقوم بمسح أرقام البوليصة التي تبدأ بـ POL- لأنها أرقام خاطئة.
                  <br />
                  رقم البوليصة الصحيح يأتي من شركة التأمين.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Show count */}
                <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">وثائق تحتوي أرقام POL-:</span>
                    <Badge variant={polNumbersCount && polNumbersCount > 0 ? "destructive" : "secondary"}>
                      {polNumbersCount !== null ? polNumbersCount.toLocaleString() : '...'}
                    </Badge>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button 
                    onClick={handleClearPolNumbers} 
                    disabled={clearingPolNumbers || polNumbersCount === 0}
                    variant="destructive"
                  >
                    {clearingPolNumbers ? (
                      <><Loader2 className="h-4 w-4 ml-2 animate-spin" />جاري المسح...</>
                    ) : (
                      <><Trash2 className="h-4 w-4 ml-2" />مسح الأرقام</>
                    )}
                  </Button>
                  
                  <Button 
                    variant="outline" 
                    onClick={fetchPolNumbersCount}
                    disabled={clearingPolNumbers}
                  >
                    <RefreshCw className="h-4 w-4 ml-2" />
                    تحديث العدد
                  </Button>
                </div>

                {/* Results */}
                {polNumbersClearStats && (
                  <div className="p-4 border rounded-lg space-y-2 bg-muted">
                    <div className="grid grid-cols-2 gap-4 text-center">
                      <div>
                        <p className="text-sm text-muted-foreground">وثائق تم العثور عليها</p>
                        <p className="text-2xl font-bold">{polNumbersClearStats.found.toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">تم مسحها</p>
                        <p className="text-2xl font-bold text-green-600">{polNumbersClearStats.cleared.toLocaleString()}</p>
                      </div>
                    </div>
                    {polNumbersClearStats.errors.length > 0 && (
                      <div className="text-sm text-destructive">
                        <p className="font-medium">أخطاء ({polNumbersClearStats.errors.length}):</p>
                        <ScrollArea className="h-24 mt-1">
                          {polNumbersClearStats.errors.map((err, i) => (
                            <p key={i} className="text-xs">{err}</p>
                          ))}
                        </ScrollArea>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="errors" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <XCircle className="h-5 w-5 text-destructive" />
                    سجل الأخطاء
                  </span>
                  {importStats && Object.values(importStats).some(s => s.errors.length > 0) && (
                    <Button variant="outline" size="sm" onClick={exportErrorsToCSV}>
                      <Download className="h-4 w-4 ml-2" />
                      تصدير CSV
                    </Button>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {importStats ? (
                  <ScrollArea className="h-96 border rounded p-4">
                    {Object.values(importStats).every(s => s.errors.length === 0) ? (
                      <p className="text-center text-muted-foreground py-8">لا توجد أخطاء مسجلة</p>
                    ) : (
                      <div className="space-y-2">
                        {Object.entries(importStats).map(([key, stats]) =>
                          stats.errors.map((err, i) => (
                            <div key={`${key}-${i}`} className="p-2 border rounded text-sm">
                              <div className="flex items-center justify-between">
                                <Badge variant="outline">{err.entity}</Badge>
                                <span className="text-xs text-muted-foreground">{new Date(err.timestamp).toLocaleTimeString('ar-EG')}</span>
                              </div>
                              <p className="mt-1"><strong>المعرف:</strong> {err.identifier}</p>
                              <p className="text-destructive">{err.reason}</p>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </ScrollArea>
                ) : (
                  <p className="text-center text-muted-foreground py-8">قم بتشغيل الاستيراد أولاً لمشاهدة الأخطاء</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
};

export default WordPressImport;
